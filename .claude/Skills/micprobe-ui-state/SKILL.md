---
name: micprobe-ui-state
description: "MicProbe UI state, monitoring/recording ayrimi ve kontrol kilitleme. Anahtar kelimeler: updateButtonStates, monitoring, recording, player, timer, disable, progress bar"
---

# MicProbe — UI State & Davranis Kurallari

## Temel Kural

- **Monitoring** basladiginda kayit tarafindaki butun kontroller kilitlenir (kullanici karistirmasin).
- **Recording** sirasinda ise kayitla ilgili kontroller aktif kalir, diger ayarlar kilitlenir.

## Sayaç (Timer)

- Sayaç sadece **kayıt** icin anlamlidir.
- Monitoring’da timer gosterme (kayıt yok). Uygulama bunu `startTimer(isMonitoring)` ile kontrol eder.

## Player / Progress Bar

Sik gorulen problem:
- Yeni kayit yuklenince eski progress dolulugu ekranda kalir veya duration gec geldigi icin “yarilanmis” gorunur.

Cozum yaklasimi:
- Yeni kayit yuklenince progress fill `scaleX(0)` yap.
- Duration invalidken progress’i ya sifirla ya da `knownDurationSeconds` fallback ile hesapla.

## Nereye Bakilir?

- UI state: `js/app.js` -> `updateButtonStates()`
- Timer: `js/app.js` -> `startTimer()/stopTimer()`
- Player: `js/modules/Player.js`
- Stil/disabled gorunumu: `css/style.css`

