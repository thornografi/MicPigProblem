/**
 * WorkletPipeline - AudioWorkletNode ile modern audio isleme
 * OCP: Yeni pipeline eklemek icin BasePipeline'i extend et
 *
 * Graph: Source -> AudioWorklet(passthrough) -> Destination -> RecordStream
 *
 * AudioWorklet avantajlari:
 * - Sabit 128 sample buffer (dusuk latency)
 * - Main thread blocking yok
 * - Modern API (ScriptProcessor deprecated)
 */
import BasePipeline from './BasePipeline.js';
import { createPassthroughWorkletNode, ensurePassthroughWorklet } from '../modules/WorkletHelper.js';

export default class WorkletPipeline extends BasePipeline {
  get type() {
    return 'worklet';
  }

  /**
   * AudioWorklet pipeline kur
   * @param {Object} options - (worklet icin ek option yok, 128 sample sabit)
   */
  async setup(options = {}) {
    // Worklet module'unu yukle (ilk seferde)
    await ensurePassthroughWorklet(this.audioContext);

    // Passthrough worklet node olustur
    this.nodes.worklet = createPassthroughWorkletNode(this.audioContext);

    // Graph kur: Source -> Worklet -> Destination
    this.sourceNode.connect(this.nodes.worklet);
    this.nodes.worklet.connect(this.destinationNode);

    this.log('AudioWorklet grafigi baglandi (Kayit)', {
      graph: 'MicStream -> SourceNode -> AudioWorklet(passthrough) -> DestinationNode -> RecordStream'
    });
  }

  /**
   * Worklet node temizligi
   */
  async cleanup() {
    await super.cleanup();
    this.log('AudioWorklet pipeline cleanup tamamlandi');
  }
}
