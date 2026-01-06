---
name: micprobe-modules
description: "MicProbe modulleri ve Config referansi. Anahtar kelimeler: Config, PROFILES, SETTINGS, AudioEngine, Recorder, Monitor, Player, EventBus, ProfileController, UIStateManager, LoopbackManager, LogManager, Logger, profil kategorileri, call, record, RadioGroupHandler, attachGroups, DrawerController, createDrawerController"
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

// Tek radio grubu
RadioGroupHandler.attachGroup('Pipeline', pipelineRadios, {
  labels: { direct: 'Direct', standard: 'Standard', scriptprocessor: 'ScriptProcessor' },
  logCategory: 'log:webaudio',
  onChange: (value) => { /* custom logic */ }
});

// Toplu kayit (tercih edilen)
RadioGroupHandler.attachGroups({
  Pipeline: { radios: pipelineRadios, labels: {...}, logCategory: 'log:webaudio', onChange: ... },
  Encoder: { radios: encoderRadios, labels: {...}, logCategory: 'log:webaudio' },
  'Buffer Size': { radios: bufferSizeRadios, logCategory: 'log:webaudio', formatValue: (v) => `${v} samples` },
  'Opus Bitrate': { radios: bitrateRadios, logCategory: 'log:stream', formatValue: (v) => `${v/1000} kbps` },
  Timeslice: { radios: timesliceRadios, logCategory: 'log:recorder', formatValue: (v) => `${v} ms` }
});

// Toggle/Checkbox
RadioGroupHandler.attachToggle(toggleEl, 'AutoGain', {
  logCategory: 'log:stream',
  onLabel: 'AKTIF',
  offLabel: 'PASIF',
  onChange: (value) => { /* ... */ }
});
```
**Emits:** `setting:<name>:changed` (generic event for listeners)

### DrawerController Factory (DRY Pattern)
```javascript
// app.js icerisinde
function createDrawerController(drawerEl, options = {}) {
  const { overlay = null, lockBody = false } = options;
  return {
    isOpen: () => drawerEl?.classList.contains('open'),
    open() { drawerEl?.classList.add('open'); overlay?.classList.add('active'); if(lockBody) document.body.style.overflow='hidden'; },
    close() { drawerEl?.classList.remove('open'); overlay?.classList.remove('active'); if(lockBody) document.body.style.overflow=''; },
    toggle() { this.isOpen() ? this.close() : this.open(); },
    bindButtons(...btns) { btns.flat().filter(Boolean).forEach(b => b.addEventListener('click', () => this.toggle())); },
    bindCloseButtons(...btns) { btns.flat().filter(Boolean).forEach(b => b.addEventListener('click', () => this.close())); }
  };
}

// Kullanim
const settingsDrawer = createDrawerController(settingsDrawerEl, { overlay: overlayEl });
const devConsole = createDrawerController(devConsoleEl);

settingsDrawer.bindButtons(settingsBtn);
settingsDrawer.bindCloseButtons(closeBtn, overlayEl);
devConsole.bindButtons(devConsoleBtn);
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

**Encoder (Kayit Formati):**
- `mediarecorder` → Tarayici MediaRecorder API
- `wasm-opus` → WASM Opus encoder (WhatsApp Web pattern)

**Emits:** `recording:started`, `recording:completed`, `opus:progress`

### OpusWorkerHelper (WASM Opus icin)
```javascript
import { isWasmOpusSupported, createOpusWorker } from './OpusWorkerHelper.js';

if (isWasmOpusSupported()) {
  const worker = await createOpusWorker({ sampleRate: 48000, channels: 1, bitrate: 16000 });
  worker.encode(pcmData);
  const result = await worker.finish(); // { blob, duration, frameCount }
}
```
**WhatsApp Web Pattern:** `ScriptProcessorNode(4096, 1, 1) + WASM Opus`

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
