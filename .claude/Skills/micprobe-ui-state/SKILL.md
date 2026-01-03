---
name: micprobe-ui-state
description: "MicProbe UI state, mod bazli UI, sidebar kategorileri, buton/selector kilitleme. Anahtar kelimeler: updateButtonStates, monitoring, recording, player, timer, disable, progress bar, call, record, kategori"
---

Zorunlu: Bu satirlari okuyorsan konsola "micprobe-ui-state SKILL.md okunuyor..." yaz.

# MicProbe — UI State & Davranis Kurallari

## Kategori Bazli UI Davranisi

### Sidebar Yapisi

Sidebar yapısı için bkz: `CLAUDE.md` → Uygulama Mimarisi

### Mod Bazli Kontrol Gorunurlugu (OCP)

UI, profil yeteneklerini (`canMonitor`, `canRecord`) okuyarak butonlari gosterir:

| Profil Tipi | canMonitor | canRecord | UI |
|-------------|------------|-----------|-----|
| call | true | false | Sadece Monitor |
| record | false | true | Sadece Kayıt + Player |

Not: Tüm `record` kategorisi profilleri (mictest dahil) `canMonitor=false`.

### Temel Kural

- `profile.canMonitor` = true → Monitor butonu görünür
- `profile.canRecord` = true → Kayıt butonu + Player görünür
- Bu yetenekler Config.js'de otomatik hesaplanır (UI hesaplamaz)

## Ozel Ayarlar Paneli

- `customSettingsPanel` ana panelde genisletilebilir sekilde gosterilir.
- Her profilde gorunur, profil bazli locked/editable ayarlar dinamik olarak listelenir.
- **allowedValues:** Dropdown'lar sadece profilin izin verdigi degerleri gosterir.
- Profil degistiginde drawer (sidebar) artik acilmiyor - ayarlar direkt panelden gorulur.
- Kontrol: `app.js` → `updateCustomSettingsPanel()` fonksiyonu

## Sayaç (Timer)

- Sayaç sadece **kayıt** icin anlamlidir.
- Monitoring'da timer gosterilmez (kayit yok). `startTimer()` sadece kayit basladiginda cagrilir.

## Player / Progress Bar

Sik gorulen problem:
- Yeni kayit yuklenince eski progress dolulugu ekranda kalir veya duration gec geldigi icin “yarilanmis” gorunur.

Cozum yaklasimi:
- Yeni kayit yuklenince progress fill `scaleX(0)` yap.
- Duration invalidken progress’i ya sifirla ya da `knownDurationSeconds` fallback ile hesapla.

## Profil Degisimi

Profil degistiginde:
1. Aktif islem varsa durdurulur
2. Yeni profil ayarlari uygulanir
3. Kategori degistiyse UI güncellenir (call↔record)
4. Gerekirse yeniden baslatilir

**Onemli:** `applyProfile()` icinde restart async bekler:
```javascript
// ProfileController.js - applyProfile() icinde
if (previousMode === 'monitoring') {
  await this.callbacks.stopMonitoring();
}
// ...ayarlar uygulanir...
if (previousMode === 'monitoring') {
  await this.callbacks.startMonitoring();
}
```

Bu sayede UI guncellemeleri ve monitoring restart senkronize olur.

## Dosya Referanslari

- UI state: `modules/UIStateManager.js` → `updateButtonStates()`
- Profil UI: `ui/ProfileUIManager.js` → `handleProfileSelect()`
- Profil logic: `modules/ProfileController.js` → `applyProfile()`
- Timer: `modules/UIStateManager.js` → `startTimer()/stopTimer()`
- Player: `modules/Player.js`
- Stil: `css/style.css`

