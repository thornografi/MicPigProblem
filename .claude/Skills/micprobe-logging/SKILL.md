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

## Sanity Kontrolleri Ne Arar?

- Monitoring ve recording ayni anda basladi mi?
- `monitor:started` icin `delaySeconds` var mi ve 2.0s mi?
- “WebAudio Pipeline: PASIF” iken monitor/record mode direct disi mi?
- Stream start/stop dengesi bozuk mu?

## Tipik “Yanlis Pozitif” Notu

- “WebAudio Pipeline: PASIF” iken `AudioEngine: Stream baglandi (VU Meter)` gorunmesi normaldir:
  VU meter icin AudioEngine her durumda AudioContext kullanir; bu pipeline toggle’undan bagimsizdir.

