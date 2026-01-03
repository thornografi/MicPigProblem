/**
 * MonitoringController - Monitor islemlerini yonetir
 * OCP: Loopback ve normal monitor modlari ayri metodlarda
 * DIP: Bagimliliklar dependency injection ile alinir
 */
import eventBus from '../modules/EventBus.js';
import loopbackManager from '../modules/LoopbackManager.js';
import { DELAY, SIGNAL, AUDIO } from '../modules/constants.js';
import { stopStreamTracks, createAudioContext, getAudioContextOptions } from '../modules/utils.js';
import { requestStream } from '../modules/StreamHelper.js';

class MonitoringController {
  constructor() {
    // State
    this.loopbackLocalStream = null;

    // Dependency injection ile gelen fonksiyonlar
    this.deps = {
      getConstraints: () => ({}),
      getProcessingMode: () => 'direct',
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
    const monitorMode = useWebAudio ? this.deps.getProcessingMode() : 'direct';
    const mediaBitrate = this.deps.getMediaBitrate();

    // Pipeline aciklamasi
    const pipeline = this._buildPipelineDescription(useLoopback, monitorMode, mediaBitrate);

    eventBus.emit('log:stream', {
      message: 'Monitor Baslat butonuna basildi',
      details: { constraints, webAudioEnabled: useWebAudio, loopbackEnabled: useLoopback, mediaBitrate, monitorMode, pipeline }
    });

    try {
      // Player'i durdur
      this.deps.player?.pause();

      // Preparing state
      this.deps.setIsPreparing(true);
      this.deps.uiStateManager?.updateButtonStates();
      this.deps.uiStateManager?.showPreparingState();

      if (useLoopback) {
        await this._startLoopbackMonitoring(constraints, monitorMode);
      } else {
        await this._startNormalMonitoring(constraints, monitorMode, mediaBitrate);
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
  async _startLoopbackMonitoring(constraints, monitorMode) {
    eventBus.emit('log', '🔄 Loopback modunda monitor baslatiliyor...');

    // Mikrofon al (requestStream ile constraint mismatch kontrolu dahil)
    this.loopbackLocalStream = await requestStream(constraints);

    // WebRTC loopback kur
    const opusBitrate = this.deps.getOpusBitrate();
    const remoteStream = await loopbackManager.setup(this.loopbackLocalStream, {
      useWebAudio: this.deps.isWebAudioEnabled(),
      opusBitrate
    });

    // Dinamik sinyal bekleme - codec hazir olana kadar bekle
    const waited = await this._waitForSignal(remoteStream, opusBitrate);

    // Remote stream'i hoparlore bagla
    await loopbackManager.startMonitorPlayback(remoteStream, {
      mode: monitorMode,
      bufferSize: this.deps.getBufferSize()
    });

    // UI guncelle (sinyal algilandi, artik hazir)
    this.deps.setIsPreparing(false);
    this.deps.setCurrentMode('monitoring');
    this.deps.uiStateManager?.updateButtonStates();
    this.deps.uiStateManager?.hidePreparingState();

    // Events
    eventBus.emit('stream:started', this.loopbackLocalStream);  // Local VU Meter
    eventBus.emit('loopback:remoteStream', remoteStream);       // Remote VU Meter

    eventBus.emit('log', `🎧 Loopback monitor hazir (${waited}ms beklendi)`);
  }

  /**
   * Normal monitoring (loopback kapali)
   */
  async _startNormalMonitoring(constraints, monitorMode, mediaBitrate) {
    const monitor = this.deps.monitor;
    const useWebAudio = this.deps.isWebAudioEnabled();

    if (mediaBitrate > 0) {
      // CODEC-SIMULATED MODE
      const timeslice = this.deps.getTimeslice();
      const bufferSize = this.deps.getBufferSize();
      eventBus.emit('log', `🎙️ Codec-simulated monitor baslatiliyor (${monitorMode} ${mediaBitrate} bps, ${timeslice}ms)...`);
      await monitor.startCodecSimulated(constraints, mediaBitrate, monitorMode, timeslice, bufferSize);
    } else if (useWebAudio) {
      // WEBAUDIO MODE
      if (monitorMode === 'direct') {
        await monitor.startDirect(constraints);
      } else if (monitorMode === 'scriptprocessor') {
        await monitor.startScriptProcessor(constraints, this.deps.getBufferSize());
      } else if (monitorMode === 'worklet') {
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

  /**
   * Dinamik sinyal bekleme - WebRTC codec hazir olana kadar bekle
   * UI senkronizasyonu icin: Sinyal algilanmadan "monitoring" durumuna gecme
   */
  async _waitForSignal(remoteStream, opusBitrate) {
    const maxWait = SIGNAL.MAX_WAIT_MS;
    const pollInterval = SIGNAL.POLL_INTERVAL_MS;
    const signalThreshold = SIGNAL.RMS_THRESHOLD;
    let waited = 0;
    let signalDetected = false;
    let lastRms = 0;

    // Gecici AudioContext ve Analyser olustur
    const acOptions = getAudioContextOptions(remoteStream);
    const tempCtx = await createAudioContext(acOptions);
    const analyser = tempCtx.createAnalyser();
    analyser.fftSize = AUDIO.FFT_SIZE;
    const testArray = new Uint8Array(analyser.fftSize);

    // Remote stream'i analyser'a bagla
    const source = tempCtx.createMediaStreamSource(remoteStream);
    source.connect(analyser);

    eventBus.emit('log:webaudio', {
      message: `Loopback Monitor: Sinyal bekleniyor (max ${maxWait}ms)`,
      details: { opusBitrate: `${opusBitrate / 1000} kbps`, threshold: signalThreshold }
    });

    while (waited < maxWait && !signalDetected) {
      analyser.getByteTimeDomainData(testArray);
      let sum = 0;
      for (let i = 0; i < testArray.length; i++) {
        const val = (testArray[i] - 128) / 128;
        sum += val * val;
      }
      lastRms = Math.sqrt(sum / testArray.length);

      if (lastRms > signalThreshold) {
        signalDetected = true;
        break;
      }

      await new Promise(r => setTimeout(r, pollInterval));
      waited += pollInterval;
    }

    // Temizlik
    source.disconnect();
    await tempCtx.close();

    eventBus.emit('log:webaudio', {
      message: `Loopback Monitor: Sinyal bekleme tamamlandi - ${signalDetected ? '✅ SINYAL VAR' : '⚠️ TIMEOUT'}`,
      details: { rms: lastRms.toFixed(6), waited: `${waited}ms`, signalDetected }
    });

    return waited;
  }

  _buildPipelineDescription(useLoopback, monitorMode, mediaBitrate) {
    const delayStr = `${DELAY.DEFAULT_SECONDS}sn Delay`;
    const modeStr = monitorMode === 'scriptprocessor' ? 'ScriptProcessor'
                  : monitorMode === 'worklet' ? 'AudioWorklet'
                  : monitorMode === 'direct' ? 'Direct'
                  : 'WebAudio';

    if (useLoopback) {
      return `WebRTC Loopback + ${modeStr} + ${delayStr} -> Speaker`;
    } else if (mediaBitrate > 0) {
      return `Codec-Simulated (${mediaBitrate}bps) + ${delayStr} -> Speaker`;
    } else {
      return `${modeStr} + ${delayStr} -> Speaker`;
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
