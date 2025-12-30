/**
 * LogManager - Kategorili loglama sistemi
 * Kategoriler: error, audio, stream, webaudio, recorder, system
 *
 * Browser'da dosya sistemine dogrudan yazilamaz.
 * Bu modul:
 * 1. Bellekte kategorili log tutar
 * 2. IndexedDB'ye kaydeder
 * 3. Export fonksiyonu ile download edilebilir
 * 4. Console'a kisa versiyon yazar
 */
import eventBus from './EventBus.js';

const LOG_CATEGORIES = {
  ERROR: 'error',
  AUDIO: 'audio',
  STREAM: 'stream',
  WEBAUDIO: 'webaudio',
  RECORDER: 'recorder',
  SYSTEM: 'system',
  UI: 'ui'
};

// Maksimum log sayisi (kategori basina) - bellek korumasi
const MAX_LOGS_PER_CATEGORY = 500;

class LogManager {
  constructor() {
    this.logs = {
      error: [],
      audio: [],
      stream: [],
      webaudio: [],
      recorder: [],
      system: [],
      ui: []
    };

    this.sessionId = Date.now().toString(36);
    this.dbName = 'MicProbeLogs';
    this.dbVersion = 1;
    this.db = null;

    this.initDB();
    this.bindEvents();

    this.log('system', 'LogManager baslatildi', { sessionId: this.sessionId });
  }

  async initDB() {
    try {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.warn('[LogManager] IndexedDB acilamadi, sadece bellek kullanilacak');
      };

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('logs')) {
          const store = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('sessionId', 'sessionId', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        this.log('system', 'IndexedDB baglantisi basarili');
      };
    } catch (err) {
      console.warn('[LogManager] IndexedDB hatasi:', err);
    }
  }

  bindEvents() {
    // Genel log event'i
    eventBus.on('log', (msg) => this.log('ui', msg));

    // Kategorili event'ler
    eventBus.on('log:error', (data) => this.log('error', data.message, data.details));
    eventBus.on('log:audio', (data) => this.log('audio', data.message, data.details));
    eventBus.on('log:stream', (data) => this.log('stream', data.message, data.details));
    eventBus.on('log:webaudio', (data) => this.log('webaudio', data.message, data.details));
    eventBus.on('log:recorder', (data) => this.log('recorder', data.message, data.details));
    eventBus.on('log:system', (data) => this.log('system', data.message, data.details));
    eventBus.on('log:ui', (data) => this.log('ui', data.message, data.details));
    eventBus.on('log:warning', (data) => {
      // Warning'lari error kategorisinde logla (ama console.warn kullan)
      console.warn('[WARNING]', data.message, data.details || '');
      this.log('error', `[WARN] ${data.message}`, data.details);
    });

    // Stream event'leri
    eventBus.on('stream:started', (stream) => {
      const track = stream?.getAudioTracks()[0];
      this.log('stream', 'Stream baslatildi', {
        trackId: track?.id,
        trackLabel: track?.label,
        trackSettings: track?.getSettings()
      });
    });

    eventBus.on('stream:stopped', () => {
      this.log('stream', 'Stream durduruldu');
    });

    // Recorder event'leri
    eventBus.on('recorder:started', (details) => {
      this.log('recorder', 'MediaRecorder baslatildi', details || null);
    });

    eventBus.on('recorder:stopped', (details) => {
      this.log('recorder', 'MediaRecorder durduruldu', details || null);
    });

    eventBus.on('recording:completed', (data) => {
      this.log('recorder', 'Kayit tamamlandi', {
        filename: data.filename,
        size: data.blob?.size,
        mimeType: data.mimeType
      });
    });

    // Monitor event'leri
    eventBus.on('monitor:started', (data) => {
      const mode = data?.mode;
      const category = (data?.loopback || mode === 'direct') ? 'stream' : 'webaudio';
      this.log(category, 'Monitor baslatildi', {
        mode,
        delaySeconds: data?.delaySeconds,
        loopback: !!data?.loopback
      });
    });

    eventBus.on('monitor:stopped', (data) => {
      const mode = data?.mode;
      const category = (data?.loopback || mode === 'direct') ? 'stream' : 'webaudio';
      this.log(category, 'Monitor durduruldu', { mode, loopback: !!data?.loopback });
    });

    // VU Meter event'leri (sadece onemli olanlar)
    eventBus.on('vumeter:started', () => {
      this.log('audio', 'VU Meter baslatildi');
    });

    eventBus.on('vumeter:stopped', () => {
      this.log('audio', 'VU Meter durduruldu');
    });

    // Global error handler
    window.addEventListener('error', (e) => {
      this.log('error', 'Uncaught Error', {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.error?.stack
      });
    });

    window.addEventListener('unhandledrejection', (e) => {
      this.log('error', 'Unhandled Promise Rejection', {
        reason: e.reason?.message || e.reason,
        stack: e.reason?.stack
      });
    });
  }

  log(category, message, details = null) {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      sessionId: this.sessionId,
      category,
      message,
      details
    };

    // Bellekte sakla
    if (this.logs[category]) {
      this.logs[category].push(entry);

      // Bellek korumasi - eski loglari sil (FIFO)
      if (this.logs[category].length > MAX_LOGS_PER_CATEGORY) {
        this.logs[category].shift();
      }
    }

    // IndexedDB'ye kaydet
    this.saveToDB(entry);

    // Console'a yaz (kisa versiyon)
    const consolePrefix = `[${category.toUpperCase()}]`;
    if (category === 'error') {
      console.error(consolePrefix, message, details || '');
    } else if (details) {
      console.log(consolePrefix, message, details);
    } else {
      console.log(consolePrefix, message);
    }

    // UI log event'i gonder (sadece onemli kategoriler)
    if (['error', 'recorder', 'webaudio', 'stream'].includes(category)) {
      eventBus.emit('log:display', { category, message, timestamp });
    }
  }

  async saveToDB(entry) {
    if (!this.db) return;

    try {
      const tx = this.db.transaction(['logs'], 'readwrite');
      const store = tx.objectStore('logs');
      store.add(entry);
    } catch (err) {
      console.warn('[LogManager] DB kayit hatasi:', err);
    }
  }

  // Kategoriye gore log al
  getByCategory(category) {
    return this.logs[category] || [];
  }

  // Tum loglari al
  getAll() {
    return { ...this.logs };
  }

  // Session loglarini al
  getSessionLogs() {
    const all = [];
    Object.keys(this.logs).forEach(cat => {
      this.logs[cat].forEach(entry => all.push(entry));
    });
    return all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  /**
   * Log akisini mantiksal olarak kontrol eder ve supheli durumlari raporlar.
   * Bu fonksiyon debug amaclidir; is akisina etkisi yoktur.
   */
  getSanityReport() {
    const entries = this.getSessionLogs();

    const issues = [];
    const addIssue = (severity, code, message, details = {}) => {
      issues.push({ severity, code, message, details });
    };

    let lastWebAudioEnabled = null;
    let recordingActive = false;
    let monitoringActive = false;
    let streamBalance = 0;

    for (const entry of entries) {
      const category = entry?.category;
      const message = entry?.message;
      const details = entry?.details || {};

      if (category === 'webaudio' && details?.setting === 'webAudioEnabled') {
        lastWebAudioEnabled = !!details.value;
      }

      if (category === 'stream' && message === 'Stream baslatildi') {
        streamBalance += 1;
      }
      if (category === 'stream' && message === 'Stream durduruldu') {
        streamBalance -= 1;
        if (streamBalance < 0) {
          addIssue('warn', 'STREAM_BALANCE_NEGATIVE', 'Stream durduruldu sayisi, baslatildi sayisindan fazla gorunuyor', {
            streamBalance
          });
          streamBalance = 0;
        }
      }

      // UI aksiyon loglari - detayi kontrol et
      if (category === 'stream' && message === 'Monitor Baslat butonuna basildi') {
        const { webAudioEnabled, loopbackEnabled, monitorMode, pipeline } = details;
        if (webAudioEnabled === false && monitorMode && monitorMode !== 'direct') {
          addIssue('error', 'MONITOR_MODE_MISMATCH', 'WebAudio Pipeline PASIF iken monitorMode direct degil', {
            webAudioEnabled,
            monitorMode,
            pipeline,
            loopbackEnabled
          });
        }
        if (loopbackEnabled === true && typeof pipeline === 'string' && !pipeline.includes('WebRTC Loopback')) {
          addIssue('warn', 'PIPELINE_LABEL_MISMATCH', 'Loopback aktif ama pipeline label WebRTC Loopback icermiyor', {
            pipeline
          });
        }
      }

      if (category === 'recorder' && message === 'Kayit baslat butonuna basildi') {
        const { webAudioEnabled, loopbackEnabled, recordMode } = details;
        if (webAudioEnabled === false && recordMode && recordMode !== 'direct' && loopbackEnabled !== true) {
          addIssue('error', 'RECORD_MODE_MISMATCH', 'WebAudio Pipeline PASIF iken recordMode direct degil', {
            webAudioEnabled,
            recordMode,
            loopbackEnabled
          });
        }
      }

      // Monitor eventleri (LogManager tarafindan olusturulan)
      if (message === 'Monitor baslatildi') {
        const delaySeconds = details?.delaySeconds;
        if (!(Number.isFinite(delaySeconds) && delaySeconds > 0)) {
          addIssue('warn', 'MONITOR_DELAY_MISSING', 'Monitor basladi ama delaySeconds log detayi yok/hatali', {
            delaySeconds,
            mode: details?.mode,
            loopback: !!details?.loopback
          });
        } else if (Math.abs(delaySeconds - 2.0) > 0.01) {
          addIssue('warn', 'MONITOR_DELAY_NOT_2S', 'Monitor delay 2sn degil (beklenen: 2.0s)', {
            delaySeconds,
            mode: details?.mode,
            loopback: !!details?.loopback
          });
        }

        if (recordingActive) {
          addIssue('error', 'CONCURRENT_RECORD_AND_MONITOR', 'Monitor basladi ama kayit hali hazirda aktif gorunuyor', {
            mode: details?.mode,
            loopback: !!details?.loopback
          });
        }
        monitoringActive = true;
      }

      if (message === 'Monitor durduruldu') {
        monitoringActive = false;
      }

      if (category === 'recorder' && message === 'MediaRecorder baslatildi') {
        if (monitoringActive) {
          addIssue('error', 'CONCURRENT_MONITOR_AND_RECORD', 'Kayit basladi ama monitoring hali hazirda aktif gorunuyor', {
            lastWebAudioEnabled
          });
        }
        recordingActive = true;
      }

      if (category === 'recorder' && message === 'MediaRecorder durduruldu') {
        recordingActive = false;
      }
    }

    if (recordingActive) {
      addIssue('warn', 'RECORDING_STILL_ACTIVE', 'Session sonunda kayit aktif gorunuyor (durdur event kacmis olabilir)', {});
    }
    if (monitoringActive) {
      addIssue('warn', 'MONITORING_STILL_ACTIVE', 'Session sonunda monitoring aktif gorunuyor (durdur event kacmis olabilir)', {});
    }
    if (streamBalance !== 0) {
      addIssue('warn', 'STREAM_BALANCE_NONZERO', 'Session sonunda stream baslat/durdur dengesi sifir degil', { streamBalance });
    }

    return {
      ok: issues.length === 0,
      issues,
      summary: {
        lastWebAudioEnabled,
        streamBalance,
        recordingActive,
        monitoringActive,
        totalEntries: entries.length
      }
    };
  }

  // Loglari JSON olarak export et
  exportJSON() {
    const data = {
      sessionId: this.sessionId,
      exportedAt: new Date().toISOString(),
      logs: this.logs
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `mic-probe-logs-${this.sessionId}.json`;
    a.click();

    URL.revokeObjectURL(url);
    this.log('system', 'Loglar export edildi', { filename: a.download });
  }

  // Kategoriye gore export
  exportCategory(category) {
    const data = {
      sessionId: this.sessionId,
      category,
      exportedAt: new Date().toISOString(),
      logs: this.logs[category] || []
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `mic-probe-${category}-${this.sessionId}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  // Loglari temizle
  clear(category = null) {
    if (category) {
      this.logs[category] = [];
    } else {
      Object.keys(this.logs).forEach(cat => {
        this.logs[cat] = [];
      });
    }
    this.log('system', category ? `${category} loglari temizlendi` : 'Tum loglar temizlendi');
  }

  // Istatistikler
  getStats() {
    const stats = {};
    Object.keys(this.logs).forEach(cat => {
      stats[cat] = this.logs[cat].length;
    });
    stats.total = Object.values(stats).reduce((a, b) => a + b, 0);
    return stats;
  }
}

// Singleton export
const logManager = new LogManager();
export { LOG_CATEGORIES };
export default logManager;
