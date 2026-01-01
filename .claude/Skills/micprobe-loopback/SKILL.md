---
name: micprobe-loopback
description: "WebRTC loopback pipeline ve debug rehberi. Anahtar kelimeler: loopback, RTCPeerConnection, SDP, opus bitrate, remote stream, activator audio, delay"
---

# MicProbe — WebRTC Loopback

## Loopback Nedir?

Mikrofon -> `RTCPeerConnection(pc1)` -> `RTCPeerConnection(pc2)` -> remote stream

Bu sayede “WhatsApp benzeri” WebRTC/Opus davranisini test ederiz.

## Kritik Chrome Davranisi (Remote Stream Aktivasyonu)

Bazi Chrome senaryolarinda remote stream’i dogrudan `createMediaStreamSource(remoteStream)` ile baglamak sorunlu olabilir.
Guvenli yol:

1. Remote stream’i bir `<audio>` elementine bagla
2. `audio.play()` ile “aktive et” (mute/volume=0 ile)
3. Sonra WebAudio graph kur

## Gecikme (Monitoring)

- Monitoring'da gecikme "opsiyon" degil; daima `DelayNode(DELAY.DEFAULT_SECONDS)` ile hoparlore gider (feedback/echo onleme).
- Loopback monitoring da ayni kuraldadir: remote stream -> (opsiyonel Worklet/ScriptProcessor) -> Delay -> speaker
- Deger: `constants.js` -> `DELAY.DEFAULT_SECONDS` (1.7s)

## Opus Bitrate

SDP icinde `maxaveragebitrate` ile set edilir.
Bitrate degisimleri encoder init/stabilizasyonu etkileyebilir; loglarda gecikmeler gorulebilir.

## Dinamik Sinyal Bekleme (Polling)

Kayit baslatilmadan once codec'in hazir olmasini beklemek icin **polling** kullanilir:

```javascript
import { SIGNAL } from './constants.js';

// Sabit sure yerine sinyal algilanana kadar bekle
const maxWait = SIGNAL.MAX_WAIT_MS;        // 2000
const pollInterval = SIGNAL.POLL_INTERVAL_MS; // 50
const threshold = SIGNAL.RMS_THRESHOLD;    // 0.001
let waited = 0;

while (waited < maxWait && !signalDetected) {
  analyserNode.getByteTimeDomainData(testArray);
  const rms = calculateRms(testArray);
  if (rms > threshold) break;
  await sleep(pollInterval);
  waited += pollInterval;
}
```

**Avantajlari:**
- Hizli sistemlerde gereksiz bekleme yok
- Yavas sistemlerde codec hazir olmadan kayit baslamaz
- Bos/sessiz kayit sorunu onlenir

**Log ornegi:**
```
Loopback: Sinyal bekleniyor (max 2000ms)
Loopback: Sinyal bekleme tamamlandi - ✅ SINYAL VAR (waited: 150ms)
```

## Debug Checklist

- ICE state `connected/completed` mi?
- `ontrack` ile gelen stream `active=true` mi?
- Remote track `muted`/`readyState` ne?
- Monitor graph log'u delay'i gosteriyor mu (`delaySeconds: DELAY.DEFAULT_SECONDS`)?

