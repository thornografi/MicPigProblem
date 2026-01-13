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

### VU Meter Event Sıralama Kuralı

> **KRİTİK:** `pipeline:analyserReady` event'i MUTLAKA `stream:started`'dan ÖNCE emit edilmeli!

```
DOĞRU SIRALAMA:
1. pipeline:analyserReady → VuMeter.startWithAnalyser() → Pipeline analyser kullan
2. stream:started → VuMeter.start() → Guard ile atla (this.analyser zaten set)

YANLIŞ SIRALAMA:
1. stream:started → VuMeter.start() → AudioEngine baglan (GEREKSIZ!)
2. pipeline:analyserReady → startWithAnalyser() → audioEngine.disconnect()
```

| Senaryo | Event Sırası | VU Kaynağı |
|---------|--------------|------------|
| Record | pipeline:analyserReady → stream:started | Pipeline.analyserNode |
| Monitor | pipeline:analyserReady → stream:started | Monitor.analyserNode |
| Loopback | stream:started (pipeline yok) | AudioEngine (HAM) |


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

## Kod Yazarken Proaktif DRY Kontrol

> **KRITIK:** Yeni kod yazmadan ONCE bu checklist'i uygula!

### Quick Check (Her Zaman)

| Adim | Soru | Aksiyon |
|------|------|---------|
| 1 | Bu islem icin helper var mi? | `utils.js` kontrol et |
| 2 | Bu kod 3+ yerde mi tekrar edecek? | Helper yaz |
| 3 | AudioNode cleanup mi? | `BasePipeline.cleanup()` pattern kullan |

### Helper Referans (utils.js)

| Islem | Helper | Ornek |
|-------|--------|-------|
| Stream durdur | `stopStreamTracks(stream)` | `stopStreamTracks(this.stream)` |
| AudioContext | `createAudioContext(opts)` | `await createAudioContext({sampleRate})` |
| MediaRecorder | `createMediaRecorder(stream, opts)` | `createMediaRecorder(stream, {audioBitsPerSecond})` |
| Async error wrap | `wrapAsyncHandler(fn, msg)` | `btn.onclick = wrapAsyncHandler(handler, 'Error')` |
| DOM visibility | `toggleDisplay(el, show)` | `toggleDisplay(panel, true, 'flex')` |
| Zaman format | `formatTime(seconds)` | `formatTime(125)` → "2:05" |

### Pipeline & Encoder Helper'lari (utils.js)

| Helper | Amac |
|--------|------|
| `needsBufferSetting(pipeline)` | Buffer ayari gerekli mi? |
| `usesWebAudio(pipeline)` | WebAudio kullaniyor mu? |
| `supportsWasmOpusEncoder(pipeline)` | WASM Opus destekler mi? |
| `usesMediaRecorder(encoder)` | MediaRecorder kullaniyor mu? |
| `usesWasmOpus(encoder)` | WASM Opus kullaniyor mu? |
| `shouldDisableTimeslice(loopback, encoder)` | Timeslice disabled olmali mi? |

### Anti-Pattern (YAPMA)

```javascript
// ❌ DRY ihlali
stream.getTracks().forEach(t => t.stop());

// ✅ Dogru
stopStreamTracks(stream);

// ❌ DRY ihlali - Her node icin ayri
if (this.node1) { this.node1.disconnect(); this.node1 = null; }
if (this.node2) { this.node2.disconnect(); this.node2 = null; }

// ✅ Dogru - Loop ile (BasePipeline.cleanup() pattern)
Object.values(this.nodes).forEach(n => n?.disconnect?.());
```

### Esik Degerleri (Asiri Muhendislikten Kacin)

| Tekrar | Aksiyon |
|--------|---------|
| < 3 | Inline birak |
| 3-4 | Helper dusun |
| 5+ | Kesinlikle helper |

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
