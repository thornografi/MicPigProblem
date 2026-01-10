/**
 * AudioEngine - Merkezi AudioContext yonetimi ve pre-initialization
 * Amac: Start butonuna basildiginda agir islemleri onceden hazirlamak
 *
 * Kullanim:
 * - Sayfa yuklenince warmup() cagir
 * - Start basilinca getContext() ile hazir context al
 * - Stream gelince connectStream() ile bagla
 */
import eventBus from './EventBus.js';
import { AUDIO } from './constants.js';

class AudioEngine {
  constructor() {
    // Merkezi AudioContext - tum moduller bunu kullanacak
    this.audioContext = null;

    // Pre-created nodes (stream baglanmadan once olusturulabilir)
    this.analyserNode = null;

    // VuMeter icin data array (GC onleme)
    this.fftSize = AUDIO.FFT_SIZE;
    this.dataArray = new Uint8Array(this.fftSize);

    // Durum
    this.isWarmedUp = false;
    this.isConnected = false;

    // Aktif source node (stream baglaninca olusturulur)
    this.sourceNode = null;
  }

  /**
   * Sayfa yuklenince cagir - AudioContext'i "warmup" yapar
   * Chrome'da suspended baslar, ilk user gesture'da resume edilir
   */
  async warmup() {
    if (this.isWarmedUp) {
      eventBus.emit('log:webaudio', {
        message: 'AudioEngine: Zaten warmup yapilmis',
        details: { state: this.audioContext?.state }
      });
      return;
    }

    try {
      // AudioContext olustur (interactive latency = dusuk gecikme)
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive'
      });

      // AnalyserNode onceden olustur
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = this.fftSize;
      this.analyserNode.smoothingTimeConstant = AUDIO.SMOOTHING_TIME_CONSTANT;

      this.isWarmedUp = true;

      eventBus.emit('log:webaudio', {
        message: 'AudioEngine: Warmup tamamlandi',
        details: {
          state: this.audioContext.state,
          sampleRate: this.audioContext.sampleRate,
          baseLatency: this.audioContext.baseLatency,
          fftSize: this.fftSize
        }
      });

      // Suspended durumda baslarsa uyari ver
      if (this.audioContext.state === 'suspended') {
        eventBus.emit('log:webaudio', {
          message: 'AudioEngine: Context suspended - ilk kullanici etkilesiminde resume edilecek',
          details: {}
        });
      }

    } catch (err) {
      eventBus.emit('log:error', {
        message: 'AudioEngine: Warmup hatasi',
        details: { error: err.message }
      });
      throw err;
    }
  }

  /**
   * User gesture sonrasi AudioContext'i aktif et
   * Start butonuna basildiginda cagir
   */
  async resume() {
    if (!this.audioContext) {
      await this.warmup();
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();

      eventBus.emit('log:webaudio', {
        message: 'AudioEngine: Context resumed',
        details: { state: this.audioContext.state }
      });
    }

    return this.audioContext;
  }

  /**
   * Stream'i AudioContext'e bagla ve AnalyserNode dondur
   * @param {MediaStream} stream - getUserMedia'dan gelen stream
   * @returns {AnalyserNode} - VuMeter icin kullanilacak analyser
   */
  async connectStream(stream) {
    if (!stream) {
      throw new Error('AudioEngine: Stream gerekli');
    }

    // Context hazir degilse hazirla
    await this.resume();

    // Onceki source varsa disconnect
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    // Source node olustur ve bagla
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.sourceNode.connect(this.analyserNode);

    this.isConnected = true;

    eventBus.emit('log:webaudio', {
      message: 'AudioEngine: Stream baglandi (VU Meter)',
      details: {
        streamId: stream.id,
        channelCount: this.sourceNode.channelCount,
        contextState: this.audioContext.state
      }
    });

    return this.analyserNode;
  }

  /**
   * Stream baglantisini kes (kayit/monitor durdugunca)
   * AudioContext acik kalir - tekrar baslangic icin hazir
   */
  disconnect() {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    this.isConnected = false;

    eventBus.emit('log:webaudio', {
      message: 'AudioEngine: Stream disconnected (context acik)',
      details: { contextState: this.audioContext?.state }
    });
  }

  /**
   * Tamamen kapat (sayfa kapanirken veya reset)
   */
  async close() {
    this.disconnect();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
    }

    this.audioContext = null;
    this.analyserNode = null;
    this.isWarmedUp = false;

    eventBus.emit('log:webaudio', {
      message: 'AudioEngine: Tamamen kapatildi',
      details: {}
    });
  }

  /**
   * Hazir AudioContext dondur
   */
  getContext() {
    return this.audioContext;
  }

  /**
   * Hazir AnalyserNode dondur
   */
  getAnalyser() {
    return this.analyserNode;
  }

  /**
   * Pre-allocated data array dondur (GC onleme)
   */
  getDataArray() {
    return this.dataArray;
  }

  /**
   * Durum bilgisi
   */
  getState() {
    return {
      isWarmedUp: this.isWarmedUp,
      isConnected: this.isConnected,
      contextState: this.audioContext?.state,
      sampleRate: this.audioContext?.sampleRate,
      baseLatency: this.audioContext?.baseLatency
    };
  }
}

// Singleton instance - tum moduller ayni engine'i kullanacak
const audioEngine = new AudioEngine();
export default audioEngine;
