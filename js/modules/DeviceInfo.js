/**
 * DeviceInfo - Cihaz ve AudioContext bilgisi gostergesi
 * VuMeter'dan gelen dB verilerini ve AudioContext durumunu gosterir
 *
 * Panel her zaman gorunur - baslangicta varsayilan degerler gosterilir
 */
import eventBus from './EventBus.js';
import audioEngine from './AudioEngine.js';

class DeviceInfo {
  constructor() {
    // UI elementleri
    this.panelEl = document.getElementById('deviceInfoPanel');
    this.sampleRateEl = document.getElementById('infoSampleRate');
    this.baseLatencyEl = document.getElementById('infoBaseLatency');
    this.outputLatencyEl = document.getElementById('infoOutputLatency');
    this.channelsEl = document.getElementById('infoChannels');
    this.contextStateEl = document.getElementById('infoContextState');
    this.fftSizeEl = document.getElementById('infoFftSize');

    // dB display elementleri
    this.dbRmsEl = document.getElementById('dbValueRms');
    this.dbPeakEl = document.getElementById('dbValuePeak');
    this.clippingStatusEl = document.getElementById('clippingStatus');

    // Panel her zaman gorunur
    this.showPanel();

    // Event dinleyiciler
    eventBus.on('vumeter:level', (data) => this.updateLevels(data));
    eventBus.on('vumeter:audiocontext', (data) => this.updateFromAudioContext(data));
    eventBus.on('stream:started', (stream) => this.updateStreamInfo(stream));
  }

  /**
   * Baslangicta AudioContext bilgilerini yukle
   * AudioEngine pre-warm edildikten sonra cagrilmali
   */
  async initFromAudioEngine() {
    // AudioEngine pre-warmed ise degerlerini al
    const ac = audioEngine.getContext();
    const analyser = audioEngine.getAnalyser();
    if (ac) {
      this.updateFromAudioContext({
        sampleRate: ac.sampleRate,
        baseLatency: ac.baseLatency,
        outputLatency: ac.outputLatency,
        state: ac.state,
        fftSize: analyser?.fftSize || 256
      });
    }
  }

  updateFromAudioContext(data) {
    const { sampleRate, baseLatency, outputLatency, state, fftSize } = data;

    // Sample rate
    if (this.sampleRateEl) {
      this.sampleRateEl.textContent = `${sampleRate} Hz`;
    }

    // Base latency
    if (this.baseLatencyEl) {
      if (baseLatency !== undefined) {
        const ms = (baseLatency * 1000).toFixed(1);
        this.baseLatencyEl.textContent = `${ms} ms`;
        this.baseLatencyEl.className = 'device-info-value';
        if (baseLatency > 0.05) this.baseLatencyEl.classList.add('warning');
        if (baseLatency > 0.1) this.baseLatencyEl.classList.add('danger');
      } else {
        this.baseLatencyEl.textContent = 'N/A';
      }
    }

    // Output latency (0 veya undefined ise N/A - bazi tarayicilar desteklemiyor)
    if (this.outputLatencyEl) {
      if (outputLatency !== undefined && outputLatency > 0) {
        const ms = (outputLatency * 1000).toFixed(1);
        this.outputLatencyEl.textContent = `${ms} ms`;
        this.outputLatencyEl.className = 'device-info-value';
        if (outputLatency > 0.05) this.outputLatencyEl.classList.add('warning');
        if (outputLatency > 0.1) this.outputLatencyEl.classList.add('danger');
      } else {
        this.outputLatencyEl.textContent = 'N/A';
      }
    }

    // Context state
    if (this.contextStateEl) {
      this.contextStateEl.textContent = state;
      this.contextStateEl.className = 'device-info-value';
      if (state === 'running') {
        this.contextStateEl.classList.add('good');
      } else if (state === 'suspended') {
        this.contextStateEl.classList.add('warning');
      } else {
        this.contextStateEl.classList.add('danger');
      }
    }

    // Channels - baslangicta "--", gercek deger stream:started'da gelecek
    if (this.channelsEl && this.channelsEl.textContent === '--') {
      // Henuz stream baslamadi, varsayilan olarak "--" kalsin
    }

    // FFT Size (VU meter analiz boyutu)
    if (this.fftSizeEl) {
      this.fftSizeEl.textContent = fftSize.toString();
    }
  }

  showPanel() {
    if (this.panelEl) {
      this.panelEl.classList.add('visible');
    }
  }

  // hidePanel kaldirildi - panel her zaman gorunur kalacak

  updateLevels(data) {
    const { dB, peakdB, isClipping } = data;

    // RMS dB guncelle
    if (this.dbRmsEl) {
      this.dbRmsEl.textContent = `${dB} dB`;
      this.dbRmsEl.className = 'db-value';
      if (parseFloat(dB) > -6) {
        this.dbRmsEl.classList.add('warning');
      }
      if (parseFloat(dB) > -3) {
        this.dbRmsEl.classList.add('clipping');
      }
    }

    // Peak dB guncelle
    if (this.dbPeakEl) {
      this.dbPeakEl.textContent = `${peakdB} dB`;
      this.dbPeakEl.className = 'db-value';
      if (parseFloat(peakdB) > -6) {
        this.dbPeakEl.classList.add('warning');
      }
      if (parseFloat(peakdB) > -1) {
        this.dbPeakEl.classList.add('clipping');
      }
    }

    // Clipping status guncelle
    if (this.clippingStatusEl) {
      if (isClipping) {
        this.clippingStatusEl.textContent = 'CLIP!';
        this.clippingStatusEl.className = 'db-value danger';
      } else if (parseFloat(peakdB) > -6) {
        this.clippingStatusEl.textContent = 'HOT';
        this.clippingStatusEl.className = 'db-value warning';
      } else {
        this.clippingStatusEl.textContent = 'OK';
        this.clippingStatusEl.className = 'db-value good';
      }
    }
  }

  resetLevels() {
    if (this.dbRmsEl) {
      this.dbRmsEl.textContent = '-60 dB';
      this.dbRmsEl.className = 'db-value';
    }
    if (this.dbPeakEl) {
      this.dbPeakEl.textContent = '-60 dB';
      this.dbPeakEl.className = 'db-value';
    }
    if (this.clippingStatusEl) {
      this.clippingStatusEl.textContent = 'OK';
      this.clippingStatusEl.className = 'db-value good';
    }
  }

  updateStreamInfo(stream) {
    if (!stream) return;

    const track = stream.getAudioTracks()[0];
    if (!track) return;

    const settings = track.getSettings();

    // Mikrofon kanal sayisi (track settings'ten al)
    if (this.channelsEl) {
      this.channelsEl.textContent = settings.channelCount || '1';
    }

    // Sample rate (track varsa onu kullan, yoksa AudioContext kalsin)
    if (this.sampleRateEl && settings.sampleRate) {
      this.sampleRateEl.textContent = `${settings.sampleRate} Hz`;
    }
  }
}

export default DeviceInfo;
