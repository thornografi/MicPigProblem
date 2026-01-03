/**
 * StandardPipeline - Basit WebAudio graph
 * OCP: Yeni pipeline eklemek icin BasePipeline'i extend et
 *
 * Graph: Source -> Destination
 */
import BasePipeline from './BasePipeline.js';

export default class StandardPipeline extends BasePipeline {
  get type() {
    return 'standard';
  }

  /**
   * Standard mode: Source direkt Destination'a baglanir
   */
  async setup(options = {}) {
    this.sourceNode.connect(this.destinationNode);

    this.log('Standard grafigi baglandi', {
      graph: 'MicStream -> SourceNode -> DestinationNode -> RecordStream'
    });
  }

  /**
   * Source -> Destination baglantisini kopar
   */
  async cleanup() {
    try {
      this.sourceNode?.disconnect(this.destinationNode);
    } catch {
      // Zaten disconnect olmus olabilir
    }

    await super.cleanup();
    this.log('Standard pipeline cleanup tamamlandi');
  }
}
