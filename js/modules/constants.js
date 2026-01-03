/**
 * constants.js - Merkezi sabit degerler
 * DRY/OCP: Tum magic number'lar tek yerde, degisiklik tek noktadan
 */

// === AUDIO CONTEXT ===
export const AUDIO = {
  DEFAULT_SAMPLE_RATE: 48000,     // Varsayilan sample rate (Hz)
  FFT_SIZE: 256,                   // AnalyserNode FFT boyutu
  SMOOTHING_TIME_CONSTANT: 0.7,    // AnalyserNode smoothing (slow motion icin)
  CENTER_VALUE: 128                // 8-bit audio center point
};

// === DELAY (Echo/Feedback Onleme) ===
export const DELAY = {
  MAX_SECONDS: 3.0,               // DelayNode maksimum delay suresi
  DEFAULT_SECONDS: 1.7            // Varsayilan delay suresi (feedback onleme)
};

// === BUFFER ===
export const BUFFER = {
  DEFAULT_SIZE: 4096,             // ScriptProcessor varsayilan buffer
  WARNING_THRESHOLD: 1024         // Dusuk buffer uyari esigi
};

// === VU METER ===
export const VU_METER = {
  RMS_THRESHOLD: 0.0001,          // dB hesaplama icin minimum RMS
  MIN_DB: -60,                    // Minimum dB seviyesi (sessizlik)
  CLIPPING_THRESHOLD_DB: -0.5,    // Bu dB ustu = clipping riski
  PEAK_HOLD_TIME_MS: 1000,        // Peak gostergesini tutma suresi
  PEAK_DECAY_RATE: 2,             // Peak dusme hizi (dB/frame)
  DOT_ACTIVE_THRESHOLD: 5,        // Sinyal noktasi aktif esigi (%)
  DEFAULT_METER_WIDTH: 200        // Varsayilan meter genisligi (px)
};

// === BYTES ===
export const BYTES = {
  PER_KB: 1024,
  PER_MB: 1024 * 1024
};

// === THROTTLING ===
export const THROTTLE = {
  ERROR_LOG_MS: 5000              // Error log throttle suresi (ms)
};

// === LOG ===
export const LOG = {
  MAX_PER_CATEGORY: 500           // Kategori basina maksimum log sayisi
};

// === SIGNAL DETECTION (Loopback) ===
export const SIGNAL = {
  MAX_WAIT_MS: 2000,              // Sinyal bekleme maksimum suresi
  POLL_INTERVAL_MS: 50,           // Polling araligi
  RMS_THRESHOLD: 0.001            // Sinyal algilama RMS esigi
};

// === LOOPBACK ===
export const LOOPBACK = {
  ICE_WAIT_MS: 3000               // ICE baglanti bekleme suresi
};

// === OPUS (WASM Encoder) ===
export const OPUS = {
  FRAME_SIZE: 960,                // 20ms @ 48kHz (standart Opus frame)
  MIN_BITRATE: 6000,              // Minimum Opus bitrate (bps)
  MAX_BITRATE: 510000,            // Maximum Opus bitrate (bps)
  WHATSAPP_BITRATE: 16000,        // WhatsApp sesli mesaj tipik bitrate
  WHATSAPP_BUFFER: 4096,          // WhatsApp ScriptProcessor buffer boyutu
  CHANNELS: 1,                    // Mono (voice)
  PRE_SKIP: 312                   // Encoder delay (~3.75ms @ 48kHz)
};

// === HELPER FUNCTIONS ===

/**
 * Bitrate'i kbps'e cevir
 * @param {number} bps - Bits per second
 * @returns {number} Kilobits per second
 */
export const bitrateToKbps = (bps) => bps / 1000;

/**
 * Byte'i KB'a cevir
 * @param {number} bytes
 * @returns {number} Kilobytes
 */
export const bytesToKB = (bytes) => bytes / BYTES.PER_KB;

/**
 * Buffer size'dan latency hesapla
 * @param {number} bufferSize - Buffer boyutu (samples)
 * @param {number} sampleRate - Sample rate (Hz)
 * @returns {number} Latency (ms)
 */
export const calculateLatencyMs = (bufferSize, sampleRate = AUDIO.DEFAULT_SAMPLE_RATE) =>
  (bufferSize / sampleRate) * 1000;

/**
 * Timeslice'dan saniyede chunk sayisi hesapla
 * @param {number} timeslice - Chunk suresi (ms)
 * @returns {number} Chunks per second
 */
export const getChunksPerSecond = (timeslice) => 1000 / timeslice;

/**
 * dB hesapla (RMS'den)
 * @param {number} rms - RMS degeri
 * @param {number} minDb - Minimum dB (varsayilan VU_METER.MIN_DB)
 * @returns {number} dB degeri
 */
export const rmsToDb = (rms, minDb = VU_METER.MIN_DB) =>
  rms > VU_METER.RMS_THRESHOLD ? 20 * Math.log10(rms) : minDb;

/**
 * dB'yi yuzdeye cevir (VU meter icin)
 * @param {number} dB - dB degeri
 * @param {number} minDb - Minimum dB (0% noktasi)
 * @returns {number} Yuzde (0-100)
 */
export const dbToPercent = (dB, minDb = VU_METER.MIN_DB) =>
  Math.max(0, Math.min(100, (dB - minDb) / -minDb * 100));
