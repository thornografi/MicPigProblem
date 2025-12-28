# MicBigProblem — Agent Guide (Skill Router)

Bu repoda proje-ozel “skills” dokumanlari `.claude/Skills/` altindadir.
Bir istek geldiginde once asagidaki router’dan uygun skill’i sec, sonra ilgili `SKILL.md` dosyasini acip oradaki akisa gore ilerle.

## Skill Router

| Konu / Anahtar Kelimeler | Skill | Dosya |
|---|---|---|
| `getUserMedia`, `MediaRecorder`, `AudioContext`, `VU meter`, `AudioWorklet`, `ScriptProcessor` | `web-audio-api` | `.claude/Skills/web-audio-api/SKILL.md` |
| Proje mimarisi, `EventBus`, `AudioEngine`, `Recorder`, `Monitor`, `Player`, `LogManager` | `micprobe-modules` | `.claude/Skills/micprobe-modules/SKILL.md` |
| WebRTC loopback, `RTCPeerConnection`, SDP/Opus bitrate, remote stream “activator”, loopback delay | `micprobe-loopback` | `.claude/Skills/micprobe-loopback/SKILL.md` |
| Log analizi, kategori tutarliligi, `runSanityChecks`, export/import | `micprobe-logging` | `.claude/Skills/micprobe-logging/SKILL.md` |
| UI state, monitoring vs recording, buton/selector kilitleme, player/timer davranisi | `micprobe-ui-state` | `.claude/Skills/micprobe-ui-state/SKILL.md` |
| Local server, port cakismasi, `server.js`, `localhost:8080`, python directory listing | `micprobe-dev-server` | `.claude/Skills/micprobe-dev-server/SKILL.md` |

## Hizli Referanslar

- **Server sorunlari** → `micprobe-dev-server` skill'ine bak
- **Delay/Monitoring** → `micprobe-loopback` skill'ine bak
- **WebRTC/Loopback** → `micprobe-loopback` skill'ine bak
