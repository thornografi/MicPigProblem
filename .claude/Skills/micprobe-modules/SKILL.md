---
name: micprobe-modules
description: "MicProbe proje modulleri ve Config referansi. Anahtar kelimeler: AudioEngine, Config, PROFILES, SETTINGS, VuMeter, Recorder, Monitor, Player, EventBus, DeviceInfo, RecordingController, MonitoringController, ProfileUIManager, modul, module, profil kategorileri, call, record"
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
├── app.js                       # Orchestrator, event wiring (~940)
├── controllers/
│   ├── RecordingController.js   # Normal kayit wrapper (~120)
│   └── MonitoringController.js  # Loopback monitor + sinyal bekleme (~310)
├── ui/
│   ├── ProfileUIManager.js      # Profil UI, settings panel (~190)
│   └── DebugConsole.js          # Debug fonksiyonlari (~145)
└── modules/
    ├── Config.js                # PROFILES, SETTINGS
    ├── constants.js             # AUDIO, DELAY, VU_METER, SIGNAL
    ├── EventBus.js              # Pub/Sub singleton
    ├── ProfileController.js     # applyProfile, constraint logic
    ├── UIStateManager.js        # Buton state yonetimi
    ├── LoopbackManager.js       # WebRTC loopback setup
    ├── Recorder.js              # MediaRecorder wrapper
    ├── Monitor.js               # Modlar: direct, standard, worklet, codec-simulated; scriptprocessor sadece record/legacy icin
    ├── Player.js                # Blob oynatma
    ├── VuMeter.js               # dB gostergesi
    └── ...
```

## Kategori & Profiller

| Kategori | Yetenek | Profiller |
|----------|---------|-----------|
| `call` | Monitoring only | discord, zoom, whatsapp-call, telegram-call |
| `record` | Recording + Playback | whatsapp-voice, telegram-voice, legacy, mictest |

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
await recorder.start(constraints, mode, timeslice, bufferSize, mediaBitrate);
recorder.stop();
```
**Emits:** `recording:started`, `recording:completed`

### Monitor (MonitoringController uzerinden)
Modlar:
- `worklet` → Call kategorisi (WebRTC Loopback + AudioWorklet)
- `direct`, `standard` → Record kategorisi veya non-loopback monitoring
- `scriptprocessor` → **SADECE record kategorisi** (legacy profili, mictest secenebilir). Call/arama modunda YASAK!
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
2. `mic_probe.html` → HTML kontrol ekle
3. `ProfileUIManager.js` otomatik isle

**Yeni profil eklemek:**
1. `Config.js` → PROFILES'a createProfile() ile ekle
2. Sidebar'a HTML ekle (data-profile attribute)
