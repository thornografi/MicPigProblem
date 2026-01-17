/**
 * Effects Module - Pipeline Decorator Pattern
 * OCP: Yeni efekt eklemek için EffectDecorator'ı extend et ve buraya ekle
 *
 * Kullanım Örneği:
 *
 *   import { createPipeline } from '../pipelines/PipelineFactory.js';
 *   import { JitterEffect, PacketLossEffect } from '../pipelines/effects/index.js';
 *
 *   // Temel pipeline oluştur
 *   const basePipeline = createPipeline('standard', ctx, source, dest);
 *
 *   // Efektleri zincirleme ekle
 *   const withJitter = new JitterEffect(basePipeline, { maxDelay: 0.15 });
 *   const withLoss = new PacketLossEffect(withJitter, { lossRate: 0.1 });
 *
 *   // Kullan
 *   await withLoss.setup(options);
 *   // ... kayıt/monitoring ...
 *   await withLoss.cleanup();
 *
 * Mevcut Efektler:
 *   - JitterEffect: Network jitter (değişken gecikme) simülasyonu
 *   - PacketLossEffect: Paket kaybı (kesinti) simülasyonu
 *
 * Gelecek Efektler (TODO):
 *   - NoiseEffect: Arka plan gürültüsü ekleme
 *   - EchoEffect: Yankı efekti
 *   - BitrateDropEffect: Dinamik bitrate düşüşü
 *   - BandwidthLimitEffect: Bant genişliği sınırlama
 */

export { default as EffectDecorator } from './EffectDecorator.js';
export { default as JitterEffect } from './JitterEffect.js';
export { default as PacketLossEffect } from './PacketLossEffect.js';

/**
 * Efekt fabrikası - Tip adına göre efekt oluştur
 * OCP: Yeni efekt eklerken EFFECT_MAP'e ekle
 */
import EffectDecorator from './EffectDecorator.js';
import JitterEffect from './JitterEffect.js';
import PacketLossEffect from './PacketLossEffect.js';

const EFFECT_MAP = {
  jitter: JitterEffect,
  packetloss: PacketLossEffect
};

/**
 * Efekt instance'ı oluştur
 * @param {string} effectType - Efekt tipi (jitter, packetloss, vb.)
 * @param {BasePipeline} pipeline - Dekore edilecek pipeline
 * @param {Object} options - Efekt ayarları
 * @returns {EffectDecorator}
 */
export function createEffect(effectType, pipeline, options = {}) {
  const EffectClass = EFFECT_MAP[effectType];

  if (!EffectClass) {
    throw new Error(`Bilinmeyen efekt tipi: ${effectType}. Geçerli tipler: ${Object.keys(EFFECT_MAP).join(', ')}`);
  }

  return new EffectClass(pipeline, options);
}

/**
 * Desteklenen efekt tiplerini döndür
 * @returns {string[]}
 */
export function getSupportedEffects() {
  return Object.keys(EFFECT_MAP);
}

/**
 * Birden fazla efekti zincirleme uygula
 * @param {BasePipeline} basePipeline - Temel pipeline
 * @param {Array<{type: string, options: Object}>} effects - Efekt listesi
 * @returns {BasePipeline} - Dekore edilmiş pipeline
 *
 * Örnek:
 *   const decorated = applyEffects(basePipeline, [
 *     { type: 'jitter', options: { maxDelay: 0.1 } },
 *     { type: 'packetloss', options: { lossRate: 0.05 } }
 *   ]);
 */
export function applyEffects(basePipeline, effects = []) {
  let pipeline = basePipeline;

  for (const { type, options } of effects) {
    pipeline = createEffect(type, pipeline, options);
  }

  return pipeline;
}
