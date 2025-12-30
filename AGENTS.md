# MicBigProblem — Agent Guide (Skill Router)

Bu repoda proje-ozel “skills” dokumanlari `.claude/Skills/` altindadir.
Bir istek geldiginde once asagidaki router’dan uygun skill’i sec, sonra ilgili `SKILL.md` dosyasini acip oradaki akisa gore ilerle.

## Skill Router

| Konu / Anahtar Kelimeler | Skill | Dosya |
|---|---|---|
| `getUserMedia`, `MediaRecorder`, `AudioContext`, `VU meter`, `AnalyserNode`, `MediaSource`, `decodeAudioData` | `web-audio-api` | `.claude/Skills/web-audio-api/SKILL.md` |
| Proje mimarisi, `EventBus`, `AudioEngine`, `Config`, `Recorder`, `Monitor`, `Player`, modul yapisi | `micprobe-modules` | `.claude/Skills/micprobe-modules/SKILL.md` |
| WebRTC loopback, `RTCPeerConnection`, SDP/Opus bitrate, remote stream "activator", loopback delay | `micprobe-loopback` | `.claude/Skills/micprobe-loopback/SKILL.md` |
| Log analizi, kategori tutarliligi, `runSanityChecks`, export/import | `micprobe-logging` | `.claude/Skills/micprobe-logging/SKILL.md` |
| UI state, monitoring vs recording, buton/selector kilitleme, player/timer davranisi | `micprobe-ui-state` | `.claude/Skills/micprobe-ui-state/SKILL.md` |
| Local server, port cakismasi, `server.js`, `localhost:8080`, python directory listing | `micprobe-dev-server` | `.claude/Skills/micprobe-dev-server/SKILL.md` |
| Skill audit, AGENTS.md, CLAUDE.md senkronizasyon, routing, duplicate, hardcoded, guncellik kontrolu | `skill-control` | `.claude/Skills/skill-control/SKILL.md` |

## Hizli Referanslar

- **Server sorunlari** → `micprobe-dev-server` skill'ine bak
- **Delay/Monitoring** → `micprobe-loopback` skill'ine bak
- **WebRTC/Loopback** → `micprobe-loopback` skill'ine bak
