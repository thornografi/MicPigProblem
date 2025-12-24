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
    this.barEl = document.getElementById(config.barId);
    this.peakEl = document.getElementById(config.peakId);
    this.dotEl = document.getElementById(config.dotId);

    this.analyser = null;
    this.animationId = null;
    this.peakLevel = 0;
    this.peakHoldTime = 0;
    this.dotState = 'idle'; // classList optimizasyonu icin state tracking

    // Performans: VU meter container genisligini cache'le (reflow onleme)
    this.meterWidth = this.peakEl?.parentElement?.offsetWidth || 200;

    // Event dinle
    eventBus.on('stream:started', (stream) => this.start(stream));
    eventBus.on('stream:stopped', () => this.stop());

    // Resize event'inde meter width'i guncelle
    window.addEventListener('resize', () => {
      this.meterWidth = this.peakEl?.parentElement?.offsetWidth || 200;
    });
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
      maxChannelCount: ac.destination.maxChannelCount,
      bufferSize: this.analyser.fftSize
    });

    eventBus.emit('vumeter:started');
  }

  update() {
    if (!this.analyser) return;

    // Performans: AudioEngine'den pre-allocated array kullan (GC onleme)
    const dataArray = audioEngine.getDataArray();
    this.analyser.getByteTimeDomainData(dataArray);

    // RMS hesapla
    let sum = 0;
    let maxSample = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = (dataArray[i] - 128) / 128;
      sum += val * val;
      maxSample = Math.max(maxSample, Math.abs(val));
    }
    const rms = Math.sqrt(sum / dataArray.length);

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

    this.animationId = requestAnimationFrame(() => this.update());
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
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

    eventBus.emit('vumeter:stopped');
  }

  getAudioContext() {
    return audioEngine.getContext();
  }
}

export default VuMeter;
