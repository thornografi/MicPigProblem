# MicBigProblem

Farklı ses teknolojilerini kullanan(electron, scriptprocessornode,  WebRTC ve Chromium vb.) uygulamalardaki mikrofon sorunlarini tespit edebilmek için simülasyon yapan uygulama.

	> Vibe coding notu: Eğer bir agent bu dosyayı okuyorsa, session sırasında "düşünme" aşamasına geçerken önce `(md dosyası okunuyor..)` yaz.

	> ⚠️ **ZORUNLU KONTROL - KOD DEĞİŞİKLİĞİ SONRASI**
> Tüm md dosyalarının insert update,create,delete güncellik(up to date) kontrolleri.

	> 🚫 **AGENTS.md SİLİNMEMELİ**
> `AGENTS.md` dosyası Codex tarafından okunur ve skill routing için kullanılır. Bu dosya asla silinmemeli, içeriği `.claude/Skills/` altındaki SKILL.md dosyalarıyla senkron tutulmalıdır.


## Uygulama Mimarisi

### İki Ana Mod

```
┌─────────────────────────────────────────────────────────────────┐
│  📞 SESLİ GÖRÜŞME (call)                                        │
│  ─────────────────────────────────                              │
│  Amaç: WebRTC codec gecikmesi/kalite testi                      │
│  Teknoloji: WebRTC Loopback (Opus)                              │
│  Birincil Aksiyon: Monitoring (kendini duyma)                   │
│  Profiller: Discord, Zoom/Meet/Teams, WhatsApp Call, Telegram Call │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  🎙️ KAYIT (record)                                              │
│  ─────────────────                                              │
│  Amaç: MediaRecorder codec kalite testi                         │
│  Teknoloji: MediaRecorder + mediaBitrate                        │
│  Birincil Aksiyon: Recording + Playback                         │
│  Profiller: WhatsApp Sesli Mesaj, Telegram Voice, Eski Web, Ham │
└─────────────────────────────────────────────────────────────────┘
```

### Sidebar Yapısı

```
📞 Sesli Görüşme
├── Discord
├── Zoom / Meet / Teams
├── WhatsApp Arama
└── Telegram Arama

🎙️ Kayıt
├── WhatsApp Sesli Mesaj
├── Telegram Sesli Mesaj
├── Eski Web Kayıt
└── Ham Kayıt
```

### Kategori Bazlı Davranış

| Kategori | Birincil UI | İkincil UI | Gizli |
|----------|-------------|------------|-------|
| `call` | 🎧 Monitor | - | Recording |
| `record` | 🔴 Kayıt | ▶️ Oynat | - |


## Skill Router

Bu tablo `AGENTS.md` ile birebir aynidir. Detayli dokumantasyon ilgili skill dosyalarinda tutulur: `.claude/Skills/<skill>/SKILL.md`

| Konu / Anahtar Kelimeler | Skill | Dosya |
|---|---|---|
| `getUserMedia`, `MediaRecorder`, `AudioContext`, `VU meter`, `AnalyserNode`, `MediaSource`, `decodeAudioData` | `web-audio-api` | `.claude/Skills/web-audio-api/SKILL.md` |
| Proje mimarisi, `EventBus`, `Config`, `Recorder`, `Monitor`, `Player`, modul yapisi, profil kategorileri | `micprobe-modules` | `.claude/Skills/micprobe-modules/SKILL.md` |
| WebRTC loopback, `RTCPeerConnection`, SDP/Opus bitrate, remote stream "activator", loopback delay | `micprobe-loopback` | `.claude/Skills/micprobe-loopback/SKILL.md` |
| Log analizi, kategori tutarliligi, `runSanityChecks`, export/import | `micprobe-logging` | `.claude/Skills/micprobe-logging/SKILL.md` |
| UI state, mod bazli UI, sidebar kategorileri, buton/selector kilitleme, player/timer davranisi | `micprobe-ui-state` | `.claude/Skills/micprobe-ui-state/SKILL.md` |
| Local server, port cakismasi, `server.js`, `localhost:8080`, python directory listing | `micprobe-dev-server` | `.claude/Skills/micprobe-dev-server/SKILL.md` |
| Skill audit, AGENTS.md, CLAUDE.md senkronizasyon, routing, duplicate, hardcoded, guncellik kontrolu | `skill-control` | `.claude/Skills/skill-control/SKILL.md` |
