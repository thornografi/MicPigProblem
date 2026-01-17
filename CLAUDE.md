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
| Stream hata mesaji | `getStreamErrorMessage(err)` | `getStreamErrorMessage(err)` → "Microphone permission denied" |
| Async error wrap | `wrapAsyncHandler(fn, msg)` | `btn.onclick = wrapAsyncHandler(handler, 'Error')` |
| DOM visibility | `toggleDisplay(el, show)` | `toggleDisplay(panel, true, 'flex')` |
| Zaman format | `formatTime(seconds)` | `formatTime(125)` → "2:05" |
| Activator audio olustur | `createAndPlayActivatorAudio(stream, ctx)` | `await createAndPlayActivatorAudio(remoteStream, 'Loopback')` |
| Activator audio temizle | `cleanupActivatorAudio(audio)` | `cleanupActivatorAudio(this.activatorAudio)` |

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

---

## Browser Testing (Chrome Extension)

> **KRİTİK:** Bu projeyi tarayıcıda test ederken DAIMA `localhost:8080` kullan!

### Bağlantı Kuralları

```
┌─────────────────────────────────────────────────────────────────┐
│  ✅ DOĞRU                          ❌ YANLIŞ                    │
│  ─────────────────                 ──────────────────           │
│  http://localhost:8080             file:///C:/...               │
│  http://localhost:8080/index.html  C:/Users/.../index.html      │
│  http://127.0.0.1:8080             c//users/... (malformed)     │
└─────────────────────────────────────────────────────────────────┘
```

### Server Yönetimi

| Durum | Aksiyon |
|-------|---------|
| Server kapalı | Hook otomatik başlatır (2sn bekle) |
| Server açık | Direkt bağlan |
| Tray icon YEŞİL | Server çalışıyor ✓ |
| Tray icon KIRMIZI | Server kapalı |

**Manuel başlatma (gerekirse):**
```powershell
Start-Process pwsh -Args '-File "C:\Tools\powershell\LocalhostServerTray.ps1"' -WindowStyle Hidden
```

### Chrome Extension Kullanım Sırası

```
1. tabs_context_mcp(createIfEmpty: true)
   └─→ Mevcut MCP tab group'u al veya yeni oluştur

2. Mevcut tab'da localhost:8080 AÇIK MI kontrol et
   └─→ AÇIKSA: O tab'ı kullan (yeni pencere AÇMA)
   └─→ KAPALI: navigate ile localhost:8080'e git

3. navigate(tabId, "http://localhost:8080")
   └─→ Hook otomatik düzeltir (file:// veya C:/ yazsan bile)

4. screenshot / read_page / find / form_input
   └─→ Artık sayfa üzerinde çalışabilirsin
```

### Mevcut Tab Kullanımı (Yeni Pencere Açmamak İçin)

```javascript
// ÖNCELİKLE mevcut tab'ları kontrol et
tabs_context_mcp → availableTabs içinde localhost:8080 var mı?

// VARSA: O tabId'yi kullan
navigate(existingTabId, "http://localhost:8080/profiles.html")

// YOKSA: Yeni tab oluştur
tabs_create_mcp → yeni tabId al
navigate(newTabId, "http://localhost:8080")
```

### Test Profilleri (Hızlı Erişim)

| Profil | URL |
|--------|-----|
| Ana sayfa | `http://localhost:8080` |
| Discord sim | `http://localhost:8080` → Sidebar: Discord |
| WhatsApp record | `http://localhost:8080` → Sidebar: WhatsApp Sesli Mesaj |
| Raw recording | `http://localhost:8080` → Sidebar: Ham Kayıt |

### Troubleshooting

| Hata | Çözüm |
|------|-------|
| "Frame with ID 0 is showing error page" | Server kapalı - Tray'den başlat |
| "No tabs available" | `tabs_context_mcp(createIfEmpty: true)` çağır |
| Yanlış URL navigate | Hook düzeltir ama `localhost:8080` yaz |
| Yeni pencere açılıyor | Aynı conversation'da kal, `tabs_context_mcp` tekrar çağırma |
