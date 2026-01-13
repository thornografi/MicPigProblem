---
name: micprobe-logging
description: "MicProbe log analizi ve tutarlilik kontrolleri. Anahtar kelimeler: LogManager, Logger, runSanityChecks, exportLogs, getLogStats, IndexedDB, category"
---

Zorunlu: Bu satirlari okuyorsan konsola "micprobe-logging SKILL.md okunuyor..." yaz.

# MicProbe — Logging & Sanity

## Log Kaynaklari

- UI log paneli: `js/modules/Logger.js` (gosterim/filtre)
- Kalici log: `js/modules/LogManager.js` (IndexedDB + kategori)

## Kategoriler

`LogManager.js:LOG_CATEGORIES` → 8 kategori:
- `error`: hatalar → `console.error` (kirmizi)
- `warning`: uyarilar → `console.warn` (turuncu)
- `audio`: genel audio olaylari
- `stream`: getUserMedia, MediaStream, track settings
- `webaudio`: AudioContext / node graph detaylari
- `recorder`: MediaRecorder yasam dongusu
- `system`: LogManager ve sistem event'leri
- `ui`: UI olaylari + genel `log` event'leri

Her kategori icin `log:<category>` event'i dinlenir.

## Console Komutlari (F12)

`js/ui/DebugConsole.js` uzerinden global'e expose edilir:
- `exportLogs()` → tum loglari JSON indir
- `getLogStats()` → kategori sayilari
- `runSanityChecks()` → log akisinda mantik kontrolu

## Sanity Kontrolleri

`getSanityReport()` su durumları kontrol eder:
- Monitoring + recording cakismasi
- Monitor delay degeri eksik/hatali mi
- Web Audio Pipeline pasifken mode uyumsuzlugu
- Stream start/stop dengesi
- `PIPELINE_LABEL_MISMATCH`: Loopback aktifken pipelineDesc "WebRTC Loopback" icermeli

### Severity Seviyeleri

| Kod | Severity | Aciklama |
|-----|----------|----------|
| `RECORDING_ACTIVE` | `info` | Check sirasinda kayit devam ediyor (normal) |
| `MONITORING_ACTIVE` | `info` | Check sirasinda monitoring devam ediyor (normal) |
| `STREAM_BALANCE_NONZERO` | `warn` | Start/stop dengesi bozuk |
| `PIPELINE_LABEL_MISMATCH` | `warn` | Loopback label tutarsizligi |
| `MONITOR_MODE_MISMATCH` | `error` | WebAudio pasifken mode hatasi |

**Not:** `runSanityChecks()` aktif session sirasinda cagrilabilir. Bu durumda `RECORDING_ACTIVE` / `MONITORING_ACTIVE` hata degil, bilgi amaclidir.

