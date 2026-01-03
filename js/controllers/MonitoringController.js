/**
 * MonitoringController - Monitor islemlerini yonetir
 * OCP: Loopback ve normal monitor modlari ayri metodlarda
 * DIP: Bagimliliklar dependency injection ile alinir
 */
import eventBus from '../modules/EventBus.js';
import loopbackManager from '../modules/LoopbackManager.js';
import { DELAY } from '../modules/constants.js';
import { stopStreamTracks } from '../modules/utils.js';
import { requestStream } from '../modules/StreamHelper.js';

class MonitoringController {
  constructor() {
    // State
    this.loopbackLocalStream = null;

    // Dependency injection ile gelen fonksiyonlar
    this.deps = {
      getConstraints: () => ({}),
      getPipeline: () => 'direct',
      getEncoder: () => 'mediarecorder',
      getProcessingMode: () => 'direct', // Geriye uyumluluk
      isLoopbackEnabled: () => false,
      isWebAudioEnabled: () => false,
      getOpusBitrate: () => 64000,
      getTimeslice: () => 0,
      getBufferSize: () => 4096,
      getMediaBitrate: () => 0,
      // Modul referanslari
      monitor: null,
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
   */
  setDependencies(deps) {
    Object.assign(this.deps, deps);
  }

  /**
   * Monitor toggle
   */
  async toggle() {
    if (this.deps.getCurrentMode() === 'monitoring') {
      await this.stop();
    } else {
      await this.start();
    }
  }

  /**
   * Monitor baslat
   */
  async start() {
    const useWebAudio = this.deps.isWebAudioEnabled();
    const useLoopback = this.deps.isLoopbackEnabled();
    const constraints = this.deps.getConstraints();
    const pipeline = useWebAudio ? this.deps.getPipeline() : 'direct';
    const mediaBitrate = this.deps.getMediaBitrate();

    // Pipeline aciklamasi
    const pipelineDesc = this._buildPipelineDescription(useLoopback, pipeline, mediaBitrate);

    eventBus.emit('log:stream', {
      message: 'Monitor Baslat butonuna basildi',
      details: { constraints, webAudioEnabled: useWebAudio, loopbackEnabled: useLoopback, mediaBitrate, pipeline, pipelineDesc }
    });

    try {
      // Player'i durdur
      this.deps.player?.pause();

      // Preparing state
      this.deps.setIsPreparing(true);
      this.deps.uiStateManager?.updateButtonStates();
      this.deps.uiStateManager?.showPreparingState();

      if (useLoopback) {
        await this._startLoopbackMonitoring(constraints, pipeline);
      } else {
        await this._startNormalMonitoring(constraints, pipeline, mediaBitrate);
      }

    } catch (err) {
      eventBus.emit('log:error', { message: 'Monitor baslatilamadi', details: { error: err.message } });
      eventBus.emit('log', `❌ HATA: ${err.message}`);

      // Temizlik
      this.deps.setIsPreparing(false);
      this.deps.setCurrentMode(null);
      this.deps.uiStateManager?.updateButtonStates();
      this.deps.uiStateManager?.hidePreparingState();
      await loopbackManager.cleanupMonitorPlayback();
      await loopbackManager.cleanup();
      stopStreamTracks(this.loopbackLocalStream);
      this.loopbackLocalStream = null;
    }
  }

  /**
   * Loopback monitoring
   */
  async _startLoopbackMonitoring(constraints, pipeline) {
    eventBus.emit('log', '🔄 Loopback modunda monitor baslatiliyor...');

    // Mikrofon al (requestStream ile constraint mismatch kontrolu dahil)
    this.loopbackLocalStream = await requestStream(constraints);

    // WebRTC loopback kur
    const opusBitrate = this.deps.getOpusBitrate();
    const remoteStream = await loopbackManager.setup(this.loopbackLocalStream, {
      useWebAudio: this.deps.isWebAudioEnabled(),
      opusBitrate
    });

    // Remote stream'i hoparlore bagla
    await loopbackManager.startMonitorPlayback(remoteStream, {
      mode: pipeline,
      bufferSize: this.deps.getBufferSize()
    });

    // UI guncelle
    this.deps.setIsPreparing(false);
    this.deps.setCurrentMode('monitoring');
    this.deps.uiStateManager?.updateButtonStates();
    this.deps.uiStateManager?.hidePreparingState();

    // Events
    eventBus.emit('stream:started', this.loopbackLocalStream);  // Local VU Meter
    eventBus.emit('loopback:remoteStream', remoteStream);       // Remote VU Meter

    eventBus.emit('log', '🎧 Loopback monitor hazir');
  }

  /**
   * Normal monitoring (loopback kapali)
   */
  async _startNormalMonitoring(constraints, pipeline, mediaBitrate) {
    const monitor = this.deps.monitor;
    const useWebAudio = this.deps.isWebAudioEnabled();

    if (mediaBitrate > 0) {
      // CODEC-SIMULATED MODE
      const timeslice = this.deps.getTimeslice();
      const bufferSize = this.deps.getBufferSize();
      eventBus.emit('log', `🎙️ Codec-simulated monitor baslatiliyor (${pipeline} ${mediaBitrate} bps, ${timeslice}ms)...`);
      await monitor.startCodecSimulated(constraints, mediaBitrate, pipeline, timeslice, bufferSize);
    } else if (useWebAudio) {
      // WEBAUDIO MODE
      if (pipeline === 'direct') {
        await monitor.startDirect(constraints);
      } else if (pipeline === 'scriptprocessor') {
        await monitor.startScriptProcessor(constraints, this.deps.getBufferSize());
      } else if (pipeline === 'worklet') {
        await monitor.startAudioWorklet(constraints);
      } else {
        await monitor.startWebAudio(constraints);
      }
    } else {
      await monitor.startDirect(constraints);
    }

    // UI guncelle
    this.deps.setIsPreparing(false);
    this.deps.setCurrentMode('monitoring');
    this.deps.uiStateManager?.updateButtonStates();
    this.deps.uiStateManager?.hidePreparingState();
  }

  /**
   * Monitor durdur
   */
  async stop() {
    const useLoopback = this.deps.isLoopbackEnabled();

    eventBus.emit('log:stream', {
      message: 'Monitor durduruluyor',
      details: { loopbackEnabled: useLoopback }
    });

    if (useLoopback) {
      await this._stopLoopbackMonitoring();
    } else {
      await this.deps.monitor?.stop();
    }

    this.deps.setCurrentMode(null);
    this.deps.uiStateManager?.updateButtonStates();
  }

  /**
   * Loopback monitoring durdur
   */
  async _stopLoopbackMonitoring() {
    // Mode bilgisini al (cleanup oncesi)
    const stoppedMode = loopbackManager.monitorMode;

    // Loopback monitor playback temizle
    await loopbackManager.cleanupMonitorPlayback();

    // Local stream durdur
    stopStreamTracks(this.loopbackLocalStream);
    this.loopbackLocalStream = null;

    // WebRTC temizle
    await loopbackManager.cleanup();

    eventBus.emit('stream:stopped');
    eventBus.emit('log', '⏹️ Loopback monitor durduruldu');
    eventBus.emit('monitor:stopped', { mode: stoppedMode, loopback: true });
  }

  // === HELPER METODLAR ===

  _buildPipelineDescription(useLoopback, pipeline, mediaBitrate) {
    const delayStr = `${DELAY.DEFAULT_SECONDS}sn Delay`;
    const pipelineStr = pipeline === 'scriptprocessor' ? 'ScriptProcessor'
                      : pipeline === 'worklet' ? 'AudioWorklet'
                      : pipeline === 'direct' ? 'Direct'
                      : 'WebAudio';

    if (useLoopback) {
      return `WebRTC Loopback + ${pipelineStr} + ${delayStr} -> Speaker`;
    } else if (mediaBitrate > 0) {
      return `Codec-Simulated (${mediaBitrate}bps) + ${delayStr} -> Speaker`;
    } else {
      return `${pipelineStr} + ${delayStr} -> Speaker`;
    }
  }

  /**
   * Loopback local stream'e erisim (VuMeter icin)
   */
  getLoopbackLocalStream() {
    return this.loopbackLocalStream;
  }
}

// Singleton export
const monitoringController = new MonitoringController();
export default monitoringController;
