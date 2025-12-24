/**
 * MicProbe - Ana Uygulama
 * OCP Mimarisi: Moduller arasi EventBus ile iletisim
 *
 * Toggle Ayarlari:
 * - EC/NS/AGC: getUserMedia constraint'leri (mikrofon seviyesi)
 * - WebAudio: Ses islemede AudioContext kullanilsin mi
 * - Loopback: WebRTC simulasyonu (WhatsApp benzeri) aktif mi
 */
import eventBus from './modules/EventBus.js';
import Logger from './modules/Logger.js';
import logManager from './modules/LogManager.js';
import audioEngine from './modules/AudioEngine.js';
import VuMeter from './modules/VuMeter.js';
import Player from './modules/Player.js';
import Recorder from './modules/Recorder.js';
import Monitor from './modules/Monitor.js';
import StatusManager from './modules/StatusManager.js';
import DeviceInfo from './modules/DeviceInfo.js';
import { formatTime, getBestAudioMimeType } from './modules/utils.js';
import { createPassthroughWorkletNode, ensurePassthroughWorklet, isAudioWorkletSupported } from './modules/WorkletHelper.js';
import { PROFILES } from './modules/Config.js';

// Modulleri baslat
const logger = new Logger('log');

const vuMeter = new VuMeter({
  barId: 'vuMeterBar',
  peakId: 'vuMeterPeak',
  dotId: 'signalDot'
});

const player = new Player({
  containerId: 'recordingPlayer',
  playBtnId: 'playBtn',
  progressBarId: 'progressBar',
  progressFillId: 'progressFill',
  timeId: 'playerTime',
  filenameId: 'playerFilename',
  metaId: 'playerMeta',
  downloadBtnId: 'downloadBtn',
  noRecordingId: 'noRecording'
});

const recorder = new Recorder({
  constraints: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
});

const monitor = new Monitor();

const statusManager = new StatusManager('statusBadge');

const deviceInfo = new DeviceInfo();

// ============================================
// UI ELEMENT REFERANSLARI
// ============================================
const recordToggleBtn = document.getElementById('recordToggle');
const monitorToggleBtn = document.getElementById('monitorToggle');
const webaudioToggle = document.getElementById('webaudioToggle');
const loopbackToggle = document.getElementById('loopbackToggle');

// Ayar checkboxlari
const ecCheckbox = document.getElementById('ec');
const nsCheckbox = document.getElementById('ns');
const agcCheckbox = document.getElementById('agc');

// Opus Bitrate secici
const opusBitrateContainer = document.getElementById('opusBitrateContainer');

// Timeslice Test secici
const timesliceInfoEl = document.getElementById('timesliceInfo');

// Islem modu (kayit + monitor icin ortak)
const processingModeContainer = document.getElementById('processingModeContainer');

// Kayit oynatici kontrolleri
const recordingPlayerEl = document.getElementById('recordingPlayer');
const recordingPlayerCardEl = recordingPlayerEl ? recordingPlayerEl.closest('.card') : null;
const playBtnEl = document.getElementById('playBtn');
const downloadBtnEl = document.getElementById('downloadBtn');
const progressBarEl = document.getElementById('progressBar');

// Timeslice container (kayit modu icin)
const timesliceContainerEl = document.querySelector('.timeslice-container');

// Profil secici
const profileSelector = document.getElementById('profileSelector');
const profileDescEl = document.getElementById('profileDesc');
const advancedSettingsEl = document.getElementById('advancedSettings');

// Mikrofon secici
const micSelector = document.getElementById('micSelector');
const refreshMicsBtn = document.getElementById('refreshMics');

// ============================================
// MIKROFON LISTESI
// ============================================
let selectedDeviceId = ''; // Bos = varsayilan

async function enumerateMicrophones() {
  try {
    // Izin almak icin once getUserMedia cagir (enumerateDevices icin gerekli)
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach(t => t.stop()); // Hemen kapat

    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === 'audioinput');

    // Dropdown'u temizle
    micSelector.innerHTML = '<option value="">Varsayilan mikrofon</option>';

    mics.forEach((mic, index) => {
      const option = document.createElement('option');
      option.value = mic.deviceId;
      option.textContent = mic.label || `Mikrofon ${index + 1}`;
      if (mic.deviceId === selectedDeviceId) {
        option.selected = true;
      }
      micSelector.appendChild(option);
    });

    eventBus.emit('log:stream', {
      message: `${mics.length} mikrofon bulundu`,
      details: { devices: mics.map(m => m.label || m.deviceId.slice(0, 8)) }
    });
  } catch (err) {
    eventBus.emit('log:error', {
      category: 'stream',
      message: 'Mikrofon listesi alinamadi',
      details: { error: err.message }
    });
  }
}

function getSelectedDeviceId() {
  return micSelector?.value || '';
}

// Mikrofon listesini izinsiz almaya calis (label'lar bos olabilir)
async function tryEnumerateWithoutPermission() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === 'audioinput');

    // Izin yoksa label'lar bos olur
    const hasLabels = mics.some(m => m.label);

    micSelector.innerHTML = '<option value="">Varsayilan mikrofon</option>';

    if (hasLabels) {
      mics.forEach((mic, index) => {
        const option = document.createElement('option');
        option.value = mic.deviceId;
        option.textContent = mic.label || `Mikrofon ${index + 1}`;
        micSelector.appendChild(option);
      });
    } else if (mics.length > 1) {
      // Izin yok ama birden fazla mikrofon var
      micSelector.innerHTML = '<option value="">Listelemek icin 🔄 tikla</option>';
    }
  } catch (err) {
    // Sessizce hata - izin yok demek
  }
}

// Sayfa yuklendiginde izinsiz listele (label'lar bos olabilir)
tryEnumerateWithoutPermission();

// Yenile butonu - izin isteyerek tam liste al
if (refreshMicsBtn) {
  refreshMicsBtn.addEventListener('click', () => {
    enumerateMicrophones();
  });
}

// Mikrofon secimi degistiginde
if (micSelector) {
  micSelector.addEventListener('change', (e) => {
    selectedDeviceId = e.target.value;
    const selectedOption = micSelector.options[micSelector.selectedIndex];
    eventBus.emit('log:stream', {
      message: `Mikrofon secildi: ${selectedOption.textContent}`,
      details: { deviceId: selectedDeviceId || 'default' }
    });
  });
}

// ============================================
// SENARYO PROFILLERI - Config.js'den import edildi
// ============================================

function applyProfile(profileId) {
  const profile = PROFILES[profileId];
  if (!profile) return;

  const isCustom = profileId === 'custom';
  const values = profile.values; // null for custom

  if (profileDescEl) profileDescEl.textContent = profile.desc;

  // Ayarlari disable/enable et (gorunur kalir)
  if (advancedSettingsEl) {
    advancedSettingsEl.classList.toggle('profile-locked', !isCustom);
  }

  // Tum input'lari disable/enable et
  const settingsInputs = advancedSettingsEl?.querySelectorAll('input, select') || [];
  settingsInputs.forEach(input => {
    input.disabled = !isCustom;
  });

  // Ozel profil: sadece kilidi kaldir, ayarlara dokunma
  if (isCustom || !values) {
    eventBus.emit('log', `Profil: ${profile.label} (manual kontrol)`);
    return;
  }

  // Diger profiller: ayarlari uygula
  ecCheckbox.checked = values.ec;
  nsCheckbox.checked = values.ns;
  agcCheckbox.checked = values.agc;
  webaudioToggle.checked = values.webaudio;
  loopbackToggle.checked = values.loopback;

  // Radio'lari sec
  const modeRadio = document.querySelector(`input[name="processingMode"][value="${values.mode}"]`);
  if (modeRadio) modeRadio.checked = true;

  const bitrateRadio = document.querySelector(`input[name="bitrate"][value="${values.bitrate}"]`);
  if (bitrateRadio) bitrateRadio.checked = true;

  const timesliceRadio = document.querySelector(`input[name="timeslice"][value="${values.timeslice}"]`);
  if (timesliceRadio) timesliceRadio.checked = true;

  // UI gorunurluklerini guncelle (gorunur ama disabled)
  processingModeContainer.style.display = values.webaudio ? 'block' : 'none';
  opusBitrateContainer.style.display = values.loopback ? 'block' : 'none';

  // Timeslice info guncelle
  updateTimesliceInfo(values.timeslice);

  eventBus.emit('log', `Profil: ${profile.label}`);
  eventBus.emit('log:system', {
    message: 'Profil uygulandi',
    details: { profileId, ...values }
  });
}

// ============================================
// AYAR OKUMA FONKSIYONLARI
// ============================================
function getConstraints() {
  const constraints = {
    echoCancellation: ecCheckbox.checked,
    noiseSuppression: nsCheckbox.checked,
    autoGainControl: agcCheckbox.checked
  };

  // Secilen mikrofonu ekle
  const deviceId = getSelectedDeviceId();
  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  }

  return constraints;
}

function isWebAudioEnabled() {
  return webaudioToggle.checked;
}

function getProcessingMode() {
  const selected = document.querySelector('input[name="processingMode"]:checked');
  return selected ? selected.value : 'webaudio';
}

function isLoopbackEnabled() {
  return loopbackToggle.checked;
}

function getOpusBitrate() {
  const selected = document.querySelector('input[name="bitrate"]:checked');
  return selected ? parseInt(selected.value, 10) : 32000;
}

function getTimeslice() {
  const selected = document.querySelector('input[name="timeslice"]:checked');
  return selected ? parseInt(selected.value, 10) : 0;
}

function createAudioMediaRecorder(stream) {
  const preferredMimeType = getBestAudioMimeType();
  if (preferredMimeType) {
    try {
      return new MediaRecorder(stream, { mimeType: preferredMimeType });
    } catch (err) {
      eventBus.emit('log:recorder', {
        message: 'MediaRecorder mimeType fallback (preferred desteklenmedi)',
        details: { preferredMimeType, error: err.message }
      });
    }
  }
  return new MediaRecorder(stream);
}

// Timeslice info metnini guncelle
function updateTimesliceInfo(value) {
  if (!timesliceInfoEl) return;

  const infoText = timesliceInfoEl.querySelector('.info-text');
  if (!infoText) return;

  // Temizle
  infoText.classList.remove('warning', 'danger');

  if (value === 0) {
    infoText.textContent = 'OFF: Tek chunk - timeslice yok';
  } else {
    const chunksPerSec = 1000 / value;
    infoText.textContent = `${value}ms: ~${chunksPerSec.toFixed(1)} chunk/sn - Citirtı frekansını dinle!`;

    if (value <= 100) {
      infoText.classList.add('danger');
    } else if (value <= 250) {
      infoText.classList.add('warning');
    }
  }
}

// ============================================
// AYAR DEGISIKLIK LOGLARI
// ============================================
ecCheckbox.addEventListener('change', (e) => {
  eventBus.emit('log:stream', {
    message: `Echo Cancellation: ${e.target.checked ? 'ACIK' : 'KAPALI'}`,
    details: { setting: 'echoCancellation', value: e.target.checked }
  });
});

nsCheckbox.addEventListener('change', (e) => {
  eventBus.emit('log:stream', {
    message: `Noise Suppression: ${e.target.checked ? 'ACIK' : 'KAPALI'}`,
    details: { setting: 'noiseSuppression', value: e.target.checked }
  });
});

agcCheckbox.addEventListener('change', (e) => {
  eventBus.emit('log:stream', {
    message: `Auto Gain Control: ${e.target.checked ? 'ACIK' : 'KAPALI'}`,
    details: { setting: 'autoGainControl', value: e.target.checked }
  });
});

webaudioToggle.addEventListener('change', (e) => {
  const isEnabled = e.target.checked;
  processingModeContainer.style.display = isEnabled ? 'block' : 'none';

  eventBus.emit('log:webaudio', {
    message: `WebAudio Pipeline: ${isEnabled ? 'AKTIF' : 'PASIF'}`,
    details: {
      setting: 'webAudioEnabled',
      value: isEnabled,
      note: isEnabled ? 'Kayit/monitor icin WebAudio graph secilebilir' : 'VU Meter icin AudioContext kullanimi devam edebilir'
    }
  });
});

// Islem modu degisikligi loglama
document.querySelectorAll('input[name="processingMode"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const mode = e.target.value;
    const labelByMode = {
      direct: 'Direct',
      webaudio: 'WebAudio',
      scriptprocessor: 'ScriptProcessor',
      worklet: 'AudioWorklet'
    };

    eventBus.emit('log:webaudio', {
      message: `Islem Modu: ${labelByMode[mode] || mode}`,
      details: { setting: 'processingMode', value: mode }
    });
  });
});

loopbackToggle.addEventListener('change', (e) => {
  // Bitrate seciciyi goster/gizle
  opusBitrateContainer.style.display = e.target.checked ? 'block' : 'none';

  eventBus.emit('log:stream', {
    message: `WebRTC Loopback: ${e.target.checked ? 'AKTIF' : 'PASIF'}`,
    details: { setting: 'loopbackEnabled', value: e.target.checked }
  });
});

// Bitrate degisikligi loglama
document.querySelectorAll('input[name="bitrate"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const bitrate = parseInt(e.target.value, 10);
    eventBus.emit('log:stream', {
      message: `Opus Bitrate: ${bitrate / 1000} kbps`,
      details: { setting: 'opusBitrate', value: bitrate }
    });
  });
});

// Timeslice degisikligi loglama
document.querySelectorAll('input[name="timeslice"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    const timeslice = parseInt(e.target.value, 10);
    updateTimesliceInfo(timeslice);

    eventBus.emit('log:recorder', {
      message: `Timeslice: ${timeslice === 0 ? 'OFF' : timeslice + 'ms'}`,
      details: {
        setting: 'timeslice',
        value: timeslice,
        chunksPerSec: timeslice > 0 ? (1000 / timeslice).toFixed(1) : 'N/A'
      }
    });
  });
});

// Profil degisikligi
if (profileSelector) {
  profileSelector.addEventListener('change', (e) => {
    applyProfile(e.target.value);
  });

  // Sayfa yuklendiginde varsayilan profili uygula
  applyProfile(profileSelector.value);
}

// ============================================
// MERKEZI STATE YONETIMI
// ============================================
// Modlar: null (idle), 'recording', 'monitoring'
let currentMode = null;

// Timer state
let timerInterval = null;
let timerStartTime = null;
const timerEl = document.getElementById('recordingTimer');

function startTimer(isMonitoring = false) {
  if (!timerEl) return;
  // Monitoring icin sayaç gereksiz (kayıt yok). UI'yi temiz tut.
  if (isMonitoring) return;

  timerStartTime = Date.now();
  timerEl.textContent = '0:00';
  timerEl.style.display = 'block';
  timerEl.classList.toggle('monitoring', isMonitoring);

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - timerStartTime) / 1000);
    timerEl.textContent = formatTime(elapsed);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (timerEl) {
    timerEl.style.display = 'none';
    timerEl.classList.remove('monitoring');
  }
}

// Loopback WebRTC kaynaklari
let loopbackPc1 = null;
let loopbackPc2 = null;
let loopbackLocalStream = null;
let loopbackRemoteStream = null;
let loopbackAudioCtx = null;

// Loopback monitor playback kaynaklari (remote stream -> delay -> speaker)
let loopbackMonitorCtx = null;
let loopbackMonitorSrc = null;
let loopbackMonitorProc = null;
let loopbackMonitorWorklet = null;
let loopbackMonitorDelay = null;
let loopbackMonitorMode = null;

const WORKLET_SUPPORTED = isAudioWorkletSupported();

function updateButtonStates() {
  const isIdle = currentMode === null;
  const isRecording = currentMode === 'recording';
  const isMonitoring = currentMode === 'monitoring';

  // Toggle butonlarin active state'leri
  recordToggleBtn.classList.toggle('active', isRecording);
  monitorToggleBtn.classList.toggle('active', isMonitoring);

  // Monitoring sirasinda kayit butonunu disable et ve tersi
  recordToggleBtn.disabled = isMonitoring;
  monitorToggleBtn.disabled = isRecording;

  // Monitoring sirasinda kayit tarafini tamamen kilitle
  const disableRecordingUi = isMonitoring;
  processingModeContainer?.classList.toggle('ui-disabled', !isIdle);
  timesliceContainerEl?.classList.toggle('ui-disabled', disableRecordingUi);
  recordingPlayerCardEl?.classList.toggle('ui-disabled', disableRecordingUi);

  if (playBtnEl) {
    playBtnEl.disabled = disableRecordingUi;
  }

  if (progressBarEl) {
    progressBarEl.style.pointerEvents = disableRecordingUi ? 'none' : '';
  }

  if (downloadBtnEl) {
    downloadBtnEl.classList.toggle('disabled', disableRecordingUi);
    downloadBtnEl.setAttribute('aria-disabled', disableRecordingUi ? 'true' : 'false');

    if (disableRecordingUi) {
      const currentHref = downloadBtnEl.getAttribute('href');
      if (currentHref) downloadBtnEl.dataset.href = currentHref;
      downloadBtnEl.removeAttribute('href');
      downloadBtnEl.tabIndex = -1;
    } else {
      if (!downloadBtnEl.getAttribute('href') && downloadBtnEl.dataset.href) {
        downloadBtnEl.setAttribute('href', downloadBtnEl.dataset.href);
      }
      delete downloadBtnEl.dataset.href;
      downloadBtnEl.tabIndex = 0;
    }
  }

  // Ayar toggle'lari - aktif mod varken degistirilemez
  webaudioToggle.disabled = !isIdle;
  loopbackToggle.disabled = !isIdle;
  ecCheckbox.disabled = !isIdle;
  nsCheckbox.disabled = !isIdle;
  agcCheckbox.disabled = !isIdle;

  // Processing mode selector - aktif session'da degistirilemez
  document.querySelectorAll('input[name="processingMode"]').forEach(radio => {
    radio.disabled = !isIdle || (radio.value === 'worklet' && !WORKLET_SUPPORTED);
  });

  // Bitrate selector - aktif session'da degistirilemez
  document.querySelectorAll('input[name="bitrate"]').forEach(radio => {
    radio.disabled = !isIdle;
  });

  // Timeslice selector - aktif session'da degistirilemez
  document.querySelectorAll('input[name="timeslice"]').forEach(radio => {
    radio.disabled = !isIdle;
  });
}

// Baslangicta buton durumlarini ayarla
updateButtonStates();

// UI state sync (refresh/persisted checkbox senaryolari icin)
processingModeContainer.style.display = isWebAudioEnabled() ? 'block' : 'none';

if (!WORKLET_SUPPORTED) {
  eventBus.emit('log:system', {
    message: 'AudioWorklet desteklenmiyor - Worklet secenekleri devre disi',
    details: {}
  });
}

// ============================================
// WEBRTC LOOPBACK YARDIMCI FONKSIYONLARI
// ============================================

/**
 * SDP'yi Opus bitrate ile modifiye et
 * @param {string} sdp - Orijinal SDP
 * @param {number} bitrate - Hedef bitrate (bps)
 * @returns {string} Modifiye edilmis SDP
 */
function setOpusBitrate(sdp, bitrate) {
  // Opus codec'in fmtp satirini bul ve maxaveragebitrate ekle
  // Ornek: a=fmtp:111 minptime=10;useinbandfec=1
  // Hedef: a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=32000

  const lines = sdp.split('\r\n');
  const modifiedLines = lines.map(line => {
    // Opus fmtp satirini bul
    if (line.startsWith('a=fmtp:') && line.includes('useinbandfec')) {
      // Mevcut maxaveragebitrate varsa kaldir
      let newLine = line.replace(/;?maxaveragebitrate=\d+/g, '');
      // Yeni bitrate ekle
      newLine += `;maxaveragebitrate=${bitrate}`;
      return newLine;
    }
    return line;
  });

  return modifiedLines.join('\r\n');
}

/**
 * WebRTC loopback baglantisi kurar
 * Mikrofon -> PeerConnection1 -> PeerConnection2 -> Remote Stream
 * @returns {Promise<MediaStream>} Remote stream (WebRTC'den gelen ses)
 */
async function setupLoopback(localStream, useWebAudio) {
  eventBus.emit('log:stream', {
    message: 'WebRTC Loopback kuruluyor',
    details: { useWebAudio }
  });

  // WebAudio pipeline (opsiyonel)
  let sendStream = localStream;
  if (useWebAudio) {
    // Mikrofon stream'inin sample rate'ini al
    const localTrack = localStream.getAudioTracks()[0];
    const localSettings = localTrack?.getSettings() || {};
    const localSampleRate = localSettings.sampleRate;

    // AudioContext'i mikrofon sample rate ile olustur
    const acOptions = localSampleRate ? { sampleRate: localSampleRate } : {};
    loopbackAudioCtx = new (window.AudioContext || window.webkitAudioContext)(acOptions);

    // AudioContext suspended olabilir - resume et
    if (loopbackAudioCtx.state === 'suspended') {
      await loopbackAudioCtx.resume();
    }

    const src = loopbackAudioCtx.createMediaStreamSource(localStream);
    const dest = loopbackAudioCtx.createMediaStreamDestination();
    src.connect(dest);
    sendStream = dest.stream;

    eventBus.emit('log:webaudio', {
      message: 'Loopback: WebAudio pipeline aktif',
      details: {
        contextSampleRate: loopbackAudioCtx.sampleRate,
        micSampleRate: localSampleRate || 'N/A',
        sampleRateMatch: !localSampleRate || localSampleRate === loopbackAudioCtx.sampleRate,
        state: loopbackAudioCtx.state,
        sendStreamActive: sendStream.active
      }
    });
  }

  // PeerConnection'lar
  loopbackPc1 = new RTCPeerConnection({ iceServers: [] });
  loopbackPc2 = new RTCPeerConnection({ iceServers: [] });

  loopbackPc1.onicecandidate = (e) => {
    if (e.candidate) loopbackPc2.addIceCandidate(e.candidate);
  };
  loopbackPc2.onicecandidate = (e) => {
    if (e.candidate) loopbackPc1.addIceCandidate(e.candidate);
  };

  // Track handler - WebRTC'nin sagladigi stream'i kullan
  loopbackPc2.ontrack = (e) => {
    eventBus.emit('log:stream', {
      message: 'Loopback: Remote track alindi',
      details: {
        trackKind: e.track.kind,
        trackId: e.track.id,
        trackEnabled: e.track.enabled,
        trackMuted: e.track.muted,
        trackReadyState: e.track.readyState,
        hasStreams: e.streams?.length > 0,
        streamId: e.streams?.[0]?.id
      }
    });

    // KRITIK: WebRTC'nin sagladigi stream'i kullan, manuel olusturma!
    if (e.streams && e.streams.length > 0) {
      loopbackRemoteStream = e.streams[0];
      eventBus.emit('log:stream', {
        message: 'Loopback: WebRTC stream kullaniliyor',
        details: { streamId: loopbackRemoteStream.id, active: loopbackRemoteStream.active }
      });
    } else {
      // Fallback: Manuel stream olustur (eski yontem)
      if (!loopbackRemoteStream) {
        loopbackRemoteStream = new MediaStream();
      }
      loopbackRemoteStream.addTrack(e.track);
      eventBus.emit('log:stream', {
        message: 'Loopback: Manuel stream olusturuldu (fallback)',
        details: {}
      });
    }
  };

  // Track ekle
  sendStream.getAudioTracks().forEach(track => {
    loopbackPc1.addTrack(track, sendStream);
  });

  // Opus bitrate ayarini al
  const opusBitrate = getOpusBitrate();

  // SDP exchange - TUM ADIMLARI AWAIT ILE BEKLE
  const offer = await loopbackPc1.createOffer({ offerToReceiveAudio: true });

  // Offer SDP'yi Opus bitrate ile modifiye et
  const modifiedOfferSdp = setOpusBitrate(offer.sdp, opusBitrate);
  const modifiedOffer = { type: offer.type, sdp: modifiedOfferSdp };

  eventBus.emit('log:stream', {
    message: `Loopback: Opus bitrate ayarlandi - ${opusBitrate / 1000} kbps`,
    details: { opusBitrate, sdpModified: modifiedOfferSdp !== offer.sdp }
  });

  await loopbackPc1.setLocalDescription(modifiedOffer);
  await loopbackPc2.setRemoteDescription(modifiedOffer); // ontrack burada tetiklenir

  const answer = await loopbackPc2.createAnswer();

  // Answer SDP'yi de Opus bitrate ile modifiye et
  const modifiedAnswerSdp = setOpusBitrate(answer.sdp, opusBitrate);
  const modifiedAnswer = { type: answer.type, sdp: modifiedAnswerSdp };

  await loopbackPc2.setLocalDescription(modifiedAnswer);
  await loopbackPc1.setRemoteDescription(modifiedAnswer);

  // ICE baglanti durumunu bekle (connectionState yerine iceConnectionState)
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      eventBus.emit('log:error', {
        message: 'Loopback: ICE baglanti zaman asimi',
        details: {
          pc1Ice: loopbackPc1.iceConnectionState,
          pc2Ice: loopbackPc2.iceConnectionState
        }
      });
      reject(new Error('ICE connection timeout'));
    }, 10000); // 10 saniye timeout

    // Son durumlari takip et - sadece degisiklikte logla
    let lastIce1 = null;
    let lastIce2 = null;

    const checkConnection = () => {
      const ice1 = loopbackPc1.iceConnectionState;
      const ice2 = loopbackPc2.iceConnectionState;

      // Sadece durum degistiginde logla
      if (ice1 !== lastIce1 || ice2 !== lastIce2) {
        eventBus.emit('log:stream', {
          message: `Loopback: ICE durumu ${ice1}/${ice2}`,
          details: {
            pc1Ice: ice1,
            pc2Ice: ice2
          }
        });
        lastIce1 = ice1;
        lastIce2 = ice2;
      }

      // ICE "connected" veya "completed" olmali
      if ((ice1 === 'connected' || ice1 === 'completed') &&
          (ice2 === 'connected' || ice2 === 'completed')) {
        clearTimeout(timeout);
        resolve();
      } else if (ice1 === 'failed' || ice2 === 'failed') {
        clearTimeout(timeout);
        reject(new Error('ICE connection failed'));
      } else {
        // 100ms sonra tekrar kontrol
        setTimeout(checkConnection, 100);
      }
    };

    // Event listener da ekle
    loopbackPc1.oniceconnectionstatechange = checkConnection;
    loopbackPc2.oniceconnectionstatechange = checkConnection;

    // Hemen kontrol et
    checkConnection();
  });

  // Stream kontrolu
  if (!loopbackRemoteStream) {
    throw new Error('Remote stream olusturulamadi - ontrack tetiklenmedi');
  }

  const remoteTrack = loopbackRemoteStream.getAudioTracks()[0];

  // Track muted ise unmute olmasini bekle
  if (remoteTrack && remoteTrack.muted) {
    eventBus.emit('log:stream', {
      message: 'Loopback: Track muted, unmute bekleniyor...',
      details: { muted: remoteTrack.muted }
    });

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        eventBus.emit('log:error', {
          message: 'Loopback: Track unmute zaman asimi',
          details: { stillMuted: remoteTrack.muted }
        });
        // Zaman asiminda da devam et, belki calisir
        resolve();
      }, 5000);

      remoteTrack.onunmute = () => {
        clearTimeout(timeout);
        eventBus.emit('log:stream', {
          message: 'Loopback: Track unmuted!',
          details: { muted: remoteTrack.muted }
        });
        resolve();
      };

      // Zaten unmuted ise hemen devam
      if (!remoteTrack.muted) {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  // Kisa bir bekleme - audio akisi baslasin
  await new Promise(resolve => setTimeout(resolve, 500));

  eventBus.emit('log:stream', {
    message: `Loopback: WebRTC baglantisi kuruldu - ICE:${loopbackPc1.iceConnectionState}/${loopbackPc2.iceConnectionState} Track:${remoteTrack?.readyState} Muted:${remoteTrack?.muted}`,
    details: {
      pc1Ice: loopbackPc1.iceConnectionState,
      pc2Ice: loopbackPc2.iceConnectionState,
      remoteTrackCount: loopbackRemoteStream.getAudioTracks().length,
      remoteTrackEnabled: remoteTrack?.enabled,
      remoteTrackReadyState: remoteTrack?.readyState,
      remoteTrackMuted: remoteTrack?.muted,
      remoteTrackLabel: remoteTrack?.label,
      streamActive: loopbackRemoteStream.active
    }
  });

  return loopbackRemoteStream;
}

/**
 * Loopback kaynaklarini temizler
 */
async function cleanupLoopback() {
  loopbackPc1?.close();
  loopbackPc2?.close();
  loopbackPc1 = null;
  loopbackPc2 = null;

  loopbackRemoteStream?.getTracks().forEach(t => t.stop());
  loopbackRemoteStream = null;

  if (loopbackAudioCtx) {
    await loopbackAudioCtx.close();
    loopbackAudioCtx = null;
  }

  eventBus.emit('log:stream', {
    message: 'Loopback: Kaynaklar temizlendi',
    details: {}
  });
}

async function cleanupLoopbackMonitorPlayback() {
  if (loopbackMonitorProc) {
    try {
      loopbackMonitorProc.disconnect();
    } catch {
      // ignore
    }
    loopbackMonitorProc.onaudioprocess = null;
    loopbackMonitorProc = null;
  }

  if (loopbackMonitorWorklet) {
    try {
      loopbackMonitorWorklet.disconnect();
    } catch {
      // ignore
    }
    loopbackMonitorWorklet = null;
  }

  if (loopbackMonitorDelay) {
    try {
      loopbackMonitorDelay.disconnect();
    } catch {
      // ignore
    }
    loopbackMonitorDelay = null;
  }

  if (loopbackMonitorSrc) {
    try {
      loopbackMonitorSrc.disconnect();
    } catch {
      // ignore
    }
    loopbackMonitorSrc = null;
  }

  if (loopbackMonitorCtx) {
    try {
      const prevState = loopbackMonitorCtx.state;
      await loopbackMonitorCtx.close();
      eventBus.emit('log:webaudio', {
        message: 'Loopback Monitor: AudioContext kapatildi',
        details: { previousState: prevState, newState: 'closed' }
      });
    } catch (err) {
      eventBus.emit('log:error', {
        message: 'Loopback Monitor: AudioContext kapatma hatasi',
        details: { error: err.message }
      });
    } finally {
      loopbackMonitorCtx = null;
    }
  }

  if (window._loopbackMonitorActivatorAudio) {
    try {
      window._loopbackMonitorActivatorAudio.pause();
      window._loopbackMonitorActivatorAudio.srcObject = null;
    } catch {
      // ignore
    }
    window._loopbackMonitorActivatorAudio = null;
  }

  loopbackMonitorMode = null;
}

async function startLoopbackMonitorPlayback(remoteStream, requestedMode) {
  await cleanupLoopbackMonitorPlayback();

  if (!remoteStream) {
    throw new Error('Loopback Monitor: remote stream yok');
  }

  const safeMode = (() => {
    const allowed = new Set(['direct', 'webaudio', 'scriptprocessor', 'worklet']);
    if (!allowed.has(requestedMode)) return 'webaudio';
    if (requestedMode === 'worklet' && !WORKLET_SUPPORTED) return 'webaudio';
    return requestedMode;
  })();

  loopbackMonitorMode = safeMode;

  // Chrome/WebRTC: Remote stream'i WebAudio'ya baglamadan once Audio element ile aktive et
  const activatorAudio = document.createElement('audio');
  activatorAudio.srcObject = remoteStream;
  activatorAudio.muted = true;
  activatorAudio.volume = 0;
  activatorAudio.playsInline = true;
  window._loopbackMonitorActivatorAudio = activatorAudio;

  try {
    await activatorAudio.play();
    eventBus.emit('log:webaudio', {
      message: 'Loopback Monitor: Activator audio baslatildi',
      details: { paused: activatorAudio.paused, muted: activatorAudio.muted }
    });
  } catch (playErr) {
    eventBus.emit('log:error', {
      message: 'Loopback Monitor: Activator audio play hatasi (devam ediliyor)',
      details: { error: playErr.message }
    });
  }

  // Remote track sample rate (varsa) ile context olustur
  const remoteTrack = remoteStream.getAudioTracks?.()[0];
  const remoteSettings = remoteTrack?.getSettings?.() || {};
  const remoteSampleRate = remoteSettings.sampleRate;
  const acOptions = remoteSampleRate ? { sampleRate: remoteSampleRate } : {};

  loopbackMonitorCtx = new (window.AudioContext || window.webkitAudioContext)(acOptions);

  if (loopbackMonitorCtx.state === 'suspended') {
    await loopbackMonitorCtx.resume();
  }

  loopbackMonitorSrc = loopbackMonitorCtx.createMediaStreamSource(remoteStream);

  // DelayNode olustur - 2 saniye gecikme
  loopbackMonitorDelay = loopbackMonitorCtx.createDelay(3.0);
  loopbackMonitorDelay.delayTime.value = 2.0;

  const delaySeconds = loopbackMonitorDelay.delayTime.value;

  if (safeMode === 'scriptprocessor') {
    const bufferSize = 1024;
    const channelCount = Math.min(2, loopbackMonitorSrc.channelCount || 1);
    loopbackMonitorProc = loopbackMonitorCtx.createScriptProcessor(bufferSize, channelCount, channelCount);
    loopbackMonitorProc.onaudioprocess = (e) => {
      const inputBuffer = e.inputBuffer;
      const outputBuffer = e.outputBuffer;
      const channels = Math.min(inputBuffer.numberOfChannels, outputBuffer.numberOfChannels);
      for (let ch = 0; ch < channels; ch++) {
        const input = inputBuffer.getChannelData(ch);
        const output = outputBuffer.getChannelData(ch);
        output.set(input);
      }
    };

    loopbackMonitorSrc.connect(loopbackMonitorProc);
    loopbackMonitorProc.connect(loopbackMonitorDelay);
  } else if (safeMode === 'worklet') {
    await ensurePassthroughWorklet(loopbackMonitorCtx);
    loopbackMonitorWorklet = createPassthroughWorkletNode(loopbackMonitorCtx);
    loopbackMonitorSrc.connect(loopbackMonitorWorklet);
    loopbackMonitorWorklet.connect(loopbackMonitorDelay);
  } else {
    // direct / webaudio: Source -> Delay
    loopbackMonitorSrc.connect(loopbackMonitorDelay);
  }

  loopbackMonitorDelay.connect(loopbackMonitorCtx.destination);

  const graphByMode = {
    direct: `WebRTC RemoteStream -> Source -> DelayNode(${delaySeconds}s) -> Destination`,
    webaudio: `WebRTC RemoteStream -> Source -> DelayNode(${delaySeconds}s) -> Destination`,
    scriptprocessor: `WebRTC RemoteStream -> Source -> ScriptProcessor -> DelayNode(${delaySeconds}s) -> Destination`,
    worklet: `WebRTC RemoteStream -> Source -> AudioWorklet(passthrough) -> DelayNode(${delaySeconds}s) -> Destination`
  };

  eventBus.emit('log:webaudio', {
    message: 'Loopback Monitor: Playback grafigi tamamlandi',
    details: {
      mode: safeMode,
      contextSampleRate: loopbackMonitorCtx.sampleRate,
      remoteSampleRate: remoteSampleRate || 'N/A',
      delaySeconds,
      graph: graphByMode[safeMode] || graphByMode.webaudio
    }
  });

  eventBus.emit('monitor:started', { mode: safeMode, delaySeconds, loopback: true });
  eventBus.emit('log', `🎧 Loopback monitor aktif (${safeMode} + ${delaySeconds}s Delay -> Speaker)`);
}

// ============================================
// RECORDING (Toggle)
// ============================================
recordToggleBtn.onclick = async () => {
  // Toggle mantigi: aktifse durdur
  if (currentMode === 'recording') {
    await stopRecording();
    return;
  }

  const useWebAudio = isWebAudioEnabled();
  const useLoopback = isLoopbackEnabled();
  const constraints = getConstraints();
  const recordMode = useLoopback ? getProcessingMode() : (useWebAudio ? getProcessingMode() : 'direct');

  eventBus.emit('log:recorder', {
    message: 'Kayit baslat butonuna basildi',
    details: {
      constraints,
      webAudioEnabled: useWebAudio,
      loopbackEnabled: useLoopback,
      recordMode
    }
  });

  try {
    currentMode = 'recording';
    updateButtonStates();

    if (useLoopback) {
      // LOOPBACK MODUNDA KAYIT
      // Mikrofon -> WebRTC -> Remote Stream -> MediaRecorder
      window._loopbackSetupStart = performance.now(); // Timing icin
      eventBus.emit('log', '🔄 Loopback modunda kayit baslatiliyor...');

      // Mikrofon al
      loopbackLocalStream = await navigator.mediaDevices.getUserMedia({
        audio: constraints,
        video: false
      });

      const track = loopbackLocalStream.getAudioTracks()[0];
      eventBus.emit('log:stream', {
        message: 'Loopback Recording: Mikrofon alindi',
        details: { trackLabel: track.label, trackSettings: track.getSettings() }
      });

      // VuMeter icin local stream gonder
      eventBus.emit('stream:started', loopbackLocalStream);

      // WebRTC loopback kur
      const remoteStream = await setupLoopback(loopbackLocalStream, useWebAudio);

      // Remote stream'i kaydet (Recorder modulunu direkt kullanmak yerine manuel kayit)
      eventBus.emit('recording:started');

      // Remote stream debug
      const remoteTracks = remoteStream.getAudioTracks();
      eventBus.emit('log:recorder', {
        message: 'Loopback: Remote stream kontrolu',
        details: {
          streamId: remoteStream.id,
          streamActive: remoteStream.active,
          trackCount: remoteTracks.length,
          track0: remoteTracks[0] ? {
            id: remoteTracks[0].id,
            enabled: remoteTracks[0].enabled,
            muted: remoteTracks[0].muted,
            readyState: remoteTracks[0].readyState,
            label: remoteTracks[0].label
          } : null
        }
      });

      // KRITIK: WebRTC remote stream'i dogrudan WebAudio'ya baglamak Chrome'da calismiyor.
      // Cozum: Oncelikle bir Audio element'e baglayip "aktive" etmek gerekiyor.

      // 1. Audio element olustur ve remote stream'i bagla
      const activatorAudio = document.createElement('audio');
      activatorAudio.srcObject = remoteStream;
      activatorAudio.muted = true; // Feedback onleme - ses cikisi istemiyoruz
      activatorAudio.volume = 0;
      window._loopbackActivatorAudio = activatorAudio;

      // Play promise'i bekle (autoplay policy)
      try {
        await activatorAudio.play();
        eventBus.emit('log:webaudio', {
          message: 'Loopback: Audio aktivator elementi baslatildi',
          details: { paused: activatorAudio.paused, muted: activatorAudio.muted }
        });
      } catch (playErr) {
        eventBus.emit('log:error', {
          message: 'Loopback: Audio aktivator play hatasi',
          details: { error: playErr.message }
        });
      }

      // Stream stabilizasyonu icin bekleme - Opus bitrate'e gore dinamik
      // Yuksek bitrate'lerde encoder initialization daha uzun surebilir
      const opusBitrate = getOpusBitrate();
      const baseWait = 500; // minimum bekleme
      const bitrateWait = opusBitrate >= 64000 ? 500 : opusBitrate >= 32000 ? 250 : 0;
      const totalWait = baseWait + bitrateWait;

      eventBus.emit('log:stream', {
        message: `Loopback: Stream stabilizasyon bekleniyor`,
        details: {
          opusBitrate: `${opusBitrate / 1000} kbps`,
          baseWait: `${baseWait}ms`,
          bitrateWait: `${bitrateWait}ms`,
          totalWait: `${totalWait}ms`
        }
      });

      await new Promise(resolve => setTimeout(resolve, totalWait));

      // Stream aktif mi kontrol et
      const remoteTrackCheck = remoteStream.getAudioTracks()[0];
      if (!remoteTrackCheck || remoteTrackCheck.readyState !== 'live') {
        eventBus.emit('log:error', {
          message: 'Loopback: Remote track hazir degil!',
          details: {
            trackExists: !!remoteTrackCheck,
            readyState: remoteTrackCheck?.readyState
          }
        });
      }

      // Direct mode (test): Remote stream'i direkt MediaRecorder'a ver
      // NOT: Chrome'da bu yol 0 KB dosya uretebilir (WebRTC->MediaRecorder bug)
      if (recordMode === 'direct') {
        eventBus.emit('log:recorder', {
          message: 'Loopback: Kayit modu DIRECT (RemoteStream -> MediaRecorder)',
          details: {
            recordMode,
            warning: 'Chrome WebRTC->MediaRecorder bug nedeniyle 0KB olasiliği var'
          }
        });

        const recordStream = remoteStream;
        const chunks = [];
        const mediaRecorder = createAudioMediaRecorder(recordStream);

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onerror = (e) => {
          eventBus.emit('log:error', {
            message: 'Loopback: MediaRecorder hatasi',
            details: { error: e.error?.message || e.message || 'Bilinmeyen hata' }
          });
        };

        mediaRecorder.onstop = () => {
          eventBus.emit('log:recorder', {
            message: 'Loopback: MediaRecorder onstop tetiklendi',
            details: { totalChunks: chunks.length }
          });

          const mimeType = mediaRecorder.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: mimeType });
          const filename = `kayit_loopback_${recordMode}_${Date.now()}.webm`;

          eventBus.emit('log', `Kayit tamamlandi: ${(blob.size / 1024).toFixed(1)} KB`);
          eventBus.emit('recording:completed', {
            blob,
            mimeType,
            filename,
            recordMode,
            useWebAudio: false,
            useLoopback: true
          });
        };

        const timeslice = getTimeslice();
        const recordStartTime = performance.now();

        if (timeslice > 0) {
          mediaRecorder.start(timeslice);
        } else {
          mediaRecorder.start();
        }

        eventBus.emit('recorder:started', {
          recordMode,
          mimeType: mediaRecorder.mimeType,
          state: mediaRecorder.state,
          streamActive: remoteStream.active,
          timeslice: timeslice > 0 ? `${timeslice}ms` : 'OFF',
          chunksPerSec: timeslice > 0 ? (1000 / timeslice).toFixed(1) : 'N/A',
          totalPreRecordDelay: `${(recordStartTime - (window._loopbackSetupStart || recordStartTime)).toFixed(0)}ms`,
          stabilizationWait: `${totalWait}ms`,
          primingDuration: 'N/A (direct)'
        });

        window._loopbackRecorder = mediaRecorder;
        window._loopbackChunks = chunks;
        window._loopbackRecordAudioCtx = null;

        startTimer(false);
        eventBus.emit('log', '🎙️ Loopback kaydi basladi (Direct RemoteStream)');
        return;
      }

      // 2. Remote stream'in sample rate'ini al
      const remoteTrack = remoteStream.getAudioTracks()[0];
      const remoteSettings = remoteTrack?.getSettings() || {};
      const remoteSampleRate = remoteSettings.sampleRate;

      // AudioContext'i remote stream sample rate ile olustur (sample rate uyumsuzlugu hizlanmaya neden olur)
      const acOptions = remoteSampleRate ? { sampleRate: remoteSampleRate } : {};
      const recordAudioCtx = new (window.AudioContext || window.webkitAudioContext)(acOptions);

      // ONEMLI: AudioContext suspended durumunda olabilir - resume et
      if (recordAudioCtx.state === 'suspended') {
        await recordAudioCtx.resume();
        eventBus.emit('log:webaudio', {
          message: 'Loopback: Recording AudioContext resume edildi',
          details: { previousState: 'suspended', newState: recordAudioCtx.state }
        });
      }

      eventBus.emit('log:webaudio', {
        message: 'Loopback: Recording AudioContext olusturuldu',
        details: {
          contextSampleRate: recordAudioCtx.sampleRate,
          remoteSampleRate: remoteSampleRate || 'N/A',
          sampleRateMatch: !remoteSampleRate || remoteSampleRate === recordAudioCtx.sampleRate
        }
      });

      // 3. Simdi MediaStreamSource olustur (stream artik aktif)
      const recordSource = recordAudioCtx.createMediaStreamSource(remoteStream);

      // GainNode ekle - bazi tarayicilarda audio akisini "aktive" eder
      const gainNode = recordAudioCtx.createGain();
      gainNode.gain.value = 1.0; // Ses seviyesini degistirme

      // AnalyserNode ekle - audio akisini dogrulamak icin
      const analyserNode = recordAudioCtx.createAnalyser();
      analyserNode.fftSize = 256;

      const recordDest = recordAudioCtx.createMediaStreamDestination();

      // Baglanti: Source -> (Opsiyonel: ScriptProcessor/AudioWorklet) -> Gain -> Analyser -> Destination
      let preGainNode = recordSource;

      if (recordMode === 'scriptprocessor') {
        const bufferSize = 4096;
        const spNode = recordAudioCtx.createScriptProcessor(bufferSize, 1, 1);
        spNode.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          const output = e.outputBuffer.getChannelData(0);
          for (let i = 0; i < input.length; i++) {
            output[i] = input[i];
          }
        };

        preGainNode.connect(spNode);
        preGainNode = spNode;

        eventBus.emit('log:webaudio', {
          message: 'Loopback: ScriptProcessor pipeline secildi (Kayit)',
          details: { bufferSize, warning: 'Deprecated API - sadece test icin' }
        });
      } else if (recordMode === 'worklet') {
        await ensurePassthroughWorklet(recordAudioCtx);
        const workletNode = createPassthroughWorkletNode(recordAudioCtx);
        preGainNode.connect(workletNode);
        preGainNode = workletNode;

        eventBus.emit('log:webaudio', {
          message: 'Loopback: AudioWorklet pipeline secildi (Kayit)',
          details: { processor: 'passthrough-processor' }
        });
      }

      preGainNode.connect(gainNode);
      gainNode.connect(analyserNode);
      analyserNode.connect(recordDest);

      // Audio akisini kontrol et (1 saniye sonra)
      setTimeout(() => {
        const testArray = new Uint8Array(analyserNode.fftSize);
        analyserNode.getByteTimeDomainData(testArray);

        // RMS hesapla
        let sum = 0;
        for (let i = 0; i < testArray.length; i++) {
          const val = (testArray[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / testArray.length);
        const hasSignal = rms > 0.001;

        eventBus.emit('log:webaudio', {
          message: `Loopback: Audio akis kontrolu - ${hasSignal ? '✅ SINYAL VAR' : '❌ SINYAL YOK'}`,
          details: {
            rms: rms.toFixed(6),
            hasSignal,
            sampleValues: Array.from(testArray.slice(0, 10)) // Ilk 10 sample
          }
        });
      }, 1000);

      // recordDest.stream'in aktif ve track'inin enabled oldugunu dogrula
      const destTrack = recordDest.stream.getAudioTracks()[0];
      // NOT: Bu WebAudio pipeline, WebAudio Toggle ayarindan BAGIMSIZDIR!
      // Chrome'da WebRTC remote stream'i direkt MediaRecorder'a vermek 0 KB dosya uretir.
      // Cozum: Remote stream -> AudioContext -> MediaStreamDestination -> MediaRecorder
      eventBus.emit('log:webaudio', {
        message: 'Loopback: Chrome workaround aktif (WebRTC stream AudioContext uzerinden kayit)',
        details: {
          recordMode,
          recordAudioCtxState: recordAudioCtx.state,
          sampleRate: recordAudioCtx.sampleRate,
          destStreamId: recordDest.stream.id,
          destStreamActive: recordDest.stream.active,
          destTrackEnabled: destTrack?.enabled,
          destTrackReadyState: destTrack?.readyState,
          sourceChannelCount: recordSource.channelCount,
          destChannelCount: recordDest.channelCount,
          gainValue: gainNode.gain.value,
          note: 'Bu WebAudio toggle ayarindan BAGIMSIZDIR - Chrome WebRTC bug workaround'
        }
      });

      // WebAudio destination stream'ini kaydet (remote stream yerine)
      const recordStream = recordDest.stream;

      // PRIMING FAZI: AudioContext pipeline'ini "isit"
      // Opus encoder'in tam initialize olmasi icin stream'i bir sure akmasina izin ver
      // Bu, ilk frame'lerdeki timing sorunlarini azaltir
      const primingDuration = opusBitrate >= 64000 ? 300 : opusBitrate >= 32000 ? 150 : 100;

      eventBus.emit('log:webaudio', {
        message: `Loopback: AudioContext priming basladi`,
        details: {
          primingDuration: `${primingDuration}ms`,
          opusBitrate: `${opusBitrate / 1000} kbps`
        }
      });

      await new Promise(resolve => setTimeout(resolve, primingDuration));

      // Priming sonrasi sinyal kontrolu
      const primingTestArray = new Uint8Array(analyserNode.fftSize);
      analyserNode.getByteTimeDomainData(primingTestArray);
      let primingSum = 0;
      for (let i = 0; i < primingTestArray.length; i++) {
        const val = (primingTestArray[i] - 128) / 128;
        primingSum += val * val;
      }
      const primingRms = Math.sqrt(primingSum / primingTestArray.length);

      eventBus.emit('log:webaudio', {
        message: `Loopback: Priming tamamlandi - ${primingRms > 0.001 ? '✅ SINYAL VAR' : '⚠️ DUSUK SINYAL'}`,
        details: {
          rms: primingRms.toFixed(6),
          pipelineReady: true
        }
      });

      const chunks = [];
      const mediaRecorder = createAudioMediaRecorder(recordStream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onerror = (e) => {
        eventBus.emit('log:error', {
          message: 'Loopback: MediaRecorder hatasi',
          details: { error: e.error?.message || e.message || 'Bilinmeyen hata' }
        });
      };

      mediaRecorder.onstop = () => {
        eventBus.emit('log:recorder', {
          message: 'Loopback: MediaRecorder onstop tetiklendi',
          details: { totalChunks: chunks.length }
        });

        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        const filename = `kayit_loopback_${recordMode}_${Date.now()}.webm`;

        eventBus.emit('log', `Kayit tamamlandi: ${(blob.size / 1024).toFixed(1)} KB`);
        eventBus.emit('recording:completed', {
          blob,
          mimeType,
          filename,
          recordMode,
          useWebAudio: recordMode !== 'direct',
          useLoopback: true
        });
      };

      // Timeslice degerini al (0 = OFF, pozitif = chunk suresi ms)
      const timeslice = getTimeslice();

      // Kayit baslangic zamani
      const recordStartTime = performance.now();

      if (timeslice > 0) {
        mediaRecorder.start(timeslice);
      } else {
        mediaRecorder.start(); // Timeslice yok - tek chunk
      }

      eventBus.emit('recorder:started', {
        recordMode,
        mimeType: mediaRecorder.mimeType,
        state: mediaRecorder.state,
        streamActive: remoteStream.active,
        timeslice: timeslice > 0 ? `${timeslice}ms` : 'OFF',
        chunksPerSec: timeslice > 0 ? (1000 / timeslice).toFixed(1) : 'N/A',
        totalPreRecordDelay: `${(recordStartTime - (window._loopbackSetupStart || recordStartTime)).toFixed(0)}ms`,
        stabilizationWait: `${totalWait}ms`,
        primingDuration: `${primingDuration}ms`
      });

      // Stop butonuna basinca durdurulacak
      window._loopbackRecorder = mediaRecorder;
      window._loopbackChunks = chunks;
      window._loopbackRecordAudioCtx = recordAudioCtx;

      startTimer(false);

      eventBus.emit('log', '🎙️ Loopback kaydi basladi (WebRTC uzerinden)');

    } else {
      // NORMAL KAYIT
      const timeslice = getTimeslice();
      await recorder.start(constraints, recordMode, timeslice);
      startTimer(false);
    }

  } catch (err) {
    eventBus.emit('log:error', {
      message: 'Kayit baslatilamadi',
      details: { error: err.message }
    });
    eventBus.emit('log', `❌ HATA: ${err.message}`);

    // Temizlik
    stopTimer();
    await cleanupLoopback();
    loopbackLocalStream?.getTracks().forEach(t => t.stop());
    loopbackLocalStream = null;

    currentMode = null;
    updateButtonStates();
  }
};

// Kayit durdurma fonksiyonu
async function stopRecording() {
  const useLoopback = isLoopbackEnabled();

  eventBus.emit('log:recorder', {
    message: 'Kayit durduruluyor',
    details: { loopbackEnabled: useLoopback }
  });

  stopTimer();

  if (useLoopback && window._loopbackRecorder) {
    // ONEMLI: MediaRecorder.stop() asenkron calisir!
    // onstop callback'i tetiklenmeden temizlik yapmamaliyiz
    const recorderInstance = window._loopbackRecorder;

    // onstop icinde temizlik yap
    const originalOnstop = recorderInstance.onstop;
    recorderInstance.onstop = async () => {
      // Oncelikli: Kayit verisini isle
      if (originalOnstop) originalOnstop();

      eventBus.emit('recorder:stopped', { loopback: true });

      // Simdi temizlik yap
      eventBus.emit('log:recorder', {
        message: 'Loopback: MediaRecorder onstop tetiklendi, temizlik basliyor',
        details: {}
      });

      // Aktivator audio temizle
      if (window._loopbackActivatorAudio) {
        window._loopbackActivatorAudio.pause();
        window._loopbackActivatorAudio.srcObject = null;
        window._loopbackActivatorAudio = null;
      }

      // Recording AudioContext temizle
      if (window._loopbackRecordAudioCtx) {
        await window._loopbackRecordAudioCtx.close();
        window._loopbackRecordAudioCtx = null;
      }

      // Local stream durdur
      loopbackLocalStream?.getTracks().forEach(t => t.stop());
      loopbackLocalStream = null;

      // WebRTC temizle
      await cleanupLoopback();

      eventBus.emit('stream:stopped');
      eventBus.emit('log', '⏹️ Loopback kaydi durduruldu');
    };

    // Recorder'i durdur (onstop tetiklenecek)
    recorderInstance.stop();
    window._loopbackRecorder = null;
  } else {
    recorder.stop();
  }

  currentMode = null;
  updateButtonStates();
}

// ============================================
// MONITORING (Toggle)
// ============================================
monitorToggleBtn.onclick = async () => {
  // Toggle mantigi: aktifse durdur
  if (currentMode === 'monitoring') {
    await stopMonitoring();
    return;
  }

  const useWebAudio = isWebAudioEnabled();
  const useLoopback = isLoopbackEnabled();
  const constraints = getConstraints();
  const monitorMode = useWebAudio ? getProcessingMode() : 'direct';

  const pipeline = useLoopback
    ? (monitorMode === 'scriptprocessor'
      ? 'WebRTC Loopback + ScriptProcessor + 2sn Delay -> Speaker'
      : monitorMode === 'worklet'
        ? 'WebRTC Loopback + AudioWorklet + 2sn Delay -> Speaker'
        : monitorMode === 'direct'
          ? 'WebRTC Loopback + Direct + 2sn Delay -> Speaker'
          : 'WebRTC Loopback + WebAudio + 2sn Delay -> Speaker')
    : (monitorMode === 'scriptprocessor'
      ? 'ScriptProcessor + 2sn Delay -> Speaker'
      : monitorMode === 'worklet'
        ? 'AudioWorklet + 2sn Delay -> Speaker'
        : monitorMode === 'direct'
          ? 'Direct + 2sn Delay -> Speaker'
          : 'WebAudio + 2sn Delay -> Speaker');

  eventBus.emit('log:stream', {
    message: 'Monitor Baslat butonuna basildi',
    details: {
      constraints,
      webAudioEnabled: useWebAudio,
      loopbackEnabled: useLoopback,
      monitorMode,
      pipeline
    }
  });

  try {
    // Monitoring baslarken kayit oynaticisini durdur (karisiklik/feedback onleme)
    player.pause();

    currentMode = 'monitoring';
    updateButtonStates();

    if (useLoopback) {
      // LOOPBACK MODUNDA MONITOR
      // Mikrofon -> WebRTC -> Remote Stream -> Speaker
      eventBus.emit('log', '🔄 Loopback modunda monitor baslatiliyor...');

      // Mikrofon al
      loopbackLocalStream = await navigator.mediaDevices.getUserMedia({
        audio: constraints,
        video: false
      });

      const track = loopbackLocalStream.getAudioTracks()[0];
      eventBus.emit('log:stream', {
        message: 'Loopback Monitor: Mikrofon alindi',
        details: { trackLabel: track.label, trackSettings: track.getSettings() }
      });

      // VuMeter icin local stream gonder
      eventBus.emit('stream:started', loopbackLocalStream);

      // WebRTC loopback kur
      const remoteStream = await setupLoopback(loopbackLocalStream, useWebAudio);

      // Remote stream'i hoparlore bagla (monitorMode + 2sn delay)
      await startLoopbackMonitorPlayback(remoteStream, monitorMode);

    } else {
      // NORMAL MONITOR
      if (useWebAudio) {
        if (monitorMode === 'direct') {
          await monitor.startDirect(constraints);
        } else if (monitorMode === 'scriptprocessor') {
          await monitor.startScriptProcessor(constraints);
        } else if (monitorMode === 'worklet') {
          await monitor.startAudioWorklet(constraints);
        } else {
          await monitor.startWebAudio(constraints);
        }
      } else {
        await monitor.startDirect(constraints);
      }
    }

  } catch (err) {
    eventBus.emit('log:error', {
      message: 'Monitor baslatilamadi',
      details: { error: err.message }
    });
    eventBus.emit('log', `❌ HATA: ${err.message}`);

    // Temizlik
    stopTimer();
    await cleanupLoopbackMonitorPlayback();
    await cleanupLoopback();
    loopbackLocalStream?.getTracks().forEach(t => t.stop());
    loopbackLocalStream = null;

    currentMode = null;
    updateButtonStates();
  }
};

// Monitor durdurma fonksiyonu
async function stopMonitoring() {
  const useLoopback = isLoopbackEnabled();

  eventBus.emit('log:stream', {
    message: 'Monitor durduruluyor',
    details: { loopbackEnabled: useLoopback }
  });

  stopTimer();

  if (useLoopback) {
    const stoppedMode = loopbackMonitorMode;

    // Loopback monitor playback temizle (Delay/Worklet/ScriptProcessor/Activator)
    await cleanupLoopbackMonitorPlayback();

    // Local stream durdur
    loopbackLocalStream?.getTracks().forEach(t => t.stop());
    loopbackLocalStream = null;

    // WebRTC temizle
    await cleanupLoopback();

    eventBus.emit('stream:stopped');
    eventBus.emit('log', '⏹️ Loopback monitor durduruldu');
    eventBus.emit('monitor:stopped', { mode: stoppedMode, loopback: true });
  } else {
    await monitor.stop();
  }

  currentMode = null;
  updateButtonStates();
}

// ============================================
// GLOBAL FONKSIYONLAR (HTML onclick icin)
// ============================================
window.clearLog = () => {
  eventBus.emit('log:clear');
};

window.exportLogs = () => {
  logManager.exportJSON();
};

window.filterLogs = (category) => {
  if (category === 'all') {
    logger.showAll();
  } else {
    logger.filterByCategory(category);
  }
  // Buton aktiflik durumunu guncelle
  document.querySelectorAll('.btn-filter').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.querySelector(`[data-category="${category}"]`);
  if (activeBtn) activeBtn.classList.add('active');
};

window.getLogStats = () => {
  const stats = logManager.getStats();
  const statsText = Object.entries(stats)
    .map(([cat, count]) => `${cat}: ${count}`)
    .join(' | ');
  eventBus.emit('log', `📊 Stats: ${statsText}`);
  console.table(stats);
  return stats;
};

window.getMonitorState = () => {
  const state = monitor.getWebAudioState();
  console.log('Monitor WebAudio State:', state);
  return state;
};

window.getAudioEngineState = () => {
  const state = audioEngine.getState();
  console.log('AudioEngine State:', state);
  return state;
};

window.runSanityChecks = () => {
  const report = logManager.getSanityReport();

  if (report.ok) {
    eventBus.emit('log:webaudio', {
      message: 'Sanity Check: OK (supheli bulgu yok)',
      details: report.summary
    });
    console.table([]);
    return report;
  }

  eventBus.emit('log:webaudio', {
    message: `Sanity Check: ${report.issues.length} bulgu bulundu`,
    details: report.summary
  });

  for (const issue of report.issues) {
    const payload = {
      message: `Sanity: ${issue.code} - ${issue.message}`,
      details: issue.details
    };
    if (issue.severity === 'error') {
      eventBus.emit('log:error', payload);
    } else {
      eventBus.emit('log:webaudio', payload);
    }
  }

  console.table(report.issues);
  return report;
};

// ============================================
// BASLANGIC - PRE-INITIALIZATION
// ============================================

// AudioEngine ve Recorder'i onceden isit (Start butonunda hiz kazanimi)
async function initializeAudio() {
  // Adim 1: AudioEngine warmup
  try {
    await audioEngine.warmup();
  } catch (err) {
    eventBus.emit('log:error', {
      message: 'AudioEngine warmup hatasi (kritik degil)',
      details: { error: err.message, step: 'audioEngine.warmup' }
    });
  }

  // Adim 2: Recorder warmup
  try {
    await recorder.warmup();
  } catch (err) {
    eventBus.emit('log:error', {
      message: 'Recorder warmup hatasi (kritik degil)',
      details: { error: err.message, step: 'recorder.warmup' }
    });
  }

  // Adim 3: Device info panelini doldur
  try {
    await deviceInfo.initFromAudioEngine();
  } catch (err) {
    eventBus.emit('log:error', {
      message: 'DeviceInfo init hatasi (kritik degil)',
      details: { error: err.message, step: 'deviceInfo.initFromAudioEngine' }
    });
  }

  eventBus.emit('log:system', {
    message: 'Audio pre-initialization tamamlandi',
    details: audioEngine.getState()
  });
}

// Sayfa yuklenince warmup baslat
initializeAudio();

eventBus.emit('log', 'Mic Probe hazir. Bir test modu secin.');
eventBus.emit('log:system', {
  message: 'Uygulama baslatildi',
  details: {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    audioContextSupported: !!(window.AudioContext || window.webkitAudioContext),
    mediaDevicesSupported: !!navigator.mediaDevices?.getUserMedia,
    rtcPeerConnectionSupported: !!window.RTCPeerConnection
  }
});
