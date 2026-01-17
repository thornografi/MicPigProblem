/**
 * ScriptProcessorPipeline - ScriptProcessorNode ile audio isleme
 * OCP: Yeni pipeline eklemek icin BasePipeline'i extend et
 * DRY: Opus worker islemleri BasePipeline'dan miras alinir
 *
 * Graph (WASM Opus):
 *   Source -> ScriptProcessor -> MuteGain -> AudioContext.destination
 *   (PCM data worker'a gonderilir)
 *
 * Graph (MediaRecorder passthrough):
 *   Source -> ScriptProcessor -> Destination -> RecordStream
 */
import BasePipeline from './BasePipeline.js';
import { usesWasmOpus } from '../modules/utils.js';
import { BUFFER } from '../modules/constants.js';

export default class ScriptProcessorPipeline extends BasePipeline {
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
   * DRY: Opus worker BasePipeline._initOpusWorker() ile olusturulur
   */
  async _setupWasmOpus(bufferSize, mediaBitrate) {
    // DRY: Ortak Opus worker kurulumu
    const opusBitrate = await this._initOpusWorker(mediaBitrate);

    // ScriptProcessor -> Opus Worker (PCM gonder)
    this.nodes.processor.onaudioprocess = (e) => {
      // Guard: cleanup sonrasi veya worker yok ise event'leri yoksay
      if (!this.opusWorker || !this.nodes.processor) {
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

    // DRY: Ortak MuteGain pattern
    this._createMuteGain(this.nodes.processor);

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
   * DRY: Opus cleanup BasePipeline._cleanupOpusWorker() ile yapilir
   */
  async cleanup() {
    // Audio event handler'i temizle (race condition onlemi)
    if (this.nodes.processor) {
      this.nodes.processor.onaudioprocess = null;
    }

    // DRY: Ortak Opus worker temizligi
    this._cleanupOpusWorker();

    await super.cleanup();
    this.log('ScriptProcessor pipeline cleanup tamamlandi');
  }
}
