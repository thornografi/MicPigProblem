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
   * Fan-out: Source -> AnalyserNode (VU) + DestinationNode (Encode)
   */
  async setup(options = {}) {
    // VU Meter icin AnalyserNode olustur
    this.createAnalyser();

    // Fan-out: ayni sinyal iki hedefe
    this.sourceNode.connect(this.analyserNode);      // VU Meter icin
    this.sourceNode.connect(this.destinationNode);   // Encode icin

    this.log('Standard grafigi baglandi (fan-out)', {
      graph: 'Source -> [AnalyserNode (VU) + DestinationNode (Encode)]'
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
