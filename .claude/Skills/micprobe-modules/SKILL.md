---
name: micprobe-modules
description: "MicProbe proje modulleri referansi. Anahtar kelimeler: AudioEngine, AudioUtils, VuMeter, Recorder, Monitor, Player, EventBus, DeviceInfo, Logger, LogManager, modul, module"
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
    ├── AudioUtils.js   # Paylasilan WebAudio yardimcilari
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
Merkezi yapilandirma - ayar tanimlari ve profil degerleri.
```javascript
import { PROFILES, SETTINGS, getProfileValue, validateSetting } from './Config.js';

// Profil degerleri
PROFILES.discord.values.ec    // true
PROFILES.discord.values.bitrate // 64000

// Ayar metadata
SETTINGS.buffer.values        // [1024, 2048, 4096]
SETTINGS.delay.min            // 0.5
SETTINGS.delay.max            // 5

// Helper fonksiyonlar
getProfileValue('discord', 'bitrate')  // 64000
validateSetting('buffer', 4096)        // true
getProfileList()                       // UI icin profil listesi
getSettingsByCategory('pipeline')      // Kategori bazli ayarlar
```
**Kategoriler:** constraints, pipeline, loopback, recording, monitor

### AudioUtils
Paylasilan WebAudio yardimci fonksiyonlari - Monitor/Recorder icin ortak.
```javascript
import { createAudioContext, createDelayNode, disconnectNodes, closeAudioContext, getStreamSampleRate } from './AudioUtils.js';

// AudioContext olustur ve resume et
const ctx = await createAudioContext(sampleRate, 'Monitor');

// DelayNode olustur (echo/feedback onleme)
const delay = createDelayNode(ctx, 2.0, 3.0);

// Node'lari guvenli disconnect et
disconnectNodes(sourceNode, delayNode, workletNode);

// AudioContext'i kapat
await closeAudioContext(ctx, 'Monitor');

// Stream'den sample rate al
const sr = getStreamSampleRate(stream);
```
**Emits:** `log:webaudio`

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
await recorder.start(constraints, recordMode, timeslice, bufferSize);
// recordMode: 'direct' | 'standard' | 'scriptprocessor' | 'worklet'
// timeslice: 0 (tek parca) veya pozitif ms (chunked)
// bufferSize: ScriptProcessor buffer boyutu (default: 4096)
recorder.stop();
recorder.getIsRecording();
```
**Emits:** `recording:started`, `recording:completed`, `stream:started`, `stream:stopped`

### Monitor
Canli mikrofon dinleme (4 mod).
```javascript
const monitor = new Monitor();
await monitor.startWebAudio(constraints);       // WebAudio + Delay
await monitor.startScriptProcessor(constraints);// Deprecated API + Delay
await monitor.startAudioWorklet(constraints);   // Modern AudioWorklet + Delay
await monitor.startDirect(constraints);         // Sadece Delay (processing yok)
await monitor.stop();
monitor.getMode();                    // 'standard' | 'scriptprocessor' | 'worklet' | 'direct'
```
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

## Console Debug Komutlari

```javascript
getAudioEngineState()   // AudioEngine durumu
getMonitorState()       // Monitor durumu
exportLogs()            // JSON indir
getLogStats()           // Kategori sayilari
```
