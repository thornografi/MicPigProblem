---
name: micprobe-logging
description: "MicProbe log analizi ve tutarlilik kontrolleri. Anahtar kelimeler: LogManager, Logger, runSanityChecks, exportLogs, getLogStats, IndexedDB, category"
---

# MicProbe — Logging & Sanity

## Log Kaynaklari

- UI log paneli: `Logger.js` (gosterim/filtre)
- Kalici log: `LogManager.js` (IndexedDB + kategori)

## Kategoriler (Kullanilan)

- `error`: hatalar (log:error)
- `stream`: getUserMedia, MediaStream, track settings (log:stream)
- `webaudio`: AudioContext / node graph detaylari (log:webaudio)
- `recorder`: MediaRecorder yasam dongusu (log:recorder)
- `system`: LogManager ve sistem event'leri (log:system)
- `log`: genel mesajlar (eventBus.emit('log', ...))

## Console Komutlari (F12)

- `exportLogs()` → tum loglari JSON indir
- `getLogStats()` → kategori sayilari
- `runSanityChecks()` → log akisinda mantik kontrolu (supheli bulgu raporu)

## Temizlik

```javascript
// LogManager singleton'i temizle (event listener'lari kaldir)
logManager.cleanup();
```

**Not:** `cleanup()` global `error` ve `unhandledrejection` listener'larini kaldirir.

## Sanity Kontrolleri Ne Arar?

- Monitoring ve recording ayni anda basladi mi?
- `monitor:started` icin `delaySeconds` var mi ve `DELAY.DEFAULT_SECONDS` mi?
- "WebAudio Pipeline: PASIF" iken monitor/record mode direct disi mi?
- Stream start/stop dengesi bozuk mu?

> **Not:** Delay degeri `constants.js` -> `DELAY.DEFAULT_SECONDS` (1.7s)

## Tipik “Yanlis Pozitif” Notu

- “WebAudio Pipeline: PASIF” iken `AudioEngine: Stream baglandi (VU Meter)` gorunmesi normaldir:
  VU meter icin AudioEngine her durumda AudioContext kullanir; bu pipeline toggle’undan bagimsizdir.

