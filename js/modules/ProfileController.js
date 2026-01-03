/**
 * ProfileController - Profil yonetimi
 * OCP: Profil degisiklikleri, kilitler ve gorunurluk tek yerde
 * DRY: Tekrarlanan profil islemleri merkezi
 */

import eventBus from './EventBus.js';
import { PROFILES, SETTINGS } from './Config.js';
import { toggleDisplay, needsBufferSetting, usesWasmOpus } from './utils.js';

/**
 * ProfileController class - Profil islemlerini yonetir
 */
class ProfileController {
  constructor() {
    // Mevcut profil ID'si
    this.currentProfileId = 'discord';

    // UI element referanslari
    this.elements = {
      loopbackToggle: null,
      profileSelector: null,
      customSettingsGrid: null,
      pipelineSection: null,
      webrtcSection: null,
      developerSection: null
    };

    // Setting container cache
    this.settingContainers = {};

    // Callbacks
    this.callbacks = {
      stopMonitoring: async () => {},
      stopRecording: async () => {},
      startMonitoring: async () => {},
      startRecording: async () => {},
      updateButtonStates: () => {},
      updateBufferInfo: () => {},
      updateTimesliceInfo: () => {},
      updateCategoryUI: () => {},
      getRadioValue: () => 'standard',
      setSettingDisabled: () => {},
      getSettingElements: () => []
    };

    // State getters
    this.getState = {
      currentMode: () => null
    };
  }

  /**
   * Initialize with UI elements
   */
  init(elements) {
    Object.assign(this.elements, elements);
  }

  /**
   * Setting container cache'i set et
   */
  setSettingContainers(containers) {
    this.settingContainers = containers;
  }

  /**
   * Callback'leri set et
   */
  setCallbacks(callbacks) {
    Object.assign(this.callbacks, callbacks);
  }

  /**
   * State getter'lari set et
   */
  setStateGetters(getters) {
    Object.assign(this.getState, getters);
  }

  /**
   * Profil uygula
   * @param {string} profileId - Profil ID'si
   */
  async applyProfile(profileId) {
    const profile = PROFILES[profileId];
    if (!profile) return;

    // Mevcut profil ID'sini guncelle
    this.currentProfileId = profileId;

    const values = profile.values;
    const lockedSettings = profile.lockedSettings || [];
    const editableSettings = profile.editableSettings || [];

    // DeviceInfo panelini guncelle (bitrate gosterimi icin)
    eventBus.emit('profile:changed', { profile: profileId, values, category: profile.category });

    // Aktif stream varsa restart gerekiyor mu kontrol et
    const currentMode = this.getState.currentMode();
    const wasActive = currentMode !== null;
    const previousMode = currentMode;

    // Profil bazli bireysel ayar gorunurlugunu guncelle
    this.updateSettingVisibility(profile);

    // Aktif stream varsa once durdur
    if (wasActive) {
      eventBus.emit('log:ui', {
        message: `Profil degisiyor, ${previousMode === 'monitoring' ? 'monitor' : 'kayit'} yeniden baslatilacak...`
      });

      if (previousMode === 'monitoring') {
        await this.callbacks.stopMonitoring();
      } else if (previousMode === 'recording') {
        await this.callbacks.stopRecording();
      }
    }

    // Ayarlari Config.js metadata'sina gore dinamik uygula
    Object.entries(values).forEach(([key, value]) => {
      const setting = SETTINGS[key];
      if (!setting?.ui) return;

      const elements = this.callbacks.getSettingElements(key);
      if (elements.length === 0) return;

      if (setting.type === 'boolean') {
        elements.forEach(el => el.checked = value);
      } else if (setting.type === 'enum') {
        const radio = elements.find(el => el.value == value);
        if (radio) radio.checked = true;
      }
    });

    // Locked/Editable constraint'leri uygula
    this.applyProfileConstraints(profile);

    // Dinamik kilitleme
    this.updateDynamicLocks();

    // Profil bazli bireysel ayar gorunurlugunu guncelle
    this.updateSettingVisibility(profile);

    // Buffer ve Timeslice bilgisini guncelle
    this.callbacks.updateBufferInfo(values.buffer);
    this.callbacks.updateTimesliceInfo(values.timeslice);

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
      details: { profileId, category: profile.category, ...values }
    });

    // Kategori bazli UI guncelle (call vs record)
    this.callbacks.updateCategoryUI(profileId);

    // Buton ve ayar durumlarini senkronize et
    this.callbacks.updateButtonStates();

    // Aktif stream vardi ise yeni ayarlarla yeniden baslat
    if (wasActive) {
      await new Promise(resolve => setTimeout(resolve, 100));

      eventBus.emit('log:ui', {
        message: `Yeni profil ile ${previousMode === 'monitoring' ? 'monitor' : 'kayit'} yeniden baslatiliyor...`
      });

      if (previousMode === 'monitoring') {
        await this.callbacks.startMonitoring();
      } else if (previousMode === 'recording') {
        await this.callbacks.startRecording();
      }
    }
  }

  /**
   * Profil constraint'lerini uygula
   */
  applyProfileConstraints(profile) {
    if (!profile) return;

    const lockedSettings = profile.lockedSettings || [];

    // Once tum ayarlari enable et
    const allSettingKeys = Object.keys(SETTINGS);
    allSettingKeys.forEach(key => this.callbacks.setSettingDisabled(key, false));

    // Locked ayarlari disable et
    lockedSettings.forEach(key => this.callbacks.setSettingDisabled(key, true));
  }

  /**
   * Dinamik kilitleme - Ham Kayit profilinde aykiri ayarlari disable et
   */
  updateDynamicLocks() {
    const profile = PROFILES[this.currentProfileId];
    if (!profile) return;

    // Sadece 'all' editable profillerde dinamik kilitleme aktif
    const isDynamicProfile = profile.allowedSettings === 'all' && profile.lockedSettings?.length === 0;
    if (!isDynamicProfile) return;

    const loopback = this.elements.loopbackToggle?.checked ?? false;
    const pipeline = this.callbacks.getRadioValue('pipeline', 'standard');

    // Kural 1: buffer sadece ScriptProcessor pipeline icin anlamli (AudioWorklet sabit 128)
    this.callbacks.setSettingDisabled('buffer', !needsBufferSetting(pipeline));

    // Kural 2: loopback ON -> mediaBitrate kilitle (WebRTC varsa MediaRecorder bitrate anlamsiz)
    this.callbacks.setSettingDisabled('mediaBitrate', loopback);

    // Kural 3: loopback OFF -> bitrate kilitle (WebRTC yoksa Opus bitrate anlamsiz)
    this.callbacks.setSettingDisabled('bitrate', !loopback);

    // Kural 4: loopback ON -> timeslice kilitle (WebRTC monitoring modunda chunk anlamsiz)
    this.callbacks.setSettingDisabled('timeslice', loopback);

    // Ozel Ayarlar panelini de guncelle
    this.updateCustomSettingsPanelDynamicState();
  }

  /**
   * Ozel Ayarlar panelindeki dinamik kilitleme durumunu guncelle
   */
  updateCustomSettingsPanelDynamicState() {
    const { customSettingsGrid, loopbackToggle } = this.elements;
    if (!customSettingsGrid) return;

    const pipeline = this.callbacks.getRadioValue('pipeline', 'standard');
    const loopbackOn = loopbackToggle?.checked ?? false;
    const dynamicLockMap = {
      buffer: !needsBufferSetting(pipeline),  // Sadece ScriptProcessor pipeline'da editable
      mediaBitrate: loopbackOn,            // Loopback ON -> disabled
      bitrate: !loopbackOn,                // Loopback OFF -> disabled
      timeslice: loopbackOn                // Loopback ON -> disabled
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

  /**
   * Ayar gorunurluklerini guncelle
   */
  updateSettingVisibility(profile) {
    if (!profile) return;

    const lockedSettings = profile.lockedSettings || [];
    const editableSettings = profile.editableSettings || [];
    const isAll = profile.allowedSettings === 'all';

    const drawerSettings = Object.keys(SETTINGS);

    drawerSettings.forEach(settingKey => {
      const container = document.querySelector(`[data-setting="${settingKey}"]`);
      if (!container) return;

      if (isAll) {
        container.style.display = '';
        container.classList.remove('setting-locked');
        this.callbacks.setSettingDisabled(settingKey, false);
      } else if (lockedSettings.includes(settingKey)) {
        container.style.display = '';
        container.classList.add('setting-locked');
        this.callbacks.setSettingDisabled(settingKey, true);
      } else if (editableSettings.includes(settingKey)) {
        container.style.display = '';
        container.classList.remove('setting-locked');
        this.callbacks.setSettingDisabled(settingKey, false);
      } else {
        container.style.display = 'none';
        container.classList.remove('setting-locked');
      }
    });

    this.updateSectionVisibility();
  }

  /**
   * Section'lari iceriklerine gore goster/gizle
   */
  updateSectionVisibility() {
    const isVisible = (key) => {
      const el = this.settingContainers[key];
      return el && el.style.display !== 'none';
    };

    const { pipelineSection, webrtcSection, developerSection } = this.elements;

    // Pipeline section: webaudio, pipeline, encoder, buffer
    toggleDisplay(pipelineSection, isVisible('webaudio') || isVisible('pipeline') || isVisible('encoder') || isVisible('buffer'));

    // WebRTC section: loopback, bitrate, mediaBitrate
    toggleDisplay(webrtcSection, isVisible('loopback') || isVisible('bitrate') || isVisible('mediaBitrate'));

    // Developer section: timeslice
    toggleDisplay(developerSection, isVisible('timeslice'));
  }

  /**
   * Mevcut profili getir
   */
  getCurrentProfile() {
    return PROFILES[this.currentProfileId];
  }

  /**
   * Mevcut profil ID'sini getir
   */
  getCurrentProfileId() {
    return this.currentProfileId;
  }

  /**
   * Profil teknik bilgi parcalarini olustur - DRY: UI'da badge/subtitle icin ortak
   * @param {Object} profile - Profil objesi veya null
   * @returns {string[]} - Teknik bilgi parcalari dizisi
   */
  buildTechParts(profile) {
    if (!profile?.values) return ['Manuel Ayarlar'];

    const techParts = [];

    // Encoder bilgisi
    if (profile.values.loopback) {
      techParts.push('WebRTC Loopback');
      techParts.push(`Opus ${profile.values.bitrate / 1000}kbps`);
    } else if (usesWasmOpus(profile.values.encoder)) {
      techParts.push(`WASM Opus ${(profile.values.mediaBitrate || 16000) / 1000}kbps`);
    } else if (profile.values.mediaBitrate && profile.values.mediaBitrate > 0) {
      techParts.push(`MediaRecorder ${profile.values.mediaBitrate / 1000}kbps`);
    } else {
      techParts.push('Direct Recording');
    }

    // Pipeline bilgisi
    if (profile.values.pipeline === 'scriptprocessor') {
      techParts.push('ScriptProcessor');
    } else if (profile.values.pipeline === 'worklet') {
      techParts.push('AudioWorklet');
    } else if (profile.values.pipeline === 'standard') {
      techParts.push('Standard');
    }

    return techParts;
  }

  /**
   * Profil teknik bilgisini string olarak getir
   * @param {string} profileId - Profil ID'si (opsiyonel, default: current)
   * @returns {string} - "WebRTC Loopback + Opus 64kbps" gibi
   */
  getTechString(profileId = null) {
    const profile = profileId ? PROFILES[profileId] : this.getCurrentProfile();
    return this.buildTechParts(profile).join(' + ');
  }
}

// Singleton export
const profileController = new ProfileController();
export default profileController;
