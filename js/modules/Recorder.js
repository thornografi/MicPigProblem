/**
 * Recorder - Ses kaydi yonetimi
 * OCP: Pipeline Strategy Pattern ile farkli kayit modlari eklenebilir
 * WebAudio mode: Stream -> AudioContext -> MediaStreamDestination -> MediaRecorder
 */
import eventBus from './EventBus.js';
import { requestStream } from './StreamHelper.js';
import { createAudioContext, getAudioContextOptions, stopStreamTracks, createMediaRecorder, usesWebAudio, usesWasmOpus, usesMediaRecorder } from './utils.js';
import { BUFFER, bytesToKB } from './constants.js';
import { createPipeline, isPipelineSupported } from '../pipelines/PipelineFactory.js';

class Recorder {
  constructor(config) {
    this.constraints = config.constraints || {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };

    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.isRecording = false;

    // WebAudio components
    this.audioContext = null;
    this.sourceNode = null;
    this.destinationNode = null;

    // Pipeline Strategy (OCP: Strategy Pattern)
    this.pipelineStrategy = null;

    // Pipeline: WebAudio graph tipi (direct | standard | scriptprocessor | worklet)
    // Encoder: Kayit formati (mediarecorder | wasm-opus)
    this.pipelineType = 'direct';
    this.encoder = 'mediarecorder';
    this.startTime = null; // Kayit baslangic zamani (bitrate hesaplama icin)

    // Pre-warm state
    this.isWarmedUp = false;
  }

  /**
   * WebAudio modu icin AudioContext'i onceden olustur
   * Sayfa yuklenince cagrilabilir - Start aninda hiz kazandirir
   */
  async warmup() {
    if (this.isWarmedUp || this.audioContext) {
      return;
    }

    try {
      // DRY: factory kullan
      this.audioContext = await createAudioContext();

      // Destination node'u da onceden olustur
      this.destinationNode = this.audioContext.createMediaStreamDestination();

      this.isWarmedUp = true;

      eventBus.emit('log:webaudio', {
        message: 'Recorder: WebAudio warmup tamamlandi',
        details: {
          state: this.audioContext.state,
          sampleRate: this.audioContext.sampleRate
        }
      });
    } catch (err) {
      eventBus.emit('log:error', {
        message: 'Recorder: Warmup hatasi',
        details: { error: err.message }
      });
    }
  }

  async start(constraints, pipelineParam = 'direct', encoderParam = 'mediarecorder', timeslice = 0, bufferSize = BUFFER.DEFAULT_SIZE, mediaBitrate = 0) {
    if (this.isRecording) return;

    // Pipeline ve encoder validasyonu (OCP: PipelineFactory destekli kontrol)
    const allowedEncoders = new Set(['mediarecorder', 'wasm-opus']);
    this.pipelineType = isPipelineSupported(pipelineParam) ? pipelineParam : 'direct';
    this.encoder = allowedEncoders.has(encoderParam) ? encoderParam : 'mediarecorder';
    this.timeslice = timeslice;
    this.mediaBitrate = mediaBitrate; // Hedef bitrate (MediaRecorder veya WASM Opus icin)

    try {
      this.stream = await requestStream(constraints);
      this.chunks = [];

      // Stream event'i gonder (VuMeter dinler)
      eventBus.emit('stream:started', this.stream);

      let recordStream = this.stream;

      // Pipeline ve encoder bazli kontroller (DRY: utils.js helper'lari)
      const needsWebAudioGraph = usesWebAudio(this.pipelineType);
      const needsMediaRecorder = usesMediaRecorder(this.encoder);

      // WebAudio-based modes: Stream -> (WebAudio graph) -> Destination -> MediaRecorder/WASM
      if (needsWebAudioGraph) {
        eventBus.emit('log:webaudio', {
          message: 'Kayit pipeline modu aktif',
          details: { pipeline: this.pipelineType, encoder: this.encoder, preWarmed: this.isWarmedUp }
        });

        // AudioContext olustur/hazirla
        await this._ensureAudioContext();

        // Source node - mikrofondan gelen stream
        this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);

        eventBus.emit('log:webaudio', {
          message: 'MediaStreamAudioSourceNode olusturuldu',
          details: {
            channelCount: this.sourceNode.channelCount,
            channelCountMode: this.sourceNode.channelCountMode
          }
        });

        // Destination node - pre-warm yapilmamissa olustur
        if (!this.destinationNode) {
          this.destinationNode = this.audioContext.createMediaStreamDestination();
          eventBus.emit('log:webaudio', {
            message: 'MediaStreamAudioDestinationNode olusturuldu',
            details: {
              channelCount: this.destinationNode.channelCount,
              streamId: this.destinationNode.stream.id
            }
          });
        }

        // ═══════════════════════════════════════════════════════════════
        // PIPELINE KURULUMU (OCP: Strategy Pattern)
        // ═══════════════════════════════════════════════════════════════
        this.pipelineStrategy = createPipeline(
          this.pipelineType,
          this.audioContext,
          this.sourceNode,
          this.destinationNode
        );

        await this.pipelineStrategy.setup({
          bufferSize,
          encoder: this.encoder,
          mediaBitrate
        });

        // MediaRecorder icin WebAudio'dan gelen stream'i kullan
        if (needsMediaRecorder) {
          recordStream = this.destinationNode.stream;
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // ENCODER KURULUMU (MediaRecorder veya WASM Opus)
      // ═══════════════════════════════════════════════════════════════
      if (needsMediaRecorder) {
        await this._setupMediaRecorder(recordStream);
      } else {
        // WASM Opus encoder modu - MediaRecorder yok
        this.startTime = Date.now();
        const opusWorker = this.pipelineStrategy?.getOpusWorker?.();
        eventBus.emit('log:recorder', {
          message: 'WASM Opus encoder aktif (MediaRecorder kullanilmiyor)',
          details: {
            pipeline: this.pipelineType,
            encoder: this.encoder,
            encoderType: opusWorker?.encoderType || 'unknown'
          }
        });
      }

      this.isRecording = true;

      // Pipeline + Encoder kombinasyonuna gore label (DRY: Config.js labels kullanilabilir)
      const pipelineLabels = {
        direct: 'Direct',
        standard: 'Standard',
        scriptprocessor: 'ScriptProcessor',
        worklet: 'AudioWorklet'
      };
      const encoderLabels = {
        mediarecorder: 'MediaRecorder',
        'wasm-opus': 'WASM Opus'
      };
      const pipelineLabel = pipelineLabels[this.pipelineType] || this.pipelineType;
      const encoderLabel = encoderLabels[this.encoder] || this.encoder;
      const modeText = `${pipelineLabel} + ${encoderLabel}`;
      const timesliceText = this.timeslice > 0 ? `, Timeslice: ${this.timeslice}ms` : '';
      eventBus.emit('log', `KAYIT basladi (${modeText}${timesliceText})`);
      eventBus.emit('recorder:started');
      eventBus.emit('recording:started');

    } catch (err) {
      // Spesifik hata mesajlari
      const userMessage = this._getErrorMessage(err);

      eventBus.emit('log:error', {
        category: 'recorder',
        message: userMessage,
        originalError: err.name
      });

      await this.cleanupWebAudio();
      eventBus.emit('stream:stopped');
      eventBus.emit('recorder:error', err);
      throw err;
    }
  }

  /**
   * AudioContext'i hazirla (pre-warm veya yeni olustur)
   * @private
   */
  async _ensureAudioContext() {
    if (!this.audioContext) {
      // DRY: factory + helper kullan - mikrofon sample rate ile olustur
      const acOptions = getAudioContextOptions(this.stream);
      this.audioContext = await createAudioContext(acOptions);

      const micSampleRate = acOptions.sampleRate;
      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuldu (Kayit - cold start)',
        details: {
          state: this.audioContext.state,
          sampleRate: this.audioContext.sampleRate,
          micSampleRate: micSampleRate || 'N/A',
          sampleRateMatch: !micSampleRate || micSampleRate === this.audioContext.sampleRate,
          baseLatency: this.audioContext.baseLatency
        }
      });
    } else {
      // Pre-warmed context var - sample rate kontrolu yap
      const track = this.stream.getAudioTracks()[0];
      const trackSettings = track.getSettings();
      const micSampleRate = trackSettings.sampleRate;

      // Sample rate uyusmuyorsa pre-warmed context'i kapat, yeni olustur
      if (micSampleRate && micSampleRate !== this.audioContext.sampleRate) {
        eventBus.emit('log:webaudio', {
          message: 'Pre-warmed AudioContext sample rate uyumsuz - yeni context olusturuluyor',
          details: {
            preWarmedSampleRate: this.audioContext.sampleRate,
            micSampleRate: micSampleRate
          }
        });

        // Eski context'i kapat
        await this.audioContext.close();
        this.destinationNode = null;

        // DRY: factory kullan - yeni context olustur (mikrofon sample rate ile)
        this.audioContext = await createAudioContext({ sampleRate: micSampleRate });
        this.isWarmedUp = false; // Artik pre-warmed degil
      } else {
        // Sample rate uyumlu - resume et
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume();
        }
      }

      eventBus.emit('log:webaudio', {
        message: 'AudioContext kullaniliyor' + (this.isWarmedUp ? ' (pre-warmed)' : ' (yeniden olusturuldu)'),
        details: {
          state: this.audioContext.state,
          sampleRate: this.audioContext.sampleRate,
          micSampleRate: micSampleRate || 'N/A',
          sampleRateMatch: !micSampleRate || micSampleRate === this.audioContext.sampleRate
        }
      });
    }
  }

  /**
   * MediaRecorder kurulumu
   * @private
   */
  async _setupMediaRecorder(recordStream) {
    // MediaRecorder olustur - DRY: createMediaRecorder helper kullaniliyor
    const recorderOptions = this.mediaBitrate > 0
      ? { audioBitsPerSecond: this.mediaBitrate }
      : {};
    this.mediaRecorder = createMediaRecorder(recordStream, recorderOptions);

    const bitrateInfo = this.mediaBitrate > 0
      ? `${(this.mediaBitrate / 1000).toFixed(0)} kbps`
      : 'varsayilan';

    eventBus.emit('log:recorder', {
      message: 'MediaRecorder olusturuldu',
      details: {
        mimeType: this.mediaRecorder.mimeType,
        state: this.mediaRecorder.state,
        pipeline: this.pipelineType,
        encoder: this.encoder,
        useWebAudio: usesWebAudio(this.pipelineType),
        mediaBitrate: bitrateInfo,
        streamId: recordStream.id
      }
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };

    this.mediaRecorder.onstop = async () => {
      const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(this.chunks, { type: mimeType });
      const suffix = this.pipelineType === 'direct' ? '' : `_${this.pipelineType}`;
      const filename = `kayit${suffix}_${Date.now()}.webm`;

      // Gercek bitrate hesapla
      const durationMs = Date.now() - this.startTime;
      const durationSec = durationMs / 1000;
      const actualBitrate = durationSec > 0 ? Math.round((blob.size * 8) / durationSec) : 0;
      const actualBitrateKbps = (actualBitrate / 1000).toFixed(1);

      // Istenen vs gercek karsilastirmasi
      const requestedBitrate = this.mediaBitrate || 0;
      const bitrateComparison = requestedBitrate > 0
        ? `Istenen: ${(requestedBitrate / 1000).toFixed(0)} kbps, Gercek: ~${actualBitrateKbps} kbps`
        : `Gercek bitrate: ~${actualBitrateKbps} kbps`;

      eventBus.emit('log', `Kayit tamamlandi: ${bytesToKB(blob.size).toFixed(1)} KB (${bitrateComparison})`);
      eventBus.emit('recording:completed', {
        blob,
        mimeType,
        filename,
        pipeline: this.pipelineType,
        encoder: this.encoder,
        useWebAudio: usesWebAudio(this.pipelineType),
        durationMs,
        requestedBitrate,
        actualBitrate
      });

      // WebAudio temizlik
      if (usesWebAudio(this.pipelineType)) {
        await this.cleanupWebAudio();
      }

      // Temizlik
      this.mediaRecorder = null;
    };

    // Timeslice ile veya tek chunk olarak baslat
    this.startTime = Date.now();
    if (this.timeslice > 0) {
      this.mediaRecorder.start(this.timeslice);
    } else {
      this.mediaRecorder.start();
    }
  }

  /**
   * Hata mesajini kullanici dostu formata cevir
   * @private
   */
  _getErrorMessage(err) {
    const errorMap = {
      NotAllowedError: 'Microphone permission denied',
      NotFoundError: 'Microphone not found',
      NotReadableError: 'Microphone is being used by another application',
      OverconstrainedError: 'Unsupported microphone setting'
    };
    return errorMap[err.name] || err.message;
  }

  async cleanupWebAudio(forceClose = false) {
    // Pipeline strategy temizligi (OCP: Strategy kendini temizler)
    if (this.pipelineStrategy) {
      await this.pipelineStrategy.cleanup();
      this.pipelineStrategy = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    // Pre-warmed ise context ve destination'i koru (tekrar hizli baslatma icin)
    if (this.isWarmedUp && !forceClose) {
      eventBus.emit('log:webaudio', {
        message: 'WebAudio cleanup (context korunuyor - pre-warmed)',
        details: { contextState: this.audioContext?.state }
      });
      return;
    }

    // Full cleanup
    if (this.destinationNode) {
      this.destinationNode = null;
    }
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        // Context zaten kapali olabilir
      }
      eventBus.emit('log:webaudio', {
        message: 'AudioContext kapatildi (Kayit)',
        details: {}
      });
      this.audioContext = null;
    }
    this.isWarmedUp = false;
  }

  async stop() {
    if (!this.isRecording) return;

    // WASM Opus encoder modu icin Opus Worker'i bitir (OCP: Strategy'den al)
    if (usesWasmOpus(this.encoder) && this.pipelineStrategy?.getOpusWorker?.()) {
      try {
        eventBus.emit('log', 'Opus encoding tamamlaniyor...');

        // Strategy'den final blob'u al
        const result = await this.pipelineStrategy.finishOpusEncoding();

        const durationMs = Date.now() - this.startTime;
        const durationSec = durationMs / 1000;
        const actualBitrate = durationSec > 0 ? Math.round((result.blob.size * 8) / durationSec) : 0;
        const actualBitrateKbps = (actualBitrate / 1000).toFixed(1);

        eventBus.emit('log', `Kayit tamamlandi: ${bytesToKB(result.blob.size).toFixed(1)} KB (Gercek: ~${actualBitrateKbps} kbps, ${result.pageCount} page)`);
        eventBus.emit('recording:completed', {
          blob: result.blob,
          mimeType: 'audio/ogg; codecs=opus',
          filename: `kayit_wasm_opus_${Date.now()}.ogg`,
          pipeline: this.pipelineType,
          encoder: this.encoder,
          useWebAudio: true,
          durationMs,
          requestedBitrate: this.mediaBitrate || 16000,
          actualBitrate,
          pageCount: result.pageCount,
          encoderType: result.encoderType
        });

        // WebAudio temizlik (strategy cleanup dahil)
        await this.cleanupWebAudio();

      } catch (error) {
        eventBus.emit('log:error', {
          message: 'Opus encoding hatasi',
          details: { error: error.message }
        });

        await this.cleanupWebAudio();
      }
    } else if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      // MediaRecorder modu
      this.mediaRecorder.stop();
    }

    // Stream durdur (DRY: stopStreamTracks kullan)
    stopStreamTracks(this.stream);
    this.stream = null;

    this.isRecording = false;

    eventBus.emit('stream:stopped');
    eventBus.emit('log', 'KAYIT durduruldu');
    eventBus.emit('recorder:stopped');
  }

  getStream() {
    return this.stream;
  }

  getIsRecording() {
    return this.isRecording;
  }

  // Geriye uyumluluk icin pipeline property (string olarak)
  get pipeline() {
    return this.pipelineType;
  }
}

export default Recorder;
