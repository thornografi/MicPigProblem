# MicBigProblem — Agent Guide (Skill Router)

Zorunlu: Bu satirlari okuyorsan konsola "AGENTS.md okunuyor..." yaz.

Bu repoda proje-ozel "skills" dokumanlari `.claude/Skills/` altindadir.
Bir istek geldiginde once asagidaki router'dan uygun skill'i sec, sonra ilgili `SKILL.md` dosyasini acip oradaki akisa gore ilerle.

## Uygulama Mimarisi (Ozet)

```
📞 Sesli Görüşme (call)     │  🎙️ Kayıt (record)
────────────────────────────┼─────────────────────────────
WebRTC Loopback (Opus)      │  MediaRecorder + mediaBitrate
Monitoring only             │  Recording + Playback
Discord, Zoom/Meet/Teams,   │  WhatsApp Voice, Telegram Voice,
WhatsApp Call, Telegram Call│  Eski Web, Ham Kayıt

call: Monitoring only (Recording yeteneği yok)
record: Recording + Playback
```

## Skill Router

| Konu / Anahtar Kelimeler | Skill | Dosya |
|---|---|---|
| `getUserMedia`, `MediaRecorder`, `AudioContext`, `AnalyserNode`, `ScriptProcessorNode`, `AudioWorkletNode`, `GainNode`, `MediaStreamDestination`, `MediaSource` | `web-audio-api` | `.claude/Skills/web-audio-api/SKILL.md` |
| Proje mimarisi, `Config`, `EventBus`, `Recorder`, `Monitor`, `Player`, `RecordingController`, `MonitoringController`, `ProfileUIManager`, modul yapisi, profil kategorileri | `micprobe-modules` | `.claude/Skills/micprobe-modules/SKILL.md` |
| WebRTC loopback, `RTCPeerConnection`, SDP/Opus bitrate, remote stream "activator", loopback delay | `micprobe-loopback` | `.claude/Skills/micprobe-loopback/SKILL.md` |
| Log analizi, kategori tutarliligi, `runSanityChecks`, export/import | `micprobe-logging` | `.claude/Skills/micprobe-logging/SKILL.md` |
| UI state, mod bazli UI, sidebar kategorileri, buton/selector kilitleme, player/timer davranisi | `micprobe-ui-state` | `.claude/Skills/micprobe-ui-state/SKILL.md` |
| Skill audit, AGENTS.md, CLAUDE.md senkronizasyon, routing, duplicate, hardcoded, guncellik kontrolu | `skill-control` | `.claude/Skills/skill-control/SKILL.md` |

## Hizli Referanslar

- **Delay/Monitoring** → `micprobe-loopback` skill'ine bak
- **WebRTC/Loopback** → `micprobe-loopback` skill'ine bak
- **Profil kategorileri** → `micprobe-modules` skill'ine bak
- **UI mod davranisi** → `micprobe-ui-state` skill'ine bak
- **Browser Testing** → CLAUDE.md "Browser Testing" bölümüne bak

---

## Browser Testing (Chrome Extension)

> **KRİTİK:** Tarayıcı testi için DAIMA `http://localhost:8080` kullan!

```
✅ DOĞRU: http://localhost:8080
❌ YANLIŞ: file:///C:/... veya C:/Users/...
```

### Bağlantı Sırası

```
1. tabs_context_mcp(createIfEmpty: true) → Tab al
2. Mevcut tab'da localhost:8080 açık mı? → AÇIKSA kullan
3. navigate(tabId, "http://localhost:8080") → Sayfaya git
4. screenshot / read_page / find → Test et
```

### Server Durumu

| Tray Icon | Durum | Aksiyon |
|-----------|-------|---------|
| 🟢 Yeşil | Çalışıyor | Direkt bağlan |
| 🔴 Kırmızı | Kapalı | Hook otomatik başlatır |

**Hook:** Yanlış URL yazsan bile (`file://`, `C:/`) otomatik `localhost:8080`'e çevirir.

**Detaylı bilgi:** CLAUDE.md → "Browser Testing" bölümü

---

## Bulgu Duzeltme Sonrasi Zorunlu Analiz

> **KRITIK:** Bir bulgu/hata duzeltildikten sonra asagidaki 3 analiz ZORUNLU!

### 1. Varyant Analizi (Benzer Kod Kontrolu)

Duzeltilen pattern baska yerlerde de var mi?

```
SORU: Bu hata/eksiklik baska dosyalarda da olabilir mi?
      |
      +-- EVET → Grep ile tum repo'yu tara, ayni fix'i uygula
      |
      +-- HAYIR → Devam et
```

**Ornek:** Bir event listener leak duzeltildiyse, tum JS dosyalarinda ara:
```bash
rg -n "addEventListener" js/ | rg -v "removeEventListener"
```

### 2. Etki Analizi (Yan Etki Kontrolu)

Duzeltme baska yerleri kirdi mi?

```
SORU: Bu degisiklik baska fonksiyonlari/modulleri etkiler mi?
      |
      +-- EVET → Etkilenen yerleri guncelle, test et
      |
      +-- HAYIR → Devam et
```

> **Detay icin:** `skill-control` skill'ine bak

### 3. DRY Ihlali Analizi (Tekrar Eden Kod)

Ayni/benzer kod birden fazla yerde mi var?

```
SORU: Bu fix'i uygularken copy-paste yaptin mi?
      |
      +-- EVET → Helper fonksiyon olustur, tek noktadan yonet
      |
      +-- HAYIR → Devam et

SORU: Ayni mantik 2+ yerde tekrarlaniyor mu?
      |
      +-- EVET → Refactor: Ortak kodu modullestir
      |
      +-- HAYIR → Devam et
```

### Checklist (Her Fix Sonrasi)

```
[ ] Varyant taramasi yaptim (grep/rg ile)
[ ] Etki analizi yaptim (bagimlilari kontrol ettim)
[ ] DRY kontrolu yaptim (tekrar eden kod yok)
[ ] Skill güncellemesi gerekip gerekmediğini kontrol ettim ve gerekiyorsa güncelledim
```
