---
name: micprobe-modules
description: "MicProbe proje modulleri ve Config referansi. Anahtar kelimeler: AudioEngine, Config, PROFILES, SETTINGS, VuMeter, Recorder, Monitor, Player, EventBus, DeviceInfo, modul, module"
---

# MicProbe Modul Referansi

## Dosya Yapisi

```
js/
├── app.js              # Orchestrator + Loopback + UI bindings
└── modules/
    ├── Config.js       # Merkezi yapilandirma (SETTINGS, PROFILES)
    ├── EventBus.js     # Pub/Sub singleton
    ├── AudioEngine.js  # Merkezi AudioContext (singleton)
    ├── AudioUtils.js   # (KALDIRILDI - bos modul, inline pattern kullaniliyor)
    ├── VuMeter.js      # dB gostergesi
    ├── Recorder.js     # Kayit (MediaRecorder)
    ├── Monitor.js      # Canli dinleme
    ├── Player.js       # Oynatma
    ├── DeviceInfo.js   # Bilgi paneli
    ├── Logger.js       # UI log paneli
    ├── LogManager.js   # IndexedDB loglama
    ├── StatusManager.js# Durum badge
    ├── StreamHelper.js # getUserMedia wrapper
    ├── WorkletHelper.js# AudioWorklet yardimcilari
    └── utils.js        # formatTime, getBestAudioMimeType helpers
```

## Modül Detaylari

### Config
Merkezi yapilandirma - ayar tanimlari, profil degerleri ve UI binding.
```javascript
import { PROFILES, SETTINGS, getProfileValue, validateSetting } from './Config.js';

// Profil degerleri (Guncellendi: discord=Gamer/Hi-Fi, zoom=Konferans)
PROFILES.discord.values.bitrate      // 96000 (Gamer/Hi-Fi)
PROFILES.discord.values.channelCount // 2 (Stereo)
PROFILES.zoom.values.bitrate         // 48000 (Konferans)
PROFILES.zoom.values.channelCount    // 1 (Mono - locked)

// Voice profil degerleri (codec-simulated monitor icin)
PROFILES.whatsapp.values.mediaBitrate // 16000
PROFILES.whatsapp.values.timeslice    // 250 (chunk uretimi icin)
PROFILES.telegram.values.mediaBitrate // 24000
PROFILES.telegram.values.timeslice    // 250

// Ayar metadata + UI binding
SETTINGS.buffer.values          // [1024, 2048, 4096]
SETTINGS.buffer.ui              // { type: 'radio', name: 'bufferSize' }
SETTINGS.ec.ui                  // { type: 'checkbox', id: 'ec' }
SETTINGS.loopback.ui            // { type: 'toggle', id: 'loopbackToggle' }
SETTINGS.sampleRate.values      // [16000, 22050, 44100, 48000]
SETTINGS.sampleRate.ui          // { type: 'radio', name: 'sampleRate' }
SETTINGS.channelCount.values    // [1, 2]
SETTINGS.channelCount.labels    // { 1: 'Mono', 2: 'Stereo' }
SETTINGS.bitrate.values         // [32000, 48000, 64000, 96000, 128000]

// Helper fonksiyonlar
getProfileValue('discord', 'bitrate')  // 96000
validateSetting('buffer', 4096)        // true
getProfileList()                       // UI icin profil listesi
getSettingsByCategory('constraints')   // ec, ns, agc, sampleRate, channelCount
```
**Kategoriler:** constraints, pipeline, loopback, recording

**UI Tipleri:** checkbox, toggle, radio (enum icin)

### EventBus (Singleton)
```javascript
import eventBus from './EventBus.js';
eventBus.emit('event:name', data);
eventBus.on('event:name', callback);
eventBus.once('event:name', callback); // Tek seferlik
```

### AudioEngine (Singleton)
Merkezi AudioContext - VuMeter ve diger moduller kullanir.
```javascript
import audioEngine from './AudioEngine.js';
await audioEngine.warmup();           // Pre-init (sayfa yuklenmesinde)
audioEngine.connectStream(stream);    // Mikrofon bagla
audioEngine.getContext();             // AudioContext
audioEngine.getAnalyser();            // AnalyserNode (fftSize: 256)
audioEngine.getState();               // Debug bilgisi
```
**Emits:** `log:webaudio`

### VuMeter
dB bazli ses seviyesi gostergesi. AudioEngine'den AnalyserNode kullanir.
```javascript
new VuMeter({ barId, peakId, dotId });
```
**Listens:** `stream:started`, `stream:stopped`
**Emits:** `vumeter:level`, `vumeter:audiocontext`

### Recorder
MediaRecorder + opsiyonel WebAudio pipeline.
```javascript
const recorder = new Recorder({ constraints });
await recorder.warmup();              // Pre-init
await recorder.start(constraints, recordMode, timeslice, bufferSize, mediaBitrate);
// recordMode: 'direct' | 'standard' | 'scriptprocessor' | 'worklet'
// timeslice: 0 (tek parca) veya pozitif ms (chunked)
// bufferSize: ScriptProcessor buffer boyutu (default: 4096)
// mediaBitrate: MediaRecorder bitrate - sesli mesaj simulasyonu icin (default: 0)
recorder.stop();
recorder.getIsRecording();
```
**Emits:** `recording:started`, `recording:completed`, `stream:started`, `stream:stopped`

### Monitor
Canli mikrofon dinleme (5 mod).
```javascript
const monitor = new Monitor();
await monitor.startWebAudio(constraints);       // WebAudio + Delay
await monitor.startScriptProcessor(constraints);// Deprecated API + Delay
await monitor.startAudioWorklet(constraints);   // Modern AudioWorklet + Delay
await monitor.startDirect(constraints);         // Sadece Delay (processing yok)
await monitor.startCodecSimulated(constraints, mediaBitrate, mode, timeslice, bufferSize);  // Codec simülasyonu
await monitor.stop();
monitor.getMode();  // 'standard' | 'scriptprocessor' | 'worklet' | 'direct' | 'codec-simulated'
```

**Codec-Simulated Mode:**
- Recording ile birebir ayni pipeline
- MediaRecorder → MediaSource → Audio → Delay → Speaker
- Parametreler: mediaBitrate, mode, timeslice, bufferSize
- WhatsApp/Telegram gibi profillerde otomatik aktif (mediaBitrate > 0)

**Emits:** `monitor:started`, `monitor:stopped`, `stream:started`, `stream:stopped`

### Player
Kayit oynatma.
```javascript
new Player({ containerId, playBtnId, progressBarId, progressFillId, timeId, filenameId, metaId, downloadBtnId, noRecordingId });
```
**Listens:** `recording:completed`, `recording:started`
**Emits:** `player:loaded`, `player:ended`, `player:reset`

### DeviceInfo
AudioContext ve stream bilgi paneli.
```javascript
const deviceInfo = new DeviceInfo();
await deviceInfo.initFromAudioEngine();  // AudioEngine'den bilgi al
```
**Listens:** `vumeter:level`, `vumeter:audiocontext`, `stream:started`

### Logger
UI log paneli (filtrelenebilir).
```javascript
new Logger('containerId');
```
**Listens:** `log`, `log:*` (tum kategoriler)

### LogManager (Singleton)
IndexedDB'ye kategorili loglama.
```javascript
import logManager from './LogManager.js';
logManager.getAll();
logManager.getByCategory('webaudio');
logManager.exportJSON();
```
**Listens:** `log:error`, `log:webaudio`, `log:stream`, `log:recorder`, `log:system`

### StatusManager
Durum badge gostergesi.
```javascript
new StatusManager('badgeId');
```
**Listens:** `recording:started`, `monitor:started`, `stream:stopped`

## Event Haritasi

| Event | Emitter | Listener |
|-------|---------|----------|
| `stream:started` | Recorder, Monitor, app.js | VuMeter, DeviceInfo, LogManager |
| `stream:stopped` | Recorder, Monitor, app.js | VuMeter, StatusManager, LogManager |
| `recording:started` | Recorder, app.js | Player, StatusManager |
| `recording:completed` | Recorder, app.js | Player, LogManager |
| `recorder:started` | Recorder, app.js | LogManager |
| `recorder:stopped` | Recorder, app.js | LogManager |
| `recorder:error` | Recorder | app.js |
| `monitor:started` | Monitor, app.js | StatusManager, LogManager |
| `monitor:stopped` | Monitor, app.js | StatusManager, LogManager |
| `monitor:error` | Monitor | app.js |
| `vumeter:level` | VuMeter | DeviceInfo |
| `vumeter:audiocontext` | VuMeter | DeviceInfo |
| `vumeter:started` | VuMeter | - |
| `vumeter:stopped` | VuMeter | - |
| `player:loaded` | Player | - |
| `player:ended` | Player | - |
| `player:paused` | Player | - |
| `player:reset` | Player | - |
| `status:changed` | StatusManager | - |
| `log` | Any | Logger |
| `log:webaudio` | AudioEngine, Monitor, Recorder, app.js | LogManager, Logger |
| `log:stream` | app.js, Monitor, StreamHelper | LogManager, Logger |
| `log:recorder` | Recorder, app.js | LogManager, Logger |
| `log:system` | app.js, LogManager | LogManager, Logger |
| `log:error` | Any | LogManager, Logger |
| `log:clear` | app.js | Logger |

## Yeni Modul Ekleme

1. `js/modules/YeniModul.js` olustur
2. EventBus import et
3. Dinleyecegi event'leri `eventBus.on()` ile bagla
4. Yayinlayacagi event'leri `eventBus.emit()` ile gonder
5. `app.js`'de import et ve baslat
6. Bu SKILL.md'yi guncelle

## Yeni Ayar Ekleme (OCP Mimari)

Sadece **2 dosya** degisikligi gerekir:

### 1. Config.js - SETTINGS'e ekle
```javascript
yeniAyar: {
  type: 'boolean',           // veya 'enum'
  default: false,
  label: 'Yeni Ayar',
  category: 'constraints',
  ui: { type: 'checkbox', id: 'yeniAyar' }  // UI binding
}
```

### 2. mic_probe.html - HTML kontrol ekle
```html
<input id="yeniAyar" type="checkbox" data-setting="yeniAyar">
```

### Otomatik Calisan Mekanizmalar
- `getSettingElements()` - Config.js `ui` metadata'dan dinamik
- `applyProfile()` - Profil degerleri dinamik uygulanir
- `updateSettingVisibility()` - Locked/editable durumu dinamik
- Custom Settings Panel - Otomatik listelenir

## Console Debug Komutlari

```javascript
getAudioEngineState()   // AudioEngine durumu
getMonitorState()       // Monitor durumu
exportLogs()            // JSON indir
getLogStats()           // Kategori sayilari
```
