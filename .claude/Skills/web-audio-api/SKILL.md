---
name: web-audio-api
description: "Web Audio API, mikrofon, ses kaydi, VU meter. Anahtar kelimeler: microphone, getUserMedia, MediaRecorder, AudioContext, AnalyserNode, decodeAudioData, MediaSource"
---

# Web Audio API Rehberi

## Mikrofon Erisimi

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
});
const settings = stream.getAudioTracks()[0].getSettings();
```

## Ses Kaydi

```javascript
const rec = new MediaRecorder(stream);
rec.ondataavailable = e => chunks.push(e.data);
rec.onstop = () => {
  const blob = new Blob(chunks, { type: rec.mimeType });
  // ONEMLI: Temizlik onstop icinde yap, rec.stop() sonrasi degil
};
rec.start();
```

## VU Meter

```javascript
import { AUDIO, VU_METER } from './constants.js';

const ac = new AudioContext();
const src = ac.createMediaStreamSource(stream);
const analyser = ac.createAnalyser();
analyser.fftSize = AUDIO.FFT_SIZE; // 256
src.connect(analyser);

// RMS -> dB
const data = new Uint8Array(AUDIO.FFT_SIZE);
analyser.getByteTimeDomainData(data);
let sum = 0;
for (let i = 0; i < data.length; i++) {
  const v = (data[i] - AUDIO.CENTER_VALUE) / AUDIO.CENTER_VALUE; // 128
  sum += v * v;
}
const rms = Math.sqrt(sum / data.length);
const dB = rms > VU_METER.RMS_THRESHOLD ? 20 * Math.log10(rms) : VU_METER.MIN_DB;
// VU_METER.RMS_THRESHOLD = 0.0001, VU_METER.MIN_DB = -60
```

## Monitor (Dinleme)

```javascript
import { DELAY } from './constants.js';

// Delay ile (feedback onleme)
const delay = ac.createDelay(DELAY.MAX_SECONDS);  // 3.0
delay.delayTime.value = DELAY.DEFAULT_SECONDS;   // 1.7
src.connect(delay).connect(ac.destination);
```

## WebRTC Loopback

> **Detayli bilgi:** `micprobe-loopback` skill'ine bak
>
> Bu skill WebRTC/loopback konularini kapsamaz - sadece temel Web Audio API.

## Temizlik

```javascript
stream.getTracks().forEach(t => t.stop());
await ac.close();
URL.revokeObjectURL(blobUrl);
```

## MediaSource API (Gercek Zamanli Codec Oynatma)

MediaRecorder chunk'larini gercek zamanli oynatmak icin:

```javascript
// MediaSource olustur
const mediaSource = new MediaSource();
const audio = document.createElement('audio');
audio.src = URL.createObjectURL(mediaSource);

// SourceBuffer ayarla
mediaSource.addEventListener('sourceopen', () => {
  const sourceBuffer = mediaSource.addSourceBuffer('audio/webm;codecs=opus');
  sourceBuffer.mode = 'sequence';  // Sirali ekleme

  // Chunk'lari isle
  sourceBuffer.addEventListener('updateend', processNextChunk);
});

// MediaRecorder'dan chunk'lari al
recorder.ondataavailable = async (e) => {
  if (e.data.size > 0) {
    const buffer = await e.data.arrayBuffer();
    if (!sourceBuffer.updating) {
      sourceBuffer.appendBuffer(buffer);
    }
  }
};
```

**Onemli:**
- `decodeAudioData` partial blob'u decode edemez - MediaSource API gerekli
- `sourceBuffer.mode = 'sequence'` sirali ekleme icin
- `sourceBuffer.updating` kontrolu QuotaExceededError onler
- Temizlik: `URL.revokeObjectURL()` ve `mediaSource.endOfStream()`

## Kritik Kurallar

1. `getUserMedia` -> HTTPS/localhost gerekli
2. `rec.stop()` asenkron -> onstop icinde temizlik
3. `AudioContext` -> User gesture sonrasi baslatilmali
4. `AnalyserNode` -> Ses cikisina baglanmadan da calisir
5. Constraints -> Tarayici garanti etmez, `getSettings()` ile kontrol et
