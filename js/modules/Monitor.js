/**
 * Monitor - Canli mikrofon dinleme
 * OCP: Farkli monitor modlari eklenebilir (WebAudio, ScriptProcessor)
 */
import eventBus from './EventBus.js';
import { requestStream } from './StreamHelper.js';
import { createPassthroughWorkletNode, ensurePassthroughWorklet } from './WorkletHelper.js';
import { getBestAudioMimeType } from './utils.js';

class Monitor {
  constructor() {
    this.stream = null;
    this.ac = null;
    this.src = null;
    this.proc = null;
    this.workletNode = null;
    this.delay = null; // DelayNode - 2 saniye gecikme
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
    this.lastSourceBufferErrorTime = 0; // Error throttle icin
    this.lastMediaRecorderErrorTime = 0; // MediaRecorder error throttle
  }

  async startWebAudio(constraints) {
    if (this.isMonitoring) return;

    try {
      this.stream = await requestStream(constraints);

      // WebAudio API - AudioContext olustur
      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuluyor',
        details: { api: 'new AudioContext()' }
      });

      this.ac = new (window.AudioContext || window.webkitAudioContext)();

      // AudioContext suspended olabilir - resume et
      if (this.ac.state === 'suspended') {
        await this.ac.resume();
      }

      // AudioContext detaylari
      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuldu',
        details: {
          state: this.ac.state,
          sampleRate: this.ac.sampleRate,
          baseLatency: this.ac.baseLatency,
          outputLatency: this.ac.outputLatency,
          currentTime: this.ac.currentTime,
          destination: {
            maxChannelCount: this.ac.destination.maxChannelCount,
            numberOfInputs: this.ac.destination.numberOfInputs,
            numberOfOutputs: this.ac.destination.numberOfOutputs
          }
        }
      });

      // MediaStreamSource olustur
      eventBus.emit('log:webaudio', {
        message: 'MediaStreamAudioSourceNode olusturuluyor',
        details: { api: 'ac.createMediaStreamSource(stream)' }
      });

      this.src = this.ac.createMediaStreamSource(this.stream);

      eventBus.emit('log:webaudio', {
        message: 'MediaStreamAudioSourceNode olusturuldu',
        details: {
          numberOfInputs: this.src.numberOfInputs,
          numberOfOutputs: this.src.numberOfOutputs,
          channelCount: this.src.channelCount,
          channelCountMode: this.src.channelCountMode
        }
      });

      // DelayNode olustur - 2 saniye gecikme (echo/feedback onleme)
      this.delay = this.ac.createDelay(3.0); // max 3 saniye
      this.delay.delayTime.value = 2.0; // 2 saniye gecikme

      eventBus.emit('log:webaudio', {
        message: 'DelayNode olusturuldu',
        details: {
          delayTime: this.delay.delayTime.value + ' saniye',
          maxDelayTime: '3 saniye',
          purpose: 'Echo/feedback onleme'
        }
      });

      // Baglanti: Source -> Delay -> Destination
      this.src.connect(this.delay);
      this.delay.connect(this.ac.destination);

      eventBus.emit('log:webaudio', {
        message: 'WebAudio grafigi tamamlandi',
        details: {
          graph: `MediaStream -> Source -> DelayNode(${this.delay.delayTime.value}s) -> Destination`,
          finalState: this.ac.state
        }
      });

      this.isMonitoring = true;
      this.mode = 'standard';

      eventBus.emit('stream:started', this.stream);
      eventBus.emit('log', `MONITOR basladi (WebAudio -> ${this.delay.delayTime.value}s Delay -> Speaker)`);
      eventBus.emit('monitor:started', { mode: this.mode, delaySeconds: this.delay.delayTime.value });

    } catch (err) {
      eventBus.emit('log:error', {
        message: 'WebAudio Monitor hatasi',
        details: { error: err.message, stack: err.stack }
      });
      eventBus.emit('monitor:error', err);
      throw err;
    }
  }

  async startScriptProcessor(constraints, bufferSize = 4096) {
    if (this.isMonitoring) return;

    try {
      this.stream = await requestStream(constraints);

      // WebAudio API - AudioContext olustur
      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuluyor (ScriptProcessor mode)',
        details: { api: 'new AudioContext()' }
      });

      this.ac = new (window.AudioContext || window.webkitAudioContext)();

      // AudioContext suspended olabilir - resume et (user gesture icinde cagriliyor)
      if (this.ac.state === 'suspended') {
        await this.ac.resume();
      }

      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuldu',
        details: {
          state: this.ac.state,
          sampleRate: this.ac.sampleRate,
          baseLatency: this.ac.baseLatency
        }
      });

      // MediaStreamSource olustur
      this.src = this.ac.createMediaStreamSource(this.stream);

      eventBus.emit('log:webaudio', {
        message: 'MediaStreamAudioSourceNode olusturuldu',
        details: { channelCount: this.src.channelCount }
      });
      const channelCount = Math.min(2, this.src.channelCount || 1);

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

      this.proc = this.ac.createScriptProcessor(bufferSize, channelCount, channelCount);
      this.proc.onaudioprocess = (e) => {
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
          bufferSize: this.proc.bufferSize,
          numberOfInputs: this.proc.numberOfInputs,
          numberOfOutputs: this.proc.numberOfOutputs
        }
      });

      // Baglantilari yap
      this.src.connect(this.proc);
      // DelayNode olustur - 2 saniye gecikme (echo/feedback onleme)
      this.delay = this.ac.createDelay(3.0);
      this.delay.delayTime.value = 2.0;

      eventBus.emit('log:webaudio', {
        message: 'DelayNode olusturuldu (ScriptProcessor mode)',
        details: {
          delayTime: this.delay.delayTime.value + ' saniye',
          maxDelayTime: '3 saniye',
          purpose: 'Echo/feedback onleme'
        }
      });

      this.proc.connect(this.delay);
      this.delay.connect(this.ac.destination);

      eventBus.emit('log:webaudio', {
        message: 'WebAudio grafigi tamamlandi (ScriptProcessor)',
        details: {
          graph: `MediaStream -> Source -> ScriptProcessor -> DelayNode(${this.delay.delayTime.value}s) -> Destination`,
          finalState: this.ac.state
        }
      });

      this.isMonitoring = true;
      this.mode = 'scriptprocessor';

      eventBus.emit('stream:started', this.stream);
      eventBus.emit('log', `WEBAUDIO monitor basladi (ScriptProcessor 1024 -> ${this.delay.delayTime.value}s Delay -> Speaker)`);
      eventBus.emit('log', `SampleRate: ${this.ac.sampleRate}Hz, State: ${this.ac.state}`);
      eventBus.emit('monitor:started', { mode: this.mode, delaySeconds: this.delay.delayTime.value });

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

      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuluyor (AudioWorklet mode)',
        details: { api: 'new AudioContext()' }
      });

      this.ac = new (window.AudioContext || window.webkitAudioContext)();

      if (this.ac.state === 'suspended') {
        await this.ac.resume();
      }

      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuldu',
        details: {
          state: this.ac.state,
          sampleRate: this.ac.sampleRate,
          baseLatency: this.ac.baseLatency
        }
      });

      this.src = this.ac.createMediaStreamSource(this.stream);

      eventBus.emit('log:webaudio', {
        message: 'MediaStreamAudioSourceNode olusturuldu',
        details: { channelCount: this.src.channelCount }
      });

      await ensurePassthroughWorklet(this.ac);
      this.workletNode = createPassthroughWorkletNode(this.ac);

      // DelayNode olustur - 2 saniye gecikme (echo/feedback onleme)
      this.delay = this.ac.createDelay(3.0);
      this.delay.delayTime.value = 2.0;

      eventBus.emit('log:webaudio', {
        message: 'DelayNode olusturuldu (AudioWorklet mode)',
        details: {
          delayTime: this.delay.delayTime.value + ' saniye',
          maxDelayTime: '3 saniye',
          purpose: 'Echo/feedback onleme'
        }
      });

      this.src.connect(this.workletNode);
      this.workletNode.connect(this.delay);
      this.delay.connect(this.ac.destination);

      eventBus.emit('log:webaudio', {
        message: 'WebAudio grafigi tamamlandi (AudioWorklet)',
        details: {
          graph: `MediaStream -> Source -> AudioWorklet(passthrough) -> DelayNode(${this.delay.delayTime.value}s) -> Destination`,
          finalState: this.ac.state
        }
      });

      this.isMonitoring = true;
      this.mode = 'worklet';

      eventBus.emit('stream:started', this.stream);
      eventBus.emit('log', `WEBAUDIO monitor basladi (AudioWorklet -> ${this.delay.delayTime.value}s Delay -> Speaker)`);
      eventBus.emit('log', `SampleRate: ${this.ac.sampleRate}Hz, State: ${this.ac.state}`);
      eventBus.emit('monitor:started', { mode: this.mode, delaySeconds: this.delay.delayTime.value });

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

      // AudioContext olustur (delay icin zorunlu)
      this.ac = new (window.AudioContext || window.webkitAudioContext)();

      // AudioContext suspended olabilir - resume et
      if (this.ac.state === 'suspended') {
        await this.ac.resume();
      }

      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuldu (Direct mode)',
        details: {
          state: this.ac.state,
          sampleRate: this.ac.sampleRate
        }
      });

      // Source node
      this.src = this.ac.createMediaStreamSource(this.stream);

      // DelayNode olustur - 2 saniye gecikme (echo/feedback onleme)
      this.delay = this.ac.createDelay(3.0);
      this.delay.delayTime.value = 2.0;

      eventBus.emit('log:webaudio', {
        message: 'DelayNode olusturuldu (Direct mode)',
        details: {
          delayTime: this.delay.delayTime.value + ' saniye',
          purpose: 'Echo/feedback onleme'
        }
      });

      // Baglanti: Source -> Delay -> Destination
      this.src.connect(this.delay);
      this.delay.connect(this.ac.destination);

      this.isMonitoring = true;
      this.mode = 'direct';

      eventBus.emit('stream:started', this.stream);
      eventBus.emit('log', `MONITOR basladi (Direct -> ${this.delay.delayTime.value}s Delay -> Speaker)`);
      eventBus.emit('monitor:started', { mode: this.mode, delaySeconds: this.delay.delayTime.value });

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
  async startCodecSimulated(constraints, mediaBitrate, mode = 'standard', timeslice = 100, bufferSize = 4096) {
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

      // Mikrofon sample rate ile AudioContext olustur (Recording ile ayni)
      const track = this.stream.getAudioTracks()[0];
      const trackSettings = track.getSettings();
      const micSampleRate = trackSettings.sampleRate;
      const acOptions = micSampleRate ? { sampleRate: micSampleRate } : {};
      this.ac = new (window.AudioContext || window.webkitAudioContext)(acOptions);

      if (this.ac.state === 'suspended') {
        await this.ac.resume();
      }

      eventBus.emit('log:webaudio', {
        message: 'AudioContext olusturuldu (Codec-simulated mode)',
        details: {
          state: this.ac.state,
          sampleRate: this.ac.sampleRate,
          micSampleRate: micSampleRate || 'N/A',
          sampleRateMatch: !micSampleRate || micSampleRate === this.ac.sampleRate
        }
      });

      // Source ve Destination node (Recording ile ayni)
      this.src = this.ac.createMediaStreamSource(this.stream);
      const destinationNode = this.ac.createMediaStreamDestination();

      // Mode'a gore WebAudio pipeline kur (Recording ile birebir ayni)
      if (mode === 'scriptprocessor') {
        this.proc = this.ac.createScriptProcessor(bufferSize, 1, 1);
        this.proc.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          const output = e.outputBuffer.getChannelData(0);
          output.set(input);
        };
        this.src.connect(this.proc);
        this.proc.connect(destinationNode);

        eventBus.emit('log:webaudio', {
          message: 'ScriptProcessor pipeline kuruldu (Codec-simulated)',
          details: {
            graph: `Source -> ScriptProcessor(${bufferSize}) -> Destination`,
            warning: 'Deprecated API - Recording ile tutarlilik icin'
          }
        });
      } else if (mode === 'worklet') {
        await ensurePassthroughWorklet(this.ac);
        this.workletNode = createPassthroughWorkletNode(this.ac);
        this.src.connect(this.workletNode);
        this.workletNode.connect(destinationNode);

        eventBus.emit('log:webaudio', {
          message: 'AudioWorklet pipeline kuruldu (Codec-simulated)',
          details: {
            graph: 'Source -> AudioWorklet(passthrough) -> Destination'
          }
        });
      } else {
        // standard veya direct - dogrudan bagla
        this.src.connect(destinationNode);

        eventBus.emit('log:webaudio', {
          message: 'Standard pipeline kuruldu (Codec-simulated)',
          details: {
            graph: 'Source -> Destination'
          }
        });
      }

      // MimeType - Recording ile ayni fonksiyon
      const mimeType = getBestAudioMimeType() || 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        throw new Error(`MimeType desteklenmiyor: ${mimeType}`);
      }

      // MediaRecorder - WebAudio destination stream kullan (Recording ile ayni)
      const recordStream = destinationNode.stream;
      const recorderOptions = {
        mimeType,
        audioBitsPerSecond: mediaBitrate
      };

      try {
        this.codecMediaRecorder = new MediaRecorder(recordStream, recorderOptions);
      } catch {
        // Options desteklenmiyorsa fallback
        this.codecMediaRecorder = new MediaRecorder(recordStream);
      }

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
        if (now - this.lastMediaRecorderErrorTime > 5000) {
          this.lastMediaRecorderErrorTime = now;
          eventBus.emit('log:error', {
            message: 'MediaRecorder hatasi (Codec-simulated)',
            details: { error: e.error?.message || 'Unknown error' }
          });
        }
      };

      // DelayNode olustur - 2 saniye gecikme
      this.delay = this.ac.createDelay(3.0);
      this.delay.delayTime.value = 2.0;

      eventBus.emit('log:webaudio', {
        message: 'DelayNode olusturuldu (Codec-simulated mode)',
        details: {
          delayTime: this.delay.delayTime.value + ' saniye',
          purpose: 'Echo/feedback onleme'
        }
      });

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
      this.codecElementSource = this.ac.createMediaElementSource(this.codecAudioElement);
      this.codecElementSource.connect(this.delay);
      this.delay.connect(this.ac.destination);

      eventBus.emit('log:webaudio', {
        message: 'WebAudio grafigi tamamlandi (Codec-simulated)',
        details: {
          graph: `${pipelineMode} -> MediaRecorder(${mediaBitrate}bps) -> MediaSource -> Audio -> DelayNode(${this.delay.delayTime.value}s) -> Destination`
        }
      });

      this.isMonitoring = true;
      this.mode = 'codec-simulated';

      eventBus.emit('stream:started', this.stream);
      eventBus.emit('log', `MONITOR basladi (Codec-simulated ${pipelineMode} ${mediaBitrate}bps -> ${this.delay.delayTime.value}s Delay -> Speaker)`);
      eventBus.emit('monitor:started', {
        mode: this.mode,
        processingMode: mode,
        mediaBitrate,
        timeslice,
        delaySeconds: this.delay.delayTime.value
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
        if (now - this.lastSourceBufferErrorTime > 5000) {
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

    if (this.proc) {
      this.proc.disconnect();
      this.proc.onaudioprocess = null;
      eventBus.emit('log:webaudio', {
        message: 'ScriptProcessorNode disconnect edildi',
        details: {}
      });
      this.proc = null;
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

    if (this.delay) {
      this.delay.disconnect();
      eventBus.emit('log:webaudio', {
        message: 'DelayNode disconnect edildi',
        details: {}
      });
      this.delay = null;
    }

    if (this.src) {
      this.src.disconnect();
      eventBus.emit('log:webaudio', {
        message: 'MediaStreamAudioSourceNode disconnect edildi',
        details: {}
      });
      this.src = null;
    }

    if (this.ac) {
      const prevState = this.ac.state;
      await this.ac.close();
      eventBus.emit('log:webaudio', {
        message: 'AudioContext kapatildi',
        details: { previousState: prevState, newState: 'closed' }
      });
      this.ac = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
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
      hasAudioContext: !!this.ac,
      state: this.ac?.state,
      sampleRate: this.ac?.sampleRate,
      currentTime: this.ac?.currentTime,
      delayTime: this.delay?.delayTime?.value || 0,
      isMonitoring: this.isMonitoring,
      mode: this.mode
    };
  }
}

export default Monitor;
