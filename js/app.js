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
import { formatTime, createAudioContext, getAudioContextOptions, stopStreamTracks, toggleDisplay, createMediaRecorder, needsBufferSetting, usesWebAudio, usesWasmOpus, usesMediaRecorder } from './modules/utils.js';
import { createPassthroughWorkletNode, ensurePassthroughWorklet, isAudioWorkletSupported } from './modules/WorkletHelper.js';
import { isWasmOpusSupported } from './modules/OpusWorkerHelper.js';
import { PROFILES, SETTINGS, PROFILE_CATEGORIES } from './modules/Config.js';
import { DELAY, SIGNAL, bytesToKB, AUDIO, BUFFER, calculateLatencyMs } from './modules/constants.js';
import loopbackManager from './modules/LoopbackManager.js';
import profileController from './modules/ProfileController.js';
import uiStateManager from './modules/UIStateManager.js';
import recordingController from './controllers/RecordingController.js';
import monitoringController from './controllers/MonitoringController.js';
import debugConsole from './ui/DebugConsole.js';
import profileUIManager from './ui/ProfileUIManager.js';
import customSettingsPanelHandler from './ui/CustomSettingsPanelHandler.js';
import { RadioGroupHandler } from './ui/RadioGroupHandler.js';

// ============================================
// ERKEN TANIMLANAN SABITLER (applyProfile oncesi gerekli)
// ============================================
const WORKLET_SUPPORTED = isAudioWorkletSupported();
const WASM_OPUS_SUPPORTED = isWasmOpusSupported();

// ============================================
// UTILITY FONKSIYONLAR
// ============================================
// NOT: stopAllTracks artik stopStreamTracks olarak utils.js'den import ediliyor

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

// Pipeline ve Encoder (kayit + monitor icin ortak)
const pipelineContainer = document.getElementById('pipelineContainer');
const encoderContainer = document.getElementById('encoderContainer');

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
const timesliceContainerEl = document.querySelector('[data-setting="timeslice"]');

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
  pipeline: document.querySelector('[data-setting="pipeline"]'),
  encoder: document.querySelector('[data-setting="encoder"]'),
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
const pipelineRadios = document.querySelectorAll('input[name="pipeline"]');
const encoderRadios = document.querySelectorAll('input[name="encoder"]');
const bitrateRadios = document.querySelectorAll('input[name="bitrate"]');
// mediaBitrateRadios - KALDIRILDI: OCP mimarisi ile getSettingElements() dinamik kullaniliyor
const timesliceRadios = document.querySelectorAll('input[name="timeslice"]');
const bufferSizeRadios = document.querySelectorAll('input[name="bufferSize"]');

// ============================================
// MIKROFON LISTESI - DeviceInfo modülüne taşındı
// ============================================
// NOT: Mikrofon yönetimi deviceInfo.initMicSelector() ile başlatılıyor
// getSelectedDeviceId() -> deviceInfo.getSelectedDeviceId()

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

// Belirli bir secenek (radio/option) enable/disable et
// Ornek: setOptionDisabled('encoder', 'wasm-opus', true) -> sadece wasm-opus secenegi disabled
function setOptionDisabled(settingKey, optionValue, disabled) {
  const elements = getSettingElements(settingKey);
  const targetEl = elements.find(el => el.value === optionValue);
  if (targetEl) {
    targetEl.disabled = disabled;
    const label = targetEl.closest('label');
    if (label) {
      label.classList.toggle('option-disabled', disabled);
    }
  }
}

// NOT: applyProfile, applyProfileConstraints, updateDynamicLocks, updateCustomSettingsPanelDynamicState
// fonksiyonlari ProfileController modülüne taşındı

// ============================================
// YARDIMCI FONKSIYONLAR
// ============================================

// NOT: toggleDisplay utils.js'e tasindi
// NOT: updateSettingVisibility, updateSectionVisibility fonksiyonlari ProfileController modülüne tasindi

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

// NOT: attachCheckboxLogger fonksiyonu RadioGroupHandler modülüne taşındı

// ============================================
// AYAR OKUMA FONKSIYONLARI
// ============================================
function getConstraints() {
  const constraints = {
    echoCancellation: ecCheckbox.checked,
    noiseSuppression: nsCheckbox.checked,
    autoGainControl: agcCheckbox.checked,
    sampleRate: getRadioValue('sampleRate', AUDIO.DEFAULT_SAMPLE_RATE, true),
    channelCount: getRadioValue('channelCount', 1, true)
  };

  // Secilen mikrofonu ekle (DeviceInfo modülünden)
  const deviceId = deviceInfo.getSelectedDeviceId();
  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  }

  return constraints;
}

function isWebAudioEnabled() {
  // Pipeline'a gore WebAudio durumunu belirle
  // direct: WebAudio yok, diger pipeline'lar: WebAudio var
  const pipeline = getRadioValue('pipeline', 'standard');
  return usesWebAudio(pipeline);
}

function getPipeline() {
  return getRadioValue('pipeline', 'standard');
}

function getEncoder() {
  return getRadioValue('encoder', 'mediarecorder');
}

// Geriye uyumluluk icin alias
function getProcessingMode() {
  return getPipeline();
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

  // Latency hesaplama (varsayilan sample rate)
  const latencyMs = calculateLatencyMs(value).toFixed(1);

  bufferInfoText.textContent = `${value} samples @ ${AUDIO.DEFAULT_SAMPLE_RATE / 1000}kHz = ~${latencyMs}ms latency`;

  // Kucuk buffer = dusuk latency ama yuksek CPU
  bufferInfoText.classList.remove('warning', 'danger');
  if (value <= BUFFER.WARNING_THRESHOLD) {
    bufferInfoText.classList.add('warning');
  }
}

// NOT: createAudioMediaRecorder utils.js'teki createMediaRecorder'a delege eder
// RecordingController dependency olarak aliyor
function createAudioMediaRecorder(stream, options = {}) {
  return createMediaRecorder(stream, options);
}

// Timeslice info metnini guncelle
function updateTimesliceInfo(value) {
  if (!timesliceInfoEl) return;

  const infoText = timesliceInfoEl.querySelector('.info-text');
  if (!infoText) return;

  // Temizle
  infoText.classList.remove('warning', 'danger');

  if (value === 0) {
    infoText.textContent = 'OFF: Single chunk - no timeslice';
  } else {
    const chunksPerSec = 1000 / value;
    infoText.textContent = `${value}ms: ~${chunksPerSec.toFixed(1)} chunks/sec - Listen for glitch frequency!`;

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
RadioGroupHandler.attachCheckboxLogger(ecCheckbox, 'echoCancellation', 'Echo Cancellation');
RadioGroupHandler.attachCheckboxLogger(nsCheckbox, 'noiseSuppression', 'Noise Suppression');
RadioGroupHandler.attachCheckboxLogger(agcCheckbox, 'autoGainControl', 'Auto Gain Control');

// NOT: webaudioToggle kaldirildi - artik mode secimi WebAudio durumunu belirliyor
// Mode degisikliginde loglama asagida yapiliyor

// Pipeline degisikligi loglama
pipelineRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    const pipeline = e.target.value;
    const labelByPipeline = {
      direct: 'Direct',
      standard: 'Standard',
      scriptprocessor: 'ScriptProcessor',
      worklet: 'AudioWorklet'
    };

    // Buffer size gorunurlugu: profil ayarlarina veya pipeline'a bagli
    // - Profilde buffer locked/editable ise: updateSettingVisibility halleder
    // - Profilde buffer yoksa: sadece ScriptProcessor pipeline'inda goster
    const profile = profileController.getCurrentProfile();
    const bufferInProfile = profile?.lockedSettings?.includes('buffer') ||
                            profile?.editableSettings?.includes('buffer') ||
                            profile?.allowedSettings === 'all';
    if (!bufferInProfile) {
      toggleDisplay(bufferSizeContainer, needsBufferSetting(pipeline));
    }

    // Dinamik kilitleme guncelle (buffer icin)
    profileController.updateDynamicLocks();
    uiStateManager.updateButtonStates();

    eventBus.emit('log:webaudio', {
      message: `Pipeline: ${labelByPipeline[pipeline] || pipeline}`,
      details: { setting: 'pipeline', value: pipeline }
    });
  });
});

// Encoder degisikligi loglama
encoderRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    const encoder = e.target.value;
    const labelByEncoder = {
      mediarecorder: 'MediaRecorder',
      'wasm-opus': 'WASM Opus'
    };

    eventBus.emit('log:webaudio', {
      message: `Encoder: ${labelByEncoder[encoder] || encoder}`,
      details: { setting: 'encoder', value: encoder }
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
        latencyMs: calculateLatencyMs(bufferSize).toFixed(1)
      }
    });
  });
});

loopbackToggle.addEventListener('change', (e) => {
  // Bitrate seciciyi goster/gizle
  toggleDisplay(opusBitrateContainer, e.target.checked);

  // Dinamik kilitleme guncelle (bitrate/mediaBitrate/timeslice icin)
  profileController.updateDynamicLocks();
  uiStateManager.updateButtonStates();

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
  // NOT: Baslangic profili uygulama, callbacks set edildikten sonra yapiliyor (line ~912)
}

// ============================================
// SENARYO KARTLARI & SIDEBAR NAV
// ============================================
// NOT: scenarioCards ve navItems yukarida tanimlandi (applyProfile hoisting icin)
const scenarioBadge = document.getElementById('scenarioBadge');
const scenarioTech = document.getElementById('scenarioTech');

// Sidebar elementleri
const pageTitle = document.getElementById('pageTitle');
const pageTitleIcon = document.getElementById('pageTitleIcon');
const pageSubtitle = document.getElementById('pageSubtitle');
const settingsDrawer = document.getElementById('settingsDrawer');
const drawerOverlay = document.getElementById('drawerOverlay');
const closeDrawerBtn = document.getElementById('closeDrawer');

// Dev Console Drawer
const devConsoleDrawer = document.getElementById('devConsoleDrawer');
const devConsoleToggle = document.getElementById('devConsoleToggle');
const closeConsoleBtn = document.getElementById('closeConsole');
// sidebarStatus - KALDIRILDI: Kullanilmiyordu

// NOT: buildTechParts ProfileController'a tasindi
// NOT: updateScenarioTechInfo, updateScenarioCardSelection, updateNavItemSelection, updatePageSubtitle
//      ProfileUIManager modülüne tasindi

function closeSettingsDrawer() {
  if (settingsDrawer) settingsDrawer.classList.remove('open');
  if (drawerOverlay) drawerOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

function toggleDevConsole() {
  if (devConsoleDrawer) {
    devConsoleDrawer.classList.toggle('open');
  }
}

// Drawer event listeners
if (closeDrawerBtn) {
  closeDrawerBtn.addEventListener('click', closeSettingsDrawer);
}
if (drawerOverlay) {
  drawerOverlay.addEventListener('click', closeSettingsDrawer);
}

// Dev Console event listeners
if (devConsoleToggle) {
  devConsoleToggle.addEventListener('click', toggleDevConsole);
}
if (closeConsoleBtn) {
  closeConsoleBtn.addEventListener('click', toggleDevConsole);
}

// ESC ile drawer/console kapat
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (settingsDrawer?.classList.contains('open')) {
      closeSettingsDrawer();
    }
    if (devConsoleDrawer?.classList.contains('open')) {
      toggleDevConsole();
    }
  }
});

// NOT: handleProfileSelect ve scenarioCards/navItems event listener'lari ProfileUIManager modülüne tasindi

// NOT: Ozel Ayarlar Panel Toggle CustomSettingsPanelHandler modülüne taşındı

// NOT: updateCustomSettingsPanel fonksiyonu ve customSettingsGrid event listener'i
// CustomSettingsPanelHandler modülüne taşındı

// Baslangic profil ID'si (initialization icin)
const initialProfile = profileSelector?.value || 'discord';
// NOT: Profil UI guncellemeleri, callbacks set edildikten sonra yapiliyor (line ~905+)

// ============================================
// MERKEZI STATE YONETIMI
// ============================================
// NOT: currentMode dosya basinda tanimlandi (hoisting icin)

// Timer - UIStateManager modülüne taşındı
const timerEl = document.getElementById('recordingTimer');

// NOT: updateButtonStates fonksiyonu UIStateManager modülüne taşındı
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
  updateButtonStates: () => uiStateManager.updateButtonStates(),
  updateBufferInfo,
  updateTimesliceInfo,
  updateCategoryUI,
  getRadioValue,
  setSettingDisabled,
  setOptionDisabled,
  getSettingElements
});

profileController.setStateGetters({
  currentMode: () => currentMode
});

// UIStateManager init (tum UI state yonetimi icin)
uiStateManager.init({
  recordToggleBtn,
  monitorToggleBtn,
  loopbackToggle,
  ecCheckbox,
  nsCheckbox,
  agcCheckbox,
  pipelineContainer,
  encoderContainer,
  timesliceContainer: timesliceContainerEl,
  recordingPlayerCard: recordingPlayerCardEl,
  playBtn: playBtnEl,
  progressBar: progressBarEl,
  downloadBtn: downloadBtnEl,
  micSelector,
  refreshMicsBtn,
  preparingOverlay: preparingOverlayEl,
  profileSelector,
  timerEl
});

uiStateManager.setRadioGroups({
  pipeline: [...pipelineRadios],
  encoder: [...encoderRadios],
  bitrate: [...bitrateRadios],
  mediaBitrate: [...document.querySelectorAll('input[name="mediaBitrate"]')],
  timeslice: [...timesliceRadios],
  bufferSize: [...bufferSizeRadios]
});

uiStateManager.setStateGetters({
  currentMode: () => currentMode,
  isPreparing: () => isPreparing,
  currentProfileId: () => profileController.getCurrentProfileId(),
  isWorkletSupported: () => WORKLET_SUPPORTED,
  isWasmOpusSupported: () => WASM_OPUS_SUPPORTED
});

uiStateManager.setProfileCollections({
  navItems: [...navItems],
  scenarioCards: [...scenarioCards]
});

uiStateManager.setProfileController(profileController);

// CustomSettingsPanelHandler init
customSettingsPanelHandler.init({
  customSettingsToggle,
  customSettingsContent,
  customSettingsGrid
});

customSettingsPanelHandler.setCallbacks({
  getSettingElements,
  setSettingDisabled
});

customSettingsPanelHandler.setDependencies({
  profileController
});

// DeviceInfo init - mikrofon secici
deviceInfo.initMicSelector({
  micSelector,
  refreshMicsBtn
});

// Baslangicta buton durumlarini ayarla
uiStateManager.updateButtonStates();

// Baslangic profilini uygula (loopback, mode vb. degerler set edilsin)
profileController.applyProfile(initialProfile);

// Baslangic profil UI guncellemeleri (applyProfile sonrasi)
profileUIManager.updateAll(initialProfile);
customSettingsPanelHandler.updatePanel(initialProfile);
// NOT: updateCategoryUI zaten applyProfile icinde cagiriliyor

// UI state sync (refresh/persisted checkbox senaryolari icin)
toggleDisplay(pipelineContainer, isWebAudioEnabled());
toggleDisplay(encoderContainer, true); // Encoder her zaman gorunur

if (!WORKLET_SUPPORTED) {
  eventBus.emit('log:system', {
    message: 'AudioWorklet desteklenmiyor - Worklet secenekleri devre disi',
    details: {}
  });
}

if (!WASM_OPUS_SUPPORTED) {
  eventBus.emit('log:system', {
    message: 'WASM Opus desteklenmiyor - WASM Opus secenegi devre disi',
    details: {}
  });

  // WASM Opus secenegini devre disi birak
  const wasmOpusOption = document.querySelector('[data-requires-wasm="true"]');
  if (wasmOpusOption) {
    wasmOpusOption.disabled = true;
    const label = wasmOpusOption.nextElementSibling;
    if (label) {
      label.classList.add('option-disabled');
    }
  }
} else {
  eventBus.emit('log:system', {
    message: 'WASM Opus destegi aktif',
    details: {}
  });
}

// LoopbackManager'a worklet support bilgisini ver
loopbackManager.workletSupported = WORKLET_SUPPORTED;

// Controller'lara bagimliliklari ver
const controllerDeps = {
  getConstraints,
  getPipeline,
  getEncoder,
  getProcessingMode, // Geriye uyumluluk icin (getPipeline alias)
  isLoopbackEnabled,
  isWebAudioEnabled,
  getOpusBitrate,
  getTimeslice,
  getBufferSize,
  getMediaBitrate,
  createAudioMediaRecorder,
  recorder,
  monitor,
  player,
  uiStateManager,
  setCurrentMode: (mode) => { currentMode = mode; },
  getCurrentMode: () => currentMode,
  setIsPreparing: (val) => { isPreparing = val; },
  getIsPreparing: () => isPreparing
};

recordingController.setDependencies(controllerDeps);
monitoringController.setDependencies(controllerDeps);

// DebugConsole init
debugConsole.init({
  eventBus,
  logger,
  logManager,
  monitor,
  audioEngine
});
debugConsole.registerGlobals();

// ProfileUIManager init
profileUIManager.init({
  scenarioCards,
  navItems,
  pageTitle,
  pageTitleIcon,
  pageSubtitle,
  scenarioBadge,
  scenarioTech,
  profileSelector
});
profileUIManager.setStateGetters({
  currentMode: () => currentMode,
  isPreparing: () => isPreparing
});
profileUIManager.setCallbacks({
  updateCustomSettingsPanel: (profileId) => customSettingsPanelHandler.updatePanel(profileId)
});

// ============================================
// RECORDING (Toggle)
// ============================================
recordToggleBtn.onclick = async () => {
  await recordingController.toggle();
};

// stopRecording - artik RecordingController tarafindan yonetiliyor
async function stopRecording() {
  await recordingController.stop();
}

// ============================================
// MONITORING (Toggle)
// ============================================
monitorToggleBtn.onclick = async () => {
  await monitoringController.toggle();
};

// stopMonitoring - artik MonitoringController tarafindan yonetiliyor
async function stopMonitoring() {
  await monitoringController.stop();
}

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
