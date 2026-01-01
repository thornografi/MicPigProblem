---
name: micprobe-modules
description: "MicProbe proje modulleri ve Config referansi. Anahtar kelimeler: AudioEngine, Config, PROFILES, SETTINGS, VuMeter, Recorder, Monitor, Player, EventBus, DeviceInfo, modul, module, profil kategorileri, call, record"
---

# MicProbe Modul Referansi

## Uygulama Mimarisi

### İki Ana Kategori

| Kategori | Amaç | Teknoloji | Birincil Aksiyon |
|----------|------|-----------|------------------|
| `call` | Sesli görüşme simülasyonu | WebRTC Loopback | Monitoring |
| `record` | Sesli mesaj simülasyonu | MediaRecorder | Recording |

### Profil Yapısı

```javascript
// Sesli Görüşme (call) - Monitoring Only
'discord':         { category: 'call', loopback: true, bitrate: 64000, channelCount: 1 }
'zoom':            { category: 'call', loopback: true, bitrate: 48000 }  // Zoom/Meet/Teams
'whatsapp-call':   { category: 'call', loopback: true, bitrate: 24000 }
'telegram-call':   { category: 'call', loopback: true, bitrate: 24000 }

// Kayıt (record) - Recording Only
'whatsapp-voice':  { category: 'record', loopback: false, mediaBitrate: 16000 }
'telegram-voice':  { category: 'record', loopback: false, mediaBitrate: 32000 }
'legacy':          { category: 'record', mode: 'scriptprocessor', loopback: false }
'mictest':         { category: 'record', mode: 'direct', loopback: false }  // Kayıt ayarları serbest
```

### allowedValues (Profil Bazlı Değer Kısıtlamaları)

Her profil, editable ayarlar için izin verilen değerleri tanımlayabilir:

```javascript
// Örnek: Zoom profili
{ locked: ['loopback', 'mode', 'channelCount', 'ec', 'ns', 'agc'],
  editable: ['bitrate', 'sampleRate'],
  allowedValues: { bitrate: [32000, 48000, 64000], sampleRate: [16000, 48000] } }

// UI'da kullanım (app.js - updateCustomSettingsPanel)
const allowedValues = profile.allowedValues?.[key] || setting.values;
```

**Amaç:** Kullanıcının mantıksız değerler seçmesini engeller (örn: WhatsApp için 128kbps)

## Dosya Yapisi

```
js/
├── app.js              # Orchestrator + Loopback + UI bindings
└── modules/
    ├── constants.js    # Merkezi sabitler (AUDIO, DELAY, VU_METER, SIGNAL, ...)
    ├── Config.js       # Merkezi yapilandirma (SETTINGS, PROFILES)
    ├── EventBus.js     # Pub/Sub singleton
    ├── AudioEngine.js  # Merkezi AudioContext (singleton)
    ├── VuMeter.js      # dB gostergesi
    ├── Recorder.js     # Kayit (MediaRecorder)
    ├── Monitor.js      # Canli dinleme (5 mod)
    ├── Player.js       # Oynatma
    ├── DeviceInfo.js   # Bilgi paneli
    ├── Logger.js       # UI log paneli
    ├── LogManager.js   # IndexedDB loglama
    ├── StatusManager.js# Durum badge
    ├── StreamHelper.js # getUserMedia wrapper
    ├── WorkletHelper.js# AudioWorklet yardimcilari
    └── utils.js        # formatTime, getBestAudioMimeType, stopStreamTracks, sleep
```

## constants.js (Merkezi Sabitler)
```javascript
import { AUDIO, DELAY, VU_METER, SIGNAL, BYTES } from './constants.js';

// Audio sabitleri
AUDIO.FFT_SIZE              // 256
AUDIO.SMOOTHING_TIME_CONSTANT // 0.7
AUDIO.CENTER_VALUE          // 128 (8-bit audio center)

// Delay sabitleri (echo/feedback onleme)
DELAY.MAX_SECONDS           // 3.0
DELAY.DEFAULT_SECONDS       // 1.7

// VU Meter sabitleri
VU_METER.RMS_THRESHOLD      // 0.0001
VU_METER.MIN_DB             // -60
VU_METER.CLIPPING_THRESHOLD_DB // -0.5

// Sinyal bekleme sabitleri (loopback)
SIGNAL.MAX_WAIT_MS          // 2000
SIGNAL.POLL_INTERVAL_MS     // 50
SIGNAL.RMS_THRESHOLD        // 0.001
```

## Config
```javascript
import { PROFILES, SETTINGS, PROFILE_CATEGORIES, getProfileValue, getSettingsByCategory } from './Config.js';

// Kategori ornekleri
PROFILE_CATEGORIES.call   // { id: 'call', label: 'Sesli Gorusme', order: 1 }
PROFILE_CATEGORIES.record // { id: 'record', label: 'Kayit', order: 2 }

// Profil ornekleri
PROFILES['discord'].category          // 'call'
PROFILES['discord'].values.bitrate    // 64000
PROFILES['discord'].allowedValues     // { bitrate: [64000, 96000, 128000, 256000, 384000] }
PROFILES['whatsapp-voice'].category   // 'record'
PROFILES['whatsapp-voice'].values.mediaBitrate // 16000

// OCP: Profil yetenekleri (otomatik hesaplanir)
PROFILES['discord'].canMonitor        // true (call kategorisi)
PROFILES['discord'].canRecord         // false
PROFILES['whatsapp-voice'].canMonitor // false (record kategorisi)
PROFILES['whatsapp-voice'].canRecord  // true
PROFILES['mictest'].canMonitor        // false (loopback locked)
PROFILES['mictest'].canRecord         // true

// Ayar metadata
SETTINGS.buffer.values   // [1024, 2048, 4096]
SETTINGS.buffer.ui       // { type: 'radio', name: 'bufferSize' }

// Helpers
getProfileValue('discord', 'bitrate')
getSettingsByCategory('constraints')  // ec, ns, agc, sampleRate, channelCount
```

## EventBus (Singleton)
```javascript
import eventBus from './EventBus.js';
eventBus.emit('event:name', data);
eventBus.on('event:name', callback);
```

## AudioEngine (Singleton)
```javascript
import audioEngine from './AudioEngine.js';
await audioEngine.warmup();
audioEngine.connectStream(stream);
audioEngine.getAnalyser();  // fftSize: 256
```

## VuMeter
```javascript
new VuMeter({ barId, peakId, dotId });
```
**Listens:** `stream:started`, `stream:stopped`, `loopback:remoteStream`
**Emits:** `vumeter:level`, `vumeter:audiocontext`

## Recorder
```javascript
const recorder = new Recorder({ constraints });
await recorder.start(constraints, recordMode, timeslice, bufferSize, mediaBitrate);
// recordMode: 'direct' | 'standard' | 'scriptprocessor' | 'worklet'
recorder.stop();
```
**Emits:** `recording:started`, `recording:completed`, `stream:started`, `stream:stopped`

## Monitor
```javascript
const monitor = new Monitor();
await monitor.startWebAudio(constraints);                    // WebAudio + Delay
await monitor.startScriptProcessor(constraints, bufferSize); // Deprecated API
await monitor.startAudioWorklet(constraints);                // Modern AudioWorklet
await monitor.startDirect(constraints);                      // Sadece Delay
await monitor.startCodecSimulated(constraints, mediaBitrate, mode, timeslice, bufferSize);
await monitor.stop();
```
**Codec-Simulated:** MediaRecorder -> MediaSource -> Audio -> Delay -> Speaker
**Emits:** `monitor:started`, `monitor:stopped`

## Player
```javascript
new Player({ containerId, playBtnId, progressBarId, ... });
```
**Listens:** `recording:completed`
**Emits:** `player:loaded`, `player:ended`

## DeviceInfo
```javascript
const deviceInfo = new DeviceInfo();
await deviceInfo.initFromAudioEngine();
```
**Listens:** `vumeter:level`, `vumeter:audiocontext`, `stream:started`

## Logger / LogManager
- `Logger`: UI log paneli (filtrelenebilir)
- `LogManager`: IndexedDB'ye kategorili loglama (singleton)

**Kategoriler:** error, stream, webaudio, recorder, system

## StatusManager
```javascript
new StatusManager('badgeId');
```
**Listens:** `recording:started`, `monitor:started`, `stream:stopped`

## Gelistirme

**Yeni ayar eklemek icin:**
1. `Config.js` -> SETTINGS'e ekle (type, default, label, category, ui)
2. `mic_probe.html` -> HTML kontrol ekle

Diger mekanizmalar (`applyProfile`, `updateSettingVisibility`) otomatik calisir.
