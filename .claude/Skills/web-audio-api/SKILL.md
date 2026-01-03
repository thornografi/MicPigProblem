---
name: web-audio-api
description: "Web Audio API, mikrofon, ses kaydi, VU meter. Anahtar kelimeler: getUserMedia, MediaRecorder, AudioContext, AnalyserNode, ScriptProcessorNode, AudioWorkletNode, GainNode, MediaStreamDestination, MediaSource"
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
rec.onstop = () => { /* TEMIZLIK BURADA */ };
```
- `rec.stop()` asenkron - temizlik `onstop` icinde
- Detay: `modules/Recorder.js`

## Node Turleri

| Node | Kullanim | Olusturma |
|------|----------|-----------|
| AnalyserNode | VU meter, sinyal kontrolu | `ac.createAnalyser()` |
| DelayNode | Feedback onleme (1.7sn) | `ac.createDelay(maxSec)` |
| GainNode | Ses seviyesi | `ac.createGain()` |
| ScriptProcessorNode | Legacy passthrough | `ac.createScriptProcessor(bufferSize, in, out)` |
| AudioWorkletNode | Modern passthrough | `new AudioWorkletNode(ac, 'processor-name')` |
| MediaStreamDestination | WebAudio → MediaRecorder | `ac.createMediaStreamDestination()` |

## VU Meter Pattern

```javascript
analyser.fftSize = AUDIO.FFT_SIZE; // 256
analyser.getByteTimeDomainData(data);
// RMS -> dB donusumu (constants.js helper'lari kullan)
const dB = rmsToDb(rms);
const percent = dbToPercent(dB);
```
- Detay: `modules/VuMeter.js`, `modules/constants.js` (AUDIO, VU_METER)
- Helper'lar: `rmsToDb()`, `dbToPercent()`, `calculateLatencyMs()`, `bitrateToKbps()`

## AudioWorklet Pattern

```javascript
await ac.audioWorklet.addModule('passthrough-processor.js');
const node = new AudioWorkletNode(ac, 'passthrough-processor');
```
- Detay: `modules/WorkletHelper.js`, `worklets/passthrough-processor.js`
- ScriptProcessor deprecated - worklet tercih et

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
- Detay: `modules/Monitor.js` (startCodecSimulated)

## Temizlik

```javascript
stream.getTracks().forEach(t => t.stop());
await ac.close();
URL.revokeObjectURL(blobUrl);
```

## Kritik Kurallar

1. `AudioContext` → User gesture sonrasi, `suspended` ise `resume()` cagir
2. `AnalyserNode` → Destination'a baglanmadan da calisir
3. Sample rate uyumsuzlugu → Ses hizlanir/yavaslar (AudioContext options ile esle)
4. WebRTC remote stream → Direkt WebAudio'ya baglanmaz, once Audio element ile "aktive" et
