/**
 * VuMeter - Ses seviyesi gostergesi
 * OCP: Farkli gorsellestirme modlari eklenebilir
 *
 * Pre-init: AudioEngine'den hazir context ve analyser kullanir
 */
import eventBus from './EventBus.js';
import audioEngine from './AudioEngine.js';

class VuMeter {
  constructor(config) {
    // Local (mic) VU meter elementleri
    this.barEl = document.getElementById(config.barId);
    this.peakEl = document.getElementById(config.peakId);
    this.dotEl = document.getElementById(config.dotId);

    // Remote (codec sonrasi) VU meter elementleri (opsiyonel)
    this.remoteBarEl = document.getElementById(config.remoteBarId || 'remoteVuBar');
    this.remotePeakEl = document.getElementById(config.remotePeakId || 'remoteVuPeak');
    this.remoteContainerEl = document.getElementById('remoteVuContainer');

    this.analyser = null;
    this.remoteAnalyser = null; // Remote stream icin ayri analyser
    this.remoteAudioCtx = null; // Remote stream icin ayri AudioContext
    this.remoteSourceNode = null;
    this.animationId = null;
    this.peakLevel = 0;
    this.remotePeakLevel = 0;
    this.peakHoldTime = 0;
    this.remotePeakHoldTime = 0;
    this.dotState = 'idle'; // classList optimizasyonu icin state tracking

    // Performans: VU meter container genisligini cache'le (reflow onleme)
    this.meterWidth = this.peakEl?.parentElement?.offsetWidth || 200;
    this.remoteMeterWidth = this.remotePeakEl?.parentElement?.offsetWidth || 200;

    // Event dinle
    eventBus.on('stream:started', (stream) => this.start(stream));
    eventBus.on('stream:stopped', () => this.stop());
    eventBus.on('loopback:remoteStream', (stream) => this.startRemote(stream));

    // Resize event'inde meter width'i guncelle
    // Memory leak fix: Named handler, stop()'ta removeEventListener icin
    this.resizeHandler = () => {
      this.meterWidth = this.peakEl?.parentElement?.offsetWidth || 200;
      this.remoteMeterWidth = this.remotePeakEl?.parentElement?.offsetWidth || 200;
    };
    window.addEventListener('resize', this.resizeHandler);
  }

  async start(stream) {
    if (!stream) return;

    // AudioEngine'den hazir analyser al (pre-init sayesinde hizli)
    this.analyser = await audioEngine.connectStream(stream);
    this.update();

    // AudioContext bilgisini gonder
    const ac = audioEngine.getContext();
    eventBus.emit('vumeter:audiocontext', {
      sampleRate: ac.sampleRate,
      baseLatency: ac.baseLatency,
      outputLatency: ac.outputLatency,
      state: ac.state,
      fftSize: this.analyser.fftSize
    });

    eventBus.emit('vumeter:started');
  }

  /**
   * Remote stream (codec sonrasi) icin VU meter baslat
   * Loopback modunda WebRTC'den gelen sesi gosterir
   */
  async startRemote(stream) {
    if (!stream) return;

    // Remote container'i goster
    if (this.remoteContainerEl) {
      this.remoteContainerEl.style.display = 'block';
    }

    try {
      // Remote stream icin ayri AudioContext (cakisma onleme)
      this.remoteAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.remoteAudioCtx.state === 'suspended') {
        await this.remoteAudioCtx.resume();
      }

      this.remoteSourceNode = this.remoteAudioCtx.createMediaStreamSource(stream);
      this.remoteAnalyser = this.remoteAudioCtx.createAnalyser();
      this.remoteAnalyser.fftSize = 256;
      this.remoteSourceNode.connect(this.remoteAnalyser);

      eventBus.emit('log:stream', {
        message: 'VU Meter: Remote stream baglandi',
        details: { streamId: stream.id }
      });
    } catch (err) {
      eventBus.emit('log:error', {
        message: 'VU Meter: Remote stream baglanti hatasi',
        details: { error: err.message }
      });
    }
  }

  stopRemote() {
    if (this.remoteAnalyser) {
      this.remoteAnalyser = null;
    }
    if (this.remoteSourceNode) {
      this.remoteSourceNode.disconnect();
      this.remoteSourceNode = null;
    }
    if (this.remoteAudioCtx) {
      this.remoteAudioCtx.close().catch(() => {});
      this.remoteAudioCtx = null;
    }

    // Remote VU elementlerini sifirla
    if (this.remoteBarEl) this.remoteBarEl.style.transform = 'scaleX(0)';
    if (this.remotePeakEl) this.remotePeakEl.style.transform = 'translateX(0)';
    if (this.remoteContainerEl) this.remoteContainerEl.style.display = 'none';

    this.remotePeakLevel = 0;
  }

  // DRY: RMS hesaplama (update ve updateRemote icin ortak)
  calculateRMS(dataArray) {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = (dataArray[i] - 128) / 128;
      sum += val * val;
    }
    return Math.sqrt(sum / dataArray.length);
  }

  update() {
    if (!this.analyser) return;

    // Performans: AudioEngine'den pre-allocated array kullan (GC onleme)
    const dataArray = audioEngine.getDataArray();
    this.analyser.getByteTimeDomainData(dataArray);

    // RMS ve maxSample hesapla
    const rms = this.calculateRMS(dataArray);
    let maxSample = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = Math.abs((dataArray[i] - 128) / 128);
      if (val > maxSample) maxSample = val;
    }

    // dB hesapla (logaritmik skala)
    // -60dB = 0%, 0dB = 100%
    const dB = rms > 0.0001 ? 20 * Math.log10(rms) : -60;
    const level = Math.max(0, Math.min(100, (dB + 60) / 60 * 100));

    // Peak dB (clipping tespiti icin)
    const peakdB = maxSample > 0.0001 ? 20 * Math.log10(maxSample) : -60;
    const isClipping = peakdB >= -0.5; // -0.5dB ustu = clipping riski

    // Bar guncelle - transform kullan (GPU accelerated, reflow yok)
    if (this.barEl) {
      this.barEl.style.transform = `scaleX(${level / 100})`;
    }

    // Peak hold
    if (level > this.peakLevel) {
      this.peakLevel = level;
      this.peakHoldTime = Date.now();
    } else if (Date.now() - this.peakHoldTime > 1000) {
      this.peakLevel = Math.max(level, this.peakLevel - 2);
    }

    // Peak indicator - translateX kullan (GPU accelerated)
    if (this.peakEl) {
      const peakX = (this.peakLevel / 100) * this.meterWidth;
      this.peakEl.style.transform = `translateX(${peakX}px)`;
    }

    // Sinyal noktasi - sadece state degisince guncelle (gereksiz classList islemlerini onle)
    const newDotState = isClipping ? 'clipping' : (level > 5 ? 'active' : 'idle');
    if (this.dotEl && this.dotState !== newDotState) {
      // Tek seferde className set et (classList.add/remove'dan daha hizli)
      this.dotEl.className = 'signal-dot' + (newDotState !== 'idle' ? ' ' + newDotState : '');
      this.dotState = newDotState;
    }

    // Level event'i gonder (diger moduller kullanabilir)
    eventBus.emit('vumeter:level', {
      level,
      peak: this.peakLevel,
      dB: dB.toFixed(1),
      peakdB: peakdB.toFixed(1),
      isClipping
    });

    // Remote stream (codec sonrasi) VU meter guncelle
    this.updateRemote();

    this.animationId = requestAnimationFrame(() => this.update());
  }

  /**
   * Remote stream VU meter guncelle (loopback modunda)
   */
  updateRemote() {
    if (!this.remoteAnalyser) return;

    // Remote stream icin ayri dataArray (GC'den kacinmak icin cache'le)
    if (!this.remoteDataArray) {
      this.remoteDataArray = new Uint8Array(this.remoteAnalyser.frequencyBinCount);
    }
    this.remoteAnalyser.getByteTimeDomainData(this.remoteDataArray);

    // DRY: Ortak RMS hesaplama fonksiyonu kullan
    const rms = this.calculateRMS(this.remoteDataArray);

    // dB ve level hesapla
    const dB = rms > 0.0001 ? 20 * Math.log10(rms) : -60;
    const remoteLevel = Math.max(0, Math.min(100, (dB + 60) / 60 * 100));

    // Remote bar guncelle
    if (this.remoteBarEl) {
      this.remoteBarEl.style.transform = `scaleX(${remoteLevel / 100})`;
    }

    // Remote peak hold
    if (remoteLevel > this.remotePeakLevel) {
      this.remotePeakLevel = remoteLevel;
      this.remotePeakHoldTime = Date.now();
    } else if (Date.now() - this.remotePeakHoldTime > 1000) {
      this.remotePeakLevel = Math.max(remoteLevel, this.remotePeakLevel - 2);
    }

    // Remote peak indicator
    if (this.remotePeakEl) {
      const peakX = (this.remotePeakLevel / 100) * this.remoteMeterWidth;
      this.remotePeakEl.style.transform = `translateX(${peakX}px)`;
    }
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    // Memory leak fix: Resize listener temizle
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
    }

    // Transform'lari sifirla (GPU accelerated)
    if (this.barEl) this.barEl.style.transform = 'scaleX(0)';
    if (this.peakEl) this.peakEl.style.transform = 'translateX(0)';
    if (this.dotEl) {
      this.dotEl.className = 'signal-dot';
      this.dotState = 'idle';
    }

    this.peakLevel = 0;

    // AudioEngine'den disconnect (context acik kalir - tekrar hizli baslatma icin)
    audioEngine.disconnect();
    this.analyser = null;

    // Remote stream'i de temizle
    this.stopRemote();

    eventBus.emit('vumeter:stopped');
  }

  getAudioContext() {
    return audioEngine.getContext();
  }
}

export default VuMeter;
