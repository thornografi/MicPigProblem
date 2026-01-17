/**
 * PacketLossEffect - Network packet loss (paket kaybı) simülasyonu
 * Decorator Pattern: Pipeline'a kesinti efekti ekler
 *
 * Kullanım:
 *   const pipeline = createPipeline('standard', ctx, source, dest);
 *   const withLoss = new PacketLossEffect(pipeline, {
 *     lossRate: 0.05,     // %5 paket kaybı
 *     burstLength: 0.1    // 100ms'lik kesinti blokları
 *   });
 *
 * Graph:
 *   WrappedPipeline.source -> GainNode(0/1) -> WrappedPipeline.destination
 */

import EffectDecorator from './EffectDecorator.js';

export default class PacketLossEffect extends EffectDecorator {
  constructor(wrappedPipeline, options = {}) {
    const defaultOptions = {
      lossRate: 0.05,     // %5 paket kaybı
      burstLength: 0.1    // 100ms
    };

    super(wrappedPipeline, { ...defaultOptions, ...options });

    this._isMuted = false;
  }

  get effectType() {
    return 'packetloss';
  }

  /**
   * Packet loss efekti kurulumu
   */
  async _setupEffect() {
    // Mute için GainNode
    this.effectNodes.muteGain = this.audioContext.createGain();
    this.effectNodes.muteGain.gain.value = 1; // Başlangıçta açık

    // Periyodik kayıp simülasyonu
    this._startLossSimulation();

    this.log('PacketLoss efekti hazır', {
      lossRate: this.effectOptions.lossRate,
      burstLength: this.effectOptions.burstLength
    });
  }

  /**
   * Periyodik paket kaybı simülasyonu
   * @private
   */
  _startLossSimulation() {
    const checkIntervalMs = 50; // Her 50ms'de kontrol

    const intervalId = setInterval(() => {
      if (this._bypassed) {
        this._unmute();
        return;
      }

      // Kayıp olasılığı kontrolü
      if (!this._isMuted && Math.random() < this.effectOptions.lossRate) {
        this._mute();

        // Burst süresi sonra unmute
        setTimeout(() => {
          this._unmute();
        }, this.effectOptions.burstLength * 1000);
      }
    }, checkIntervalMs);

    // Base class'a kaydet (otomatik cleanup için)
    this._registerInterval(intervalId);
  }

  /**
   * Sesi kapat (paket kaybı simülasyonu)
   * @private
   */
  _mute() {
    if (this.effectNodes.muteGain && !this._isMuted) {
      this.effectNodes.muteGain.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.005);
      this._isMuted = true;
    }
  }

  /**
   * Sesi aç
   * @private
   */
  _unmute() {
    if (this.effectNodes.muteGain && this._isMuted) {
      this.effectNodes.muteGain.gain.setTargetAtTime(1, this.audioContext.currentTime, 0.005);
      this._isMuted = false;
    }
  }

  /**
   * Bypass durumunu uygula
   * @protected
   */
  _applyBypass() {
    if (this._bypassed) {
      this._unmute();
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
