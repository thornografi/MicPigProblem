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
import { PROFILES, SETTINGS } from './modules/Config.js';

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
// Mevcut profil ID'si (ozel mod icin)
let currentProfileId = 'discord';

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

// Mikrofon secici
const micSelector = document.getElementById('micSelector');
const refreshMicsBtn = document.getElementById('refreshMics');

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

async function enumerateMicrophones(silent = false) {
  try {
    // Izin almak icin once getUserMedia cagir (enumerateDevices icin gerekli)
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stopAllTracks(tempStream); // Hemen kapat
    hasMicPermission = true;

    const devices = await navigator.mediaDevices.enumerateDevices();
    const allMics = devices.filter(d => d.kind === 'audioinput');

    // Windows virtual entries'i filtrele (default, communications)
    const virtualIds = ['default', 'communications'];
    const realMics = allMics.filter(m => !virtualIds.includes(m.deviceId));

    // Varsayilan cihazi bul (default entry'nin label'indan)
    const defaultEntry = allMics.find(m => m.deviceId === 'default');
    let defaultRealDeviceId = null;

    if (defaultEntry && defaultEntry.label) {
      // "Varsayilan - Analogue 1+2 (Focusrite)" → "Analogue 1+2 (Focusrite)"
      const defaultLabel = defaultEntry.label.replace(/^(Varsay[ıi]lan|Default)\s*-\s*/i, '').trim();

      // Bu label ile eslesen gercek cihazi bul
      const matchingReal = realMics.find(m => m.label === defaultLabel);
      if (matchingReal) {
        defaultRealDeviceId = matchingReal.deviceId;
      }
    }

    // Eslesme bulunamazsa ilk cihazi varsayilan say
    if (!defaultRealDeviceId && realMics.length > 0) {
      defaultRealDeviceId = realMics[0].deviceId;
    }

    // Dropdown'u temizle
    micSelector.innerHTML = '';

    // Secili cihaz hala mevcut mu kontrol et
    const selectedStillExists = realMics.some(m => m.deviceId === selectedDeviceId);
    if (selectedDeviceId && !selectedStillExists) {
      eventBus.emit('log:warning', {
        message: 'Onceden secili mikrofon artik mevcut degil',
        details: { lostDeviceId: selectedDeviceId.slice(0, 8) }
      });
      selectedDeviceId = '';
      localStorage.removeItem(MIC_STORAGE_KEY);
    }

    realMics.forEach((mic, index) => {
      const option = document.createElement('option');
      option.value = mic.deviceId;

      // Cihaz adi
      let label = mic.label || `Mikrofon ${index + 1}`;

      // Varsayilan cihaza "(varsayilan)" ekle
      if (mic.deviceId === defaultRealDeviceId) {
        label += ' (varsayilan)';
      }

      option.textContent = label;

      // Secili cihazi isle
      if (mic.deviceId === selectedDeviceId) {
        option.selected = true;
      } else if (!selectedDeviceId && mic.deviceId === defaultRealDeviceId) {
        // Hic secim yoksa varsayilani sec
        option.selected = true;
        selectedDeviceId = mic.deviceId;
      }

      micSelector.appendChild(option);
    });

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
      // Izin var - tam listeyi goster
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

      micSelector.innerHTML = '';

      // Secili cihaz hala mevcut mu kontrol et
      const selectedStillExists = realMics.some(m => m.deviceId === selectedDeviceId);
      if (selectedDeviceId && !selectedStillExists) {
        selectedDeviceId = '';
        localStorage.removeItem(MIC_STORAGE_KEY);
      }

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

// Profil constraint'lerini uygula (locked/editable)
function applyProfileConstraints(profile) {
  if (!profile) return;

  const lockedSettings = profile.lockedSettings || [];

  // Once tum ayarlari enable et (temiz baslangic)
  // OCP: Dinamik olarak SETTINGS'den key listesi alinir
  const allSettingKeys = Object.keys(SETTINGS);
  allSettingKeys.forEach(key => setSettingDisabled(key, false));

  // Locked ayarlari disable et
  lockedSettings.forEach(key => setSettingDisabled(key, true));
}

// validateConfigCombination() - KALDIRILDI: Kullanilmiyordu, UI mantigi updateDynamicLocks() ve updateSettingVisibility() icinde

/**
 * Dinamik kilitleme - Ham Kayit (mictest) profilinde aykiri ayarlari otomatik disable eder
 * Bu fonksiyon profil constraint'lerinden SONRA calisir ve dinamik kurallari uygular
 * NOT: webaudio toggle kaldirildi - artik sadece mode ve loopback'e gore kilitleme yapiliyor
 */
function updateDynamicLocks() {
  const profile = PROFILES[currentProfileId];
  if (!profile) return;

  // Sadece 'all' editable profillerde dinamik kilitleme aktif (Ham Kayit)
  const isDynamicProfile = profile.allowedSettings === 'all' && profile.lockedSettings?.length === 0;
  if (!isDynamicProfile) return;

  const loopback = loopbackToggle?.checked ?? false;
  const mode = getRadioValue('processingMode', 'standard');

  // Kural 1: mode direct/standard → buffer kilitle (sadece scriptprocessor/worklet icin anlamli)
  const needsBuffer = ['scriptprocessor', 'worklet'].includes(mode);
  setSettingDisabled('buffer', !needsBuffer);

  // Kural 2: loopback ON → mediaBitrate kilitle (WebRTC varsa MediaRecorder bitrate anlamsiz)
  setSettingDisabled('mediaBitrate', loopback);

  // Kural 3: loopback OFF → bitrate kilitle (WebRTC yoksa Opus bitrate anlamsiz)
  setSettingDisabled('bitrate', !loopback);

  // Ozel Ayarlar panelini de guncelle (disabled state'leri yansit)
  updateCustomSettingsPanelDynamicState();
}

/**
 * Ozel Ayarlar panelindeki dinamik kilitleme durumunu guncelle
 */
function updateCustomSettingsPanelDynamicState() {
  if (!customSettingsGrid) return;

  const mode = getRadioValue('processingMode', 'standard');
  const dynamicLockMap = {
    buffer: !['scriptprocessor', 'worklet'].includes(mode),
    mediaBitrate: loopbackToggle?.checked,
    bitrate: !loopbackToggle?.checked
  };

  Object.entries(dynamicLockMap).forEach(([key, isLocked]) => {
    const element = customSettingsGrid.querySelector(`[data-setting="${key}"]`);
    if (element) {
      element.disabled = isLocked;
      const parent = element.closest('.custom-setting-item');
      if (parent) {
        parent.classList.toggle('dynamic-locked', isLocked);
      }
    }
  });
}

async function applyProfile(profileId) {
  const profile = PROFILES[profileId];
  if (!profile) return;

  // Mevcut profil ID'sini guncelle (ozel mod icin)
  currentProfileId = profileId;

  const values = profile.values;
  const lockedSettings = profile.lockedSettings || [];
  const editableSettings = profile.editableSettings || [];

  // Aktif stream varsa restart gerekiyor mu kontrol et
  const wasActive = currentMode !== null;
  const previousMode = currentMode;

  // Profil bazli bireysel ayar gorunurlugunu guncelle
  updateSettingVisibility(profile);

  // Aktif stream varsa once durdur
  if (wasActive) {
    eventBus.emit('log:ui', { message: `Profil degisiyor, ${previousMode === 'monitoring' ? 'monitor' : 'kayit'} yeniden baslatilacak...` });

    if (previousMode === 'monitoring') {
      await stopMonitoring();
    } else if (previousMode === 'recording') {
      await stopRecording();
    }
  }

  // OCP: Diger profiller - ayarlari Config.js metadata'sina gore dinamik uygula
  Object.entries(values).forEach(([key, value]) => {
    const setting = SETTINGS[key];
    if (!setting?.ui) return;

    const elements = getSettingElements(key);
    if (elements.length === 0) return;

    if (setting.type === 'boolean') {
      // Checkbox veya Toggle
      elements.forEach(el => el.checked = value);
    } else if (setting.type === 'enum') {
      // Radio grubu - degere gore sec
      const radio = elements.find(el => el.value == value);
      if (radio) radio.checked = true;
    }
  });

  // Locked/Editable constraint'leri uygula
  applyProfileConstraints(profile);

  // Dinamik kilitleme (Ham Kayit profili icin aykiri ayar kurallari)
  updateDynamicLocks();

  // Profil bazli bireysel ayar gorunurlugunu guncelle
  updateSettingVisibility(profile);

  // Buffer bilgisini guncelle
  updateBufferInfo(values.buffer);

  // Timeslice info guncelle
  updateTimesliceInfo(values.timeslice);

  // Locked ayarlari logla
  if (lockedSettings.length > 0) {
    eventBus.emit('log:system', {
      message: `Profil: ${profile.label} - Kilitli ayarlar: ${lockedSettings.join(', ')}`,
      details: { profileId, locked: lockedSettings, editable: editableSettings }
    });
  }

  eventBus.emit('log', `Profil: ${profile.label}`);
  eventBus.emit('log:system', {
    message: 'Profil uygulandi',
    details: { profileId, ...values }
  });

  // Buton ve ayar durumlarini senkronize et
  updateButtonStates();

  // Aktif stream vardi ise yeni ayarlarla yeniden baslat
  if (wasActive) {
    // Kisa bir gecikme - UI'in guncellenmesi icin
    await new Promise(resolve => setTimeout(resolve, 100));

    eventBus.emit('log:ui', { message: `Yeni profil ile ${previousMode === 'monitoring' ? 'monitor' : 'kayit'} yeniden baslatiliyor...` });

    if (previousMode === 'monitoring') {
      // Dogrudan onclick cagir ve bekle (click() Promise donmuyor)
      await monitorToggleBtn.onclick();
    } else if (previousMode === 'recording') {
      // Dogrudan onclick cagir ve bekle
      await recordToggleBtn.onclick();
    }
  }
}

// ============================================
// YARDIMCI FONKSIYONLAR
// ============================================

// DOM visibility helper - element goster/gizle
function toggleDisplay(element, shouldShow, displayValue = 'block') {
  if (element) element.style.display = shouldShow ? displayValue : 'none';
}

// Profil bazli bireysel ayar gorunurlugu ve kilitleme
// locked: gorunur ama disabled (kilit ikonu)
// editable: gorunur ve enabled
// hidden: ne locked ne editable (display: none)
function updateSettingVisibility(profile) {
  if (!profile) return;

  const lockedSettings = profile.lockedSettings || [];
  const editableSettings = profile.editableSettings || [];
  const isAll = profile.allowedSettings === 'all';

  // Drawer icindeki tum ayar container'lari
  // OCP: Dinamik olarak SETTINGS'den key listesi alinir
  const drawerSettings = Object.keys(SETTINGS);

  drawerSettings.forEach(settingKey => {
    const container = document.querySelector(`[data-setting="${settingKey}"]`);
    if (!container) return;

    if (isAll) {
      // Legacy/Custom: Tum ayarlar gorunur ve enabled
      container.style.display = '';
      container.classList.remove('setting-locked');
      setSettingDisabled(settingKey, false);
    } else if (lockedSettings.includes(settingKey)) {
      // Kilitli: Gorunur ama disabled (kilit ikonu)
      container.style.display = '';
      container.classList.add('setting-locked');
      setSettingDisabled(settingKey, true);
    } else if (editableSettings.includes(settingKey)) {
      // Editable: Gorunur ve enabled
      container.style.display = '';
      container.classList.remove('setting-locked');
      setSettingDisabled(settingKey, false);
    } else {
      // Ne locked ne editable: GIZLI
      container.style.display = 'none';
      container.classList.remove('setting-locked');
    }
  });

  // Section visibility - icerigine gore otomatik gizle/goster
  updateSectionVisibility();
}

// Section'lari iceriklerine gore goster/gizle
function updateSectionVisibility() {
  // Pipeline section: webaudio, mode, buffer gorunur mu?
  const pipelineVisible = ['webaudio', 'mode', 'buffer'].some(key => {
    const container = document.querySelector(`[data-setting="${key}"]`);
    return container && container.style.display !== 'none';
  });
  toggleDisplay(pipelineSection, pipelineVisible);

  // WebRTC section: loopback, bitrate, mediaBitrate gorunur mu?
  const webrtcVisible = ['loopback', 'bitrate', 'mediaBitrate'].some(key => {
    const container = document.querySelector(`[data-setting="${key}"]`);
    return container && container.style.display !== 'none';
  });
  toggleDisplay(webrtcSection, webrtcVisible);

  // Developer section: timeslice gorunur mu?
  const developerVisible = ['timeslice'].some(key => {
    const container = document.querySelector(`[data-setting="${key}"]`);
    return container && container.style.display !== 'none';
  });
  toggleDisplay(developerSection, developerVisible);
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

    // Buffer size secici sadece ScriptProcessor modunda gorunur
    toggleDisplay(bufferSizeContainer, mode === 'scriptprocessor');

    // Dinamik kilitleme guncelle (buffer icin)
    updateDynamicLocks();

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

  // Dinamik kilitleme guncelle (bitrate/mediaBitrate icin)
  updateDynamicLocks();

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
    await applyProfile(e.target.value);
    updateScenarioCardSelection(e.target.value);
  });

  // Sayfa yuklendiginde varsayilan profili uygula
  applyProfile(profileSelector.value).catch(err => {
    eventBus.emit('log:error', {
      message: 'Profil uygulama hatasi',
      details: { error: err.message }
    });
  });
}

// ============================================
// SENARYO KARTLARI & SIDEBAR NAV
// ============================================
const scenarioCards = document.querySelectorAll('.scenario-card');
const scenarioBadge = document.getElementById('scenarioBadge');
const scenarioTech = document.getElementById('scenarioTech');

// Yeni sidebar elementleri
const navItems = document.querySelectorAll('.nav-item[data-profile]');
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
  if (profileSelector) {
    profileSelector.value = profileId;
  }
  await applyProfile(profileId);
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
      setting.values.forEach(val => {
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
let loopbackStatsInterval = null; // WebRTC getStats polling
let lastBytesSent = 0; // getStats bitrate hesaplama icin
let lastStatsTimestamp = 0;

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

  // Profil kilitleri kontrolu
  const profile = PROFILES[currentProfileId];
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

  // Processing mode selector - profil kilidi + aktif session kontrolu
  processingModeRadios.forEach(radio => {
    const workletUnsupported = radio.value === 'worklet' && !WORKLET_SUPPORTED;
    radio.disabled = shouldBeDisabled('mode') || workletUnsupported;
  });

  // Bitrate selector - profil kilidi + aktif session kontrolu
  bitrateRadios.forEach(r => r.disabled = shouldBeDisabled('bitrate'));

  // Timeslice selector - profil kilidi + aktif session kontrolu
  timesliceRadios.forEach(r => r.disabled = shouldBeDisabled('timeslice'));

  // Buffer size selector - profil kilidi + aktif session kontrolu
  bufferSizeRadios.forEach(r => r.disabled = shouldBeDisabled('buffer'));

  // Buton text'lerini guncelle
  const recordBtnText = recordToggleBtn.querySelector('.btn-text');
  const monitorBtnText = monitorToggleBtn.querySelector('.btn-text');

  if (recordBtnText) {
    recordBtnText.textContent = isRecording ? 'Durdur' : 'Kayıt';
  }
  if (monitorBtnText) {
    monitorBtnText.textContent = isMonitoring ? 'Durdur' : 'Monitor';
  }
}

/**
 * "Hazırlanıyor..." overlay'ini göster
 * Kayıt/monitoring başlatılırken async işlemler sırasında kullanılır
 */
function showPreparingState() {
  if (preparingOverlayEl) {
    preparingOverlayEl.classList.add('visible');
  }
}

/**
 * "Hazırlanıyor..." overlay'ini gizle
 */
function hidePreparingState() {
  if (preparingOverlayEl) {
    preparingOverlayEl.classList.remove('visible');
  }
}

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

  // Opus payload type'ini bul (a=rtpmap:111 opus/48000/2)
  let opusPayloadType = null;
  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+opus\//i);
    if (match) {
      opusPayloadType = match[1];
      break;
    }
  }

  // Opus bulunamadiysa SDP'yi degistirme
  if (!opusPayloadType) {
    return sdp;
  }

  const modifiedLines = lines.map(line => {
    // Opus fmtp satirini bul (payload type ile eslesme)
    if (line.startsWith(`a=fmtp:${opusPayloadType}`)) {
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
    // Listener cleanup fonksiyonu - memory leak onleme
    const cleanupListeners = () => {
      loopbackPc1.oniceconnectionstatechange = null;
      loopbackPc2.oniceconnectionstatechange = null;
    };

    const timeout = setTimeout(() => {
      cleanupListeners(); // Temizle
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
        cleanupListeners(); // Temizle
        resolve();
      } else if (ice1 === 'failed' || ice2 === 'failed') {
        clearTimeout(timeout);
        cleanupListeners(); // Temizle
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

  // WebRTC getStats ile gercek bitrate olcumu baslat
  startLoopbackStatsPolling(opusBitrate);

  return loopbackRemoteStream;
}

/**
 * WebRTC getStats ile gercek bitrate olcumu
 * 2 saniyede bir bytesSent delta'si ile bitrate hesaplar
 */
function startLoopbackStatsPolling(requestedBitrate) {
  // Onceki polling'i temizle
  if (loopbackStatsInterval) {
    clearInterval(loopbackStatsInterval);
  }

  lastBytesSent = 0;
  lastStatsTimestamp = Date.now();
  let statsErrorCount = 0; // Error counter - cok fazla hata olursa polling durdur

  loopbackStatsInterval = setInterval(async () => {
    if (!loopbackPc1) {
      clearInterval(loopbackStatsInterval);
      loopbackStatsInterval = null;
      return;
    }

    try {
      const stats = await loopbackPc1.getStats();
      let currentBytesSent = 0;

      stats.forEach(report => {
        if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          currentBytesSent = report.bytesSent || 0;
        }
      });

      const now = Date.now();
      const timeDelta = (now - lastStatsTimestamp) / 1000; // saniye

      if (lastBytesSent > 0 && timeDelta > 0) {
        const bytesDelta = currentBytesSent - lastBytesSent;
        const actualBitrate = Math.round((bytesDelta * 8) / timeDelta);
        const actualKbps = (actualBitrate / 1000).toFixed(1);
        const requestedKbps = (requestedBitrate / 1000).toFixed(0);

        eventBus.emit('loopback:stats', {
          requestedBitrate,
          actualBitrate,
          requestedKbps,
          actualKbps
        });

        // Log sadece buyuk sapma varsa (%50+) - kucuk sapmalar normal (adaptive bitrate)
        const deviation = Math.abs(actualBitrate - requestedBitrate) / requestedBitrate;
        if (deviation > 0.5) {
          eventBus.emit('log:warning', {
            message: `WebRTC bitrate sapmasi: Istenen ${requestedKbps}kbps, Gercek ~${actualKbps}kbps`,
            details: { requestedBitrate, actualBitrate, deviation: (deviation * 100).toFixed(0) + '%' }
          });
        }
      }

      lastBytesSent = currentBytesSent;
      lastStatsTimestamp = now;
      statsErrorCount = 0; // Basarili - error counter reset

    } catch (err) {
      // getStats hatasi - error counter ile kontrol
      statsErrorCount++;
      if (statsErrorCount > 10) {
        clearInterval(loopbackStatsInterval);
        loopbackStatsInterval = null;
        eventBus.emit('log:error', {
          message: 'Loopback stats: Cok fazla hata, polling durduruluyor',
          details: { errorCount: statsErrorCount, lastError: err.message }
        });
      }
    }
  }, 2000); // 2 saniyede bir
}

/**
 * Loopback kaynaklarini temizler
 */
async function cleanupLoopback() {
  // Stats polling durdur
  if (loopbackStatsInterval) {
    clearInterval(loopbackStatsInterval);
    loopbackStatsInterval = null;
  }

  loopbackPc1?.close();
  loopbackPc2?.close();
  loopbackPc1 = null;
  loopbackPc2 = null;

  stopAllTracks(loopbackRemoteStream);
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
    const allowed = new Set(['direct', 'standard', 'scriptprocessor', 'worklet']);
    if (!allowed.has(requestedMode)) return 'standard';
    if (requestedMode === 'worklet' && !WORKLET_SUPPORTED) return 'standard';
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
    const bufferSize = getBufferSize();
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
    // direct / standard: Source -> Delay
    loopbackMonitorSrc.connect(loopbackMonitorDelay);
  }

  loopbackMonitorDelay.connect(loopbackMonitorCtx.destination);

  const graphByMode = {
    direct: `WebRTC RemoteStream -> Source -> DelayNode(${delaySeconds}s) -> Destination`,
    standard: `WebRTC RemoteStream -> Source -> DelayNode(${delaySeconds}s) -> Destination`,
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
      graph: graphByMode[safeMode] || graphByMode.standard
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
    // Kayit baslarken oynaticiyi durdur (tutarlilik + potansiyel feedback onleme)
    player.pause();

    currentMode = 'recording';
    updateButtonStates();
    showPreparingState(); // Hazirlanıyor... overlay goster

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

      // --- SENKRON UI GUNCELLEME ---
      // Hazirlanıyor overlay'i gizle
      hidePreparingState();

      // VU Meter'lari ayni anda baslat
      eventBus.emit('stream:started', loopbackLocalStream);  // Local VU Meter
      eventBus.emit('loopback:remoteStream', remoteStream);  // Remote VU Meter (codec sonrasi)

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

        startTimer();
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

      startTimer();

      eventBus.emit('log', '🎙️ Loopback kaydi basladi (WebRTC uzerinden)');

    } else {
      // NORMAL KAYIT
      const timeslice = getTimeslice();
      const mediaBitrate = getMediaBitrate();
      await recorder.start(constraints, recordMode, timeslice, getBufferSize(), mediaBitrate);
      hidePreparingState(); // Hazirlanıyor overlay'i gizle
      startTimer();
    }

  } catch (err) {
    eventBus.emit('log:error', {
      message: 'Kayit baslatilamadi',
      details: { error: err.message }
    });
    eventBus.emit('log', `❌ HATA: ${err.message}`);

    // Temizlik
    hidePreparingState(); // Hata durumunda overlay'i gizle
    stopTimer();
    await cleanupLoopback();
    stopAllTracks(loopbackLocalStream);
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
      // Oncelikli: Kayit verisini isle (async olabilir - await et)
      if (originalOnstop) await originalOnstop();

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
      stopAllTracks(loopbackLocalStream);
      loopbackLocalStream = null;

      // WebRTC temizle
      await cleanupLoopback();

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
      ? 'WebRTC Loopback + ScriptProcessor + 2sn Delay -> Speaker'
      : monitorMode === 'worklet'
        ? 'WebRTC Loopback + AudioWorklet + 2sn Delay -> Speaker'
        : monitorMode === 'direct'
          ? 'WebRTC Loopback + Direct + 2sn Delay -> Speaker'
          : 'WebRTC Loopback + WebAudio + 2sn Delay -> Speaker';
  } else if (mediaBitrate > 0) {
    // Codec-simulated mode - WhatsApp/Telegram gibi profillerde
    pipeline = `Codec-Simulated (${mediaBitrate}bps) + 2sn Delay -> Speaker`;
  } else {
    pipeline = monitorMode === 'scriptprocessor'
      ? 'ScriptProcessor + 2sn Delay -> Speaker'
      : monitorMode === 'worklet'
        ? 'AudioWorklet + 2sn Delay -> Speaker'
        : monitorMode === 'direct'
          ? 'Direct + 2sn Delay -> Speaker'
          : 'WebAudio + 2sn Delay -> Speaker';
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

    currentMode = 'monitoring';
    updateButtonStates();
    showPreparingState(); // Hazirlanıyor... overlay goster

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
      const remoteStream = await setupLoopback(loopbackLocalStream, useWebAudio);

      // Remote stream'i hoparlore bagla (monitorMode + 2sn delay)
      await startLoopbackMonitorPlayback(remoteStream, monitorMode);

      // --- SENKRON UI GUNCELLEME ---
      hidePreparingState(); // Hazirlanıyor overlay'i gizle
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
      hidePreparingState(); // Hazirlanıyor overlay'i gizle
    }

  } catch (err) {
    eventBus.emit('log:error', {
      message: 'Monitor baslatilamadi',
      details: { error: err.message }
    });
    eventBus.emit('log', `❌ HATA: ${err.message}`);

    // Temizlik
    hidePreparingState(); // Hata durumunda overlay'i gizle
    await cleanupLoopbackMonitorPlayback();
    await cleanupLoopback();
    stopAllTracks(loopbackLocalStream);
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

  // NOT: Monitoring'de timer kullanilmiyor (timer sadece kayit icin)
  // stopTimer() burada gereksiz - kaldirildi

  if (useLoopback) {
    const stoppedMode = loopbackMonitorMode;

    // Loopback monitor playback temizle (Delay/Worklet/ScriptProcessor/Activator)
    await cleanupLoopbackMonitorPlayback();

    // Local stream durdur
    stopAllTracks(loopbackLocalStream);
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
