/**
 * Monitor - Canli mikrofon dinleme
 * OCP: Farkli monitor modlari eklenebilir (WebAudio, ScriptProcessor)
 */
import eventBus from './EventBus.js';
import { requestStream } from './StreamHelper.js';
import { createPassthroughWorkletNode, ensurePassthroughWorklet } from './WorkletHelper.js';
import { createAudioContext, stopStreamTracks } from './utils.js';
import { DELAY, THROTTLE, BUFFER } from './constants.js';

class Monitor {
  constructor() {
    this.stream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.workletNode = null;
    this.delayNode = null;
    this.analyserNode = null; // VU Meter icin (fan-out pattern)
    this.isMonitoring = false;
    this.mode = null; // 'standard', 'scriptprocessor', 'worklet', 'direct'
  }

  /**
   * AnalyserNode olusturur ve VU Meter event'i emit eder (DRY helper)
   * @param {AudioNode} sourceNode - Analyser'a baglanacak node
   * @param {string} mode - Log icin mod adi
   * @returns {AnalyserNode}
   */
  _createAnalyser(sourceNode, mode = '') {
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.8;

    // Fan-out: sourceNode -> analyser (VU icin)
    sourceNode.connect(this.analyserNode);

    // VU Meter'a bildir
    eventBus.emit('pipeline:analyserReady', this.analyserNode);

    eventBus.emit('log:webaudio', {
      message: `AnalyserNode olusturuldu${mode ? ` (${mode})` : ''}`,
      details: {
        fftSize: this.analyserNode.fftSize,
        purpose: 'VU Meter (encode oncesi sinyal)'
      }
    });

    return this.analyserNode;
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

      // VU Meter icin AnalyserNode (fan-out: Source -> Analyser)
      this._createAnalyser(this.sourceNode, 'Standard');

      eventBus.emit('log:webaudio', {
        message: 'WebAudio grafigi tamamlandi',
        details: {
          graph: `MediaStream -> Source -> [AnalyserNode (VU) + DelayNode(${this.delayNode.delayTime.value}s)] -> Destination`,
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

      // VU Meter icin AnalyserNode (fan-out: Processor -> Analyser)
      this._createAnalyser(this.processorNode, 'ScriptProcessor');

      eventBus.emit('log:webaudio', {
        message: 'WebAudio grafigi tamamlandi (ScriptProcessor)',
        details: {
          graph: `MediaStream -> Source -> ScriptProcessor -> [AnalyserNode (VU) + DelayNode(${this.delayNode.delayTime.value}s)] -> Destination`,
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

      // VU Meter icin AnalyserNode (fan-out: Worklet -> Analyser)
      this._createAnalyser(this.workletNode, 'AudioWorklet');

      eventBus.emit('log:webaudio', {
        message: 'WebAudio grafigi tamamlandi (AudioWorklet)',
        details: {
          graph: `MediaStream -> Source -> AudioWorklet -> [AnalyserNode (VU) + DelayNode(${this.delayNode.delayTime.value}s)] -> Destination`,
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

      // VU Meter icin AnalyserNode (fan-out: Source -> Analyser)
      this._createAnalyser(this.sourceNode, 'Direct');

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

  async stop() {
    if (!this.isMonitoring) return;

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

    if (this.analyserNode) {
      this.analyserNode.disconnect();
      eventBus.emit('log:webaudio', {
        message: 'AnalyserNode disconnect edildi',
        details: {}
      });
      this.analyserNode = null;
    }

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
