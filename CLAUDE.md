# MicBigProblem

Farklı ses teknolojilerini kullanan(electron, scriptprocessornode,  WebRTC ve Chromium vb.) uygulamalardaki mikrofon sorunlarini tespit edebilmek için simülasyon yapan uygulama.

	> Vibe coding notu: Eğer bir agent bu dosyayı okuyorsa, session sırasında "düşünme" aşamasına geçerken önce `(md dosyası okunuyor..)` yaz.

	> ⚠️ **ZORUNLU KONTROL - KOD DEĞİŞİKLİĞİ SONRASI**
> Tüm md dosyalarının güncellik kontrolleri (insert, update, create, delete)

	> 🚫 **AGENTS.md SİLİNMEMELİ**
> `AGENTS.md` dosyası Codex tarafından okunur ve skill routing için kullanılır. Bu dosya asla silinmemeli, içeriği `.claude/Skills/` altındaki SKILL.md dosyalarıyla senkron tutulmalıdır.


## Uygulama Mimarisi

### İki Ana Mod

```
┌─────────────────────────────────────────────────────────────────┐
│  📞 SESLİ GÖRÜŞME (call)                                        │
│  ─────────────────────────────────                              │
│  Amaç: WebRTC codec kalite testi (kendini duyma)                │
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
├── WhatsApp Web Arama
└── Telegram Web Arama

🎙️ Kayıt
├── WhatsApp Sesli Mesaj
├── Telegram Sesli Mesaj
├── Eski Web Kayıt
└── Ham Kayıt
```

### Kategori Bazlı Yetenekler

| Kategori | Yetenekler | UI Aksiyonları |
|----------|------------|----------------|
| `call` | Monitoring only | 🎧 Monitor |
| `record` | Recording + Playback | 🔴 Kayıt, ▶️ Oynat |


## Skill Router

Bu tablo `AGENTS.md` ile birebir aynidir. Detayli dokumantasyon ilgili skill dosyalarinda tutulur: `.claude/Skills/<skill>/SKILL.md`

| Konu / Anahtar Kelimeler | Skill | Dosya |
|---|---|---|
| `getUserMedia`, `MediaRecorder`, `AudioContext`, `AnalyserNode`, `ScriptProcessorNode`, `AudioWorkletNode`, `GainNode`, `MediaStreamDestination`, `MediaSource` | `web-audio-api` | `.claude/Skills/web-audio-api/SKILL.md` |
| Proje mimarisi, `Config`, `EventBus`, `Recorder`, `Monitor`, `Player`, `RecordingController`, `MonitoringController`, `ProfileUIManager`, modul yapisi, profil kategorileri | `micprobe-modules` | `.claude/Skills/micprobe-modules/SKILL.md` |
| WebRTC loopback, `RTCPeerConnection`, SDP/Opus bitrate, remote stream "activator", loopback delay | `micprobe-loopback` | `.claude/Skills/micprobe-loopback/SKILL.md` |
| Log analizi, kategori tutarliligi, `runSanityChecks`, export/import | `micprobe-logging` | `.claude/Skills/micprobe-logging/SKILL.md` |
| UI state, mod bazli UI, sidebar kategorileri, buton/selector kilitleme, player/timer davranisi | `micprobe-ui-state` | `.claude/Skills/micprobe-ui-state/SKILL.md` |
| Skill audit, AGENTS.md, CLAUDE.md senkronizasyon, routing, duplicate, hardcoded, guncellik kontrolu | `skill-control` | `.claude/Skills/skill-control/SKILL.md` |

---

## Bulgu Duzeltme Sonrasi Zorunlu Analiz

> **KRITIK:** Bir bulgu/hata duzeltildikten sonra asagidaki 3 analiz ZORUNLU!

### 1. Varyant Analizi (Benzer Kod Kontrolu)

Duzeltilen pattern baska yerlerde de var mi?

`
SORU: Bu hata/eksiklik baska dosyalarda da olabilir mi?
      |
      +-- EVET → Grep ile tum repo'yu tara, ayni fix'i uygula
      |
      +-- HAYIR → Devam et
`

**Ornek:** `.Count` tuzagi bir yerde duzeltildiyse, tum repo'da ara:
`powershell
rg -n ")\s*\.Count" src | rg -v "@\("
`

### 2. Etki Analizi (Yan Etki Kontrolu)

Duzeltme baska yerleri kirdi mi?

`
SORU: Bu degisiklik baska fonksiyonlari/modulleri etkiler mi?
      |
      +-- EVET → Etkilenen yerleri guncelle, test et
      |
      +-- HAYIR → Devam et
`

> **Detay icin:** `skill-control` skill'ine bak

### 3. DRY Ihlali Analizi (Tekrar Eden Kod)

Ayni/benzer kod birden fazla yerde mi var?

`
SORU: Bu fix'i uygularken copy-paste yaptin mi?
      |
      +-- EVET → Helper fonksiyon olustur, tek noktadan yonet
      |
      +-- HAYIR → Devam et

SORU: Ayni mantik 2+ yerde tekrarlaniyor mu?
      |
      +-- EVET → Refactor: Ortak kod Utils'e tasinmali
      |
      +-- HAYIR → Devam et
`

### Checklist (Her Fix Sonrasi)

`
[ ] Varyant taramasi yaptim (grep/rg ile)
[ ] Etki analizi yaptim (bagimlilari kontrol ettim)
[ ] DRY kontrolu yaptim (tekrar eden kod yok)
[ ] Skill güncellemesi gerekip gerekmediğini kontrol ettim ve gerekiyorsa güncelledim
`
