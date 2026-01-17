/**
 * RecordingController - Kayit islemlerini yonetir
 * Sadece normal kayit (MediaRecorder) - Loopback recording kaldirildi
 * DIP: Bagimliliklar dependency injection ile alinir
 */
import eventBus from '../modules/EventBus.js';

class RecordingController {
  constructor() {
    // Dependency injection ile gelen fonksiyonlar
    this.deps = {
      getConstraints: () => ({}),
      getPipeline: () => 'direct',
      isWebAudioEnabled: () => false,
      getTimeslice: () => 0,
      getBufferSize: () => 4096,
      getMediaBitrate: () => 0,
      // Modul referanslari
      recorder: null,
      player: null,
      uiStateManager: null,
      // State yonetimi
      setCurrentMode: () => {},
      getCurrentMode: () => null,
      setIsPreparing: () => {}
    };
  }

  /**
   * Bagimliliklari set et
   * @param {Object} deps - Bagimliliklar
   */
  setDependencies(deps) {
    Object.assign(this.deps, deps);
  }

  /**
   * Kayit baslatma - toggle mantigi
   */
  async toggle() {
    if (this.deps.getCurrentMode() === 'recording') {
      await this.stop();
    } else {
      await this.start();
    }
  }

  /**
   * Kayit baslat
   */
  async start() {
    const useWebAudio = this.deps.isWebAudioEnabled();
    const constraints = this.deps.getConstraints();
    const pipeline = useWebAudio ? this.deps.getPipeline() : 'direct';

    // Encoder: Pipeline tipine gore zorunlu secim
    // ScriptProcessor/Worklet -> WASM Opus (PCM erisimi var)
    // Direct/Standard -> MediaRecorder (PCM erisimi yok)
    const pipelineSupportsWasm = pipeline === 'scriptprocessor' || pipeline === 'worklet';
    const encoder = pipelineSupportsWasm ? 'wasm-opus' : 'mediarecorder';

    eventBus.emit('log:recorder', {
      message: 'Kayit baslat butonuna basildi',
      details: { constraints, webAudioEnabled: useWebAudio, pipeline, encoder, pipelineSupportsWasm }
    });

    try {
      // Kayit baslarken oynaticiyi durdur
      this.deps.player?.pause();

      // Preparing state - mode'u hemen set et (UI hangi butonun preparing oldugunu bilsin)
      this.deps.setCurrentMode('recording');
      this.deps.setIsPreparing(true);
      this.deps.uiStateManager?.updateButtonStates();
      this.deps.uiStateManager?.showPreparingState();

      // Normal kayit (Recorder modulu uzerinden)
      const timeslice = this.deps.getTimeslice();
      const mediaBitrate = this.deps.getMediaBitrate();
      const bufferSize = this.deps.getBufferSize();

      await this.deps.recorder.start(constraints, pipeline, encoder, timeslice, bufferSize, mediaBitrate);

      // UI guncelle - mode zaten set edildi, sadece preparing'i kapat
      this.deps.setIsPreparing(false);
      this.deps.uiStateManager?.updateButtonStates();
      this.deps.uiStateManager?.hidePreparingState();
      this.deps.uiStateManager?.startTimer();

    } catch (err) {
      eventBus.emit('log:error', { message: 'Kayit baslatilamadi', details: { error: err.message } });
      eventBus.emit('log', `❌ HATA: ${err.message}`);

      // Temizlik
      this.deps.setIsPreparing(false);
      this.deps.setCurrentMode(null);
      this.deps.uiStateManager?.updateButtonStates();
      this.deps.uiStateManager?.hidePreparingState();
      this.deps.uiStateManager?.stopTimer();
    }
  }

  /**
   * Kayit durdur
   */
  async stop() {
    eventBus.emit('log:recorder', {
      message: 'Kayit durduruluyor',
      details: {}
    });

    try {
      this.deps.uiStateManager?.stopTimer();
      await this.deps.recorder?.stop();
    } catch (err) {
      eventBus.emit('log:error', {
        message: 'Kayit durdurma hatasi',
        details: { error: err.message, stack: err.stack }
      });
    } finally {
      // Her durumda state reset - hata olsa bile UI tutarli kalsin
      this.deps.setCurrentMode(null);
      this.deps.uiStateManager?.updateButtonStates();
    }
  }
}

// Singleton export
const recordingController = new RecordingController();
export default recordingController;
