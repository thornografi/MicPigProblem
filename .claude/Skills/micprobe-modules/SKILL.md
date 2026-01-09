---
name: micprobe-modules
description: "MicProbe modulleri ve Config referansi. Anahtar kelimeler: Config, PROFILES, SETTINGS, AudioEngine, Recorder, Monitor, Player, EventBus, ProfileController, UIStateManager, LoopbackManager, LogManager, Logger, profil kategorileri, call, record"
---

Zorunlu: Bu satirlari okuyorsan konsola "micprobe-modules SKILL.md okunuyor..." yaz.

# MicProbe Modul Referansi

## Uygulama Akisi

```
┌─────────────────────────────────────────────────────────────────┐
│  CALL Kategorisi (Discord, Zoom, WhatsApp/Telegram Arama)       │
│  ───────────────────────────────────────────────────────────    │
│  User clicks Monitor → MonitoringController.start()             │
│    → LoopbackManager.setup() → WebRTC Loopback                  │
│    → Monitor.startCodecSimulated() → Kendini duyma (1.7sn)      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  RECORD Kategorisi (WhatsApp/Telegram Voice, Legacy, Ham)       │
│  ───────────────────────────────────────────────────────────    │
│  User clicks Record → Recorder.start()                          │
│    → MediaRecorder → Blob                                       │
│  User clicks Play → Player.load(blob)                           │
└─────────────────────────────────────────────────────────────────┘
```

## Dosya Yapisi

```
js/
├── app.js                       # Orchestrator, event wiring (~907)
├── controllers/
│   ├── RecordingController.js   # Normal kayit wrapper (~120)
│   └── MonitoringController.js  # Loopback monitor + sinyal bekleme (~310)
├── pipelines/                   # Pipeline Strategy Pattern (OCP)
│   ├── index.js                 # Export barrel
│   ├── BasePipeline.js          # Abstract base class
│   ├── PipelineFactory.js       # Factory Method Pattern
│   ├── DirectPipeline.js        # WebAudio bypass
│   ├── StandardPipeline.js      # Source -> Destination
│   ├── ScriptProcessorPipeline.js # ScriptProcessor + WASM Opus
│   └── WorkletPipeline.js       # AudioWorkletNode
├── ui/
│   ├── ProfileUIManager.js      # Profil UI, scenario cards (~184)
│   ├── CustomSettingsPanelHandler.js # Ozel ayarlar paneli (~280)
│   ├── RadioGroupHandler.js     # Radio/checkbox event handler (~141)
│   └── DebugConsole.js          # Debug fonksiyonlari (~145)
├── lib/opus/
│   ├── encoderWorker.min.js     # opus-recorder WASM encoder (376KB)
│   └── OggOpusWriter.js         # Ogg Opus container writer (yedek)
├── worklets/
│   └── passthrough-processor.js # AudioWorklet processor
└── modules/
    ├── Config.js                # PROFILES, SETTINGS, getProfileValue
    ├── constants.js             # AUDIO, DELAY, VU_METER, SIGNAL, OPUS sabitleri
    ├── EventBus.js              # Pub/Sub singleton
    ├── ProfileController.js     # applyProfile, constraint logic
    ├── UIStateManager.js        # Buton state yonetimi, updateButtonStates
    ├── StatusManager.js         # Durum yonetimi (recording, monitoring states)
    ├── LoopbackManager.js       # WebRTC loopback setup
    ├── Recorder.js              # MediaRecorder + Pipeline Strategy
    ├── OpusWorkerHelper.js      # WASM Opus worker yonetimi
    ├── Monitor.js               # Modlar: direct, standard, worklet, codec-simulated
    ├── Player.js                # Blob oynatma
    ├── VuMeter.js               # dB gostergesi
    ├── AudioEngine.js           # Ses motoru, AudioContext yonetimi
    ├── DeviceInfo.js            # Mikrofon/cihaz bilgileri
    ├── StreamHelper.js          # MediaStream yardimci islemleri
    ├── WorkletHelper.js         # AudioWorklet yardimci islemleri
    ├── Logger.js                # UI log paneli gosterimi
    ├── LogManager.js            # IndexedDB log yonetimi
    ├── WaveAnimator.js          # Landing page ses dalgasi animasyonu
    └── utils.js                 # Genel yardimci fonksiyonlar
```

## Kategori & Profiller

| Kategori | Yetenek | Profiller |
|----------|---------|-----------|
| `call` | Monitoring only | discord, zoom, whatsapp-call, telegram-call |
| `record` | Recording + Playback | whatsapp-voice, telegram-voice, legacy, raw |

Profil detaylari: `Config.js` → `PROFILES`

## Controllers (Yeni)

### RecordingController
```javascript
import recordingController from './controllers/RecordingController.js';

// Normal kayit (record kategorisi icin) - Loopback YOK
await recordingController.toggle();
await recordingController.start();
await recordingController.stop();
```
**Not:** Loopback recording kaldirildi. Recording sadece MediaRecorder uzerinden (Recorder.js).

### MonitoringController
```javascript
import monitoringController from './controllers/MonitoringController.js';

// Loopback modunda monitor (call kategorisi icin)
await monitoringController.toggle();
await monitoringController.start();  // Sinyal bekler, sonra UI gunceller
await monitoringController.stop();
```
**Emits:** `monitor:started`, `monitor:stopped`, `stream:started`, `stream:stopped`, `loopback:remoteStream`
**Ozellik:** `_waitForSignal()` - WebRTC codec hazir olana kadar UI bekler

### ProfileUIManager
```javascript
import profileUIManager from './ui/ProfileUIManager.js';

profileUIManager.init(scenarioCards, navItems);
profileUIManager.updateSettingsPanel(profileId);
profileUIManager.handleProfileSelect(profileId);
```

### RadioGroupHandler (DRY Pattern)
```javascript
import { RadioGroupHandler } from './ui/RadioGroupHandler.js';
RadioGroupHandler.attachGroup('Pipeline', radios, { labels, logCategory, onChange });
RadioGroupHandler.attachGroups({ Pipeline: {...}, Encoder: {...} }); // Toplu kayit
RadioGroupHandler.attachToggle(toggleEl, 'AutoGain', { logCategory, onChange });
```
**Emits:** `setting:<name>:changed`

### DrawerController Factory (DRY Pattern)
```javascript
// app.js - createDrawerController(drawerEl, { overlay, lockBody })
const drawer = createDrawerController(el, { overlay });
drawer.open(); drawer.close(); drawer.toggle();
drawer.bindButtons(btn1, btn2); drawer.bindCloseButtons(closeBtn);
```

## Core Modules

### Config
```javascript
import { PROFILES, SETTINGS, getProfileValue } from './Config.js';

PROFILES['discord'].values.bitrate     // 64000
PROFILES['discord'].canMonitor         // true (OCP: otomatik)
PROFILES['discord'].canRecord          // false
getProfileValue('discord', 'bitrate')
```

### EventBus
```javascript
import eventBus from './EventBus.js';
eventBus.emit('event:name', data);
eventBus.on('event:name', callback);
```

### Recorder (record kategorisi icin)
```javascript
const recorder = new Recorder({ constraints });
await recorder.start(constraints, pipeline, encoder, timeslice, bufferSize, mediaBitrate);
recorder.stop();
```

**Pipeline Strategy Pattern (OCP):**
Recorder, pipeline kurulumu icin Strategy Pattern kullanir. Yeni pipeline eklemek icin:
1. `js/pipelines/NewPipeline.js` olustur (BasePipeline extend)
2. `PipelineFactory.js`'e ekle

**Mevcut Pipeline'lar:**
- `direct` → Web Audio yok, dogrudan MediaRecorder
- `standard` → AudioContext → MediaRecorder
- `scriptprocessor` → ScriptProcessorNode → MediaRecorder/WASM Opus
- `worklet` → AudioWorkletNode → MediaRecorder

**Pipeline Cleanup Pattern (Race Condition Prevention):**
Cleanup sırasında audio thread'den hala event'ler gelebilir:
1. Önce handler'ı temizle (null yap)
2. Sonra worker/buffer'ı temizle
3. Guard clause ekle (fallback)

**Örnek:** `WorkletPipeline.cleanup()` ve `ScriptProcessorPipeline.cleanup()`

**Encoder (Kayit Formati):**
- `mediarecorder` → Tarayici MediaRecorder API
- `wasm-opus` → WASM Opus encoder (WhatsApp Web pattern)

**Emits:** `recording:started`, `recording:completed`, `opus:progress`

### OpusWorkerHelper (WASM Opus icin)
```javascript
import { isWasmOpusSupported, createOpusWorker } from './OpusWorkerHelper.js';
const worker = await createOpusWorker({ sampleRate, channels, bitrate });
worker.encode(pcmData); const result = await worker.finish();
```
**Pattern:** `ScriptProcessorNode(4096, 1, 1) + WASM Opus` (WhatsApp Web)

### Monitor (MonitoringController uzerinden)
Modlar:
- `worklet` → Call kategorisi (WebRTC Loopback + AudioWorklet)
- `direct`, `standard` → Record kategorisi veya non-loopback monitoring
- `scriptprocessor` → **SADECE record kategorisi** (legacy profili, raw secenebilir). Call/arama modunda YASAK!
- `codec-simulated` → Loopback monitoring icin (dahili mod)

**Codec-Simulated:** Mic → MediaRecorder → MediaSource → Audio → DelayNode(1.7s) → Speaker

**Onemli:** ScriptProcessorNode deprecated API'dir ve sadece eski web kayit sitelerini simule etmek icin kullanilir. Call kategorisinde (WebRTC loopback) asla kullanilamaz.

### VuMeter
```javascript
new VuMeter({ barId, peakId, dotId });
```
**Listens:** `stream:started`, `loopback:remoteStream`

### Player
```javascript
new Player({ containerId, playBtnId, ... });
```
**Listens:** `recording:completed`

## Event Akisi

```
Recording (record):
  Recorder.start() → stream:started → recording:started
  Recorder.stop()  → recording:completed → stream:stopped

Monitoring (call):
  MonitoringController.start() → stream:started → loopback:remoteStream → monitor:started
  MonitoringController.stop()  → monitor:stopped → stream:stopped
```

## Gelistirme

**Yeni ayar eklemek:**
1. `Config.js` → SETTINGS'e ekle
2. `index.html` → HTML kontrol ekle (Settings Drawer icinde)
3. `ProfileUIManager.js` otomatik isle

**Yeni profil eklemek:**
1. `Config.js` → PROFILES'a createProfile() ile ekle
2. Sidebar'a HTML ekle (data-profile attribute)

---

## Mevcut Helper Katalogu

> Kod yazarken once bu listeyi kontrol et! DRY ihlalinden kacin.

### utils.js (js/modules/utils.js)

| Helper | Amac |
|--------|------|
| `stopStreamTracks(stream)` | MediaStream track'lerini durdur |
| `createAudioContext(opts)` | AudioContext factory + resume |
| `getAudioContextOptions(stream)` | Sample rate matching |
| `createMediaRecorder(stream, opts)` | MimeType fallback |
| `wrapAsyncHandler(fn, msg)` | Async try-catch wrapper |
| `toggleDisplay(el, show, display)` | DOM visibility |
| `formatTime(seconds)` | MM:SS format |
| `getBestAudioMimeType()` | Tarayici destekli mimeType |

### Pipeline Helper'lari (utils.js)

| Helper | Amac |
|--------|------|
| `needsBufferSetting(pipeline)` | Buffer ayari gerekli mi? |
| `usesWebAudio(pipeline)` | WebAudio kullaniyor mu? |
| `usesWasmOpus(encoder)` | WASM Opus kullaniyor mu? |
| `usesMediaRecorder(encoder)` | MediaRecorder kullaniyor mu? |
| `supportsWasmOpusEncoder(pipeline)` | WASM Opus destekler mi? |

### SettingTypeHandlers (utils.js - OCP)

```javascript
// Yeni setting tipi eklemek (OCP uyumlu)
SettingTypeHandlers.register('newType', {
  group: 'newTypes',
  render({ key, setting, isLocked, currentValue }) { ... }
});
```

### BasePipeline (js/pipelines/BasePipeline.js)

| Method | Amac |
|--------|------|
| `cleanup()` | Node disconnect loop (DRY) |
| `log(msg, details)` | Merkezi log:webaudio emit |

### constants.js (js/modules/constants.js)

| Helper | Amac |
|--------|------|
| `rmsToDb(rms)` | RMS -> dB donusumu |
| `dbToPercent(dB)` | dB -> yuzde donusumu |
| `calculateLatencyMs(sampleRate, bufferSize)` | Gecikme hesaplama |
| `bitrateToKbps(bps)` | Bitrate format |
| `bytesToKB(bytes)` | Boyut format |
