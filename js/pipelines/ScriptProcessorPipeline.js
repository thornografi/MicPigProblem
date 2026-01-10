/**
 * ScriptProcessorPipeline - ScriptProcessorNode ile audio isleme
 * OCP: Yeni pipeline eklemek icin BasePipeline'i extend et
 *
 * Graph (WASM Opus):
 *   Source -> ScriptProcessor -> MuteGain -> AudioContext.destination
 *   (PCM data worker'a gonderilir)
 *
 * Graph (MediaRecorder passthrough):
 *   Source -> ScriptProcessor -> Destination -> RecordStream
 */
import BasePipeline from './BasePipeline.js';
import eventBus from '../modules/EventBus.js';
import { createOpusWorker, isWasmOpusSupported } from '../modules/OpusWorkerHelper.js';
import { usesWasmOpus } from '../modules/utils.js';
import { BUFFER } from '../modules/constants.js';

export default class ScriptProcessorPipeline extends BasePipeline {
  constructor(audioContext, sourceNode, destinationNode) {
    super(audioContext, sourceNode, destinationNode);
    this.opusWorker = null;
  }

  get type() {
    return 'scriptprocessor';
  }

  /**
   * ScriptProcessor pipeline kur
   * @param {Object} options - { bufferSize, encoder, mediaBitrate }
   */
  async setup(options = {}) {
    const {
      bufferSize = BUFFER.DEFAULT_SIZE,
      encoder = 'mediarecorder',
      mediaBitrate = 0
    } = options;

    // ScriptProcessor olustur
    this.nodes.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

    // WASM Opus encoder modu
    if (usesWasmOpus(encoder)) {
      await this._setupWasmOpus(bufferSize, mediaBitrate);
    } else {
      // MediaRecorder passthrough modu
      this._setupPassthrough(bufferSize);
    }
  }

  /**
   * WASM Opus encoder kurulumu
   */
  async _setupWasmOpus(bufferSize, mediaBitrate) {
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
        message: 'Opus encoder hatasi',
        details: { error: error.message }
      });
    };

    // ScriptProcessor -> Opus Worker (PCM gonder)
    this.nodes.processor.onaudioprocess = (e) => {
      // Guard: cleanup sonrasi gelen audio event'lerini yoksay
      if (!this.opusWorker) {
        return;
      }

      const pcmData = e.inputBuffer.getChannelData(0);
      this.opusWorker.encode(pcmData.slice(), false);
      // Passthrough (VU meter icin)
      const output = e.outputBuffer.getChannelData(0);
      output.set(pcmData);
    };

    // VU Meter icin AnalyserNode olustur
    this.createAnalyser();

    this.sourceNode.connect(this.nodes.processor);

    // Fan-out: Processor cikisindan VU Meter'a
    this.nodes.processor.connect(this.analyserNode);

    // ScriptProcessor destination'a baglanmali - aksi halde onaudioprocess tetiklenmez
    // Ses cikisini engellemek icin mute GainNode kullan
    this.nodes.mute = this.audioContext.createGain();
    this.nodes.mute.gain.value = 0;
    this.nodes.processor.connect(this.nodes.mute);
    this.nodes.mute.connect(this.audioContext.destination);

    this.log('ScriptProcessor + WASM Opus grafigi baglandi (fan-out)', {
      graph: `Source -> Processor -> [AnalyserNode (VU) + MuteGain -> Destination]`,
      bufferSize,
      bitrate: opusBitrate,
      encoderType: this.opusWorker.encoderType
    });
  }

  /**
   * MediaRecorder passthrough kurulumu
   */
  _setupPassthrough(bufferSize) {
    // Passthrough: input -> output (degisiklik yok)
    this.nodes.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const output = e.outputBuffer.getChannelData(0);
      output.set(input);
    };

    // VU Meter icin AnalyserNode olustur
    this.createAnalyser();

    this.sourceNode.connect(this.nodes.processor);

    // Fan-out: Processor cikisindan VU Meter ve Destination'a
    this.nodes.processor.connect(this.analyserNode);      // VU Meter icin
    this.nodes.processor.connect(this.destinationNode);   // Encode icin

    this.log('ScriptProcessor grafigi baglandi (fan-out)', {
      graph: `Source -> Processor -> [AnalyserNode (VU) + DestinationNode (Encode)]`,
      warning: 'Deprecated API - sadece test icin'
    });
  }

  /**
   * Temizlik - Opus worker dahil
   */
  async cleanup() {
    // Audio event handler'i temizle (race condition onlemi)
    if (this.nodes.processor) {
      this.nodes.processor.onaudioprocess = null;
    }

    // Opus worker temizligi
    if (this.opusWorker) {
      this.opusWorker.terminate();
      this.opusWorker = null;
    }

    await super.cleanup();
    this.log('ScriptProcessor pipeline cleanup tamamlandi');
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

    const result = await this.opusWorker.finish();
    return result;
  }
}
