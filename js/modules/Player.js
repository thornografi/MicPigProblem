/**
 * Player - Kayit oynatma yonetimi
 * OCP: Farkli format destekleri eklenebilir
 */
import eventBus from './EventBus.js';
import { formatTime } from './utils.js';
import { BYTES } from './constants.js';

// Clean Code: Tekrarlayan SVG iconlari constant olarak
const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

// Clean Code: Magic strings yerine constants
const TIME_PLACEHOLDER = '0:00 / 0:00';
const UNKNOWN_DURATION = '--:--';

class Player {
  constructor(config) {
    this.containerEl = document.getElementById(config.containerId);
    this.playBtnEl = document.getElementById(config.playBtnId);
    this.progressBarEl = document.getElementById(config.progressBarId);
    this.progressFillEl = document.getElementById(config.progressFillId);
    this.timeEl = document.getElementById(config.timeId);
    this.filenameEl = document.getElementById(config.filenameId);
    this.metaEl = document.getElementById(config.metaId);
    this.downloadBtnEl = document.getElementById(config.downloadBtnId);
    this.noRecordingEl = document.getElementById(config.noRecordingId);

    this.audio = new Audio();
    this.isPlaying = false;
    this.currentBlob = null;
    this.currentUrl = null;
    this.knownDurationSeconds = null;

    this.bindEvents();

    // Event dinle
    eventBus.on('recording:completed', (data) => this.load(data));
    eventBus.on('recording:started', () => this.reset());
  }

  bindEvents() {
    if (this.playBtnEl) {
      this.playBtnEl.onclick = () => this.togglePlay();
    }

    if (this.progressBarEl) {
      this.progressBarEl.onclick = (e) => this.seek(e);
    }

    this.audio.ontimeupdate = () => this.updateProgress();
    this.audio.onended = () => this.onEnded();
    this.audio.onloadedmetadata = () => this.onLoaded();
    // WebM dosyalarinda duration bazen gecikebilir
    this.audio.ondurationchange = () => this.onDurationChange();
  }

  load(data) {
    const { blob, mimeType, filename } = data;

    // Onceki URL'i temizle
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
    }

    this.currentBlob = blob;
    this.knownDurationSeconds = null;
    this.currentUrl = URL.createObjectURL(blob);

    this.audio.src = this.currentUrl;

    // Yeni kayit yuklenince progress'i sifirla (aksi halde onceki kayittan kalan doluluk gorunebilir)
    if (this.progressFillEl) {
      this.progressFillEl.style.transform = 'scaleX(0)';
    }

    if (this.filenameEl) {
      this.filenameEl.textContent = filename;
    }

    if (this.metaEl) {
      this.metaEl.textContent = `${(blob.size / BYTES.PER_KB).toFixed(1)} KB - ${mimeType} - Süre: ${UNKNOWN_DURATION}`;
    }

    if (this.downloadBtnEl) {
      this.downloadBtnEl.href = this.currentUrl;
      this.downloadBtnEl.download = filename;
    }

    if (this.containerEl) {
      this.containerEl.classList.add('visible');
    }

    if (this.noRecordingEl) {
      this.noRecordingEl.style.display = 'none';
    }

    // Duration bazen metadata ile gec gelir (webm/opus). Play'e basmadan sureyi gostermek icin probe et.
    this.probeDuration(blob, mimeType).catch((err) => {
      eventBus.emit('log:error', {
        message: 'Player: duration probe hatasi (kritik degil)',
        details: { error: err.message }
      });
    });

    eventBus.emit('player:loaded', { filename, size: blob.size });
  }

  reset() {
    // Oynatmayi durdur
    this.audio.pause();
    this.audio.src = '';
    this.isPlaying = false;
    this.knownDurationSeconds = null;

    // URL temizle
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
    this.currentBlob = null;

    // UI sifirla
    if (this.containerEl) {
      this.containerEl.classList.remove('visible');
    }

    if (this.progressFillEl) {
      this.progressFillEl.style.transform = 'scaleX(0)';
    }

    if (this.timeEl) {
      this.timeEl.textContent = TIME_PLACEHOLDER;
    }

    if (this.playBtnEl) {
      this.playBtnEl.innerHTML = PLAY_ICON;
    }

    if (this.noRecordingEl) {
      this.noRecordingEl.style.display = 'block';
    }

    eventBus.emit('player:reset');
  }

  async probeDuration(blob, mimeType) {
    // 1) Metadata'dan gelirse kullan
    await new Promise((resolve) => {
      const onMeta = () => resolve();
      const onErr = () => resolve();
      this.audio.addEventListener('loadedmetadata', onMeta, { once: true });
      this.audio.addEventListener('durationchange', onMeta, { once: true });
      this.audio.addEventListener('error', onErr, { once: true });

      // Metadata zaten gelmis olabilir
      if (this.hasValidDuration()) {
        resolve();
      }
    });

    if (this.hasValidDuration()) {
      this.knownDurationSeconds = this.audio.duration;
      this.updateDurationUI(mimeType, blob.size, this.audio.duration);
      return;
    }

    // 2) Fallback: decodeAudioData ile sureyi hesapla (play'e basmadan)
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    const arrayBuffer = await blob.arrayBuffer();
    const ac = new AudioContextCtor();
    try {
      const decoded = await ac.decodeAudioData(arrayBuffer.slice(0));
      const durationSeconds = decoded?.duration;
      if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
        this.knownDurationSeconds = durationSeconds;
        this.updateDurationUI(mimeType, blob.size, durationSeconds);
      }
    } finally {
      try {
        await ac.close();
      } catch {
        // ignore
      }
    }
  }

  updateDurationUI(mimeType, sizeBytes, durationSeconds) {
    if (this.timeEl) {
      this.timeEl.textContent = `0:00 / ${formatTime(durationSeconds)}`;
    }

    if (this.metaEl) {
      this.metaEl.textContent = `${(sizeBytes / BYTES.PER_KB).toFixed(1)} KB - ${mimeType} - Süre: ${formatTime(durationSeconds)}`;
    }
  }

  pause() {
    if (!this.isPlaying) return;

    this.audio.pause();
    this.isPlaying = false;

    if (this.playBtnEl) {
      this.playBtnEl.innerHTML = PLAY_ICON;
    }

    eventBus.emit('player:paused');
  }

  togglePlay() {
    if (this.isPlaying) {
      this.audio.pause();
      this.playBtnEl.innerHTML = PLAY_ICON;
      this.isPlaying = false;
    } else {
      this.audio.play();
      this.playBtnEl.innerHTML = PAUSE_ICON;
      this.isPlaying = true;
    }
  }

  seek(e) {
    const duration = this.audio.duration;
    // Gecersiz duration'da seek yapma
    if (!isFinite(duration) || isNaN(duration) || duration <= 0) return;

    const rect = this.progressBarEl.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    this.audio.currentTime = percent * duration;
  }

  updateProgress() {
    const duration = this.audio.duration;
    const currentTime = this.audio.currentTime;

    // Gecersiz duration kontrolu
    if (!isFinite(duration) || isNaN(duration) || duration <= 0) {
      // Duration gec geliyorsa (webm) eski doluluk gorunmesin
      const fallbackDuration = this.knownDurationSeconds;
      if (this.progressFillEl) {
        if (Number.isFinite(fallbackDuration) && fallbackDuration > 0) {
          const progress = Math.max(0, Math.min(1, currentTime / fallbackDuration));
          this.progressFillEl.style.transform = `scaleX(${progress})`;
        } else {
          this.progressFillEl.style.transform = 'scaleX(0)';
        }
      }
      if (this.timeEl) {
        this.timeEl.textContent = `${formatTime(currentTime)} / ${UNKNOWN_DURATION}`;
      }
      return;
    }

    const progress = currentTime / duration;

    if (this.progressFillEl) {
      this.progressFillEl.style.transform = `scaleX(${progress})`;
    }

    if (this.timeEl) {
      this.timeEl.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    }
  }

  onEnded() {
    if (this.playBtnEl) {
      this.playBtnEl.innerHTML = PLAY_ICON;
    }
    this.isPlaying = false;

    if (this.progressFillEl) {
      this.progressFillEl.style.transform = 'scaleX(0)';
    }

    eventBus.emit('player:ended');
  }

  onLoaded() {
    this.updateDurationDisplay();
  }

  onDurationChange() {
    this.updateDurationDisplay();
  }

  updateDurationDisplay() {
    if (this.timeEl) {
      const duration = this.audio.duration;
      // Infinity veya NaN kontrolu
      if (!isFinite(duration) || isNaN(duration)) {
        const fallback = this.knownDurationSeconds ? formatTime(this.knownDurationSeconds) : UNKNOWN_DURATION;
        this.timeEl.textContent = `0:00 / ${fallback}`;
      } else {
        this.timeEl.textContent = `0:00 / ${formatTime(duration)}`;
      }
    }
  }

  // Gecerli duration kontrolu
  hasValidDuration() {
    return isFinite(this.audio.duration) && !isNaN(this.audio.duration) && this.audio.duration > 0;
  }
}

export default Player;
