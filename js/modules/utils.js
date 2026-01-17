/**
 * Utils - Ortak yardimci fonksiyonlar
 */
import eventBus from './EventBus.js';

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

/**
 * DOM element gorunurlugunu toggle et - DRY: UI state guncellemelerinde ortak
 * @param {HTMLElement} element - Hedef element
 * @param {boolean} shouldShow - Goster/gizle
 * @param {string} displayValue - Gosterilecek display degeri (default: 'block')
 */
export function toggleDisplay(element, shouldShow, displayValue = 'block') {
  if (element) {
    element.style.display = shouldShow ? displayValue : 'none';
  }
}

/**
 * Async event handler'lari try-catch ile sarar - DRY: Tekrarlayan error handling
 * OCP: Hata formati degismek istediginde tek yerden degisir
 * @param {Function} fn - Async handler fonksiyonu
 * @param {string} errorMessage - Hata mesaji
 * @returns {Function} - Try-catch ile sarili handler
 */
export function wrapAsyncHandler(fn, errorMessage) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      eventBus.emit('log:error', {
        message: errorMessage,
        details: { error: err.message, stack: err.stack }
      });
    }
  };
}

/**
 * MediaRecorder factory - DRY: MimeType fallback mantigi tek yerde
 * @param {MediaStream} stream - Kayit yapilacak stream
 * @param {Object} options - MediaRecorder options (audioBitsPerSecond vb.)
 * @returns {MediaRecorder} - Olusturulan MediaRecorder instance
 */
export function createMediaRecorder(stream, options = {}) {
  const mimeType = getBestAudioMimeType();
  const recorderOptions = { ...options };

  if (mimeType) {
    recorderOptions.mimeType = mimeType;
  }

  try {
    return new MediaRecorder(stream, recorderOptions);
  } catch {
    // Options desteklenmiyorsa fallback
    return new MediaRecorder(stream);
  }
}

// ═══════════════════════════════════════════════════════════════
// Error Message Helper (DRY - getUserMedia hatalari)
// ═══════════════════════════════════════════════════════════════

/**
 * getUserMedia hata kodlarini kullanici dostu mesaja cevir
 * DRY: Recorder, Monitor, MonitoringController ayni mapping'i kullanir
 * @param {Error} err - getUserMedia veya MediaRecorder hatasi
 * @returns {string} - Kullanici dostu hata mesaji
 */
export function getStreamErrorMessage(err) {
  const errorMap = {
    NotAllowedError: 'Microphone permission denied',
    NotFoundError: 'Microphone not found',
    NotReadableError: 'Microphone is being used by another application',
    OverconstrainedError: 'Unsupported microphone setting',
    AbortError: 'Microphone access was aborted',
    SecurityError: 'Microphone access blocked by security policy'
  };
  return errorMap[err.name] || err.message;
}

// ═══════════════════════════════════════════════════════════════
// Pipeline & Encoder Helper Functions (DRY - OCP)
// ═══════════════════════════════════════════════════════════════

/**
 * Pipeline'in buffer ayari gerektirip gerektirmedigini dondurur
 * ScriptProcessor kullanici tarafindan ayarlanabilir buffer'a sahip
 * @param {string} pipeline - Pipeline tipi
 * @returns {boolean}
 */
export function needsBufferSetting(pipeline) {
  return pipeline === 'scriptprocessor';
}

/**
 * Pipeline'in WebAudio kullanip kullanmadigini dondurur
 * direct harici tum pipeline'lar WebAudio kullaniyor
 * @param {string} pipeline - Pipeline tipi
 * @returns {boolean}
 */
export function usesWebAudio(pipeline) {
  return pipeline !== 'direct';
}

/**
 * Encoder'in WASM Opus kullanip kullanmadigini dondurur
 * @param {string} encoder - Encoder tipi
 * @returns {boolean}
 */
export function usesWasmOpus(encoder) {
  return encoder === 'wasm-opus';
}

/**
 * Encoder'in MediaRecorder kullanip kullanmadigini dondurur
 * @param {string} encoder - Encoder tipi
 * @returns {boolean}
 */
export function usesMediaRecorder(encoder) {
  return encoder === 'mediarecorder';
}

/**
 * Pipeline'in WASM Opus encoder'i destekleyip desteklemedigini dondurur
 * WASM Opus ScriptProcessor ve Worklet pipeline'larinda calisir (PCM data gerektirir)
 * Direct ve Standard'da PCM erisimi yok, WASM Opus kullanilamaz
 * @param {string} pipeline - Pipeline tipi
 * @returns {boolean}
 */
export function supportsWasmOpusEncoder(pipeline) {
  return pipeline === 'scriptprocessor' || pipeline === 'worklet';
}

/**
 * Timeslice ayarinin disabled olmasi gerekip gerekmedigi
 * MediaRecorder kullanilmiyorsa timeslice anlamsiz
 * @param {boolean} loopbackOn - Loopback toggle durumu
 * @param {string} encoder - Encoder tipi
 * @returns {boolean} - true ise disabled olmali
 */
export function shouldDisableTimeslice(loopbackOn, encoder) {
  return loopbackOn || !usesMediaRecorder(encoder);
}

/**
 * SettingTypeHandlers - OCP uyumlu setting type registry
 * Yeni tip eklemek icin sadece register() cagirmak yeterli
 *
 * OCP: Open for extension (yeni tipler), Closed for modification (mevcut kod)
 */
export const SettingTypeHandlers = {
  _handlers: {},

  /**
   * Yeni tip handler kaydet
   * @param {string} type - Setting tipi (boolean, enum, range, vb.)
   * @param {Object} handler - { group, render } metodlari
   */
  register(type, handler) {
    this._handlers[type] = handler;
  },

  /**
   * Tip icin handler dondur
   * @param {string} type
   * @returns {Object|null}
   */
  get(type) {
    return this._handlers[type] || null;
  },

  /**
   * Tum kayitli tipleri dondur
   * @returns {string[]}
   */
  getTypes() {
    return Object.keys(this._handlers);
  }
};

// Boolean handler - checkbox olarak render edilir
SettingTypeHandlers.register('boolean', {
  group: 'booleans',
  render({ key, setting, isLocked, currentValue }) {
    const statusClass = isLocked ? 'locked' : 'editable';
    return `<div class="custom-setting-item ${statusClass}">
      <input type="checkbox" ${currentValue ? 'checked' : ''} ${isLocked ? 'disabled' : ''} data-setting="${key}">
      <span class="setting-name">${setting.label || key}</span>
    </div>`;
  }
});

// Enum handler - select olarak render edilir
SettingTypeHandlers.register('enum', {
  group: 'enums',
  render({ key, setting, isLocked, currentValue, allowedValues, formatValue }) {
    const statusClass = isLocked ? 'locked' : 'editable';
    const values = allowedValues || setting.values;
    let options = '';
    values.forEach(val => {
      const selected = val === currentValue ? 'selected' : '';
      options += `<option value="${val}" ${selected}>${formatValue(val, key)}</option>`;
    });
    return `<div class="custom-setting-item ${statusClass}">
      <select ${isLocked ? 'disabled' : ''} data-setting="${key}">${options}</select>
      <span class="setting-name">${setting.label || key}</span>
    </div>`;
  }
});

// ═══════════════════════════════════════════════════════════════
// Activator Audio Helper Functions (DRY - WebRTC Remote Stream)
// ═══════════════════════════════════════════════════════════════

/**
 * Chrome/WebRTC: Remote stream'i aktive etmek icin Audio element olustur ve play et
 * NOT: Chrome'da MediaStream, bir Audio element'te play() cagrilmadan aktif olmuyor
 * DRY: LoopbackManager ve MonitoringController ayni pattern'i kullaniyor
 * @param {MediaStream} remoteStream - WebRTC remote stream
 * @param {string} context - Log mesajlari icin context (ornek: 'Loopback Monitor', 'Test')
 * @returns {Promise<HTMLAudioElement>} - Olusturulan activator audio element
 */
export async function createAndPlayActivatorAudio(remoteStream, context = 'loopback') {
  const audio = document.createElement('audio');
  audio.srcObject = remoteStream;
  audio.muted = true;
  audio.volume = 0;
  audio.playsInline = true;

  try {
    await audio.play();
    eventBus.emit('log:stream', {
      message: `${context}: Activator audio baslatildi`,
      details: { paused: audio.paused, muted: audio.muted }
    });
  } catch (err) {
    eventBus.emit('log:warning', {
      message: `${context}: Activator audio hatasi (devam ediliyor)`,
      details: { error: err.message }
    });
  }

  return audio;
}

/**
 * Activator audio element'i temizle
 * DRY: Ayni temizlik mantigi birden fazla yerde tekrarlaniyor
 * @param {HTMLAudioElement|null} audio - Temizlenecek audio element
 */
export function cleanupActivatorAudio(audio) {
  if (!audio) return;
  try {
    audio.pause();
    audio.srcObject = null;
  } catch { /* ignore */ }
}
