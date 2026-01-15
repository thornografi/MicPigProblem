---
name: micprobe-ui-state
description: "MicProbe UI state, mod bazli UI, sidebar kategorileri, buton/selector kilitleme. Anahtar kelimeler: updateButtonStates, monitoring, recording, player, timer, disable, progress bar, call, record, kategori"
---

Zorunlu: Bu satirlari okuyorsan konsola "micprobe-ui-state SKILL.md okunuyor..." yaz.

# MicProbe — UI State & Davranis Kurallari

## UI Dil ve Olcek Tutarliligi

- Log console haric tum sayfa/arayuz metinleri Ingilizce olmalidir.
- Tasarimlarda farkli inch/ekran olcekleri birlikte dusunulmeli; tum boyutlarda birbirine benzer gorunum ve oranlar korunmalidir.

## Kategori Bazli UI Davranisi

### Sidebar Yapisi

Sidebar yapısı için bkz: `CLAUDE.md` → Uygulama Mimarisi

### Mod Bazli Kontrol Gorunurlugu (OCP)

UI, profil yeteneklerini (`canMonitor`, `canRecord`) okuyarak butonlari gosterir:

| Profil Tipi | canMonitor | canRecord | UI |
|-------------|------------|-----------|-----|
| call | true | false | Monitor + Test butonu |
| record | false | true | Sadece Kayıt + Player |

Not: Tüm `record` kategorisi profilleri (raw dahil) `canMonitor=false`.

### Test Butonu (call kategorisi)

7 saniyelik loopback test - Skype/Teams "Test your microphone" benzeri:

| State | currentMode | UI Davranisi |
|-------|-------------|--------------|
| Idle | `null` | Test butonu "Test" yaziyor |
| Recording | `test-recording` | Buton "Stop Test", countdown badge (7...1) |
| Playback | `test-playback` | Buton "Stop", kayit oynatiliyor |

**Body State:** `document.body.dataset.appState = 'testing'` (recording veya playback sirasinda)

**Kilitleme:** Test sirasinda Monitor, Record, profil secimi disabled.

### Temel Kural

- `profile.canMonitor` = true → Monitor butonu görünür
- `profile.canRecord` = true → Kayıt butonu + Player görünür
- Bu yetenekler Config.js'de otomatik hesaplanır (UI hesaplamaz)

## Ozel Ayarlar Paneli

- `customSettingsPanel` ana panelde genisletilebilir sekilde gosterilir.
- Her profilde gorunur, profil bazli locked/editable ayarlar dinamik olarak listelenir.
- **allowedValues:** Dropdown'lar sadece profilin izin verdigi degerleri gosterir.
- Profil degistiginde drawer (sidebar) artik acilmiyor - ayarlar direkt panelden gorulur.
- Kontrol: `js/ui/CustomSettingsPanelHandler.js` → `updatePanel()` metodu

## Sayaç (Timer) ve Countdown

**Kayit Timer:**
- Sayaç sadece **kayıt** icin anlamlidir.
- Monitoring'da timer gosterilmez (kayit yok). `startTimer()` sadece kayit basladiginda cagrilir.

**Test Countdown:**
- Test sirasinda buton uzerinde countdown badge gosterilir (7...1)
- `test:countdown` event'i her saniye emit edilir
- Countdown badge: `#testCountdown` elementi

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

- UI state: `js/modules/UIStateManager.js` → `updateButtonStates()`
- Status yonetimi: `js/modules/StatusManager.js` → recording/monitoring states
- Profil UI: `js/ui/ProfileUIManager.js` → `handleProfileSelect()`
- Profil logic: `js/modules/ProfileController.js` → `applyProfile()`
- Timer: `js/modules/UIStateManager.js` → `startTimer()/stopTimer()`
- Player: `js/modules/Player.js`
- Test: `js/controllers/MonitoringController.js` → test metodlari
- Stil: `css/style.css`

## CSS Responsive Breakpoint'ler

Unified panel layout icin breakpoint yapisi:

| Breakpoint | Layout | Aciklama |
|------------|--------|----------|
| 1024px+ | Grid 3 sutun | `grid-template-columns: 3fr 2fr 2fr` |
| 768-1023px | Flex wrap | Controls tam genislik, tips/status yan yana |
| <768px | Flex column | Mobil, sidebar gizli |
| <480px | Kompakt | Kucuk mobil optimizasyonlari |

### Breakpoint Dosya Konumlari

```css
/* css/style.css icinde */

/* 768-1023px tablet */
@media (min-width: 768px) and (max-width: 1023px) { ... }

/* 1024px+ desktop grid */
@media (min-width: 1024px) { ... }

/* <768px mobil */
@media (max-width: 768px) { ... }

/* <480px kucuk mobil */
@media (max-width: 480px) { ... }
```

### Breakpoint Degisiklik Rehberi

Yeni breakpoint eklerken:
1. Mevcut breakpoint'lerle cakisma kontrolu yap
2. `min-width` ve `max-width` araliklari birbirini tamamlamali
3. Test: Chrome DevTools → Toggle device toolbar
