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
