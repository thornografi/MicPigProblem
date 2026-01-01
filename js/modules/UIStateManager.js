/**
 * UIStateManager - UI durumu yonetimi
 * OCP: Button states, preparing overlay, control locking tek yerde
 * DRY: Tekrarlanan UI state guncellemeleri merkezi
 */

import { PROFILES, SETTINGS } from './Config.js';

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
      preparingOverlay: null
    };

    // Radio button koleksiyonlari
    this.radioGroups = {
      processingMode: [],
      bitrate: [],
      timeslice: [],
      bufferSize: []
    };

    // State getters (dısarıdan set edilir)
    this.getState = {
      currentMode: () => null,
      isPreparing: () => false,
      currentProfileId: () => 'discord',
      isWorkletSupported: () => true
    };
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
   * Button ve control durumlarini guncelle
   */
  updateButtonStates() {
    const currentMode = this.getState.currentMode();
    const isPreparing = this.getState.isPreparing();
    const currentProfileId = this.getState.currentProfileId();
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
      refreshMicsBtn
    } = this.elements;

    // Toggle butonlarin active state'leri
    recordToggleBtn?.classList.toggle('active', isRecording && !isPreparing);
    monitorToggleBtn?.classList.toggle('active', isMonitoring && !isPreparing);

    // Preparing state kontrolü
    recordToggleBtn?.classList.toggle('preparing', isPreparing && !isMonitoring);
    monitorToggleBtn?.classList.toggle('preparing', isPreparing && !isRecording);

    // Monitoring sirasinda kayit butonunu disable et ve tersi
    if (recordToggleBtn) recordToggleBtn.disabled = isMonitoring || isPreparing;
    if (monitorToggleBtn) monitorToggleBtn.disabled = isRecording || isPreparing;

    // Monitoring sirasinda kayit tarafini tamamen kilitle
    const disableRecordingUi = isMonitoring;
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

    // Profil kilitleri kontrolu
    const profile = PROFILES[currentProfileId];
    const lockedSettings = profile?.lockedSettings || [];

    // Ayar toggle'lari icin disabled durumu hesapla
    const shouldBeDisabled = (settingKey) => {
      if (!isIdle) return true;
      return lockedSettings.includes(settingKey);
    };

    // Ayar toggle'lari - profil kilitleri + aktif mod kontrolu
    if (loopbackToggle) loopbackToggle.disabled = shouldBeDisabled('loopback');
    if (ecCheckbox) ecCheckbox.disabled = shouldBeDisabled('ec');
    if (nsCheckbox) nsCheckbox.disabled = shouldBeDisabled('ns');
    if (agcCheckbox) agcCheckbox.disabled = shouldBeDisabled('ag');

    // Mikrofon secici - aktif islem varken degistirilemez
    if (micSelector) micSelector.disabled = !isIdle;
    if (refreshMicsBtn) refreshMicsBtn.disabled = !isIdle;

    // Radio gruplarini guncelle
    this.radioGroups.processingMode.forEach(radio => {
      const workletUnsupported = radio.value === 'worklet' && !WORKLET_SUPPORTED;
      radio.disabled = shouldBeDisabled('mode') || workletUnsupported;
    });

    this.radioGroups.bitrate.forEach(r => r.disabled = shouldBeDisabled('bitrate'));
    this.radioGroups.timeslice.forEach(r => r.disabled = shouldBeDisabled('timeslice'));
    this.radioGroups.bufferSize.forEach(r => r.disabled = shouldBeDisabled('buffer'));

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
