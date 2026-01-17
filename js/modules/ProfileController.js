/**
 * ProfileController - Profil yonetimi
 * OCP: Profil degisiklikleri, kilitler ve gorunurluk tek yerde
 * DRY: Tekrarlanan profil islemleri merkezi
 */

import eventBus from './EventBus.js';
import { PROFILES, SETTINGS, PROFILE_TIPS } from './Config.js';
import { toggleDisplay, needsBufferSetting, usesWasmOpus, supportsWasmOpusEncoder, shouldDisableTimeslice } from './utils.js';

/**
 * Dinamik kilit politikasi - DRY: Tek noktadan kilit kurallari
 * @param {string} pipeline - Pipeline tipi (direct, standard, scriptprocessor, worklet)
 * @param {boolean} loopback - Loopback aktif mi
 * @param {string} encoder - Encoder tipi (mediarecorder, wasm-opus)
 * @returns {Object} Kilit durumu haritasi { settingKey: isLocked }
 */
function getDynamicLockPolicy(pipeline, loopback, encoder) {
  return {
    buffer: !needsBufferSetting(pipeline),        // Sadece ScriptProcessor'da editable
    mediaBitrate: loopback,                       // Loopback ON -> disabled (WebRTC varsa MediaRecorder bitrate anlamsiz)
    bitrate: !loopback,                           // Loopback OFF -> disabled (WebRTC yoksa Opus bitrate anlamsiz)
    timeslice: shouldDisableTimeslice(loopback, encoder)  // MediaRecorder yoksa disabled
  };
}

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
      setOptionDisabled: () => {},
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

    // Profil degistiginde Player'i temizle (memory leak ve UX tutarliligi)
    this.callbacks.resetPlayer?.();

    // Mevcut profil ID'sini guncelle
    this.currentProfileId = profileId;
    this.applyProfileTheme(profileId);

    const values = profile.values;
    const lockedSettings = profile.lockedSettings || [];
    const editableSettings = profile.editableSettings || [];

    // NOT: profile:changed event'i DOM guncellendikten SONRA emit edilmeli
    // Cunku dispatchEvent tetikledigi handler'lar DOM'dan deger okuyor
    // Eger once emit edersek, sonraki dispatchEvent'ler yanlis degerle tekrar emit yapar

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
        elements.forEach(el => {
          el.checked = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
      } else if (setting.type === 'enum') {
        const radio = elements.find(el => el.value == value);
        if (radio) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });

    // DOM guncellendikten SONRA profile:changed emit et
    // Bu siralama kritik: dispatchEvent'ler handler'lari tetikliyor ve
    // o handler'lar DOM'dan deger okuyor - onlar bittikten sonra
    // dogru Config degerlerini emit ediyoruz
    eventBus.emit('profile:changed', { profile: profileId, values, category: profile.category });

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

    // Tips alanini profil bazli guncelle
    this.updateTips(profileId);

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
   * Profil tema token'larini uygula (UI accent renkleri)
   * Not: Per-profile tema destegi kaldirildi, varsayilan degerler kullaniliyor
   */
  applyProfileTheme() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--profile-accent', 'var(--color-accent-text)');
    root.style.setProperty('--profile-accent-glow', 'rgba(var(--color-accent-text-rgb), 0.55)');
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

    // Dinamik kilitleme: lockedSettings bos olan profillerde aktif
    // (Raw profili gibi tum ayarlarin degistirilebildigi profiller)
    const isDynamicProfile = profile.lockedSettings?.length === 0;

    if (!isDynamicProfile) return;

    const loopback = this.elements.loopbackToggle?.checked ?? false;
    const pipeline = this.callbacks.getRadioValue('pipeline', 'standard');
    const encoder = this.callbacks.getRadioValue('encoder', 'mediarecorder');

    // DRY: Kilit politikasini tek noktadan al
    const lockPolicy = getDynamicLockPolicy(pipeline, loopback, encoder);
    Object.entries(lockPolicy).forEach(([key, isLocked]) => {
      this.callbacks.setSettingDisabled(key, isLocked);
    });

    // Kural 5: Encoder kilitleme - pipeline tipine gore
    // Worklet/ScriptProcessor -> WASM Opus (PCM erisimi var)
    // Direct/Standard -> MediaRecorder (PCM erisimi yok)
    const supportsWasm = supportsWasmOpusEncoder(pipeline);
    this.callbacks.setOptionDisabled('encoder', 'wasm-opus', !supportsWasm);
    this.callbacks.setOptionDisabled('encoder', 'mediarecorder', supportsWasm);

    // Pipeline degistiginde encoder'i otomatik ayarla
    const currentEncoder = this.callbacks.getRadioValue('encoder', 'mediarecorder');
    if (supportsWasm && currentEncoder === 'mediarecorder') {
      // Worklet/ScriptProcessor secildi -> WASM Opus'a gec
      const wasmOpusRadio = document.querySelector('input[name="encoder"][value="wasm-opus"]');
      if (wasmOpusRadio) {
        wasmOpusRadio.checked = true;
        eventBus.emit('log:ui', {
          message: 'Encoder otomatik olarak WASM Opus\'a degistirildi (PCM erisimi mevcut)'
        });
      }
    } else if (!supportsWasm && currentEncoder === 'wasm-opus') {
      // Direct/Standard secildi -> MediaRecorder'a gec
      const mediaRecorderRadio = document.querySelector('input[name="encoder"][value="mediarecorder"]');
      if (mediaRecorderRadio) {
        mediaRecorderRadio.checked = true;
        eventBus.emit('log:ui', {
          message: 'Encoder otomatik olarak MediaRecorder\'a degistirildi (PCM erisimi yok)'
        });
      }
    }

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
    const encoder = this.callbacks.getRadioValue('encoder', 'mediarecorder');
    const loopbackOn = loopbackToggle?.checked ?? false;

    // DRY: Kilit politikasini tek noktadan al
    const lockPolicy = getDynamicLockPolicy(pipeline, loopbackOn, encoder);

    Object.entries(lockPolicy).forEach(([key, isLocked]) => {
      const element = customSettingsGrid.querySelector(`[data-setting="${key}"]`);
      if (element) {
        element.disabled = isLocked;
        const parent = element.closest('.custom-setting-item');
        if (parent) {
          parent.classList.toggle('dynamic-locked', isLocked);
        }
      }
    });

    // Encoder select icin pipeline tipine gore kilitle
    const encoderSelect = customSettingsGrid.querySelector('[data-setting="encoder"]');
    if (encoderSelect && encoderSelect.tagName === 'SELECT') {
      const supportsWasm = supportsWasmOpusEncoder(pipeline);
      const wasmOpusOption = encoderSelect.querySelector('option[value="wasm-opus"]');
      const mediaRecorderOption = encoderSelect.querySelector('option[value="mediarecorder"]');

      if (wasmOpusOption) wasmOpusOption.disabled = !supportsWasm;
      if (mediaRecorderOption) mediaRecorderOption.disabled = supportsWasm;

      // Pipeline degistiginde encoder'i otomatik ayarla
      if (supportsWasm && encoderSelect.value === 'mediarecorder') {
        encoderSelect.value = 'wasm-opus';
      } else if (!supportsWasm && encoderSelect.value === 'wasm-opus') {
        encoderSelect.value = 'mediarecorder';
      }
    }
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
        container.classList.remove('hidden');
        container.classList.remove('setting-locked');
        this.callbacks.setSettingDisabled(settingKey, false);
      } else if (lockedSettings.includes(settingKey)) {
        container.classList.remove('hidden');
        container.classList.add('setting-locked');
        this.callbacks.setSettingDisabled(settingKey, true);
      } else if (editableSettings.includes(settingKey)) {
        container.classList.remove('hidden');
        container.classList.remove('setting-locked');
        this.callbacks.setSettingDisabled(settingKey, false);
      } else {
        container.classList.add('hidden');
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
      return el && !el.classList.contains('hidden');
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

  /**
   * Tips alanini profil bazli guncelle
   * @param {string} profileId - Profil ID'si
   */
  updateTips(profileId = null) {
    const id = profileId || this.currentProfileId;
    const tips = PROFILE_TIPS[id] || PROFILE_TIPS['default'];
    const container = document.querySelector('.unified-tips');

    if (!container || !tips) return;

    // Tips HTML'i olustur
    const html = tips.map(tip =>
      `<span class="utip"><em>${tip.step}</em><span class="utip-text">${tip.text}</span></span>`
    ).join('');

    container.innerHTML = html;
  }
}

// Singleton export
const profileController = new ProfileController();
export default profileController;
