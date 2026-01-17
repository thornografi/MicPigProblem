---
name: micprobe-loopback
description: "WebRTC loopback pipeline ve debug rehberi. Anahtar kelimeler: loopback, RTCPeerConnection, SDP, opus bitrate, remote stream, activator audio, delay"
---

Zorunlu: Bu satirlari okuyorsan konsola "micprobe-loopback SKILL.md okunuyor..." yaz.

# MicProbe — WebRTC Loopback

**Ana dosya:** `js/modules/LoopbackManager.js`

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
// DRY: utils.js helper'larini kullan
import { createAndPlayActivatorAudio, cleanupActivatorAudio } from './utils.js';

// Aktivasyon
const activatorAudio = await createAndPlayActivatorAudio(remoteStream, 'Loopback Monitor');
// Simdi Web Audio graph kurulabilir

// Temizlik
cleanupActivatorAudio(activatorAudio);
```

**Helper'lar (utils.js):**
- `createAndPlayActivatorAudio(stream, context)` - Audio element olustur, play() cagir, log emit et
- `cleanupActivatorAudio(audio)` - pause() + srcObject = null

## Gecikme (Monitoring)

Monitoring'da gecikme zorunlu - `DelayNode` ile hoparlore gider (feedback onleme).

```
remote stream -> Source -> [Worklet] -> DelayNode(1.7s) -> speaker
```

Modlar: `direct`, `standard`, `worklet` (ScriptProcessor loopback'te YASAK)

Deger: `js/modules/constants.js` → `DELAY.DEFAULT_SECONDS` (1.7s), `DELAY.MAX_SECONDS` (3.0s)

## Opus Bitrate

SDP'de `maxaveragebitrate` ile set edilir. Detay: `js/modules/LoopbackManager.js:setOpusBitrate()`

Bitrate degisimleri encoder init'i etkiler; loglarda gecikmeler gorulebilir.

## Dinamik Sinyal Bekleme (UI Senkronizasyonu)

WebRTC codec hazir olana kadar UI "Monitoring" durumuna gecmez.
Detay: `js/controllers/MonitoringController.js:_waitForSignal()`

```
Setup → [Sinyal bekle max 2sn] → UI "Monitoring" → Ses hemen gelir
```

Sabitler: `js/modules/constants.js` → `SIGNAL.MAX_WAIT_MS` (2000), `SIGNAL.POLL_INTERVAL_MS` (50), `SIGNAL.RMS_THRESHOLD` (0.001)

**Not:** Loopback recording kaldirildi. Loopback sadece monitoring (call kategorisi) icin kullanilir.

## Bitrate Monitoring

`startStatsPolling()` WebRTC getStats ile gercek bitrate olcer.

**Grace Period:** Ilk 3 olcum (6 saniye) boyunca sapma uyarisi verilmez. Bunun nedeni:
- WebRTC baslangicta ramp-up yapar
- DTX (Discontinuous Transmission) sessizlikte dusuk bitrate kullanir
- Baslangic sapmasi normal davranis

Sapma esigi: `> %50` → `log:warning` emit edilir

## Cleanup & Race Condition

`_isCleaningUp` flag'i race condition onlemek icin kullanilir:
- ICE candidate handler'larinda: cleanup sirasinda gec gelen candidate'ler sessizce atlanir
- Stats polling'de: cleanup sirasinda interval otomatik durur
- Tum async islemler bu flag'i kontrol eder

```javascript
// ICE handler pattern
if (e.candidate && this.pc2 && !this._isCleaningUp) {
  this.pc2.addIceCandidate(e.candidate).catch(err => {
    if (!this._isCleaningUp) {
      // Sadece cleanup degilse warning ver
    }
  });
}
```

## Debug Checklist

- ICE state `connected/completed` mi? (timeout: `LOOPBACK.ICE_WAIT_MS` = 10000ms)
- `ontrack` ile gelen stream `active=true` mi?
- Remote track `muted`/`readyState` ne?
- Monitor graph log'u delay'i gosteriyor mu (`delaySeconds: DELAY.DEFAULT_SECONDS`)?
- Bitrate sapmasi var mi? (ilk 6sn normal, sonrasi kontrol edilir)

## Tum Sabitler (js/modules/constants.js)

| Sabit | Deger | Aciklama |
|-------|-------|----------|
| `DELAY.DEFAULT_SECONDS` | 1.7 | Feedback onleme gecikmesi |
| `DELAY.MAX_SECONDS` | 3.0 | DelayNode max |
| `SIGNAL.MAX_WAIT_MS` | 2000 | Sinyal bekleme timeout |
| `SIGNAL.POLL_INTERVAL_MS` | 50 | Polling araligi |
| `SIGNAL.RMS_THRESHOLD` | 0.001 | Sinyal algilama esigi |
| `LOOPBACK.ICE_WAIT_MS` | 10000 | ICE baglanti timeout |

