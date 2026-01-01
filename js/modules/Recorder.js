/**
 * Recorder - Ses kaydi yonetimi
 * OCP: Farkli kayit modlari eklenebilir (MediaRecorder, WebAudio, etc.)
 * WebAudio mode: Stream -> AudioContext -> MediaStreamDestination -> MediaRecorder
 */
import eventBus from './EventBus.js';
import { requestStream } from './StreamHelper.js';
import { createPassthroughWorkletNode, ensurePassthroughWorklet } from './WorkletHelper.js';
import { getBestAudioMimeType, createAudioContext, getAudioContextOptions } from './utils.js';

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
    this.processorNode = null; // ScriptProcessor (deprecated)
    this.workletNode = null; // AudioWorkletNode

    this.recordMode = 'direct'; // direct | standard | scriptprocessor | worklet
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

  async start(constraints, recordModeOrUseWebAudio = false, timeslice = 0, bufferSize = 4096, mediaBitrate = 0) {
    if (this.isRecording) return;

    const recordMode = typeof recordModeOrUseWebAudio === 'string'
      ? recordModeOrUseWebAudio
      : (recordModeOrUseWebAudio ? 'standard' : 'direct');

    const allowedModes = new Set(['direct', 'standard', 'scriptprocessor', 'worklet']);
    this.recordMode = allowedModes.has(recordMode) ? recordMode : 'direct';
    this.timeslice = timeslice;
    this.mediaBitrate = mediaBitrate; // MediaRecorder bitrate (sesli mesaj simülasyonu icin)

    try {
      this.stream = await requestStream(constraints);
      this.chunks = [];

      // NOT: recording:started event'i MediaRecorder.start() sonrasina tasindi (semantik tutarlilik)

      // Stream event'i gonder (VuMeter dinler)
      eventBus.emit('stream:started', this.stream);

      let recordStream = this.stream;

      const needsWebAudio = this.recordMode !== 'direct';

      // WebAudio-based modes: Stream -> (WebAudio graph) -> Destination -> MediaRecorder
      if (needsWebAudio) {
        eventBus.emit('log:webaudio', {
          message: 'Kayit pipeline modu aktif',
          details: { mode: this.recordMode, preWarmed: this.isWarmedUp }
        });

        // Pre-warm yapilmamissa AudioContext olustur
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

        if (this.recordMode === 'standard') {
          this.sourceNode.connect(this.destinationNode);

          eventBus.emit('log:webaudio', {
            message: 'Standard grafigi baglandi',
            details: {
              graph: 'MicStream -> SourceNode -> DestinationNode -> RecordStream'
            }
          });
        } else if (this.recordMode === 'scriptprocessor') {
          // bufferSize parametreden gelir (UI'daki buffer selector)
          this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

          this.processorNode.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            const output = e.outputBuffer.getChannelData(0);
            for (let i = 0; i < input.length; i++) {
              output[i] = input[i];
            }
          };

          this.sourceNode.connect(this.processorNode);
          this.processorNode.connect(this.destinationNode);

          eventBus.emit('log:webaudio', {
            message: 'ScriptProcessor grafigi baglandi (Kayit)',
            details: {
              graph: `MicStream -> SourceNode -> ScriptProcessor(${bufferSize}) -> DestinationNode -> RecordStream`,
              warning: 'Deprecated API - sadece test icin'
            }
          });
        } else if (this.recordMode === 'worklet') {
          await ensurePassthroughWorklet(this.audioContext);
          this.workletNode = createPassthroughWorkletNode(this.audioContext);

          this.sourceNode.connect(this.workletNode);
          this.workletNode.connect(this.destinationNode);

          eventBus.emit('log:webaudio', {
            message: 'AudioWorklet grafigi baglandi (Kayit)',
            details: {
              graph: 'MicStream -> SourceNode -> AudioWorklet(passthrough) -> DestinationNode -> RecordStream'
            }
          });
        }

        // MediaRecorder icin WebAudio'dan gelen stream'i kullan
        recordStream = this.destinationNode.stream;
      }

      // MediaRecorder options
      const preferredMimeType = getBestAudioMimeType();
      const recorderOptions = {};

      if (preferredMimeType) {
        recorderOptions.mimeType = preferredMimeType;
      }

      // Sesli mesaj simülasyonu icin bitrate ayarla
      // 0 = tarayici varsayilani, >0 = belirli bitrate
      if (this.mediaBitrate > 0) {
        recorderOptions.audioBitsPerSecond = this.mediaBitrate;
      }

      try {
        this.mediaRecorder = new MediaRecorder(recordStream, recorderOptions);
      } catch {
        // Options desteklenmiyorsa fallback
        this.mediaRecorder = new MediaRecorder(recordStream);
      }

      const bitrateInfo = this.mediaBitrate > 0
        ? `${(this.mediaBitrate / 1000).toFixed(0)} kbps`
        : 'varsayilan';

      eventBus.emit('log:recorder', {
        message: 'MediaRecorder olusturuldu',
        details: {
          mimeType: this.mediaRecorder.mimeType,
          state: this.mediaRecorder.state,
          recordMode: this.recordMode,
          useWebAudio: this.recordMode !== 'direct',
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
        const suffix = this.recordMode === 'direct' ? '' : `_${this.recordMode}`;
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

        eventBus.emit('log', `Kayit tamamlandi: ${(blob.size / 1024).toFixed(1)} KB (${bitrateComparison})`);
        eventBus.emit('recording:completed', {
          blob,
          mimeType,
          filename,
          recordMode: this.recordMode,
          useWebAudio: this.recordMode !== 'direct',
          durationMs,
          requestedBitrate,
          actualBitrate
        });

        // WebAudio temizlik
        if (this.recordMode !== 'direct') {
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
      this.isRecording = true;

      const modeLabelByMode = {
        direct: 'MediaRecorder (Direct)',
        standard: 'Standard + MediaRecorder',
        scriptprocessor: 'ScriptProcessor + MediaRecorder',
        worklet: 'AudioWorklet + MediaRecorder'
      };
      const modeText = modeLabelByMode[this.recordMode] || this.recordMode;
      const timesliceText = this.timeslice > 0 ? `, Timeslice: ${this.timeslice}ms` : '';
      eventBus.emit('log', `KAYIT basladi (${modeText}${timesliceText})`);
      eventBus.emit('recorder:started');
      // recording:started - MediaRecorder.start() sonrasi (Player.reset icin)
      eventBus.emit('recording:started');

    } catch (err) {
      // Spesifik hata mesajlari
      let userMessage = err.message;
      if (err.name === 'NotAllowedError') {
        userMessage = 'Mikrofon izni reddedildi';
      } else if (err.name === 'NotFoundError') {
        userMessage = 'Mikrofon bulunamadi';
      } else if (err.name === 'NotReadableError') {
        userMessage = 'Mikrofon baska uygulama tarafindan kullaniliyor';
      } else if (err.name === 'OverconstrainedError') {
        userMessage = 'Desteklenmeyen mikrofon ayari';
      }

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

  async cleanupWebAudio(forceClose = false) {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
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

  stop() {
    if (!this.isRecording) return;

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    // Stream durdur
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }

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
}

export default Recorder;
