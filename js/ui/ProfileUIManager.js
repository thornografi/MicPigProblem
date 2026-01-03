/**
 * ProfileUIManager - Profil UI yonetimi
 * OCP: Profil secim, kart/nav guncelleme tek yerde
 * DIP: Bagimliliklar dependency injection ile alinir
 */
import eventBus from '../modules/EventBus.js';
import profileController from '../modules/ProfileController.js';
import { PROFILES } from '../modules/Config.js';

class ProfileUIManager {
  constructor() {
    // UI element referanslari
    this.elements = {
      scenarioCards: [],
      navItems: [],
      pageTitle: null,
      pageSubtitle: null,
      scenarioBadge: null,
      scenarioTech: null,
      profileSelector: null,
      customSettingsPanel: null
    };

    // State getters (disaridan set edilir)
    this.getState = {
      currentMode: () => null,
      isPreparing: () => false
    };

    // Callbacks
    this.callbacks = {
      updateCustomSettingsPanel: () => {}
    };
  }

  /**
   * UI elemanlarini initialize et
   * @param {Object} elements - UI element referanslari
   */
  init(elements) {
    Object.assign(this.elements, elements);
    this._bindEvents();
  }

  /**
   * State getter'lari set et
   */
  setStateGetters(getters) {
    Object.assign(this.getState, getters);
  }

  /**
   * Callback'leri set et
   */
  setCallbacks(callbacks) {
    Object.assign(this.callbacks, callbacks);
  }

  /**
   * Event listener'lari bagla
   */
  _bindEvents() {
    const { scenarioCards, navItems } = this.elements;

    // Senaryo kartlarina tiklama
    scenarioCards.forEach(card => {
      card.addEventListener('click', () => this.handleProfileSelect(card.dataset.profile));
    });

    // Sidebar nav-item tiklama
    navItems.forEach(item => {
      item.addEventListener('click', () => this.handleProfileSelect(item.dataset.profile));
    });
  }

  /**
   * Profil secim handler - DRY: scenarioCards ve navItems icin ortak
   * @param {string} profileId - Secilen profil ID'si
   */
  async handleProfileSelect(profileId) {
    const currentMode = this.getState.currentMode();
    const isPreparing = this.getState.isPreparing();

    // Aktif islem VEYA preparing varken profil degisikligine izin verme
    if (currentMode !== null || isPreparing) {
      eventBus.emit('log:ui', {
        message: 'Profil degistirmek icin once mevcut islemi durdurun'
      });
      return;
    }

    const { profileSelector } = this.elements;
    if (profileSelector) {
      profileSelector.value = profileId;
    }

    await profileController.applyProfile(profileId);
    this.updateScenarioCardSelection(profileId);
    this.updateNavItemSelection(profileId);
    this.callbacks.updateCustomSettingsPanel(profileId);

    eventBus.emit('log:ui', {
      message: `Senaryo degistirildi: ${PROFILES[profileId]?.label || profileId}`
    });
  }

  /**
   * Senaryo kart secimini guncelle
   * @param {string} profileId - Aktif profil ID'si
   */
  updateScenarioCardSelection(profileId) {
    const { scenarioCards } = this.elements;

    scenarioCards.forEach(card => {
      const cardProfile = card.dataset.profile;
      card.classList.toggle('selected', cardProfile === profileId);
    });

    this.updateScenarioTechInfo(profileId);
  }

  /**
   * Senaryo teknik bilgisini guncelle (badge ve tech text)
   * @param {string} profileId - Profil ID'si
   */
  updateScenarioTechInfo(profileId) {
    const { scenarioTech, scenarioBadge } = this.elements;
    if (!scenarioTech || !scenarioBadge) return;

    const profile = PROFILES[profileId];
    if (!profile) return;

    scenarioBadge.textContent = profile.label;

    // Badge rengini sifirla (CSS'e birak)
    scenarioBadge.style.background = '';
    scenarioBadge.style.color = '';

    // DRY: ProfileController'daki buildTechParts kullan
    scenarioTech.textContent = profileController.getTechString(profileId);
  }

  /**
   * Sidebar nav item secimini guncelle
   * @param {string} profileId - Aktif profil ID'si
   */
  updateNavItemSelection(profileId) {
    const { navItems, pageTitle } = this.elements;

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
    this.updatePageSubtitle(profileId);
  }

  /**
   * Page subtitle guncelle - DRY: ProfileController.getTechString() kullanir
   * @param {string} profileId - Profil ID'si
   */
  updatePageSubtitle(profileId) {
    const { pageSubtitle } = this.elements;
    if (!pageSubtitle) return;

    pageSubtitle.textContent = profileController.getTechString(profileId);
  }

  /**
   * Tum profil UI'ini guncelle (tek cagri ile)
   * @param {string} profileId - Profil ID'si
   */
  updateAll(profileId) {
    this.updateScenarioCardSelection(profileId);
    this.updateNavItemSelection(profileId);
  }
}

// Singleton export
const profileUIManager = new ProfileUIManager();
export default profileUIManager;
