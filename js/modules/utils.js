/**
 * Utils - Ortak yardimci fonksiyonlar
 */

/**
 * Saniyeyi mm:ss formatina cevir
 * @param {number} seconds - Saniye cinsinden sure
 * @returns {string} - "0:00" formatinda sure
 */
export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Tarayicida desteklenen en uygun audio MediaRecorder mimeType'i dondurur.
 * Amac: Testler arasinda daha tutarli codec/container secimi (tercihen Opus/WebM)
 * @returns {string} mimeType veya '' (bulunamadi)
 */
export function getBestAudioMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg'
  ];

  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  for (const mimeType of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
    } catch {
      // ignore
    }
  }

  return '';
}

/**
 * MediaStream'in tum track'lerini durdurur
 * DRY: Birden fazla yerde kullanilan stream temizleme islemi
 * @param {MediaStream} stream - Durdurulacak stream
 * @returns {void}
 */
export function stopStreamTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach(track => track.stop());
}

/**
 * Async sleep fonksiyonu
 * @param {number} ms - Bekleme suresi (milisaniye)
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * AudioContext factory - DRY: Tek noktadan tutarli AudioContext olusturma
 * Sample rate matching, resume handling ve cross-browser uyumluluk saglar
 * @param {Object} options - AudioContext options (sampleRate, etc.)
 * @returns {Promise<AudioContext>} - Hazir (resumed) AudioContext
 */
export async function createAudioContext(options = {}) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextCtor(options);

  // AudioContext suspended olabilir (autoplay policy) - resume et
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  return ctx;
}

/**
 * Stream'den AudioContext options olustur - DRY: Sample rate matching
 * @param {MediaStream} stream - Kaynak stream
 * @returns {Object} - AudioContext options { sampleRate } veya {}
 */
export function getAudioContextOptions(stream) {
  if (!stream) return {};

  const track = stream.getAudioTracks()[0];
  const sampleRate = track?.getSettings()?.sampleRate;

  return sampleRate ? { sampleRate } : {};
}
