/**
 * WorkletPipeline - AudioWorkletNode ile modern audio isleme
 * OCP: Yeni pipeline eklemek icin BasePipeline'i extend et
 *
 * Graph (WASM Opus):
 *   Source -> AudioWorklet -> MuteGain -> AudioContext.destination
 *   (PCM data port uzerinden main thread'e, accumulator ile Opus worker'a)
 *
 * Graph (MediaRecorder passthrough):
 *   Source -> AudioWorklet(passthrough) -> Destination -> RecordStream
 *
 * AudioWorklet avantajlari:
 * - Sabit 128 sample buffer (dusuk latency)
 * - Main thread blocking yok
 * - Modern API (ScriptProcessor deprecated)
 */
import BasePipeline from './BasePipeline.js';
import { createPassthroughWorkletNode, ensurePassthroughWorklet } from '../modules/WorkletHelper.js';
import { createOpusWorker, isWasmOpusSupported } from '../modules/OpusWorkerHelper.js';
import { usesWasmOpus } from '../modules/utils.js';
import eventBus from '../modules/EventBus.js';

// Opus frame size: 20ms @ 48kHz = 960 samples
const OPUS_FRAME_SIZE = 960;

export default class WorkletPipeline extends BasePipeline {
  constructor(audioContext, sourceNode, destinationNode) {
    super(audioContext, sourceNode, destinationNode);
    this.opusWorker = null;
    this.accumulator = null;
    this.accumulatorIndex = 0;
  }

  get type() {
    return 'worklet';
  }

  /**
   * AudioWorklet pipeline kur
   * @param {Object} options - { encoder, mediaBitrate }
   */
  async setup(options = {}) {
    const { encoder = 'mediarecorder', mediaBitrate = 0 } = options;

    // Worklet module'unu yukle (ilk seferde)
    await ensurePassthroughWorklet(this.audioContext);

    // Passthrough worklet node olustur
    this.nodes.worklet = createPassthroughWorkletNode(this.audioContext);

    // WASM Opus encoder modu
    if (usesWasmOpus(encoder)) {
      await this._setupWasmOpus(mediaBitrate);
    } else {
      // MediaRecorder passthrough modu
      this._setupPassthrough();
    }
  }

  /**
   * WASM Opus encoder kurulumu (accumulator pattern)
   */
  async _setupWasmOpus(mediaBitrate) {
    // WASM Opus destegi kontrolu
    if (!isWasmOpusSupported()) {
      throw new Error('WASM Opus desteklenmiyor');
    }

    // Opus worker olustur
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
        message: 'Opus encoder hatasi (Worklet)',
        details: { error: error.message }
      });
    };

    // Accumulator buffer olustur (128 sample -> 960 sample biriktir)
    this.accumulator = new Float32Array(OPUS_FRAME_SIZE);
    this.accumulatorIndex = 0;

    // Worklet'e PCM gonderimini ac
    this.nodes.worklet.port.postMessage({ command: 'enablePcm' });

    // Worklet'ten gelen PCM data'yi dinle + error handler
    this.nodes.worklet.port.onmessage = (e) => {
      // Worklet'ten gelen hata mesajlarini yakala
      if (e.data.error) {
        eventBus.emit('log:error', {
          message: 'AudioWorklet hatasi',
          details: { error: e.data.error }
        });
        return;
      }
      if (e.data.pcm) {
        this._accumulateAndEncode(e.data.pcm);
      }
    };

    // Graph kur: Source -> Worklet -> MuteGain -> destination
    this.sourceNode.connect(this.nodes.worklet);

    // Worklet destination'a baglanmali - aksi halde process() tetiklenmez
    // Ses cikisini engellemek icin mute GainNode kullan
    this.nodes.mute = this.audioContext.createGain();
    this.nodes.mute.gain.value = 0;
    this.nodes.worklet.connect(this.nodes.mute);
    this.nodes.mute.connect(this.audioContext.destination);

    this.log('AudioWorklet + WASM Opus grafigi baglandi', {
      graph: 'MicStream -> SourceNode -> AudioWorklet(128) -> Accumulator(960) -> Opus Worker -> .ogg',
      frameSize: OPUS_FRAME_SIZE,
      bitrate: opusBitrate,
      encoderType: this.opusWorker.encoderType
    });
  }

  /**
   * 128 sample bloklari biriktirip 960 sample olunca Opus'a gonder
   */
  _accumulateAndEncode(pcmData) {
    // Guard: cleanup sonrasi gelen worklet mesajlarini yoksay
    if (!this.accumulator || !this.opusWorker) {
      return;
    }

    try {
      for (let i = 0; i < pcmData.length; i++) {
        this.accumulator[this.accumulatorIndex++] = pcmData[i];

        // Frame doldu, encode et
        if (this.accumulatorIndex >= OPUS_FRAME_SIZE) {
          this.opusWorker.encode(this.accumulator.slice(), false);
          this.accumulatorIndex = 0;
        }
      }
    } catch (err) {
      eventBus.emit('log:error', {
        message: 'WASM Opus encode hatasi',
        details: { error: err.message, stack: err.stack }
      });
    }
  }

  /**
   * MediaRecorder passthrough kurulumu
   */
  _setupPassthrough() {
    // Graph kur: Source -> Worklet -> Destination
    this.sourceNode.connect(this.nodes.worklet);
    this.nodes.worklet.connect(this.destinationNode);

    this.log('AudioWorklet grafigi baglandi (Kayit)', {
      graph: 'MicStream -> SourceNode -> AudioWorklet(passthrough) -> DestinationNode -> RecordStream'
    });
  }

  /**
   * Temizlik - Opus worker dahil
   */
  async cleanup() {
    // Message handler'i temizle (race condition onlemi)
    if (this.nodes.worklet) {
      this.nodes.worklet.port.onmessage = null;
      this.nodes.worklet.port.postMessage({ command: 'disablePcm' });
    }

    // Opus worker temizligi
    if (this.opusWorker) {
      this.opusWorker.terminate();
      this.opusWorker = null;
    }

    // Accumulator temizle
    this.accumulator = null;
    this.accumulatorIndex = 0;

    await super.cleanup();
    this.log('AudioWorklet pipeline cleanup tamamlandi');
  }

  /**
   * Opus worker'i dondur (Recorder.js stop() icin)
   */
  getOpusWorker() {
    return this.opusWorker;
  }

  /**
   * Opus encoding'i bitir ve blob dondur
   */
  async finishOpusEncoding() {
    if (!this.opusWorker) {
      throw new Error('Opus worker mevcut degil');
    }

    // Kalan accumulator verisini gonder (padding ile)
    if (this.accumulatorIndex > 0) {
      // Kalan kismi sifirla (silence padding)
      for (let i = this.accumulatorIndex; i < OPUS_FRAME_SIZE; i++) {
        this.accumulator[i] = 0;
      }
      this.opusWorker.encode(this.accumulator.slice(), false);
    }

    const result = await this.opusWorker.finish();
    return result;
  }
}
