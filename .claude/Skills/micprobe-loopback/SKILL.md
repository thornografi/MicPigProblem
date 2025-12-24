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

- Monitoring’da gecikme “opsiyon” degil; daima `DelayNode(2s)` ile hoparlore gider (feedback/echo onleme).
- Loopback monitoring da ayni kuraldadir: remote stream -> (opsiyonel Worklet/ScriptProcessor) -> Delay(2s) -> speaker

## Opus Bitrate

SDP icinde `maxaveragebitrate` ile set edilir.
Bitrate degisimleri encoder init/stabilizasyonu etkileyebilir; loglarda gecikmeler gorulebilir.

## Debug Checklist

- ICE state `connected/completed` mi?
- `ontrack` ile gelen stream `active=true` mi?
- Remote track `muted`/`readyState` ne?
- Monitor graph log’u delay’i gosteriyor mu (`delaySeconds: 2.0`)?

