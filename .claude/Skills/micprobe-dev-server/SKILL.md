---
name: micprobe-dev-server
description: "MicBigProblem local server/dev ortam rehberi. Anahtar kelimeler: server.js, localhost:8080, port in use, python http.server, directory listing, EADDRINUSE"
---

# MicProbe — Dev Server & Port Triage

## Hedef

- `http://localhost:8080/` acilinca **Mic Probe** UI gelmeli (dizin listesi degil).
- `server.js` statik dosyalari servis eder ve `/` -> `mic_probe.html` yönlendirir.

## Tipik Sorun: 8080'de Dizin Listesi

Belirti:
- Browser'da `.ps1` dosyalari listeleniyor.

Muhtemel sebep:
- Baska bir proses `8080` portunu kullaniyor (cogunlukla `python -m http.server 8080`).

Kontrol:
- PowerShell: `Get-NetTCPConnection -LocalPort 8080`
- PID bul -> `Get-Process -Id <PID> | Select-Object ProcessName,Id,Path`

Cozum:
- Yanlis server’i kapat, sonra `node server.js` calistir.

## Node Server Calistirma

- Calistir: `node server.js`
- Port cakismasi olursa otomatik `8081`, `8082`... dener.

## Notlar

- AudioWorklet icin **localhost veya HTTPS** gerekir.
- Cache sorunlarinda hard refresh / devtools “Disable cache” kullan.

