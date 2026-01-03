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
      getEncoder: () => 'mediarecorder',
      getProcessingMode: () => 'direct', // Geriye uyumluluk
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
      setIsPreparing: () => {},
      getIsPreparing: () => false
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
    const encoder = this.deps.getEncoder();

    eventBus.emit('log:recorder', {
      message: 'Kayit baslat butonuna basildi',
      details: { constraints, webAudioEnabled: useWebAudio, pipeline, encoder }
    });

    try {
      // Kayit baslarken oynaticiyi durdur
      this.deps.player?.pause();

      // Preparing state
      this.deps.setIsPreparing(true);
      this.deps.uiStateManager?.updateButtonStates();
      this.deps.uiStateManager?.showPreparingState();

      // Normal kayit (Recorder modulu uzerinden)
      const timeslice = this.deps.getTimeslice();
      const mediaBitrate = this.deps.getMediaBitrate();
      const bufferSize = this.deps.getBufferSize();

      await this.deps.recorder.start(constraints, pipeline, encoder, timeslice, bufferSize, mediaBitrate);

      // UI guncelle
      this.deps.setIsPreparing(false);
      this.deps.setCurrentMode('recording');
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

    this.deps.uiStateManager?.stopTimer();
    this.deps.recorder?.stop();

    this.deps.setCurrentMode(null);
    this.deps.uiStateManager?.updateButtonStates();
  }
}

// Singleton export
const recordingController = new RecordingController();
export default recordingController;
