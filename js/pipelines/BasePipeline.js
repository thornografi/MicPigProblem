/**
 * BasePipeline - Pipeline Strategy Interface
 * OCP: Yeni pipeline eklemek icin bu class'i extend et
 * DRY: Ortak Opus worker ve MuteGain islemleri burada
 *
 * Her pipeline:
 * - setup(): WebAudio graph'i kur
 * - cleanup(): Kaynaklari temizle
 * - getNodes(): Olusturulan node'lari dondur
 */
import eventBus from '../modules/EventBus.js';
import { createOpusWorker, isWasmOpusSupported } from '../modules/OpusWorkerHelper.js';

export default class BasePipeline {
  constructor(audioContext, sourceNode, destinationNode) {
    this.audioContext = audioContext;
    this.sourceNode = sourceNode;
    this.destinationNode = destinationNode;

    // Alt class'lar bu node'lari dolduracak
    this.nodes = {
      processor: null,  // ScriptProcessor veya Worklet
      mute: null,       // WASM Opus icin mute GainNode
      worklet: null     // AudioWorkletNode
    };

    // VU Meter icin AnalyserNode (fan-out pattern)
    this.analyserNode = null;

    // WASM Opus encoder (ScriptProcessor ve Worklet icin)
    this.opusWorker = null;
  }

  /**
   * VU Meter icin AnalyserNode olustur
   * constants.js'deki AUDIO sabitleri ile tutarli
   * @returns {AnalyserNode}
   */
  createAnalyser() {
    // Import yerine dogrudan deger kullan (circular dependency onleme)
    // Bu degerler constants.js AUDIO ile eslestirilmeli
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256; // AUDIO.FFT_SIZE
    this.analyserNode.smoothingTimeConstant = 0.3; // AUDIO.SMOOTHING_TIME_CONSTANT
    return this.analyserNode;
  }

  /**
   * Pipeline'i kur
   * @param {Object} options - Pipeline options (bufferSize, encoder, etc.)
   * @returns {Promise<void>}
   */
  async setup(options = {}) {
    throw new Error('BasePipeline.setup() must be implemented by subclass');
  }

  /**
   * Pipeline'i temizle
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Ortak temizlik mantigi
    Object.values(this.nodes).forEach(node => {
      if (node) {
        try {
          node.disconnect();
        } catch {
          // Node zaten disconnect olmus olabilir
        }
      }
    });

    // ScriptProcessor onaudioprocess temizligi
    if (this.nodes.processor?.onaudioprocess) {
      this.nodes.processor.onaudioprocess = null;
    }

    // AnalyserNode temizligi
    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {
        // Node zaten disconnect olmus olabilir
      }
      this.analyserNode = null;
    }

    this.nodes = { processor: null, mute: null, worklet: null };
  }

  /**
   * Olusturulan node'lari dondur
   * @returns {Object} - { processor, mute, worklet }
   */
  getNodes() {
    return { ...this.nodes };
  }

  /**
   * Pipeline tipi (subclass override etmeli)
   * @returns {string}
   */
  get type() {
    return 'base';
  }

  /**
   * Log helper
   */
  log(message, details = {}) {
    eventBus.emit('log:webaudio', { message, details });
  }

  // ═══════════════════════════════════════════════════════════════
  // DRY: Ortak Opus Worker Metodlari (ScriptProcessor & Worklet icin)
  // ═══════════════════════════════════════════════════════════════

  /**
   * WASM Opus worker'i olustur ve event handler'lari bagla
   * DRY: ScriptProcessor ve Worklet ayni kodu kullanir
   * @param {number} mediaBitrate - Hedef bitrate (0 ise default 16000)
   * @returns {Promise<void>}
   */
  async _initOpusWorker(mediaBitrate = 0) {
    if (!isWasmOpusSupported()) {
      throw new Error('WASM Opus desteklenmiyor');
    }

    const opusBitrate = mediaBitrate || 16000;
    this.opusWorker = await createOpusWorker({
      sampleRate: this.audioContext.sampleRate,
      channels: 1,
      bitrate: opusBitrate
    });

    this.opusWorker.onProgress = (progress) => {
      eventBus.emit('opus:progress', progress);
    };

    this.opusWorker.onError = (error) => {
      eventBus.emit('log:error', {
        message: `Opus encoder hatasi (${this.type})`,
        details: { error: error.message }
      });
    };

    return opusBitrate;
  }

  /**
   * Opus worker'i dondur (Recorder.js stop() icin)
   * @returns {Object|null}
   */
  getOpusWorker() {
    return this.opusWorker;
  }

  /**
   * Opus encoding'i bitir ve blob dondur
   * Alt class'lar override edebilir (WorkletPipeline accumulator icin)
   * @returns {Promise<Object>} - { blob, pageCount, encoderType }
   */
  async finishOpusEncoding() {
    if (!this.opusWorker) {
      throw new Error('Opus worker mevcut degil');
    }
    return await this.opusWorker.finish();
  }

  /**
   * Opus worker'i temizle
   * @protected
   */
  _cleanupOpusWorker() {
    if (this.opusWorker) {
      this.opusWorker.terminate();
      this.opusWorker = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // DRY: Ortak MuteGain Pattern (WASM Opus modunda ses cikisini engelle)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Mute GainNode olustur ve bagla
   * WASM Opus modunda ses cikisini engellemek icin kullanilir
   * @param {AudioNode} sourceNode - Baglanti kaynagi (processor veya worklet)
   */
  _createMuteGain(sourceNode) {
    this.nodes.mute = this.audioContext.createGain();
    this.nodes.mute.gain.value = 0;
    sourceNode.connect(this.nodes.mute);
    this.nodes.mute.connect(this.audioContext.destination);
  }
}
