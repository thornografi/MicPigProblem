/**
 * constants.js - Merkezi sabit degerler
 * DRY/OCP: Tum magic number'lar tek yerde, degisiklik tek noktadan
 */

// === AUDIO CONTEXT ===
export const AUDIO = {
  DEFAULT_SAMPLE_RATE: 48000,     // Varsayilan sample rate (Hz)
  FFT_SIZE: 256,                   // AnalyserNode FFT boyutu
  SMOOTHING_TIME_CONSTANT: 0.3,    // AnalyserNode smoothing (fast responsive VU meter)
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
  PEAK_HOLD_TIME_MS: 4500,        // Peak gostergesini tutma suresi (4.5 saniye)
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

// === LOOPBACK (WebRTC) ===
export const LOOPBACK = {
  ICE_WAIT_MS: 10000              // ICE baglanti timeout suresi (ms)
};

// === TEST (Loopback Test Ozelligi) ===
export const TEST = {
  DURATION_MS: 7000               // Test suresi (7 saniye)
};

// === HELPER FUNCTIONS ===

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
