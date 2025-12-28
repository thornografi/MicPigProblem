/**
 * AudioUtils - Paylasilan WebAudio yardimci fonksiyonlari
 * Monitor.js ve Recorder.js arasinda ortak kullanim icin
 */
import eventBus from './EventBus.js';

/**
 * AudioContext olustur ve resume et
 * @param {number|null} sampleRate - Istenen sample rate (null = varsayilan)
 * @param {string} logContext - Log mesajlari icin context (ornegin 'Monitor', 'Recorder')
 * @returns {Promise<AudioContext>}
 */
export async function createAudioContext(sampleRate = null, logContext = '') {
  const options = sampleRate ? { sampleRate } : {};
  const ctx = new (window.AudioContext || window.webkitAudioContext)(options);

  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  eventBus.emit('log:webaudio', {
    message: `AudioContext olusturuldu${logContext ? ` (${logContext})` : ''}`,
    details: {
      state: ctx.state,
      sampleRate: ctx.sampleRate,
      baseLatency: ctx.baseLatency
    }
  });

  return ctx;
}

/**
 * DelayNode olustur
 * @param {AudioContext} ctx - AudioContext
 * @param {number} delaySeconds - Gecikme suresi (saniye)
 * @param {number} maxDelay - Maksimum gecikme (saniye)
 * @returns {DelayNode}
 */
export function createDelayNode(ctx, delaySeconds = 2.0, maxDelay = 3.0) {
  const delay = ctx.createDelay(maxDelay);
  delay.delayTime.value = delaySeconds;

  eventBus.emit('log:webaudio', {
    message: 'DelayNode olusturuldu',
    details: {
      delayTime: `${delaySeconds} saniye`,
      maxDelayTime: `${maxDelay} saniye`,
      purpose: 'Echo/feedback onleme'
    }
  });

  return delay;
}

/**
 * Audio node'lari guvenli sekilde disconnect et
 * @param {...AudioNode} nodes - Disconnect edilecek node'lar
 */
export function disconnectNodes(...nodes) {
  nodes.forEach(node => {
    if (!node) return;
    try {
      node.disconnect();
    } catch {
      // Node zaten disconnected olabilir
    }
  });
}

/**
 * AudioContext'i guvenli sekilde kapat
 * @param {AudioContext} ctx - Kapatilacak AudioContext
 * @param {string} logContext - Log mesaji icin context
 */
export async function closeAudioContext(ctx, logContext = '') {
  if (!ctx) return;

  try {
    await ctx.close();
    eventBus.emit('log:webaudio', {
      message: `AudioContext kapatildi${logContext ? ` (${logContext})` : ''}`,
      details: {}
    });
  } catch {
    // Context zaten kapali olabilir
  }
}

/**
 * Mikrofon stream'inden sample rate al
 * @param {MediaStream} stream - Mikrofon stream
 * @returns {number|null} Sample rate veya null
 */
export function getStreamSampleRate(stream) {
  if (!stream) return null;
  const track = stream.getAudioTracks()[0];
  if (!track) return null;
  const settings = track.getSettings();
  return settings.sampleRate || null;
}

export default {
  createAudioContext,
  createDelayNode,
  disconnectNodes,
  closeAudioContext,
  getStreamSampleRate
};
