---
name: web-audio-api
description: "Web Audio API, mikrofon, kayit, VU meter, WASM Opus. Anahtar kelimeler: getUserMedia, MediaRecorder, AudioContext, AnalyserNode, ScriptProcessorNode, AudioWorkletNode, GainNode, MediaStreamDestination, MediaSource, opus-encoder-worker"
---

Zorunlu: Bu satirlari okuyorsan konsola "web-audio-api SKILL.md okunuyor..." yaz.

# Web Audio API Rehberi

## Mikrofon Erisimi

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation, noiseSuppression, autoGainControl, sampleRate, channelCount }
});
```
- HTTPS/localhost gerekli
- `getSettings()` ile gercek degerleri kontrol et (tarayici garanti etmez)

## MediaRecorder

```javascript
const rec = new MediaRecorder(stream, { mimeType });
rec.ondataavailable = e => chunks.push(e.data);
rec.onstop = () => {
  rec.ondataavailable = null; // Race condition önleme
  // Temizlik burada
};
```
- `rec.stop()` asenkron - temizlik `onstop` icinde
- `onstop` başında `ondataavailable = null` yap (son chunk zaten gelmiş olur)
- Detay: `js/modules/Recorder.js`

## Node Turleri

| Node | Kullanim | Olusturma |
|------|----------|-----------|
| AnalyserNode | VU meter, sinyal kontrolu | `ac.createAnalyser()` |
| DelayNode | Feedback onleme (1.7sn) | `ac.createDelay(maxSec)` |
| GainNode | Ses seviyesi | `ac.createGain()` |
| ScriptProcessorNode | Legacy passthrough | `ac.createScriptProcessor(bufferSize, in, out)` |
| AudioWorkletNode | Modern passthrough | `new AudioWorkletNode(ac, 'processor-name')` |
| MediaStreamDestination | Web Audio → MediaRecorder | `ac.createMediaStreamDestination()` |

**MediaStreamDestination Kullanimi:**
- **SADECE** MediaRecorder encoder modu icin gerekli
- WASM Opus modunda kullanilmaz (PCM dogrudan worker'a gider)
- Recorder.js: `needsMediaRecorder` kontrolu ile olusturulur

## VU Meter Pattern

```javascript
analyser.fftSize = AUDIO.FFT_SIZE; // 256
analyser.getByteTimeDomainData(data);
// RMS -> dB donusumu (constants.js helper'lari kullan)
const dB = rmsToDb(rms);
const percent = dbToPercent(dB);
```
- Detay: `js/modules/VuMeter.js`, `js/modules/constants.js` (AUDIO, VU_METER)
- Helper'lar: `rmsToDb()`, `dbToPercent()`, `calculateLatencyMs()`, `bitrateToKbps()`

## AudioWorklet Pattern

```javascript
await ac.audioWorklet.addModule('passthrough-processor.js');
const node = new AudioWorkletNode(ac, 'passthrough-processor');
```
- Detay: `js/modules/WorkletHelper.js`, `js/worklets/passthrough-processor.js`
- ScriptProcessor deprecated - worklet tercih et

## Pipeline Strategy Pattern (OCP)

Recorder modulu pipeline kurulumu icin Strategy Pattern kullanir:

```javascript
import { createPipeline } from '../pipelines/PipelineFactory.js';

const strategy = createPipeline('worklet', audioContext, sourceNode, destNode);
await strategy.setup({ bufferSize, encoder, mediaBitrate, channels });
```

**Setup options:**
- `bufferSize`: ScriptProcessor buffer (4096 default)
- `mediaBitrate`: 0 = VBR (Variable Bit Rate), >0 = CBR (kbps)
- `channels`: 1 = Mono (default), 2 = Stereo

**Dosyalar:** `js/pipelines/` klasoru
- `BasePipeline.js` - Abstract base class (Opus worker, MuteGain, Analyser ortak metodlari)
- `PipelineFactory.js` - Factory Method
- `DirectPipeline.js` - Web Audio bypass, dogrudan MediaRecorder
- `StandardPipeline.js` - AudioContext → MediaRecorder
- `ScriptProcessorPipeline.js` - **SADECE WASM Opus** (MediaRecorder passthrough kaldirildi)
- `WorkletPipeline.js` - **WASM Opus veya PCM/WAV** (Raw Recording icin 16-bit WAV destegi)

**NOT:** ScriptProcessor pipeline sadece WASM Opus kullanir. WorkletPipeline hem WASM Opus hem PCM/WAV destekler (encoder parametresi ile).

## WASM Opus Encoding (WhatsApp Web Pattern)

WhatsApp Web, sesli mesajlar icin `ScriptProcessorNode(4096, 1, 1) + WASM Opus` kullanir:

```javascript
// ScriptProcessor → PCM → Web Worker → WASM Opus → .ogg
const processor = ac.createScriptProcessor(4096, 1, 1);
processor.onaudioprocess = (e) => {
  const pcm = e.inputBuffer.getChannelData(0);
  opusWorker.encode(pcm.slice()); // Worker'a gonder
};
```

- Detay: `js/modules/OpusWorkerHelper.js`, `js/lib/opus/encoderWorker.min.js` (opus-recorder WASM)
- MediaRecorder kullanilmiyor - dogrudan Opus encoding
- Output: `.ogg` (audio/ogg; codecs=opus)

### VBR/CBR Bitrate Destegi

```javascript
import { createOpusWorker } from './OpusWorkerHelper.js';

// VBR modu (Variable Bit Rate) - bitrate: 0 veya undefined
const vbrWorker = await createOpusWorker({ sampleRate: 48000, channels: 1, bitrate: 0 });

// CBR modu (Constant Bit Rate) - bitrate > 0
const cbrWorker = await createOpusWorker({ sampleRate: 48000, channels: 1, bitrate: 24000 });
```

| Parametre | Deger | Anlam |
|-----------|-------|-------|
| `bitrate: 0` | VBR | Opus varsayilani, degisken bitrate |
| `bitrate: undefined` | VBR | Ayni sekilde VBR |
| `bitrate: 16000+` | CBR | Sabit bitrate (bps) |

**NOT:** Eski kod `bitrate: 0` icin 16000 default uyguluyordu, bu duzeltildi.

## PCM/WAV Recording (Raw Recording)

WorkletPipeline ile 16-bit uncompressed WAV dosyasi olusturma:

```javascript
// WorkletPipeline setup (encoder: 'pcm-wav')
await strategy.setup({ encoder: 'pcm-wav', channels: 1 });

// Kayit bittiginde
const result = pipeline.finishPcmWavEncoding();
// result = { blob, sampleCount, encoderType: 'pcm-wav' }
```

**Helper fonksiyonlar (utils.js):**
- `usesPcmWav(encoder)` → Encoder PCM/WAV mi?
- `float32ToInt16(float32Array)` → Float32 → Int16 donusumu
- `createWavHeader(dataLength, sampleRate, channels, bitsPerSample)` → 44-byte WAV header
- `createWavBlob(pcmChunks, sampleRate, channels)` → WAV blob olustur

**Dosya boyutu:** ~5.6 MB/dakika (48kHz mono 16-bit)

**Detay:** `js/pipelines/WorkletPipeline.js` → `_setupPcmWav()`, `finishPcmWavEncoding()`

## MediaSource API

Gercek zamanli codec oynatma (chunk → SourceBuffer → Audio):
```javascript
const ms = new MediaSource();
audio.src = URL.createObjectURL(ms);
ms.addEventListener('sourceopen', () => {
  const sb = ms.addSourceBuffer(mimeType);
  sb.mode = 'sequence';
});
```
- `decodeAudioData` partial blob'u decode edemez
- `sb.updating` kontrolu sart (QuotaExceededError)

## Temizlik

### Stream Temizligi (DRY)

```javascript
// ❌ YANLIS - DRY ihlali
stream.getTracks().forEach(t => t.stop());

// ✅ DOGRU - utils.js helper kullan
import { stopStreamTracks } from './utils.js';
stopStreamTracks(stream);
```

### Node Cleanup Pattern (DRY)

```javascript
// ❌ YANLIS - Her node icin ayri (DRY ihlali)
if (this.processorNode) {
  this.processorNode.disconnect();
  this.processorNode.onaudioprocess = null;
  this.processorNode = null;
}
if (this.workletNode) {
  this.workletNode.disconnect();
  this.workletNode = null;
}

// ✅ DOGRU - BasePipeline.cleanup() pattern'i kullan
Object.values(this.nodes).forEach(node => {
  if (node) {
    try { node.disconnect(); } catch { /* ignore */ }
  }
});
// ScriptProcessor icin handler'i null yap
if (this.nodes.processor?.onaudioprocess) {
  this.nodes.processor.onaudioprocess = null;
}
```

**Not:** Pipeline'larda `BasePipeline.cleanup()` metodunu kullan/extend et.

### Diger Temizlik

```javascript
await ac.close();
URL.revokeObjectURL(blobUrl);
```

## Effect Decorator Pattern

Pipeline'lara runtime'da efekt eklemek icin Decorator Pattern:

```javascript
import { JitterEffect, PacketLossEffect } from '../pipelines/effects/index.js';

const withJitter = new JitterEffect(basePipeline, { maxDelay: 0.15 });
```

Detay: `micprobe-modules` skill'ine bak → "Effect Decorator Pattern" bolumu

## Kritik Kurallar

1. `AudioContext` → User gesture sonrasi, `suspended` ise `resume()` cagir
2. `AnalyserNode` → Destination'a baglanmadan da calisir
3. Sample rate uyumsuzlugu → Ses hizlanir/yavaslar (AudioContext options ile esle)
4. WebRTC remote stream → Direkt Web Audio'ya baglanmaz, once Audio element ile "aktive" et

### Remote Stream Aktivasyonu (DRY)

Chrome'da WebRTC remote stream'i dogrudan Web Audio'ya baglamak sorunlu olabilir. Helper kullan:

```javascript
import { createAndPlayActivatorAudio, cleanupActivatorAudio } from './utils.js';

// Aktivasyon (muted audio element ile)
const activator = await createAndPlayActivatorAudio(remoteStream, 'Context');

// Web Audio graph kur...

// Temizlik
cleanupActivatorAudio(activator);
```

Detay: `micprobe-loopback` skill'ine bak
