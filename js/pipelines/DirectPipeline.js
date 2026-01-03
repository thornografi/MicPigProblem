/**
 * DirectPipeline - WebAudio kullanmadan direkt stream
 * OCP: Yeni pipeline eklemek icin BasePipeline'i extend et
 *
 * Graph: (yok) - Stream direkt MediaRecorder'a gider
 */
import BasePipeline from './BasePipeline.js';

export default class DirectPipeline extends BasePipeline {
  get type() {
    return 'direct';
  }

  /**
   * Direct mode'da WebAudio graph kurulmaz
   * Stream direkt kullanilir
   */
  async setup(options = {}) {
    this.log('Direct pipeline - WebAudio bypass', {
      graph: 'MicStream -> MediaRecorder (no WebAudio)'
    });

    // Direct modda node olusturulmaz
    // Sadece log icin cagrilir
  }

  /**
   * Temizlenecek node yok
   */
  async cleanup() {
    // Direct modda temizlenecek WebAudio node yok
    this.log('Direct pipeline cleanup - nothing to clean');
  }
}
