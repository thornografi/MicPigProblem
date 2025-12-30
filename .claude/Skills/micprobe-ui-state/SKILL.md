---
name: micprobe-ui-state
description: "MicProbe UI state, monitoring/recording ayrimi ve kontrol kilitleme. Anahtar kelimeler: updateButtonStates, monitoring, recording, player, timer, disable, progress bar"
---

# MicProbe — UI State & Davranis Kurallari

## Temel Kural

- **Monitoring** basladiginda kayit tarafindaki butun kontroller kilitlenir (kullanici karistirmasin).
- **Recording** sirasinda ise kayitla ilgili kontroller aktif kalir, diger ayarlar kilitlenir.

## Ozel Ayarlar Paneli

- `customSettingsPanel` ana panelde genisletilebilir sekilde gosterilir.
- Her profilde gorunur, profil bazli locked/editable ayarlar dinamik olarak listelenir.
- Profil degistiginde drawer (sidebar) artik acilmiyor - ayarlar direkt panelden gorulur.
- Kontrol: `updateCustomSettingsPanel()` fonksiyonu icerisinde.

## Sayaç (Timer)

- Sayaç sadece **kayıt** icin anlamlidir.
- Monitoring'da timer gosterilmez (kayit yok). `startTimer()` sadece kayit basladiginda cagrilir.

## Player / Progress Bar

Sik gorulen problem:
- Yeni kayit yuklenince eski progress dolulugu ekranda kalir veya duration gec geldigi icin “yarilanmis” gorunur.

Cozum yaklasimi:
- Yeni kayit yuklenince progress fill `scaleX(0)` yap.
- Duration invalidken progress’i ya sifirla ya da `knownDurationSeconds` fallback ile hesapla.

## Profil Degisimi ve Monitoring

Profil degistiginde aktif monitoring/recording yeni ayarlarla yeniden baslatilir.

**Onemli:** `applyProfile()` icinde restart async bekler:
```javascript
// app.js - applyProfile() icinde
if (previousMode === 'monitoring') {
  await monitorToggleBtn.onclick();  // Restart tamamlanana kadar bekle
}
```

Bu sayede UI guncellemeleri ve monitoring restart senkronize olur.

## Nereye Bakilir?

- UI state: `js/app.js` -> `updateButtonStates()`
- Timer: `js/app.js` -> `startTimer()/stopTimer()`
- Profil degisimi: `js/app.js` -> `applyProfile()`
- Player: `js/modules/Player.js`
- Stil/disabled gorunumu: `css/style.css`

