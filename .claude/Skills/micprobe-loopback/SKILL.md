---
name: micprobe-loopback
description: "WebRTC loopback pipeline ve debug rehberi. Anahtar kelimeler: loopback, RTCPeerConnection, SDP, opus bitrate, remote stream, activator audio, delay"
---

Zorunlu: Bu satirlari okuyorsan konsola "micprobe-loopback SKILL.md okunuyor..." yaz.

# MicProbe — WebRTC Loopback

**Ana dosya:** `LoopbackManager.js`

## Loopback Nedir?

```
Mikrofon -> pc1 (RTCPeerConnection) -> pc2 -> remote stream
```

WhatsApp/Discord benzeri WebRTC/Opus davranisini test eder. `call` kategorisi bunu kullanir.

## Kritik Chrome Davranisi (Remote Stream Aktivasyonu)

Bazi Chrome senaryolarinda remote stream'i dogrudan `createMediaStreamSource(remoteStream)` ile baglamak sorunlu olabilir.
Guvenli yol:

1. Remote stream'i bir `<audio>` elementine bagla
2. `audio.play()` ile "aktive et" (mute/volume=0 ile)
3. Sonra Web Audio graph kur

```javascript
// LoopbackManager.js - Activator pattern
const activatorAudio = document.createElement('audio');
activatorAudio.srcObject = remoteStream;
activatorAudio.muted = true;
activatorAudio.volume = 0;
await activatorAudio.play();
// Simdi Web Audio graph kurulabilir
```

**Cleanup:** `window._loopbackMonitorActivatorAudio` global'de tutulur, `cleanupMonitorPlayback()` icinde temizlenir.

## Gecikme (Monitoring)

Monitoring'da gecikme zorunlu - `DelayNode` ile hoparlore gider (feedback onleme).

```
remote stream -> Source -> [Worklet] -> DelayNode(1.7s) -> speaker
```

Modlar: `direct`, `standard`, `worklet` (ScriptProcessor loopback'te YASAK)

Deger: `constants.js` → `DELAY.DEFAULT_SECONDS` (1.7s), `DELAY.MAX_SECONDS` (3.0s)

## Opus Bitrate

SDP'de `maxaveragebitrate` ile set edilir. Detay: `LoopbackManager.js:setOpusBitrate()`

Bitrate degisimleri encoder init'i etkiler; loglarda gecikmeler gorulebilir.

## Dinamik Sinyal Bekleme (UI Senkronizasyonu)

WebRTC codec hazir olana kadar UI "Monitoring" durumuna gecmez.
Detay: `MonitoringController.js:_waitForSignal()`

```
Setup → [Sinyal bekle max 2sn] → UI "Monitoring" → Ses hemen gelir
```

Sabitler: `constants.js` → `SIGNAL.MAX_WAIT_MS` (2000), `SIGNAL.POLL_INTERVAL_MS` (50), `SIGNAL.RMS_THRESHOLD` (0.001)

**Not:** Loopback recording kaldirildi. Loopback sadece monitoring (call kategorisi) icin kullanilir.

## Debug Checklist

- ICE state `connected/completed` mi? (timeout: `LOOPBACK.ICE_WAIT_MS` = 3000ms)
- `ontrack` ile gelen stream `active=true` mi?
- Remote track `muted`/`readyState` ne?
- Monitor graph log'u delay'i gosteriyor mu (`delaySeconds: DELAY.DEFAULT_SECONDS`)?

## Tum Sabitler (constants.js)

| Sabit | Deger | Aciklama |
|-------|-------|----------|
| `DELAY.DEFAULT_SECONDS` | 1.7 | Feedback onleme gecikmesi |
| `DELAY.MAX_SECONDS` | 3.0 | DelayNode max |
| `SIGNAL.MAX_WAIT_MS` | 2000 | Sinyal bekleme timeout |
| `SIGNAL.POLL_INTERVAL_MS` | 50 | Polling araligi |
| `SIGNAL.RMS_THRESHOLD` | 0.001 | Sinyal algilama esigi |
| `LOOPBACK.ICE_WAIT_MS` | 3000 | ICE baglanti timeout |

