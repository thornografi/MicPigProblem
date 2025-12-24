/**
 * Monitor - Canli mikrofon dinleme
 * OCP: Farkli monitor modlari eklenebilir (WebAudio, ScriptProcessor)
 */
import eventBus from './EventBus.js';
import { requestStream } from './StreamHelper.js';
import { createPassthroughWorkletNode, ensurePassthroughWorklet } from './WorkletHelper.js';

class Monitor {
  constructor() {
    this.stream = null;
    this.ac = null;
    this.src = null;
    this.proc = null;
    this.workletNode = null;
    this.delay = null; // DelayNode - 2 saniye gecikme
    this.isMonitoring = false;
    this.mode = null; // 'webaudio', 'scriptprocessor', 'worklet' veya 'direct'
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
      this.mode = 'webaudio';

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

  async startScriptProcessor(constraints) {
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

      // ScriptProcessor olustur (DEPRECATED ama test icin)
      const bufferSize = 1024;
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

  async stop() {
    if (!this.isMonitoring) return;

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
