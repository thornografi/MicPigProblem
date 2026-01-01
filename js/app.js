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
import { formatTime, getBestAudioMimeType, createAudioContext, getAudioContextOptions } from './modules/utils.js';
import { createPassthroughWorkletNode, ensurePassthroughWorklet, isAudioWorkletSupported } from './modules/WorkletHelper.js';
import { PROFILES, SETTINGS, PROFILE_CATEGORIES } from './modules/Config.js';
import { DELAY, SIGNAL } from './modules/constants.js';
import loopbackManager from './modules/LoopbackManager.js';
import profileController from './modules/ProfileController.js';
import uiStateManager from './modules/UIStateManager.js';

// ============================================
// ERKEN TANIMLANAN SABITLER (applyProfile oncesi gerekli)
// ============================================
const WORKLET_SUPPORTED = isAudioWorkletSupported();

// ============================================
// UTILITY FONKSIYONLAR
// ============================================
// DRY: Stream track'lerini durdur (6 yerde kullaniliyor)
function stopAllTracks(stream) {
  stream?.getTracks().forEach(t => t.stop());
}

// ============================================
// MERKEZI STATE - Erken tanimlama (hoisting icin)
// ============================================
// Modlar: null (idle), 'recording', 'monitoring'
let currentMode = null;
// Hazırlanıyor state (kayıt/monitoring başlatılırken)
let isPreparing = false;
// NOT: currentProfileId artik ProfileController tarafindan yonetiliyor

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
const loopbackToggle = document.getElementById('loopbackToggle');
// NOT: webaudioToggle kaldirildi - artik mode ayari WebAudio durumunu belirliyor

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

// Buffer size secici
const bufferSizeContainer = document.getElementById('bufferSizeContainer');
const bufferInfoText = document.getElementById('bufferInfoText');

// Kayit oynatici kontrolleri
const recordingPlayerEl = document.getElementById('recordingPlayer');
const recordingPlayerCardEl = recordingPlayerEl ? recordingPlayerEl.closest('.card') : null;
const recordingPlayerPanelEl = recordingPlayerEl ? recordingPlayerEl.closest('.panel-player') : null;
const playBtnEl = document.getElementById('playBtn');
const downloadBtnEl = document.getElementById('downloadBtn');
const progressBarEl = document.getElementById('progressBar');

// Timeslice container (kayit modu icin)
const timesliceContainerEl = document.querySelector('.timeslice-container');

// Hazirlanıyor overlay (kayit/monitoring gecikme gostergesi)
const preparingOverlayEl = document.getElementById('preparingOverlay');

// Profil secici
const profileSelector = document.getElementById('profileSelector');

// Ozel Ayarlar Panel (Ana sayfa)
const customSettingsToggle = document.getElementById('customSettingsToggle');
const customSettingsContent = document.getElementById('customSettingsContent');
const customSettingsGrid = document.getElementById('customSettingsGrid');

// Ayar section'lari (profil bazli gorunurluk icin)
const pipelineSection = document.getElementById('pipelineSection');
const webrtcSection = document.getElementById('webrtcSection');
const developerSection = document.getElementById('developerSection');

// data-setting container cache (updateSectionVisibility icin)
const settingContainers = {
  webaudio: document.querySelector('[data-setting="webaudio"]'),
  mode: document.querySelector('[data-setting="mode"]'),
  buffer: document.querySelector('[data-setting="buffer"]'),
  loopback: document.querySelector('[data-setting="loopback"]'),
  bitrate: document.querySelector('[data-setting="bitrate"]'),
  mediaBitrate: document.querySelector('[data-setting="mediaBitrate"]'),
  timeslice: document.querySelector('[data-setting="timeslice"]')
};

// Mikrofon secici
const micSelector = document.getElementById('micSelector');
const refreshMicsBtn = document.getElementById('refreshMics');

// Senaryo kartlari ve sidebar nav (erken tanimlama - applyProfile icin gerekli)
const scenarioCards = document.querySelectorAll('.scenario-card');
const navItems = document.querySelectorAll('.nav-item[data-profile]');

// Radio buton koleksiyonlari (cache - tekrar sorgu onlemi)
const processingModeRadios = document.querySelectorAll('input[name="processingMode"]');
const bitrateRadios = document.querySelectorAll('input[name="bitrate"]');
// mediaBitrateRadios - KALDIRILDI: OCP mimarisi ile getSettingElements() dinamik kullaniliyor
const timesliceRadios = document.querySelectorAll('input[name="timeslice"]');
const bufferSizeRadios = document.querySelectorAll('input[name="bufferSize"]');

// ============================================
// MIKROFON LISTESI
// ============================================
const MIC_STORAGE_KEY = 'micprobe_selectedMic';

// localStorage'dan onceki secimi yukle
let selectedDeviceId = localStorage.getItem(MIC_STORAGE_KEY) || '';
let hasMicPermission = false; // Izin durumu

/**
 * Mikrofon listesini dropdown'a doldurur (DRY helper)
 * @param {MediaDeviceInfo[]} allMics - Tum audio input cihazlari
 * @param {Object} options - { logWarnings: boolean }
 * @returns {MediaDeviceInfo[]} Filtrelenmis gercek mikrofonlar
 */
function buildMicrophoneDropdown(allMics, options = {}) {
  const { logWarnings = true } = options;

  // Windows virtual entries'i filtrele (default, communications)
  const virtualIds = ['default', 'communications'];
  const realMics = allMics.filter(m => !virtualIds.includes(m.deviceId));

  // Varsayilan cihazi bul (default entry'nin label'indan)
  const defaultEntry = allMics.find(m => m.deviceId === 'default');
  let defaultRealDeviceId = null;

  if (defaultEntry && defaultEntry.label) {
    const defaultLabel = defaultEntry.label.replace(/^(Varsay[ıi]lan|Default)\s*-\s*/i, '').trim();
    const matchingReal = realMics.find(m => m.label === defaultLabel);
    if (matchingReal) {
      defaultRealDeviceId = matchingReal.deviceId;
    }
  }

  if (!defaultRealDeviceId && realMics.length > 0) {
    defaultRealDeviceId = realMics[0].deviceId;
  }

  // Dropdown temizle
  micSelector.innerHTML = '';

  // Secili cihaz hala mevcut mu kontrol et
  const selectedStillExists = realMics.some(m => m.deviceId === selectedDeviceId);
  if (selectedDeviceId && !selectedStillExists) {
    if (logWarnings) {
      eventBus.emit('log:warning', {
        message: 'Onceden secili mikrofon artik mevcut degil',
        details: { lostDeviceId: selectedDeviceId.slice(0, 8) }
      });
    }
    selectedDeviceId = '';
    localStorage.removeItem(MIC_STORAGE_KEY);
  }

  // Dropdown doldur
  realMics.forEach((mic, index) => {
    const option = document.createElement('option');
    option.value = mic.deviceId;

    let label = mic.label || `Mikrofon ${index + 1}`;
    if (mic.deviceId === defaultRealDeviceId) {
      label += ' (varsayilan)';
    }
    option.textContent = label;

    if (mic.deviceId === selectedDeviceId) {
      option.selected = true;
    } else if (!selectedDeviceId && mic.deviceId === defaultRealDeviceId) {
      option.selected = true;
      selectedDeviceId = mic.deviceId;
    }

    micSelector.appendChild(option);
  });

  return realMics;
}

async function enumerateMicrophones(silent = false) {
  try {
    // Izin almak icin once getUserMedia cagir (enumerateDevices icin gerekli)
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stopAllTracks(tempStream); // Hemen kapat
    hasMicPermission = true;

    const devices = await navigator.mediaDevices.enumerateDevices();
    const allMics = devices.filter(d => d.kind === 'audioinput');

    // DRY helper ile dropdown doldur
    const realMics = buildMicrophoneDropdown(allMics, { logWarnings: true });

    if (!silent) {
      eventBus.emit('log:stream', {
        message: `${realMics.length} mikrofon bulundu`,
        details: { devices: realMics.map(m => m.label || m.deviceId.slice(0, 8)) }
      });
    }
  } catch (err) {
    hasMicPermission = false;
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
    const allMics = devices.filter(d => d.kind === 'audioinput');

    // Izin yoksa label'lar bos olur
    const hasLabels = allMics.some(m => m.label);
    hasMicPermission = hasLabels;

    if (hasLabels) {
      // Izin var - DRY helper ile dropdown doldur (warning log'suz)
      buildMicrophoneDropdown(allMics, { logWarnings: false });
    } else {
      // Izin yok - tiklandiginda izin istenecek
      micSelector.innerHTML = '<option value="" disabled>🎤 Mikrofon erisimi icin tiklayin</option>';
    }
  } catch (err) {
    // Sessizce hata - izin yok demek
    micSelector.innerHTML = '<option value="" disabled>🎤 Mikrofon erisimi icin tiklayin</option>';
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

// Mikrofon seciciye tiklandiginda izin yoksa iste
if (micSelector) {
  micSelector.addEventListener('mousedown', async (e) => {
    if (!hasMicPermission) {
      e.preventDefault(); // Dropdown'un acilmasini engelle
      await enumerateMicrophones();
    }
  });

  // Mikrofon secimi degistiginde
  micSelector.addEventListener('change', (e) => {
    selectedDeviceId = e.target.value;
    const selectedOption = micSelector.options[micSelector.selectedIndex];

    // localStorage'a kaydet (sayfa yenilenince korunsun)
    if (selectedDeviceId) {
      localStorage.setItem(MIC_STORAGE_KEY, selectedDeviceId);
    } else {
      localStorage.removeItem(MIC_STORAGE_KEY);
    }

    eventBus.emit('log:stream', {
      message: `Mikrofon secildi: ${selectedOption.textContent}`,
      details: { deviceId: selectedDeviceId || 'default' }
    });
  });
}

// Cihaz degisikligi dinle (mikrofon takildiginda/cikarildiginda)
if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', async () => {
    // Sadece izin varsa listeyi guncelle
    if (hasMicPermission) {
      eventBus.emit('log:stream', {
        message: 'Cihaz degisikligi algilandi, liste guncelleniyor...',
        details: {}
      });
      // Sessiz modda guncelle (tekrar "X mikrofon bulundu" yazmasin)
      await enumerateMicrophones(true);
    }
  });
}

// ============================================
// SENARYO PROFILLERI - Config.js'den import edildi
// ============================================

// Ayar key'ine gore UI elementlerini dondur (checkbox, radio grubu, toggle)
// OCP: Config.js'deki ui metadata kullanilarak dinamik element bulma
function getSettingElements(settingKey) {
  const setting = SETTINGS[settingKey];
  if (!setting?.ui) return [];

  const { type, id, name } = setting.ui;

  // Checkbox veya Toggle icin tek element
  if (type === 'checkbox' || type === 'toggle') {
    const el = document.getElementById(id);
    return el ? [el] : [];
  }

  // Radio grubu icin tum radiolari dondur
  if (type === 'radio') {
    return [...document.querySelectorAll(`input[name="${name}"]`)];
  }

  return [];
}

// Ayar elementlerini enable/disable et
function setSettingDisabled(settingKey, disabled) {
  const elements = getSettingElements(settingKey);
  elements.forEach(el => {
    el.disabled = disabled;
    // Disabled durumunda visual feedback icin parent label'a class ekle
    const label = el.closest('label');
    if (label) {
      label.classList.toggle('setting-locked', disabled);
    }
  });
}

// NOT: applyProfile, applyProfileConstraints, updateDynamicLocks, updateCustomSettingsPanelDynamicState
// fonksiyonlari ProfileController modülüne taşındı

// ============================================
// YARDIMCI FONKSIYONLAR
// ============================================

// DOM visibility helper - element goster/gizle
function toggleDisplay(element, shouldShow, displayValue = 'block') {
  if (element) element.style.display = shouldShow ? displayValue : 'none';
}

// NOT: updateSettingVisibility, updateSectionVisibility fonksiyonlari ProfileController modülüne taşındı

/**
 * Kategori bazli UI gorunurlugu
 * OCP: Profil yetenekleri (canMonitor, canRecord) kullanilir
 */
function updateCategoryUI(profileId) {
  const profile = PROFILES[profileId];
  if (!profile) return;

  // OCP: Profil kendi yeteneklerini biliyor
  const { canMonitor, canRecord, category } = profile;
  const loopbackValue = profile.values?.loopback;

  // Buton gorunurlukleri - profil yeteneklerine gore
  toggleDisplay(monitorToggleBtn, canMonitor, 'flex');
  toggleDisplay(recordToggleBtn, canRecord, 'flex');

  // Player paneli - kayit yapabilen profillerde goster
  toggleDisplay(recordingPlayerPanelEl, canRecord);

  // Controls row layout
  const controlsRow = document.querySelector('.controls-row');
  if (controlsRow) {
    controlsRow.classList.toggle('call-mode', !canRecord);
    controlsRow.classList.toggle('record-only-mode', canRecord && !canMonitor);
  }

  // Remote VU container - loopback aktifse goster
  const remoteVuContainer = document.getElementById('remoteVuContainer');
  toggleDisplay(remoteVuContainer, loopbackValue === true);

  eventBus.emit('log:ui', {
    message: `Kategori UI guncellendi: ${category}`,
    details: {
      category,
      canMonitor,
      canRecord,
      remoteVuVisible: loopbackValue === true
    }
  });
}

// Radio value getter - radio butonlarindan deger al
function getRadioValue(name, defaultValue, parseAsInt = false) {
  const selected = document.querySelector(`input[name="${name}"]:checked`);
  if (!selected) return defaultValue;
  return parseAsInt ? parseInt(selected.value, 10) : selected.value;
}

// Checkbox logger factory - checkbox degisikliklerini logla
function attachCheckboxLogger(checkbox, settingName, displayName) {
  if (!checkbox) return;
  checkbox.addEventListener('change', (e) => {
    eventBus.emit('log:stream', {
      message: `${displayName}: ${e.target.checked ? 'ACIK' : 'KAPALI'}`,
      details: { setting: settingName, value: e.target.checked }
    });
  });
}

// ============================================
// AYAR OKUMA FONKSIYONLARI
// ============================================
function getConstraints() {
  const constraints = {
    echoCancellation: ecCheckbox.checked,
    noiseSuppression: nsCheckbox.checked,
    autoGainControl: agcCheckbox.checked,
    sampleRate: getRadioValue('sampleRate', 48000, true),
    channelCount: getRadioValue('channelCount', 1, true)
  };

  // Secilen mikrofonu ekle
  const deviceId = getSelectedDeviceId();
  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  }

  return constraints;
}

function isWebAudioEnabled() {
  // Mode'a gore WebAudio durumunu belirle
  // direct: WebAudio yok, diger modlar: WebAudio var
  const mode = getRadioValue('processingMode', 'standard');
  return mode !== 'direct';
}

function getProcessingMode() {
  return getRadioValue('processingMode', 'standard');
}

function isLoopbackEnabled() {
  return loopbackToggle.checked;
}

function getOpusBitrate() {
  return getRadioValue('bitrate', 32000, true);
}

function getTimeslice() {
  // Profile degeri varsa onu kullan, yoksa UI'dan oku
  const profile = PROFILES[profileSelector?.value];
  const profileTimeslice = profile?.values?.timeslice;
  if (profileTimeslice !== undefined) return profileTimeslice;
  return getRadioValue('timeslice', 0, true);
}

function getBufferSize() {
  return getRadioValue('bufferSize', 4096, true);
}

function getMediaBitrate() {
  return getRadioValue('mediaBitrate', 0, true);
}

// Buffer info metnini guncelle
function updateBufferInfo(value) {
  if (!bufferInfoText) return;

  // Latency hesaplama (48kHz varsayilan)
  const sampleRate = 48000;
  const latencyMs = (value / sampleRate * 1000).toFixed(1);

  bufferInfoText.textContent = `${value} samples @ 48kHz = ~${latencyMs}ms latency`;

  // Kucuk buffer = dusuk latency ama yuksek CPU
  bufferInfoText.classList.remove('warning', 'danger');
  if (value <= 1024) {
    bufferInfoText.classList.add('warning');
  }
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
attachCheckboxLogger(ecCheckbox, 'echoCancellation', 'Echo Cancellation');
attachCheckboxLogger(nsCheckbox, 'noiseSuppression', 'Noise Suppression');
attachCheckboxLogger(agcCheckbox, 'autoGainControl', 'Auto Gain Control');

// NOT: webaudioToggle kaldirildi - artik mode secimi WebAudio durumunu belirliyor
// Mode degisikliginde loglama asagida yapiliyor

// Islem modu degisikligi loglama
processingModeRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    const mode = e.target.value;
    const labelByMode = {
      direct: 'Direct',
      standard: 'Standard',
      scriptprocessor: 'ScriptProcessor',
      worklet: 'AudioWorklet'
    };

    // Buffer size gorunurlugu: profil ayarlarina veya mode'a bagli
    // - Profilde buffer locked/editable ise: updateSettingVisibility halleder
    // - Profilde buffer yoksa: sadece ScriptProcessor modunda goster
    const profile = profileController.getCurrentProfile();
    const bufferInProfile = profile?.lockedSettings?.includes('buffer') ||
                            profile?.editableSettings?.includes('buffer') ||
                            profile?.allowedSettings === 'all';
    if (!bufferInProfile) {
      toggleDisplay(bufferSizeContainer, mode === 'scriptprocessor');
    }

    // Dinamik kilitleme guncelle (buffer icin)
    profileController.updateDynamicLocks();
    updateButtonStates(); // AudioWorklet modunda buffer disabled olur

    eventBus.emit('log:webaudio', {
      message: `Islem Modu: ${labelByMode[mode] || mode}`,
      details: { setting: 'processingMode', value: mode }
    });
  });
});

// Buffer size degisikligi loglama
bufferSizeRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    const bufferSize = parseInt(e.target.value, 10);
    updateBufferInfo(bufferSize);

    eventBus.emit('log:webaudio', {
      message: `Buffer Size: ${bufferSize} samples`,
      details: {
        setting: 'bufferSize',
        value: bufferSize,
        latencyMs: (bufferSize / 48000 * 1000).toFixed(1)
      }
    });
  });
});

loopbackToggle.addEventListener('change', (e) => {
  // Bitrate seciciyi goster/gizle
  toggleDisplay(opusBitrateContainer, e.target.checked);

  // Dinamik kilitleme guncelle (bitrate/mediaBitrate/timeslice icin)
  profileController.updateDynamicLocks();
  updateButtonStates();

  // DeviceInfo panelini guncelle (Hedef Bitrate degisir)
  // Mevcut UI degerlerini al (profile.values yerine - dinamik degisebilir)
  const profile = profileController.getCurrentProfile();
  if (profile) {
    const currentBitrate = parseInt(document.querySelector('input[name="bitrate"]:checked')?.value || '0', 10);
    const currentMediaBitrate = parseInt(document.querySelector('input[name="mediaBitrate"]:checked')?.value || '0', 10);
    const currentValues = {
      ...profile.values,
      loopback: e.target.checked,
      bitrate: currentBitrate,
      mediaBitrate: currentMediaBitrate
    };
    eventBus.emit('profile:changed', {
      profile: profileController.getCurrentProfileId(),
      values: currentValues,
      category: profile.category
    });
  }

  eventBus.emit('log:stream', {
    message: `WebRTC Loopback: ${e.target.checked ? 'AKTIF' : 'PASIF'}`,
    details: { setting: 'loopbackEnabled', value: e.target.checked }
  });
});

// Bitrate degisikligi loglama
bitrateRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    const bitrate = parseInt(e.target.value, 10);
    eventBus.emit('log:stream', {
      message: `Opus Bitrate: ${bitrate / 1000} kbps`,
      details: { setting: 'opusBitrate', value: bitrate }
    });
  });
});

// Timeslice degisikligi loglama
timesliceRadios.forEach(radio => {
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

// Profil degisikligi (hidden select - backward compatibility)
if (profileSelector) {
  profileSelector.addEventListener('change', async (e) => {
    await profileController.applyProfile(e.target.value);
    updateScenarioCardSelection(e.target.value);
  });

  // Sayfa yuklendiginde varsayilan profili uygula
  profileController.applyProfile(profileSelector.value).catch(err => {
    eventBus.emit('log:error', {
      message: 'Profil uygulama hatasi',
      details: { error: err.message }
    });
  });
}

// ============================================
// SENARYO KARTLARI & SIDEBAR NAV
// ============================================
// NOT: scenarioCards ve navItems yukarida tanimlandi (applyProfile hoisting icin)
const scenarioBadge = document.getElementById('scenarioBadge');
const scenarioTech = document.getElementById('scenarioTech');

// Sidebar elementleri
const pageTitle = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');
const settingsDrawer = document.getElementById('settingsDrawer');
const drawerOverlay = document.getElementById('drawerOverlay');
const closeDrawerBtn = document.getElementById('closeDrawer');
// sidebarStatus - KALDIRILDI: Kullanilmiyordu

// DRY: Teknik bilgi parcalarini olustur (updateScenarioTechInfo ve updatePageSubtitle icin ortak)
function buildTechParts(profile) {
  if (!profile?.values) return ['Manuel Ayarlar'];

  const techParts = [];

  if (profile.values.loopback) {
    techParts.push('WebRTC Loopback');
    techParts.push(`Opus ${profile.values.bitrate / 1000}kbps`);
  } else if (profile.values.mediaBitrate && profile.values.mediaBitrate > 0) {
    techParts.push(`MediaRecorder ${profile.values.mediaBitrate / 1000}kbps`);
  } else {
    techParts.push('Direct Recording');
  }

  if (profile.values.mode === 'scriptprocessor') {
    techParts.push('ScriptProcessor');
  } else if (profile.values.mode === 'worklet') {
    techParts.push('AudioWorklet');
  }

  return techParts;
}

// Senaryo teknik bilgisini guncelle
function updateScenarioTechInfo(profileId) {
  if (!scenarioTech || !scenarioBadge) return;

  const profile = PROFILES[profileId];
  if (!profile) return;

  scenarioBadge.textContent = profile.label;

  // Badge rengini guncelle
  scenarioBadge.style.background = '';
  scenarioBadge.style.color = '';

  scenarioTech.textContent = buildTechParts(profile).join(' + ');
}

// Senaryo kart secimini guncelle
function updateScenarioCardSelection(profileId) {
  scenarioCards.forEach(card => {
    const cardProfile = card.dataset.profile;
    card.classList.toggle('selected', cardProfile === profileId);
  });
  updateScenarioTechInfo(profileId);
}

// Sidebar nav item secimini guncelle
function updateNavItemSelection(profileId) {
  navItems.forEach(item => {
    const itemProfile = item.dataset.profile;
    item.classList.toggle('active', itemProfile === profileId);
  });

  // Page header'i guncelle
  const profile = PROFILES[profileId];
  if (profile && pageTitle) {
    pageTitle.textContent = profile.label + ' Test';
  }

  // Tech info'yu subtitle olarak goster
  updatePageSubtitle(profileId);
}

// Page subtitle guncelle - DRY: buildTechParts() kullanir
function updatePageSubtitle(profileId) {
  if (!pageSubtitle) return;
  const profile = PROFILES[profileId];
  pageSubtitle.textContent = buildTechParts(profile).join(' + ');
}

// openSettingsDrawer() - KALDIRILDI: Drawer artik acilmiyor, customSettingsPanel kullaniliyor

function closeSettingsDrawer() {
  if (settingsDrawer) settingsDrawer.classList.remove('open');
  if (drawerOverlay) drawerOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

// Drawer event listeners
if (closeDrawerBtn) {
  closeDrawerBtn.addEventListener('click', closeSettingsDrawer);
}
if (drawerOverlay) {
  drawerOverlay.addEventListener('click', closeSettingsDrawer);
}

// ESC ile drawer kapat
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsDrawer?.classList.contains('open')) {
    closeSettingsDrawer();
  }
});

// DRY: Profil secim handler'i (scenarioCards ve navItems icin ortak)
async function handleProfileSelect(profileId) {
  // Aktif islem VEYA preparing varken profil degisikligine izin verme
  if (currentMode !== null || isPreparing) {
    eventBus.emit('log:ui', {
      message: 'Profil degistirmek icin once mevcut islemi durdurun'
    });
    return;
  }

  if (profileSelector) {
    profileSelector.value = profileId;
  }
  await profileController.applyProfile(profileId);
  updateScenarioCardSelection(profileId);
  updateNavItemSelection(profileId);
  updateCustomSettingsPanel(profileId);
  eventBus.emit('log:ui', {
    message: `Senaryo degistirildi: ${PROFILES[profileId]?.label || profileId}`
  });
}

// Senaryo kartlarina tiklama
scenarioCards.forEach(card => {
  card.addEventListener('click', () => handleProfileSelect(card.dataset.profile));
});

// Sidebar nav-item tiklama
navItems.forEach(item => {
  item.addEventListener('click', () => handleProfileSelect(item.dataset.profile));
});

// Ozel Ayarlar Panel Toggle ve Dinamik Icerik
if (customSettingsToggle && customSettingsContent) {
  customSettingsToggle.addEventListener('click', () => {
    const isCollapsed = customSettingsContent.classList.contains('collapsed');

    customSettingsContent.classList.toggle('collapsed');
    customSettingsToggle.classList.toggle('expanded');

    eventBus.emit('log:ui', {
      message: isCollapsed ? 'Ozel ayarlar acildi' : 'Ozel ayarlar kapatildi'
    });
  });
}

// Profil bazli ozel ayarlar icerigi olustur
function updateCustomSettingsPanel(profileId) {
  if (!customSettingsGrid) return;

  const profile = PROFILES[profileId];
  if (!profile) return;

  const lockedSettings = profile.lockedSettings || [];
  const editableSettings = profile.editableSettings || [];
  const isCustomProfile = profileId === 'custom' || profile.allowedSettings === 'all';

  // Tum ayarlari listele
  const allSettingKeys = Object.keys(SETTINGS);

  let html = '';

  // Deger formatlama (bitrate icin "64k" gibi)
  const formatEnumValue = (val, key) => {
    if (key === 'bitrate' || key === 'mediaBitrate') {
      return val === 0 ? 'Off' : (val / 1000) + 'k';
    }
    if (key === 'buffer') {
      return val.toString();
    }
    if (key === 'timeslice') {
      return val === 0 ? 'Tek parça' : val + 'ms';
    }
    return val;
  };

  allSettingKeys.forEach(key => {
    const setting = SETTINGS[key];
    if (!setting) return;

    const isLocked = lockedSettings.includes(key);
    const isEditable = isCustomProfile || editableSettings.includes(key);

    // Sadece locked veya editable olanlari goster
    if (!isLocked && !isEditable) return;

    const statusClass = isLocked ? 'locked' : 'editable';
    const currentValue = profile.values?.[key] ?? setting.default;
    const isBoolean = setting.type === 'boolean';
    const isEnum = setting.type === 'enum';

    html += `<div class="custom-setting-item ${statusClass}">`;

    if (isBoolean) {
      html += `<input type="checkbox" ${currentValue ? 'checked' : ''} ${isLocked ? 'disabled' : ''} data-setting="${key}">`;
      html += `<span class="setting-name">${setting.label || key}</span>`;
    } else if (isEnum) {
      html += `<span class="setting-name">${setting.label || key}</span>`;
      html += `<select ${isLocked ? 'disabled' : ''} data-setting="${key}">`;
      // Profil bazli izin verilen degerler (allowedValues yoksa tum degerler)
      const allowedValues = profile.allowedValues?.[key] || setting.values;
      allowedValues.forEach(val => {
        const selected = val === currentValue ? 'selected' : '';
        html += `<option value="${val}" ${selected}>${formatEnumValue(val, key)}</option>`;
      });
      html += `</select>`;
    } else {
      html += `<span class="setting-name">${setting.label || key}</span>`;
    }

    html += `</div>`;
  });

  if (html === '') {
    html = '<p class="custom-settings-hint">Bu profil icin ozel ayar bulunmuyor.</p>';
  }

  customSettingsGrid.innerHTML = html;

  // Dinamik kilitleri uygula (mode -> buffer, loopback -> timeslice vb.)
  profileController.updateCustomSettingsPanelDynamicState();
}

// Ozel Ayarlar panelindeki degisiklikleri dinle
if (customSettingsGrid) {
  customSettingsGrid.addEventListener('change', (e) => {
    const target = e.target;
    const key = target.dataset.setting;
    if (!key) return;

    let value;
    if (target.type === 'checkbox') {
      value = target.checked;
    } else if (target.tagName === 'SELECT') {
      // Enum degerler - sayi ise number'a cevir
      value = isNaN(target.value) ? target.value : Number(target.value);
    } else {
      return;
    }

    // OCP: Drawer'daki ilgili kontrolu dinamik olarak guncelle
    const setting = SETTINGS[key];
    if (setting?.ui) {
      const elements = getSettingElements(key);
      if (setting.type === 'boolean') {
        // Checkbox veya Toggle
        elements.forEach(el => el.checked = value);
      } else if (setting.type === 'enum') {
        // Radio grubu - degere gore sec
        const radio = elements.find(el => el.value == value);
        if (radio) radio.checked = true;
      }
    }

    // Dinamik bagimliliklari guncelle (mode -> buffer, loopback -> timeslice vb.)
    profileController.updateCustomSettingsPanelDynamicState();

    eventBus.emit('log:ui', {
      message: `Ayar degistirildi: ${key} = ${value}`
    });
  });
}

// Sayfa yuklendiginde senaryo bilgisini guncelle
const initialProfile = profileSelector?.value || 'discord';
updateScenarioTechInfo(initialProfile);
updateNavItemSelection(initialProfile);
updateCustomSettingsPanel(initialProfile);
updateCategoryUI(initialProfile);

// ============================================
// MERKEZI STATE YONETIMI
// ============================================
// NOT: currentMode dosya basinda tanimlandi (hoisting icin)

// Timer state
let timerInterval = null;
let timerStartTime = null;
const timerEl = document.getElementById('recordingTimer');

function startTimer() {
  if (!timerEl) return;

  timerStartTime = Date.now();
  timerEl.textContent = '0:00';
  toggleDisplay(timerEl, true);

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
  toggleDisplay(timerEl, false);
}

// Loopback local stream (recording flow icin)
// NOT: WebRTC state ve fonksiyonlari LoopbackManager'a tasindi
let loopbackLocalStream = null;
let loopbackSignalCheckTimeout = null; // Audio akis kontrolu timeout (recording)

function updateButtonStates() {
  const isIdle = currentMode === null;
  const isRecording = currentMode === 'recording';
  const isMonitoring = currentMode === 'monitoring';

  // Toggle butonlarin active state'leri
  recordToggleBtn.classList.toggle('active', isRecording && !isPreparing);
  monitorToggleBtn.classList.toggle('active', isMonitoring && !isPreparing);

  // Preparing state kontrolü
  recordToggleBtn.classList.toggle('preparing', isPreparing && !isMonitoring);
  monitorToggleBtn.classList.toggle('preparing', isPreparing && !isRecording);

  // Monitoring sirasinda kayit butonunu disable et ve tersi
  // Preparing state'de de butonlar disabled
  recordToggleBtn.disabled = isMonitoring || isPreparing;
  monitorToggleBtn.disabled = isRecording || isPreparing;

  // Aktif islem sirasinda kayit tarafini tamamen kilitle (recording VEYA monitoring)
  const disableRecordingUi = isMonitoring || isRecording;
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

  // Profil kilitleri kontrolu
  const profile = profileController.getCurrentProfile();
  const lockedSettings = profile?.lockedSettings || [];

  // Ayar toggle'lari icin disabled durumu hesapla
  const shouldBeDisabled = (settingKey) => {
    // Aktif islem varsa her zaman disabled
    if (!isIdle) return true;
    // Profil kilidi varsa disabled
    return lockedSettings.includes(settingKey);
  };

  // Ayar toggle'lari - profil kilitleri + aktif mod kontrolu
  // NOT: webaudioToggle kaldirildi - mode secimi WebAudio durumunu belirliyor
  loopbackToggle.disabled = shouldBeDisabled('loopback');
  ecCheckbox.disabled = shouldBeDisabled('ec');
  nsCheckbox.disabled = shouldBeDisabled('ns');
  agcCheckbox.disabled = shouldBeDisabled('agc');

  // Mikrofon secici - aktif islem varken degistirilemez (profil kilidi yok)
  if (micSelector) {
    micSelector.disabled = !isIdle;
  }
  if (refreshMicsBtn) {
    refreshMicsBtn.disabled = !isIdle;
  }

  // Profil butonlari - aktif islem VEYA preparing varken degistirilemez
  // NOT: Profil degisimi stop+restart tetikler, UX acisindan engellemek daha temiz
  const disableProfiles = !isIdle || isPreparing;
  navItems.forEach(item => {
    item.classList.toggle('disabled', disableProfiles);
    item.setAttribute('aria-disabled', disableProfiles ? 'true' : 'false');
  });
  scenarioCards.forEach(card => {
    card.classList.toggle('disabled', disableProfiles);
    card.setAttribute('aria-disabled', disableProfiles ? 'true' : 'false');
  });
  if (profileSelector) {
    profileSelector.disabled = disableProfiles;
  }

  // Processing mode selector - profil kilidi + aktif session kontrolu
  processingModeRadios.forEach(radio => {
    const workletUnsupported = radio.value === 'worklet' && !WORKLET_SUPPORTED;
    radio.disabled = shouldBeDisabled('mode') || workletUnsupported;
  });

  // Loopback durumu - dinamik kilitleme kurallari icin
  const isLoopbackOn = loopbackToggle?.checked ?? false;

  // Bitrate selector - profil kilidi + loopback OFF ise disabled
  bitrateRadios.forEach(r => r.disabled = shouldBeDisabled('bitrate') || !isLoopbackOn);

  // Timeslice selector - profil kilidi + loopback ON ise disabled
  timesliceRadios.forEach(r => r.disabled = shouldBeDisabled('timeslice') || isLoopbackOn);

  // MediaBitrate selector - profil kilidi + loopback ON ise disabled
  const mediaBitrateRadios = document.querySelectorAll('input[name="mediaBitrate"]');
  mediaBitrateRadios.forEach(r => r.disabled = shouldBeDisabled('mediaBitrate') || isLoopbackOn);

  // Buffer size selector - profil kilidi + AudioWorklet/non-ScriptProcessor modunda disabled
  const selectedMode = document.querySelector('input[name="processingMode"]:checked')?.value;
  const isScriptProcessorMode = selectedMode === 'scriptprocessor';
  bufferSizeRadios.forEach(r => r.disabled = shouldBeDisabled('buffer') || !isScriptProcessorMode);

  // Buton text'lerini guncelle
  const recordBtnText = recordToggleBtn.querySelector('.btn-text');
  const monitorBtnText = monitorToggleBtn.querySelector('.btn-text');

  if (recordBtnText) {
    if (isPreparing && !isMonitoring) {
      recordBtnText.textContent = 'Hazırlanıyor...';
    } else {
      recordBtnText.textContent = isRecording ? 'Durdur' : 'Kayıt';
    }
  }
  if (monitorBtnText) {
    if (isPreparing && !isRecording) {
      monitorBtnText.textContent = 'Hazırlanıyor...';
    } else {
      monitorBtnText.textContent = isMonitoring ? 'Durdur' : 'Monitor';
    }
  }
}

// NOT: showPreparingState, hidePreparingState fonksiyonlari UIStateManager modülüne taşındı

// ============================================
// MODUL INITIALIZATION
// ============================================

// ProfileController init
profileController.init({
  loopbackToggle,
  profileSelector,
  customSettingsGrid,
  pipelineSection,
  webrtcSection,
  developerSection
});

profileController.setSettingContainers(settingContainers);

profileController.setCallbacks({
  stopMonitoring,
  stopRecording,
  startMonitoring: () => monitorToggleBtn.onclick(),
  startRecording: () => recordToggleBtn.onclick(),
  updateButtonStates,
  updateBufferInfo,
  updateTimesliceInfo,
  updateCategoryUI,
  getRadioValue,
  setSettingDisabled,
  getSettingElements
});

profileController.setStateGetters({
  currentMode: () => currentMode
});

// UIStateManager init (showPreparingState/hidePreparingState icin)
uiStateManager.init({
  preparingOverlay: preparingOverlayEl
});

// Baslangicta buton durumlarini ayarla
updateButtonStates();

// UI state sync (refresh/persisted checkbox senaryolari icin)
toggleDisplay(processingModeContainer, isWebAudioEnabled());

if (!WORKLET_SUPPORTED) {
  eventBus.emit('log:system', {
    message: 'AudioWorklet desteklenmiyor - Worklet secenekleri devre disi',
    details: {}
  });
}

// LoopbackManager'a worklet support bilgisini ver
loopbackManager.workletSupported = WORKLET_SUPPORTED;

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
    // Kayit baslarken oynaticiyi durdur (tutarlilik + potansiyel feedback onleme)
    player.pause();

    // Preparing state'e geç - buton sarı "Hazırlanıyor..." olur
    isPreparing = true;
    updateButtonStates();
    uiStateManager.showPreparingState(); // Hazirlanıyor... overlay goster

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

      // NOT: stream:started event'i stabilizasyon sonrasina tasindi (senkron UI guncelleme)

      // WebRTC loopback kur
      const remoteStream = await loopbackManager.setup(loopbackLocalStream, { useWebAudio, opusBitrate: getOpusBitrate() });

      // Remote stream debug (recording:started event'i MediaRecorder.start() sonrasina tasindi)
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
      // Dusuk gecikme: UI hizli baslasin, codec genelde 100ms icinde hazir
      const opusBitrate = getOpusBitrate();
      const baseWait = 150; // minimum bekleme (eskiden 500ms)
      const bitrateWait = opusBitrate >= 64000 ? 50 : 0;
      const totalWait = baseWait + bitrateWait; // Toplam: 150-200ms

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

      // NOT: UI güncellemeleri MediaRecorder.start() sonrasına taşındı (profesyonel senkronizasyon)

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

        eventBus.emit('log:recorder', {
          message: 'MediaRecorder basladi (direct)',
          details: {
            recordMode,
            mimeType: mediaRecorder.mimeType,
            state: mediaRecorder.state,
            streamActive: remoteStream.active,
            timeslice: timeslice > 0 ? `${timeslice}ms` : 'OFF',
            chunksPerSec: timeslice > 0 ? (1000 / timeslice).toFixed(1) : 'N/A',
            totalPreRecordDelay: `${(recordStartTime - (window._loopbackSetupStart || recordStartTime)).toFixed(0)}ms`,
            stabilizationWait: `${totalWait}ms`,
            primingDuration: 'N/A (direct)'
          }
        });

        window._loopbackRecorder = mediaRecorder;
        window._loopbackChunks = chunks;
        window._loopbackRecordAudioCtx = null;

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
        const bufferSize = getBufferSize();
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

      // Audio akisini kontrol et (1 saniye sonra) - cleanup icin ID sakla
      loopbackSignalCheckTimeout = setTimeout(() => {
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
        loopbackSignalCheckTimeout = null; // Timeout tamamlandi
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

      // DINAMIK SINYAL BEKLEME: Sabit sure yerine sinyal algılanana kadar bekle
      // Bu sekilde codec hazir olmadan kayit baslamaz
      const maxWait = SIGNAL.MAX_WAIT_MS;
      const pollInterval = SIGNAL.POLL_INTERVAL_MS;
      const signalThreshold = SIGNAL.RMS_THRESHOLD;
      let waited = 0;
      let signalDetected = false;
      let lastRms = 0;
      const testArray = new Uint8Array(analyserNode.fftSize);

      eventBus.emit('log:webaudio', {
        message: `Loopback: Sinyal bekleniyor (max ${maxWait}ms)`,
        details: {
          opusBitrate: `${opusBitrate / 1000} kbps`,
          threshold: signalThreshold
        }
      });

      while (waited < maxWait && !signalDetected) {
        analyserNode.getByteTimeDomainData(testArray);
        let sum = 0;
        for (let i = 0; i < testArray.length; i++) {
          const val = (testArray[i] - 128) / 128;
          sum += val * val;
        }
        lastRms = Math.sqrt(sum / testArray.length);

        if (lastRms > signalThreshold) {
          signalDetected = true;
          break;
        }

        await new Promise(r => setTimeout(r, pollInterval));
        waited += pollInterval;
      }

      eventBus.emit('log:webaudio', {
        message: `Loopback: Sinyal bekleme tamamlandi - ${signalDetected ? '✅ SINYAL VAR' : '⚠️ TIMEOUT (sinyal yok)'}`,
        details: {
          rms: lastRms.toFixed(6),
          waited: `${waited}ms`,
          signalDetected,
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

      // Timeslice ve kayit baslangic zamani (onstop closure icin ONCE tanimla)
      const timeslice = getTimeslice();
      let recordStartTime = 0;

      mediaRecorder.onstop = () => {
        eventBus.emit('log:recorder', {
          message: 'Loopback: MediaRecorder onstop tetiklendi',
          details: { totalChunks: chunks.length }
        });

        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        const filename = `kayit_loopback_${recordMode}_${Date.now()}.webm`;

        // Gercek bitrate hesapla
        const durationMs = performance.now() - recordStartTime;
        const durationSec = durationMs / 1000;
        const actualBitrateKbps = durationSec > 0 ? ((blob.size * 8) / 1000 / durationSec).toFixed(1) : '?';

        eventBus.emit('log', `Kayit tamamlandi: ${(blob.size / 1024).toFixed(1)} KB (Gercek bitrate: ~${actualBitrateKbps} kbps)`);
        eventBus.emit('recording:completed', {
          blob,
          mimeType,
          filename,
          recordMode,
          useWebAudio: recordMode !== 'direct',
          useLoopback: true
        });
      };

      if (timeslice > 0) {
        mediaRecorder.start(timeslice);
      } else {
        mediaRecorder.start(); // Timeslice yok - tek chunk
      }
      recordStartTime = performance.now(); // Bitrate hesaplama icin

      // --- SENKRON UI GUNCELLEME (MediaRecorder.start() HEMEN SONRASI) ---
      // Log emit'inden ÖNCE UI güncelle - kullanıcı gecikmesiz görsün
      isPreparing = false;
      currentMode = 'recording';
      updateButtonStates();  // Buton kırmızı "Durdur" olur
      uiStateManager.hidePreparingState();  // Overlay gizlenir
      startTimer();          // Sayaç başlar
      eventBus.emit('recorder:started', { mode: 'loopback' });  // Status: "Kaydediliyor"
      eventBus.emit('recording:started');                       // Player.reset icin
      eventBus.emit('stream:started', loopbackLocalStream);     // Local VU Meter
      eventBus.emit('loopback:remoteStream', remoteStream);     // Remote VU Meter

      // Log yazımı UI güncellemesinden SONRA (IndexedDB/console gecikmesi UI'ı etkilemesin)
      eventBus.emit('log:recorder', {
        message: 'MediaRecorder basladi (WebRTC)',
        details: {
          recordMode,
          mimeType: mediaRecorder.mimeType,
          state: mediaRecorder.state,
          streamActive: remoteStream.active,
          timeslice: timeslice > 0 ? `${timeslice}ms` : 'OFF',
          chunksPerSec: timeslice > 0 ? (1000 / timeslice).toFixed(1) : 'N/A',
          totalPreRecordDelay: `${(recordStartTime - (window._loopbackSetupStart || recordStartTime)).toFixed(0)}ms`,
          stabilizationWait: `${totalWait}ms`,
          signalWait: `${waited}ms`
        }
      });

      // Stop butonuna basinca durdurulacak
      window._loopbackRecorder = mediaRecorder;
      window._loopbackChunks = chunks;
      window._loopbackRecordAudioCtx = recordAudioCtx;

      eventBus.emit('log', '🎙️ Loopback kaydi basladi (WebRTC uzerinden)');

    } else {
      // NORMAL KAYIT
      const timeslice = getTimeslice();
      const mediaBitrate = getMediaBitrate();
      await recorder.start(constraints, recordMode, timeslice, getBufferSize(), mediaBitrate);

      // Kayıt başladı - UI güncelle
      isPreparing = false;
      currentMode = 'recording';
      updateButtonStates();
      uiStateManager.hidePreparingState();
      startTimer();
    }

  } catch (err) {
    eventBus.emit('log:error', {
      message: 'Kayit baslatilamadi',
      details: { error: err.message }
    });
    eventBus.emit('log', `❌ HATA: ${err.message}`);

    // Temizlik
    isPreparing = false;
    currentMode = null;
    updateButtonStates();
    uiStateManager.hidePreparingState();
    stopTimer();
    await loopbackManager.cleanup();
    stopAllTracks(loopbackLocalStream);
    loopbackLocalStream = null;
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
      // Oncelikli: Kayit verisini isle (async olabilir - await et)
      if (originalOnstop) await originalOnstop();

      eventBus.emit('recorder:stopped', { loopback: true });

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
      stopAllTracks(loopbackLocalStream);
      loopbackLocalStream = null;

      // WebRTC temizle
      await loopbackManager.cleanup();

      eventBus.emit('stream:stopped');
      eventBus.emit('log', '⏹️ Loopback kaydi durduruldu');
    };

    // Recorder'i durdur (onstop tetiklenecek)
    recorderInstance.stop();
    window._loopbackRecorder = null;
    window._loopbackChunks = null;
    window._loopbackSetupStart = null;
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
  const mediaBitrate = getMediaBitrate();

  // Pipeline aciklamasi
  let pipeline;
  if (useLoopback) {
    pipeline = monitorMode === 'scriptprocessor'
      ? 'WebRTC Loopback + ScriptProcessor + 1.7sn Delay -> Speaker'
      : monitorMode === 'worklet'
        ? 'WebRTC Loopback + AudioWorklet + 1.7sn Delay -> Speaker'
        : monitorMode === 'direct'
          ? 'WebRTC Loopback + Direct + 1.7sn Delay -> Speaker'
          : 'WebRTC Loopback + WebAudio + 1.7sn Delay -> Speaker';
  } else if (mediaBitrate > 0) {
    // Codec-simulated mode - WhatsApp/Telegram gibi profillerde
    pipeline = `Codec-Simulated (${mediaBitrate}bps) + 1.7sn Delay -> Speaker`;
  } else {
    pipeline = monitorMode === 'scriptprocessor'
      ? 'ScriptProcessor + 1.7sn Delay -> Speaker'
      : monitorMode === 'worklet'
        ? 'AudioWorklet + 1.7sn Delay -> Speaker'
        : monitorMode === 'direct'
          ? 'Direct + 1.7sn Delay -> Speaker'
          : 'WebAudio + 1.7sn Delay -> Speaker';
  }

  eventBus.emit('log:stream', {
    message: 'Monitor Baslat butonuna basildi',
    details: {
      constraints,
      webAudioEnabled: useWebAudio,
      loopbackEnabled: useLoopback,
      mediaBitrate,
      monitorMode,
      pipeline
    }
  });

  try {
    // Monitoring baslarken kayit oynaticisini durdur (karisiklik/feedback onleme)
    player.pause();

    // Preparing state'e geç - buton sarı "Hazırlanıyor..." olur
    isPreparing = true;
    updateButtonStates();
    uiStateManager.showPreparingState(); // Hazirlanıyor... overlay goster

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

      // NOT: stream:started event'i WebRTC kurulumu sonrasina tasindi (senkron UI guncelleme)

      // WebRTC loopback kur
      const remoteStream = await loopbackManager.setup(loopbackLocalStream, { useWebAudio, opusBitrate: getOpusBitrate() });

      // Remote stream'i hoparlore bagla (monitorMode + 1.7sn delay)
      await loopbackManager.startMonitorPlayback(remoteStream, { mode: monitorMode, bufferSize: getBufferSize() });

      // --- SENKRON UI GUNCELLEME ---
      isPreparing = false;
      currentMode = 'monitoring';
      updateButtonStates();
      uiStateManager.hidePreparingState();
      eventBus.emit('stream:started', loopbackLocalStream);  // Local VU Meter
      eventBus.emit('loopback:remoteStream', remoteStream);  // Remote VU Meter (codec sonrasi)

    } else {
      // NORMAL MONITOR (loopback kapali)
      const mediaBitrate = getMediaBitrate();

      if (mediaBitrate > 0) {
        // CODEC-SIMULATED MODE
        // WhatsApp/Telegram gibi profillerde gercek codec sikistirmasi simule et
        // Recording ile birebir ayni parametreler
        const timeslice = getTimeslice();
        const bufferSize = getBufferSize();
        eventBus.emit('log', `🎙️ Codec-simulated monitor baslatiliyor (${monitorMode} ${mediaBitrate} bps, ${timeslice}ms)...`);
        await monitor.startCodecSimulated(constraints, mediaBitrate, monitorMode, timeslice, bufferSize);
      } else if (useWebAudio) {
        // WEBAUDIO MODE
        if (monitorMode === 'direct') {
          await monitor.startDirect(constraints);
        } else if (monitorMode === 'scriptprocessor') {
          await monitor.startScriptProcessor(constraints, getBufferSize());
        } else if (monitorMode === 'worklet') {
          await monitor.startAudioWorklet(constraints);
        } else {
          await monitor.startWebAudio(constraints);
        }
      } else {
        await monitor.startDirect(constraints);
      }

      // Monitor başladı - UI güncelle
      isPreparing = false;
      currentMode = 'monitoring';
      updateButtonStates();
      uiStateManager.hidePreparingState();
    }

  } catch (err) {
    eventBus.emit('log:error', {
      message: 'Monitor baslatilamadi',
      details: { error: err.message }
    });
    eventBus.emit('log', `❌ HATA: ${err.message}`);

    // Temizlik
    isPreparing = false;
    currentMode = null;
    updateButtonStates();
    uiStateManager.hidePreparingState();
    await loopbackManager.cleanupMonitorPlayback();
    await loopbackManager.cleanup();
    stopAllTracks(loopbackLocalStream);
    loopbackLocalStream = null;
  }
};

// Monitor durdurma fonksiyonu
async function stopMonitoring() {
  const useLoopback = isLoopbackEnabled();

  eventBus.emit('log:stream', {
    message: 'Monitor durduruluyor',
    details: { loopbackEnabled: useLoopback }
  });

  // NOT: Monitoring'de timer kullanilmiyor (timer sadece kayit icin)
  // stopTimer() burada gereksiz - kaldirildi

  if (useLoopback) {
    // LoopbackManager'dan mode bilgisini al (cleanup oncesi)
    const stoppedMode = loopbackManager.monitorMode;

    // Loopback monitor playback temizle (Delay/Worklet/ScriptProcessor/Activator)
    await loopbackManager.cleanupMonitorPlayback();

    // Local stream durdur
    stopAllTracks(loopbackLocalStream);
    loopbackLocalStream = null;

    // WebRTC temizle
    await loopbackManager.cleanup();

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

window.copyAllLogs = async () => {
  const btn = document.getElementById('copyLogsBtn');
  const iconCopy = btn?.querySelector('.icon-copy');
  const iconCheck = btn?.querySelector('.icon-check');

  const success = await logger.copyAll();

  if (success && btn) {
    // Basarili animasyon
    btn.classList.add('copied');
    if (iconCopy) iconCopy.style.display = 'none';
    if (iconCheck) iconCheck.style.display = 'block';

    setTimeout(() => {
      btn.classList.remove('copied');
      if (iconCopy) iconCopy.style.display = 'block';
      if (iconCheck) iconCheck.style.display = 'none';
    }, 1500);
  } else if (!success) {
    eventBus.emit('log:error', { message: 'Kopyalama basarisiz', details: {} });
  }
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
