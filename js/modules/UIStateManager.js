/**
 * UIStateManager - UI durumu yonetimi
 * OCP: Button states, preparing overlay, control locking tek yerde
 * DRY: Tekrarlanan UI state guncellemeleri merkezi
 */

import { PROFILES, SETTINGS } from './Config.js';
import { formatTime } from './utils.js';

/**
 * UIStateManager class - UI durumlarini yonetir
 */
class UIStateManager {
  constructor() {
    // UI element referanslari
    this.elements = {
      recordToggleBtn: null,
      monitorToggleBtn: null,
      loopbackToggle: null,
      ecCheckbox: null,
      nsCheckbox: null,
      agcCheckbox: null,
      processingModeContainer: null,
      timesliceContainer: null,
      recordingPlayerCard: null,
      playBtn: null,
      progressBar: null,
      downloadBtn: null,
      micSelector: null,
      refreshMicsBtn: null,
      preparingOverlay: null,
      profileSelector: null,
      timerEl: null
    };

    // Radio button koleksiyonlari
    this.radioGroups = {
      processingMode: [],
      bitrate: [],
      mediaBitrate: [],
      timeslice: [],
      bufferSize: []
    };

    // Nav items ve scenario cards (profil secim disabling icin)
    this.navItems = [];
    this.scenarioCards = [];

    // State getters (dısarıdan set edilir)
    this.getState = {
      currentMode: () => null,
      isPreparing: () => false,
      currentProfileId: () => 'discord',
      isWorkletSupported: () => true
    };

    // ProfileController referansi (locked settings icin)
    this.profileController = null;

    // Timer state
    this.timerInterval = null;
    this.timerStartTime = null;
  }

  /**
   * UI elemanlarini initialize et
   * @param {Object} elements - UI element referanslari
   */
  init(elements) {
    Object.assign(this.elements, elements);
  }

  /**
   * Radio gruplarini set et
   * @param {Object} groups - Radio button koleksiyonlari
   */
  setRadioGroups(groups) {
    Object.assign(this.radioGroups, groups);
  }

  /**
   * State getter'lari set et
   * @param {Object} getters - State getter fonksiyonlari
   */
  setStateGetters(getters) {
    Object.assign(this.getState, getters);
  }

  /**
   * Nav items ve scenario cards'i set et (profil secimi icin)
   * @param {Object} collections - { navItems, scenarioCards }
   */
  setProfileCollections(collections) {
    if (collections.navItems) this.navItems = collections.navItems;
    if (collections.scenarioCards) this.scenarioCards = collections.scenarioCards;
  }

  /**
   * ProfileController referansini set et
   * @param {Object} controller - ProfileController instance
   */
  setProfileController(controller) {
    this.profileController = controller;
  }

  /**
   * Button ve control durumlarini guncelle
   * DRY: Tum UI state guncellemeleri tek yerde
   */
  updateButtonStates() {
    const currentMode = this.getState.currentMode();
    const isPreparing = this.getState.isPreparing();
    const WORKLET_SUPPORTED = this.getState.isWorkletSupported();

    const isIdle = currentMode === null;
    const isRecording = currentMode === 'recording';
    const isMonitoring = currentMode === 'monitoring';

    const {
      recordToggleBtn,
      monitorToggleBtn,
      loopbackToggle,
      ecCheckbox,
      nsCheckbox,
      agcCheckbox,
      processingModeContainer,
      timesliceContainer,
      recordingPlayerCard,
      playBtn,
      progressBar,
      downloadBtn,
      micSelector,
      refreshMicsBtn,
      profileSelector
    } = this.elements;

    // Toggle butonlarin active state'leri
    recordToggleBtn?.classList.toggle('active', isRecording && !isPreparing);
    monitorToggleBtn?.classList.toggle('active', isMonitoring && !isPreparing);

    // Preparing state kontrolü
    recordToggleBtn?.classList.toggle('preparing', isPreparing && !isMonitoring);
    monitorToggleBtn?.classList.toggle('preparing', isPreparing && !isRecording);

    // Monitoring sirasinda kayit butonunu disable et ve tersi
    // Preparing state'de de butonlar disabled
    if (recordToggleBtn) recordToggleBtn.disabled = isMonitoring || isPreparing;
    if (monitorToggleBtn) monitorToggleBtn.disabled = isRecording || isPreparing;

    // Aktif islem sirasinda kayit tarafini tamamen kilitle (recording VEYA monitoring)
    const disableRecordingUi = isMonitoring || isRecording;
    processingModeContainer?.classList.toggle('ui-disabled', !isIdle);
    timesliceContainer?.classList.toggle('ui-disabled', disableRecordingUi);
    recordingPlayerCard?.classList.toggle('ui-disabled', disableRecordingUi);

    if (playBtn) {
      playBtn.disabled = disableRecordingUi;
    }

    if (progressBar) {
      progressBar.style.pointerEvents = disableRecordingUi ? 'none' : '';
    }

    if (downloadBtn) {
      downloadBtn.classList.toggle('disabled', disableRecordingUi);
      downloadBtn.setAttribute('aria-disabled', disableRecordingUi ? 'true' : 'false');

      if (disableRecordingUi) {
        const currentHref = downloadBtn.getAttribute('href');
        if (currentHref) downloadBtn.dataset.href = currentHref;
        downloadBtn.removeAttribute('href');
        downloadBtn.tabIndex = -1;
      } else {
        if (!downloadBtn.getAttribute('href') && downloadBtn.dataset.href) {
          downloadBtn.setAttribute('href', downloadBtn.dataset.href);
        }
        delete downloadBtn.dataset.href;
        downloadBtn.tabIndex = 0;
      }
    }

    // Profil kilitleri kontrolu - ProfileController'dan al
    const profile = this.profileController?.getCurrentProfile();
    const lockedSettings = profile?.lockedSettings || [];

    // Ayar toggle'lari icin disabled durumu hesapla
    const shouldBeDisabled = (settingKey) => {
      // Aktif islem varsa her zaman disabled
      if (!isIdle) return true;
      // Profil kilidi varsa disabled
      return lockedSettings.includes(settingKey);
    };

    // Ayar toggle'lari - profil kilitleri + aktif mod kontrolu
    if (loopbackToggle) loopbackToggle.disabled = shouldBeDisabled('loopback');
    if (ecCheckbox) ecCheckbox.disabled = shouldBeDisabled('ec');
    if (nsCheckbox) nsCheckbox.disabled = shouldBeDisabled('ns');
    if (agcCheckbox) agcCheckbox.disabled = shouldBeDisabled('agc');

    // Mikrofon secici - aktif islem varken degistirilemez (profil kilidi yok)
    if (micSelector) micSelector.disabled = !isIdle;
    if (refreshMicsBtn) refreshMicsBtn.disabled = !isIdle;

    // Profil butonlari - aktif islem VEYA preparing varken degistirilemez
    const disableProfiles = !isIdle || isPreparing;
    this.navItems.forEach(item => {
      item.classList.toggle('disabled', disableProfiles);
      item.setAttribute('aria-disabled', disableProfiles ? 'true' : 'false');
    });
    this.scenarioCards.forEach(card => {
      card.classList.toggle('disabled', disableProfiles);
      card.setAttribute('aria-disabled', disableProfiles ? 'true' : 'false');
    });
    if (profileSelector) {
      profileSelector.disabled = disableProfiles;
    }

    // Loopback durumu - dinamik kilitleme kurallari icin
    const isLoopbackOn = loopbackToggle?.checked ?? false;

    // Processing mode selector - profil kilidi + aktif session kontrolu
    this.radioGroups.processingMode.forEach(radio => {
      const workletUnsupported = radio.value === 'worklet' && !WORKLET_SUPPORTED;
      radio.disabled = shouldBeDisabled('mode') || workletUnsupported;
    });

    // Bitrate selector - profil kilidi + loopback OFF ise disabled
    this.radioGroups.bitrate.forEach(r => r.disabled = shouldBeDisabled('bitrate') || !isLoopbackOn);

    // Timeslice selector - profil kilidi + loopback ON ise disabled
    this.radioGroups.timeslice.forEach(r => r.disabled = shouldBeDisabled('timeslice') || isLoopbackOn);

    // MediaBitrate selector - profil kilidi + loopback ON ise disabled
    this.radioGroups.mediaBitrate.forEach(r => r.disabled = shouldBeDisabled('mediaBitrate') || isLoopbackOn);

    // Buffer size selector - profil kilidi + AudioWorklet/non-ScriptProcessor modunda disabled
    const selectedMode = document.querySelector('input[name="processingMode"]:checked')?.value;
    const isScriptProcessorMode = selectedMode === 'scriptprocessor';
    this.radioGroups.bufferSize.forEach(r => r.disabled = shouldBeDisabled('buffer') || !isScriptProcessorMode);

    // Buton text'lerini guncelle
    const recordBtnText = recordToggleBtn?.querySelector('.btn-text');
    const monitorBtnText = monitorToggleBtn?.querySelector('.btn-text');

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

  /**
   * "Hazırlanıyor..." overlay'ini goster
   */
  showPreparingState() {
    if (this.elements.preparingOverlay) {
      this.elements.preparingOverlay.classList.add('visible');
    }
  }

  /**
   * "Hazırlanıyor..." overlay'ini gizle
   */
  hidePreparingState() {
    if (this.elements.preparingOverlay) {
      this.elements.preparingOverlay.classList.remove('visible');
    }
  }

  /**
   * Kayit timer'ini baslat
   */
  startTimer() {
    const { timerEl } = this.elements;
    if (!timerEl) return;

    this.timerStartTime = Date.now();
    timerEl.textContent = '0:00';
    timerEl.style.display = 'block';

    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.timerStartTime) / 1000);
      timerEl.textContent = formatTime(elapsed);
    }, 1000);
  }

  /**
   * Kayit timer'ini durdur
   */
  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    const { timerEl } = this.elements;
    if (timerEl) {
      timerEl.style.display = 'none';
    }
  }

  /**
   * Belirli bir ayari disable/enable et
   * @param {string} settingKey - Ayar key'i
   * @param {boolean} isDisabled - Disabled durumu
   */
  setSettingDisabled(settingKey, isDisabled) {
    const setting = SETTINGS[settingKey];
    if (!setting?.ui) return;

    const container = document.querySelector(`[data-setting="${settingKey}"]`);
    if (!container) return;

    // Container icindeki input/select elementlerini bul
    const inputs = container.querySelectorAll('input, select');
    inputs.forEach(input => {
      input.disabled = isDisabled;
    });

    // Locked gorunumu
    container.classList.toggle('locked', isDisabled);
  }
}

// Singleton export
const uiStateManager = new UIStateManager();
export default uiStateManager;
