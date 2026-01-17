/**
 * JitterEffect - Network jitter (paket gecikmesi) simülasyonu
 * Decorator Pattern: Pipeline'a jitter efekti ekler
 *
 * Kullanım:
 *   const pipeline = createPipeline('standard', ctx, source, dest);
 *   const withJitter = new JitterEffect(pipeline, {
 *     minDelay: 0.02,    // 20ms minimum delay
 *     maxDelay: 0.15,    // 150ms maximum delay
 *     interval: 0.1      // Her 100ms'de bir değişim
 *   });
 *
 * Graph:
 *   WrappedPipeline.source -> DelayNode(dynamic) -> WrappedPipeline.destination
 */

import EffectDecorator from './EffectDecorator.js';

export default class JitterEffect extends EffectDecorator {
  constructor(wrappedPipeline, options = {}) {
    const defaultOptions = {
      minDelay: 0.02,   // 20ms
      maxDelay: 0.15,   // 150ms
      interval: 0.1     // 100ms
    };

    super(wrappedPipeline, { ...defaultOptions, ...options });
  }

  get effectType() {
    return 'jitter';
  }

  /**
   * Jitter efekti kurulumu
   */
  async _setupEffect() {
    const { maxDelay } = this.effectOptions;

    // DelayNode oluştur (max delay değeri ile)
    this.effectNodes.delay = this.audioContext.createDelay(maxDelay + 0.1);

    // Başlangıç delay'i
    this._updateJitter();

    // Periyodik jitter değişimi
    this._startJitterVariation();

    // Source -> Delay -> (devam eden zincir)
    // NOT: Bu basit implementasyon, gerçek kullanımda
    // wrapped pipeline'ın source/destination arasına eklenmeli
    this.log('Jitter efekti hazır', {
      minDelay: this.effectOptions.minDelay,
      maxDelay: this.effectOptions.maxDelay,
      interval: this.effectOptions.interval
    });
  }

  /**
   * Rastgele jitter değeri uygula
   * @private
   */
  _updateJitter() {
    if (!this.effectNodes.delay || this._bypassed) return;

    const { minDelay, maxDelay } = this.effectOptions;
    const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);

    // Smooth transition
    this.effectNodes.delay.delayTime.setTargetAtTime(
      randomDelay,
      this.audioContext.currentTime,
      0.01
    );
  }

  /**
   * Periyodik jitter değişimi başlat
   * @private
   */
  _startJitterVariation() {
    const intervalMs = this.effectOptions.interval * 1000;

    const intervalId = setInterval(() => {
      this._updateJitter();
    }, intervalMs);

    // Base class'a kaydet (otomatik cleanup için)
    this._registerInterval(intervalId);
  }

  /**
   * Bypass durumunu uygula
   * @protected
   */
  _applyBypass() {
    if (this.effectNodes.delay) {
      if (this._bypassed) {
        // Bypass: delay = 0
        this.effectNodes.delay.delayTime.setTargetAtTime(0, this.audioContext.currentTime, 0.01);
      } else {
        // Normal: rastgele delay
        this._updateJitter();
      }
    }
  }

  /**
   * Temizlik
   * NOT: Interval temizliği base class tarafından otomatik yapılır
   */
  async cleanup() {
    await super.cleanup();
  }
}
