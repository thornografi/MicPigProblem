/**
 * EffectDecorator - Base class for pipeline effects (Decorator Pattern)
 * OCP: Yeni efekt eklemek için bu class'ı extend et
 *
 * Decorator Pattern avantajları:
 * - Mevcut pipeline'ları değiştirmeden yeni davranış ekler
 * - Efektler zincirleme bağlanabilir (Chain of Responsibility)
 * - Runtime'da efekt ekleyip çıkarabilirsin
 *
 * Kullanım:
 *   const pipeline = createPipeline('standard', ctx, source, dest);
 *   const withJitter = new JitterEffect(pipeline, { delay: 50 });
 *   const withNoise = new NoiseEffect(withJitter, { level: 0.1 });
 *   await withNoise.setup(options);
 *
 * Graph örneği:
 *   Source -> [Effect1] -> [Effect2] -> Pipeline -> Destination
 */

import BasePipeline from '../BasePipeline.js';

// Aktif efekt instance'larını takip et (cleanup için)
const activeEffects = new Set();

// Sayfa kapanırken tüm efektleri temizle
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    activeEffects.forEach(effect => {
      try {
        effect._emergencyCleanup();
      } catch {
        // Sessizce geç
      }
    });
    activeEffects.clear();
  });
}

export default class EffectDecorator extends BasePipeline {
  /**
   * @param {BasePipeline} wrappedPipeline - Dekore edilecek pipeline
   * @param {Object} effectOptions - Efekt-specific ayarlar
   */
  constructor(wrappedPipeline, effectOptions = {}) {
    // Wrapped pipeline'ın context'ini kullan
    super(
      wrappedPipeline.audioContext,
      wrappedPipeline.sourceNode,
      wrappedPipeline.destinationNode
    );

    this.wrappedPipeline = wrappedPipeline;
    this.effectOptions = effectOptions;

    // Efekt için oluşturulan node'lar (subclass doldurur)
    this.effectNodes = {};

    // Bypass modu (efekti devre dışı bırak)
    this._bypassed = false;

    // Interval ID'leri takip et (subclass'lar kullanır)
    this._intervalIds = [];

    // Aktif efektler listesine ekle
    activeEffects.add(this);
  }

  /**
   * Efekt tipi (subclass override etmeli)
   * @returns {string}
   */
  get effectType() {
    return 'base';
  }

  /**
   * Zincirleme type getter
   * @returns {string}
   */
  get type() {
    return `${this.wrappedPipeline.type}+${this.effectType}`;
  }

  /**
   * Efekti kur ve wrapped pipeline'a bağla
   * Subclass'lar bu metodu override edip kendi node'larını oluşturmalı
   * @param {Object} options - Pipeline options
   */
  async setup(options = {}) {
    // Önce wrapped pipeline'ı kur
    await this.wrappedPipeline.setup(options);

    // Efekt-specific kurulum (subclass implement eder)
    await this._setupEffect(options);

    this.log(`${this.effectType} efekti baglandi`, {
      wrappedType: this.wrappedPipeline.type,
      effectOptions: this.effectOptions
    });
  }

  /**
   * Efekt-specific kurulum (subclass implement etmeli)
   * @protected
   */
  async _setupEffect(options = {}) {
    // Subclass'lar override eder
    // Örnek: DelayNode, GainNode, ScriptProcessor oluştur ve bağla
  }

  /**
   * Efekti temizle
   */
  async cleanup() {
    // Tüm interval'ları temizle
    this._clearAllIntervals();

    // Efekt node'larını temizle
    Object.values(this.effectNodes).forEach(node => {
      if (node) {
        try {
          node.disconnect();
        } catch {
          // Node zaten disconnect olmuş olabilir
        }
      }
    });
    this.effectNodes = {};

    // Aktif efektler listesinden çıkar
    activeEffects.delete(this);

    // Wrapped pipeline'ı temizle
    await this.wrappedPipeline.cleanup();

    this.log(`${this.effectType} efekti temizlendi`);
  }

  /**
   * Interval kaydet (subclass'lar kullanır)
   * @protected
   * @param {number} intervalId - setInterval dönüş değeri
   */
  _registerInterval(intervalId) {
    this._intervalIds.push(intervalId);
  }

  /**
   * Tüm interval'ları temizle
   * @protected
   */
  _clearAllIntervals() {
    this._intervalIds.forEach(id => clearInterval(id));
    this._intervalIds = [];
  }

  /**
   * Acil durum temizliği (beforeunload için)
   * @protected
   */
  _emergencyCleanup() {
    this._clearAllIntervals();
    // Node'ları senkron temizle
    Object.values(this.effectNodes).forEach(node => {
      try { node?.disconnect(); } catch { /* ignore */ }
    });
  }

  /**
   * Efekti bypass et (devre dışı bırak)
   * @param {boolean} bypass - true = efekt atlanır
   */
  setBypass(bypass) {
    this._bypassed = bypass;
    this._applyBypass();
    this.log(`${this.effectType} bypass: ${bypass}`);
  }

  /**
   * Bypass durumunu uygula (subclass override edebilir)
   * @protected
   */
  _applyBypass() {
    // Subclass'lar override edebilir
    // Örnek: GainNode.gain.value = bypassed ? 0 : 1
  }

  /**
   * Analyser node'u wrapped pipeline'dan al
   * @returns {AnalyserNode|null}
   */
  get analyserNode() {
    return this.wrappedPipeline.analyserNode;
  }

  /**
   * Opus worker'ı wrapped pipeline'dan al
   * @returns {Object|null}
   */
  getOpusWorker() {
    return this.wrappedPipeline.getOpusWorker();
  }

  /**
   * Opus encoding'i bitir (wrapped pipeline'a delege)
   */
  async finishOpusEncoding() {
    return await this.wrappedPipeline.finishOpusEncoding();
  }

  /**
   * Node'ları wrapped pipeline'dan al
   */
  getNodes() {
    return {
      ...this.wrappedPipeline.getNodes(),
      ...this.effectNodes
    };
  }
}
