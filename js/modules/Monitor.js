/**
 * Monitor - Canli mikrofon dinleme
 * OCP: Farkli monitor modlari eklenebilir (WebAudio, ScriptProcessor)
 */
import eventBus from './EventBus.js';
import { requestStream } from './StreamHelper.js';
import { createPassthroughWorkletNode, ensurePassthroughWorklet } from './WorkletHelper.js';
import { createAudioContext, getAudioContextOptions, stopStreamTracks, createMediaRecorder } from './utils.js';
import { DELAY, THROTTLE, BUFFER } from './constants.js';

class Monitor {
  constructor() {
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.workletNode = null;
    this.delayNode = null;
    this.isMonitoring = false;
    this.mode = null; // 'standard', 'scriptprocessor', 'worklet', 'direct' veya 'codec-simulated'

    // Codec-simulated mode icin ek property'ler
    this.codecMediaRecorder = null;
    this.codecMediaSource = null;
    this.codecSourceBuffer = null;
    this.codecAudioElement = null;
    this.codecElementSource = null; // MediaElementAudioSourceNode
    this.pendingChunks = [];

    // Guard flags - stop sirasinda chunk islemesini engelle
    this.isStoppingCodecSimulated = false;
    this.lastSourceBufferErrorTime = 0;
    this.lastMediaRecorderErrorTime = 0;
  }

  /**
   * DelayNode olusturur (DRY helper - feedback/echo onleme)
   * @param {string} mode - Log icin mod adi
   * @returns {DelayNode}
   */
  _createDelayNode(mode = '') {
    this.delayNode = this.audioContext.createDelay(DELAY.MAX_SECONDS);
    this.delayNode.delayTime.value = DELAY.DEFAULT_SECONDS;

    eventBus.emit('log:webaudio', {
      message: `DelayNode olusturuldu${mode ? ` (${mode})` : ''}`,
      details: {
        delayTime: this.delayNode.delayTime.value + ' saniye',
        maxDelayTime: DELAY.MAX_SECONDS + ' saniye',
        purpose: 'Echo/feedback onleme'
      }
    });

    return this.delayNode;
  }

  async startWebAudio(constraints) {
    if (this.isMonitoring) return;

    try {
      this.stream = await requestStream(constraints);

      // WebAudio API - AudioContext olustur (DRY: factory kullan)
      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuluyor',
        details: { api: 'createAudioContext()' }
      });

      this.audioContext = await createAudioContext();

      // AudioContext detaylari
      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuldu',
        details: {
          state: this.audioContext.state,
          sampleRate: this.audioContext.sampleRate,
          baseLatency: this.audioContext.baseLatency,
          outputLatency: this.audioContext.outputLatency,
          currentTime: this.audioContext.currentTime,
          destination: {
            maxChannelCount: this.audioContext.destination.maxChannelCount,
            numberOfInputs: this.audioContext.destination.numberOfInputs,
            numberOfOutputs: this.audioContext.destination.numberOfOutputs
          }
        }
      });

      // MediaStreamSource olustur
      eventBus.emit('log:webaudio', {
        message: 'MediaStreamAudioSourceNode olusturuluyor',
        details: { api: 'ac.createMediaStreamSource(stream)' }
      });

      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);

      eventBus.emit('log:webaudio', {
        message: 'MediaStreamAudioSourceNode olusturuldu',
        details: {
          numberOfInputs: this.sourceNode.numberOfInputs,
          numberOfOutputs: this.sourceNode.numberOfOutputs,
          channelCount: this.sourceNode.channelCount,
          channelCountMode: this.sourceNode.channelCountMode
        }
      });

      // DelayNode olustur (DRY helper)
      this._createDelayNode('Standard');

      // Baglanti: Source -> Delay -> Destination
      this.sourceNode.connect(this.delayNode);
      this.delayNode.connect(this.audioContext.destination);

      eventBus.emit('log:webaudio', {
        message: 'WebAudio grafigi tamamlandi',
        details: {
          graph: `MediaStream -> Source -> DelayNode(${this.delayNode.delayTime.value}s) -> Destination`,
          finalState: this.audioContext.state
        }
      });

      this.isMonitoring = true;
      this.mode = 'standard';

      eventBus.emit('stream:started', this.stream);
      eventBus.emit('log', `MONITOR basladi (WebAudio -> ${this.delayNode.delayTime.value.toFixed(1)}s Delay -> Speaker)`);
      eventBus.emit('monitor:started', { mode: this.mode, delaySeconds: this.delayNode.delayTime.value });

    } catch (err) {
      eventBus.emit('log:error', {
        message: 'WebAudio Monitor hatasi',
        details: { error: err.message, stack: err.stack }
      });
      eventBus.emit('monitor:error', err);
      throw err;
    }
  }

  async startScriptProcessor(constraints, bufferSize = BUFFER.DEFAULT_SIZE) {
    if (this.isMonitoring) return;

    try {
      this.stream = await requestStream(constraints);

      // WebAudio API - AudioContext olustur (DRY: factory kullan)
      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuluyor (ScriptProcessor mode)',
        details: { api: 'createAudioContext()' }
      });

      this.audioContext = await createAudioContext();

      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuldu',
        details: {
          state: this.audioContext.state,
          sampleRate: this.audioContext.sampleRate,
          baseLatency: this.audioContext.baseLatency
        }
      });

      // MediaStreamSource olustur
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);

      eventBus.emit('log:webaudio', {
        message: 'MediaStreamAudioSourceNode olusturuldu',
        details: { channelCount: this.sourceNode.channelCount }
      });
      const channelCount = Math.min(2, this.sourceNode.channelCount || 1);

      eventBus.emit('log:webaudio', {
        message: 'ScriptProcessorNode olusturuluyor (DEPRECATED API)',
        details: {
          api: `ac.createScriptProcessor(${bufferSize}, ${channelCount}, ${channelCount})`,
          warning: 'Bu API deprecated, AudioWorklet kullanilmali',
          bufferSize,
          inputChannels: channelCount,
          outputChannels: channelCount
        }
      });

      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, channelCount, channelCount);
      this.processorNode.onaudioprocess = (e) => {
        const inputBuffer = e.inputBuffer;
        const outputBuffer = e.outputBuffer;
        const channels = Math.min(inputBuffer.numberOfChannels, outputBuffer.numberOfChannels);

        for (let ch = 0; ch < channels; ch++) {
          const input = inputBuffer.getChannelData(ch);
          const output = outputBuffer.getChannelData(ch);
          output.set(input);
        }
      };

      eventBus.emit('log:webaudio', {
        message: 'ScriptProcessorNode olusturuldu',
        details: {
          bufferSize: this.processorNode.bufferSize,
          numberOfInputs: this.processorNode.numberOfInputs,
          numberOfOutputs: this.processorNode.numberOfOutputs
        }
      });

      // Baglantilari yap
      this.sourceNode.connect(this.processorNode);

      // DelayNode olustur (DRY helper)
      this._createDelayNode('ScriptProcessor');

      this.processorNode.connect(this.delayNode);
      this.delayNode.connect(this.audioContext.destination);

      eventBus.emit('log:webaudio', {
        message: 'WebAudio grafigi tamamlandi (ScriptProcessor)',
        details: {
          graph: `MediaStream -> Source -> ScriptProcessor -> DelayNode(${this.delayNode.delayTime.value}s) -> Destination`,
          finalState: this.audioContext.state
        }
      });

      this.isMonitoring = true;
      this.mode = 'scriptprocessor';

      eventBus.emit('stream:started', this.stream);
      eventBus.emit('log', `WEBAUDIO monitor basladi (ScriptProcessor 1024 -> ${this.delayNode.delayTime.value.toFixed(1)}s Delay -> Speaker)`);
      eventBus.emit('log', `SampleRate: ${this.audioContext.sampleRate}Hz, State: ${this.audioContext.state}`);
      eventBus.emit('monitor:started', { mode: this.mode, delaySeconds: this.delayNode.delayTime.value });

    } catch (err) {
      eventBus.emit('log:error', {
        message: 'ScriptProcessor Monitor hatasi',
        details: { error: err.message, stack: err.stack }
      });
      eventBus.emit('monitor:error', err);
      throw err;
    }
  }

  async startAudioWorklet(constraints) {
    if (this.isMonitoring) return;

    try {
      this.stream = await requestStream(constraints);

      // DRY: factory kullan
      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuluyor (AudioWorklet mode)',
        details: { api: 'createAudioContext()' }
      });

      this.audioContext = await createAudioContext();

      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuldu',
        details: {
          state: this.audioContext.state,
          sampleRate: this.audioContext.sampleRate,
          baseLatency: this.audioContext.baseLatency
        }
      });

      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);

      eventBus.emit('log:webaudio', {
        message: 'MediaStreamAudioSourceNode olusturuldu',
        details: { channelCount: this.sourceNode.channelCount }
      });

      await ensurePassthroughWorklet(this.audioContext);
      this.workletNode = createPassthroughWorkletNode(this.audioContext);

      // DelayNode olustur (DRY helper)
      this._createDelayNode('AudioWorklet');

      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.delayNode);
      this.delayNode.connect(this.audioContext.destination);

      eventBus.emit('log:webaudio', {
        message: 'WebAudio grafigi tamamlandi (AudioWorklet)',
        details: {
          graph: `MediaStream -> Source -> AudioWorklet(passthrough) -> DelayNode(${this.delayNode.delayTime.value}s) -> Destination`,
          finalState: this.audioContext.state
        }
      });

      this.isMonitoring = true;
      this.mode = 'worklet';

      eventBus.emit('stream:started', this.stream);
      eventBus.emit('log', `WEBAUDIO monitor basladi (AudioWorklet -> ${this.delayNode.delayTime.value.toFixed(1)}s Delay -> Speaker)`);
      eventBus.emit('log', `SampleRate: ${this.audioContext.sampleRate}Hz, State: ${this.audioContext.state}`);
      eventBus.emit('monitor:started', { mode: this.mode, delaySeconds: this.delayNode.delayTime.value });

    } catch (err) {
      eventBus.emit('log:error', {
        message: 'AudioWorklet Monitor hatasi',
        details: { error: err.message, stack: err.stack }
      });
      eventBus.emit('monitor:error', err);
      throw err;
    }
  }

  /**
   * Direct Mode - Basit WebAudio pipeline ile monitor (DelayNode ile)
   * WebAudio toggle kapaliyken kullanilir, sadece delay uygulanir
   */
  async startDirect(constraints) {
    if (this.isMonitoring) return;

    try {
      this.stream = await requestStream(constraints);

      eventBus.emit('log:stream', {
        message: 'Direct monitor baslatiliyor (Delay ile)',
        details: {
          mode: 'direct',
          pipeline: 'MediaStream -> DelayNode -> Speaker'
        }
      });

      // AudioContext olustur (DRY: factory kullan)
      this.audioContext = await createAudioContext();

      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuldu (Direct mode)',
        details: {
          state: this.audioContext.state,
          sampleRate: this.audioContext.sampleRate
        }
      });

      // Source node
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);

      // DelayNode olustur (DRY helper)
      this._createDelayNode('Direct');

      // Baglanti: Source -> Delay -> Destination
      this.sourceNode.connect(this.delayNode);
      this.delayNode.connect(this.audioContext.destination);

      this.isMonitoring = true;
      this.mode = 'direct';

      eventBus.emit('stream:started', this.stream);
      eventBus.emit('log', `MONITOR basladi (Direct -> ${this.delayNode.delayTime.value.toFixed(1)}s Delay -> Speaker)`);
      eventBus.emit('monitor:started', { mode: this.mode, delaySeconds: this.delayNode.delayTime.value });

    } catch (err) {
      eventBus.emit('log:error', {
        message: 'Direct Monitor hatasi',
        details: { error: err.message, stack: err.stack }
      });
      eventBus.emit('monitor:error', err);
      throw err;
    }
  }

  /**
   * Codec-Simulated Mode - MediaRecorder ile gercek codec sikistirmasi
   * WhatsApp/Telegram gibi mediaBitrate > 0 profillerde kullanilir
   * Recording ile birebir ayni pipeline kullanir
   * Pipeline: Mic -> WebAudio(mode) -> Destination -> MediaRecorder -> MediaSource -> Audio -> Delay -> Speaker
   */
  async startCodecSimulated(constraints, mediaBitrate, mode = 'standard', timeslice = 100, bufferSize = BUFFER.DEFAULT_SIZE) {
    if (this.isMonitoring) return;

    try {
      this.stream = await requestStream(constraints);

      // Recording ile ayni pipeline bilgisi
      const pipelineMode = mode === 'scriptprocessor' ? 'ScriptProcessor' :
                           mode === 'worklet' ? 'AudioWorklet' : 'Standard';

      eventBus.emit('log:stream', {
        message: 'Codec-simulated monitor baslatiliyor',
        details: {
          mode: 'codec-simulated',
          processingMode: mode,
          mediaBitrate: mediaBitrate + ' bps',
          timeslice: timeslice + 'ms',
          bufferSize: mode === 'scriptprocessor' ? bufferSize : 'N/A',
          pipeline: `MediaStream -> ${pipelineMode} -> MediaRecorder -> MediaSource -> Audio -> Delay -> Speaker`
        }
      });

      // Mikrofon sample rate ile AudioContext olustur (DRY: factory + helper)
      const acOptions = getAudioContextOptions(this.stream);
      this.audioContext = await createAudioContext(acOptions);

      const micSampleRate = acOptions.sampleRate;
      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuldu (Codec-simulated mode)',
        details: {
          state: this.audioContext.state,
          sampleRate: this.audioContext.sampleRate,
          micSampleRate: micSampleRate || 'N/A',
          sampleRateMatch: !micSampleRate || micSampleRate === this.audioContext.sampleRate
        }
      });

      // Source ve Destination node (Recording ile ayni)
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      const destinationNode = this.audioContext.createMediaStreamDestination();

      // Mode'a gore WebAudio pipeline kur (Recording ile birebir ayni)
      if (mode === 'scriptprocessor') {
        this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
        this.processorNode.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          const output = e.outputBuffer.getChannelData(0);
          output.set(input);
        };
        this.sourceNode.connect(this.processorNode);
        this.processorNode.connect(destinationNode);

        eventBus.emit('log:webaudio', {
          message: 'ScriptProcessor pipeline kuruldu (Codec-simulated)',
          details: {
            graph: `Source -> ScriptProcessor(${bufferSize}) -> Destination`,
            warning: 'Deprecated API - Recording ile tutarlilik icin'
          }
        });
      } else if (mode === 'worklet') {
        await ensurePassthroughWorklet(this.audioContext);
        this.workletNode = createPassthroughWorkletNode(this.audioContext);
        this.sourceNode.connect(this.workletNode);
        this.workletNode.connect(destinationNode);

        eventBus.emit('log:webaudio', {
          message: 'AudioWorklet pipeline kuruldu (Codec-simulated)',
          details: {
            graph: 'Source -> AudioWorklet(passthrough) -> Destination'
          }
        });
      } else {
        // standard veya direct - dogrudan bagla
        this.sourceNode.connect(destinationNode);

        eventBus.emit('log:webaudio', {
          message: 'Standard pipeline kuruldu (Codec-simulated)',
          details: {
            graph: 'Source -> Destination'
          }
        });
      }

      // MediaRecorder - DRY: createMediaRecorder helper kullaniliyor
      const recordStream = destinationNode.stream;
      this.codecMediaRecorder = createMediaRecorder(recordStream, {
        audioBitsPerSecond: mediaBitrate
      });

      eventBus.emit('log:recorder', {
        message: 'MediaRecorder olusturuldu (Codec-simulated)',
        details: {
          mimeType: this.codecMediaRecorder.mimeType,
          audioBitsPerSecond: mediaBitrate,
          state: this.codecMediaRecorder.state,
          streamFromWebAudio: true
        }
      });

      // MediaSource olustur
      this.codecMediaSource = new MediaSource();
      this.codecAudioElement = document.createElement('audio');
      this.codecAudioElement.src = URL.createObjectURL(this.codecMediaSource);

      // MediaSource acildiginda SourceBuffer olustur
      await new Promise((resolve, reject) => {
        this.codecMediaSource.addEventListener('sourceopen', () => {
          try {
            this.codecSourceBuffer = this.codecMediaSource.addSourceBuffer(mimeType);
            this.codecSourceBuffer.mode = 'sequence';

            // updateend event'inde siradaki chunk'i isle
            this.codecSourceBuffer.addEventListener('updateend', () => {
              this.processNextChunk();
            });

            eventBus.emit('log:webaudio', {
              message: 'MediaSource ve SourceBuffer olusturuldu',
              details: {
                readyState: this.codecMediaSource.readyState,
                mode: this.codecSourceBuffer.mode
              }
            });

            resolve();
          } catch (err) {
            reject(err);
          }
        }, { once: true });

        this.codecMediaSource.addEventListener('error', (e) => {
          reject(new Error('MediaSource error: ' + e));
        }, { once: true });
      });

      // Chunk'lari topla
      this.codecMediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && this.codecSourceBuffer && !this.codecSourceBuffer.updating) {
          this.pendingChunks.push(e.data);
          this.processNextChunk();
        } else if (e.data.size > 0) {
          this.pendingChunks.push(e.data);
        }
      };

      this.codecMediaRecorder.onerror = (e) => {
        // ERROR THROTTLING: 5 saniyede bir log
        const now = Date.now();
        if (now - this.lastMediaRecorderErrorTime > THROTTLE.ERROR_LOG_MS) {
          this.lastMediaRecorderErrorTime = now;
          eventBus.emit('log:error', {
            message: 'MediaRecorder hatasi (Codec-simulated)',
            details: { error: e.error?.message || 'Unknown error' }
          });
        }
      };

      // DelayNode olustur (DRY helper)
      this._createDelayNode('Codec-simulated');

      // Audio element -> WebAudio -> Delay -> Speaker
      this.codecAudioElement.muted = false;

      // MediaRecorder'i baslat (profil timeslice ile - Recording ile ayni)
      this.codecMediaRecorder.start(timeslice);

      eventBus.emit('log:recorder', {
        message: 'MediaRecorder baslatildi (Codec-simulated)',
        details: {
          timeslice: timeslice + 'ms',
          state: this.codecMediaRecorder.state
        }
      });

      // Audio element'i baslat ve WebAudio'ya bagla
      document.body.appendChild(this.codecAudioElement);
      this.codecAudioElement.style.display = 'none';

      try {
        await this.codecAudioElement.play();
      } catch (playErr) {
        eventBus.emit('log:warning', {
          message: 'Audio autoplay engellendi, click sonrasi baslatilacak',
          details: { error: playErr.message }
        });
      }

      // MediaElementAudioSourceNode olustur ve bagla
      this.codecElementSource = this.audioContext.createMediaElementSource(this.codecAudioElement);
      this.codecElementSource.connect(this.delayNode);
      this.delayNode.connect(this.audioContext.destination);

      eventBus.emit('log:webaudio', {
        message: 'WebAudio grafigi tamamlandi (Codec-simulated)',
        details: {
          graph: `${pipelineMode} -> MediaRecorder(${mediaBitrate}bps) -> MediaSource -> Audio -> DelayNode(${this.delayNode.delayTime.value}s) -> Destination`
        }
      });

      this.isMonitoring = true;
      this.mode = 'codec-simulated';

      eventBus.emit('stream:started', this.stream);
      eventBus.emit('log', `MONITOR basladi (Codec-simulated ${pipelineMode} ${mediaBitrate}bps -> ${this.delayNode.delayTime.value.toFixed(1)}s Delay -> Speaker)`);
      eventBus.emit('monitor:started', {
        mode: this.mode,
        processingMode: mode,
        mediaBitrate,
        timeslice,
        delaySeconds: this.delayNode.delayTime.value
      });

    } catch (err) {
      eventBus.emit('log:error', {
        message: 'Codec-simulated Monitor hatasi',
        details: { error: err.message, stack: err.stack }
      });
      eventBus.emit('monitor:error', err);
      throw err;
    }
  }

  /**
   * Codec-simulated mode icin chunk isleme
   * SourceBuffer'a siradaki chunk'i ekler
   * Guard flags ve error throttling ile korunmus
   */
  processNextChunk() {
    // Guard: Stop islemi sirasinda cik
    if (this.isStoppingCodecSimulated) return;

    // Mevcut kontroller
    if (!this.codecSourceBuffer) return;
    if (this.codecSourceBuffer.updating) return;
    if (this.pendingChunks.length === 0) return;

    // MediaSource durumu kontrolu
    if (!this.codecMediaSource || this.codecMediaSource.readyState !== 'open') {
      this.pendingChunks = []; // Bekleyen chunk'lari temizle
      return;
    }

    const chunk = this.pendingChunks.shift();
    chunk.arrayBuffer().then(buffer => {
      // Double-check guards (async callback sonrasi)
      if (this.isStoppingCodecSimulated) return;
      if (!this.codecSourceBuffer) return;
      if (this.codecSourceBuffer.updating) return;
      if (!this.codecMediaSource || this.codecMediaSource.readyState !== 'open') return;

      try {
        this.codecSourceBuffer.appendBuffer(buffer);
      } catch (err) {
        // ERROR THROTTLING: 5 saniyede bir log
        const now = Date.now();
        if (now - this.lastSourceBufferErrorTime > THROTTLE.ERROR_LOG_MS) {
          this.lastSourceBufferErrorTime = now;
          eventBus.emit('log:error', {
            message: 'SourceBuffer appendBuffer hatasi',
            details: {
              error: err.message,
              pendingChunks: this.pendingChunks.length,
              mediaSourceState: this.codecMediaSource?.readyState
            }
          });
        }
      }
    }).catch(() => {
      // arrayBuffer() hatasi - sessizce yoksay (stop sirasinda olabilir)
    });
  }

  async stop() {
    if (!this.isMonitoring) return;

    // Codec-simulated mode icin flag'i hemen set et - chunk islemesini durdur
    if (this.mode === 'codec-simulated') {
      this.isStoppingCodecSimulated = true;
      this.pendingChunks = []; // Bekleyen chunk'lari hemen temizle
    }

    eventBus.emit('log:webaudio', {
      message: 'Monitor durduruluyor',
      details: { mode: this.mode }
    });

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      eventBus.emit('log:webaudio', {
        message: 'ScriptProcessorNode disconnect edildi',
        details: {}
      });
      this.processorNode = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      eventBus.emit('log:webaudio', {
        message: 'AudioWorkletNode disconnect edildi',
        details: {}
      });
      this.workletNode = null;
    }

    // Codec-simulated mode temizligi
    if (this.codecMediaRecorder) {
      if (this.codecMediaRecorder.state !== 'inactive') {
        this.codecMediaRecorder.stop();
      }
      this.codecMediaRecorder.ondataavailable = null;
      this.codecMediaRecorder.onerror = null;
      eventBus.emit('log:recorder', {
        message: 'MediaRecorder durduruldu (Codec-simulated)',
        details: {}
      });
      this.codecMediaRecorder = null;
    }

    if (this.codecElementSource) {
      this.codecElementSource.disconnect();
      eventBus.emit('log:webaudio', {
        message: 'MediaElementAudioSourceNode disconnect edildi',
        details: {}
      });
      this.codecElementSource = null;
    }

    if (this.codecAudioElement) {
      this.codecAudioElement.pause();
      URL.revokeObjectURL(this.codecAudioElement.src);
      this.codecAudioElement.src = '';
      // DOM'dan kaldir
      if (this.codecAudioElement.parentNode) {
        this.codecAudioElement.parentNode.removeChild(this.codecAudioElement);
      }
      eventBus.emit('log:webaudio', {
        message: 'Audio element temizlendi',
        details: {}
      });
      this.codecAudioElement = null;
    }

    if (this.codecSourceBuffer) {
      this.codecSourceBuffer = null;
    }

    if (this.codecMediaSource) {
      // MediaSource'u kapat (eger aciksa)
      if (this.codecMediaSource.readyState === 'open') {
        try {
          this.codecMediaSource.endOfStream();
        } catch (e) {
          // Zaten kapali olabilir
        }
      }
      this.codecMediaSource = null;
    }

    this.pendingChunks = [];

    if (this.delayNode) {
      this.delayNode.disconnect();
      eventBus.emit('log:webaudio', {
        message: 'DelayNode disconnect edildi',
        details: {}
      });
      this.delayNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      eventBus.emit('log:webaudio', {
        message: 'MediaStreamAudioSourceNode disconnect edildi',
        details: {}
      });
      this.sourceNode = null;
    }

    if (this.audioContext) {
      const prevState = this.audioContext.state;
      await this.audioContext.close();
      eventBus.emit('log:webaudio', {
        message: 'AudioContext kapatildi',
        details: { previousState: prevState, newState: 'closed' }
      });
      this.audioContext = null;
    }

    if (this.stream) {
      stopStreamTracks(this.stream);
      eventBus.emit('log:stream', {
        message: 'MediaStream track\'leri durduruldu',
        details: {}
      });
      this.stream = null;
    }

    const stoppedMode = this.mode;
    this.isMonitoring = false;
    this.mode = null;

    // Guard flag'i reset et
    this.isStoppingCodecSimulated = false;

    eventBus.emit('stream:stopped');
    eventBus.emit('log', `${stoppedMode === 'scriptprocessor' || stoppedMode === 'worklet' ? 'WEBAUDIO' : 'MONITOR'} durduruldu`);
    eventBus.emit('monitor:stopped', { mode: stoppedMode });
  }

  getIsMonitoring() {
    return this.isMonitoring;
  }

  getMode() {
    return this.mode;
  }

  // Debug: Mevcut WebAudio durumunu al
  getWebAudioState() {
    return {
      hasAudioContext: !!this.audioContext,
      state: this.audioContext?.state,
      sampleRate: this.audioContext?.sampleRate,
      currentTime: this.audioContext?.currentTime,
      delayTime: this.delayNode?.delayTime?.value || 0,
      isMonitoring: this.isMonitoring,
      mode: this.mode
    };
  }
}

export default Monitor;
