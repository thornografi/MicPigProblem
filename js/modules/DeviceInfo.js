/**
 * DeviceInfo - Ses Durumu Paneli
 * 2 bolum: Cihaz (mikrofon, kanal), Codec (bitrate)
 * Stream baslangicinda ve profil degisikliginde guncellenir
 */
import eventBus from './EventBus.js';

class DeviceInfo {
  constructor() {
    // UI elementleri - Cihaz bolumu
    this.panelEl = document.getElementById('deviceInfoPanel');
    this.micNameEl = document.getElementById('infoMicName');
    this.channelsEl = document.getElementById('infoChannels');

    // UI elementleri - Codec bolumu
    this.targetBitrateEl = document.getElementById('infoTargetBitrate');
    this.actualBitrateEl = document.getElementById('infoActualBitrate');

    // Panel her zaman gorunur
    this.showPanel();

    // Event dinleyiciler
    eventBus.on('stream:started', (stream) => this.updateStreamInfo(stream));
    eventBus.on('profile:changed', (data) => this.updateTargetBitrate(data));
    eventBus.on('loopback:stats', (stats) => this.updateActualBitrate(stats));
  }

  /**
   * Hedef bitrate guncelle (profil degistiginde)
   */
  updateTargetBitrate(data) {
    if (!this.targetBitrateEl) return;

    const { profile, values, category } = data;

    // Loopback durumuna gore bitrate secimi:
    // - loopback ON: bitrate (WebRTC Opus) - sesli gorusme/monitoring
    // - loopback OFF: mediaBitrate (MediaRecorder) - kayit
    // NOT: Kategori degil, gercek loopback durumu onemli (Ham Kayit'ta dinamik degisebilir)
    let bitrate;
    if (values?.loopback === true) {
      bitrate = values?.bitrate;
    } else {
      bitrate = values?.mediaBitrate;
    }

    if (bitrate && bitrate > 0) {
      const kbps = Math.round(bitrate / 1000);
      this.targetBitrateEl.textContent = `${kbps} kbps`;
    } else {
      this.targetBitrateEl.textContent = 'N/A';
    }
  }

  /**
   * Gercek bitrate guncelle (WebRTC stats'tan)
   */
  updateActualBitrate(stats) {
    if (!this.actualBitrateEl) return;

    if (stats && stats.actualBitrate !== undefined) {
      const kbps = Math.round(stats.actualBitrate / 1000);
      this.actualBitrateEl.textContent = `${kbps} kbps`;
    } else {
      this.actualBitrateEl.textContent = '--';
    }
  }

  showPanel() {
    if (this.panelEl) {
      this.panelEl.classList.add('visible');
    }
  }

  updateStreamInfo(stream) {
    if (!stream) return;

    const track = stream.getAudioTracks()[0];
    if (!track) return;

    const settings = track.getSettings();

    // Mikrofon adi (Cihaz bolumu)
    if (this.micNameEl) {
      // Track label mikrofon adini icerir
      const label = track.label || 'Bilinmiyor';
      // Uzun isimleri kisalt
      this.micNameEl.textContent = label.length > 25 ? label.substring(0, 22) + '...' : label;
      this.micNameEl.title = label; // Tam isim tooltip olarak
    }

    // Mikrofon kanal sayisi (Cihaz bolumu)
    if (this.channelsEl) {
      const count = settings.channelCount || 1;
      this.channelsEl.textContent = count === 1 ? 'Mono' : 'Stereo';
    }
  }

  /**
   * Panel degerlerini sifirla
   */
  resetPanel() {
    if (this.micNameEl) this.micNameEl.textContent = '--';
    if (this.channelsEl) this.channelsEl.textContent = '--';
    if (this.targetBitrateEl) this.targetBitrateEl.textContent = '--';
    if (this.actualBitrateEl) this.actualBitrateEl.textContent = '--';
  }
}

export default DeviceInfo;
