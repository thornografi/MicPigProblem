/**
 * Config - Merkezi yapilandirma modulu
 * Ayar tanimlari ve profil degerleri
 */

// Ayar tanimlari (metadata + UI binding)
export const SETTINGS = {
  // Mikrofon constraints
  ec: {
    type: 'boolean',
    default: true,
    label: 'Echo Cancellation',
    category: 'constraints',
    ui: { type: 'checkbox', id: 'ec' }
  },
  ns: {
    type: 'boolean',
    default: true,
    label: 'Noise Suppression',
    category: 'constraints',
    ui: { type: 'checkbox', id: 'ns' }
  },
  agc: {
    type: 'boolean',
    default: true,
    label: 'Auto Gain Control',
    category: 'constraints',
    ui: { type: 'checkbox', id: 'agc' }
  },
  sampleRate: {
    type: 'enum',
    values: [16000, 24000, 48000],  // Opus-uyumlu: wideband, super-wideband, fullband
    default: 48000,
    label: 'Sample Rate',
    category: 'constraints',
    unit: 'Hz',
    ui: { type: 'radio', name: 'sampleRate' }
  },
  channelCount: {
    type: 'enum',
    values: [1, 2],
    default: 1,
    label: 'Channel Count',
    category: 'constraints',
    labels: { 1: 'Mono', 2: 'Stereo' },
    ui: { type: 'radio', name: 'channelCount' }
  },

  // Ses Isleme Pipeline (WebAudio graph)
  // direct: WebAudio yok, ham MediaStream
  // standard: WebAudio basit graph (Source -> Destination)
  // scriptprocessor: WebAudio + ScriptProcessorNode (eski API, buffer ayarlanabilir)
  // worklet: WebAudio + AudioWorkletNode (modern API, sabit 128 sample)
  pipeline: {
    type: 'enum',
    values: ['direct', 'standard', 'scriptprocessor', 'worklet'],
    default: 'standard',
    label: 'Pipeline',
    category: 'pipeline',
    labels: {
      direct: 'Direct (No Web Audio)',
      standard: 'Standard (Web Audio)',
      scriptprocessor: 'ScriptProcessorNode',
      worklet: 'AudioWorklet'
    },
    ui: { type: 'radio', name: 'pipeline' }
  },

  // Encoder (Kayit formati)
  // mediarecorder: Tarayici MediaRecorder API (varsayilan codec)
  // wasm-opus: WASM Opus encoder (WhatsApp Web pattern)
  encoder: {
    type: 'enum',
    values: ['mediarecorder', 'wasm-opus'],
    default: 'mediarecorder',
    label: 'Encoder',
    category: 'pipeline',
    labels: {
      mediarecorder: 'MediaRecorder',
      'wasm-opus': 'WASM Opus'
    },
    ui: { type: 'radio', name: 'encoder' }
  },
  buffer: {
    type: 'enum',
    values: [1024, 2048, 4096],
    default: 4096,
    label: 'Buffer Size',
    category: 'pipeline',
    unit: 'samples',
    ui: { type: 'radio', name: 'bufferSize' }
  },

  // Loopback (WebRTC)
  loopback: {
    type: 'boolean',
    default: true,
    label: 'WebRTC Loopback',
    category: 'loopback',
    ui: { type: 'toggle', id: 'loopbackToggle' }
  },
  bitrate: {
    type: 'enum',
    values: [16000, 24000, 32000, 48000, 64000, 96000, 128000, 256000, 384000],  // Discord Nitro: 256k, 384k
    default: 64000,
    label: 'Opus Bitrate (WebRTC)',
    category: 'loopback',
    unit: 'bps',
    ui: { type: 'radio', name: 'bitrate' }
  },

  // Ses bitrate (MediaRecorder veya WASM Opus encoder icin)
  mediaBitrate: {
    type: 'enum',
    values: [0, 16000, 24000, 32000, 64000, 128000],
    default: 0,
    label: 'Voice Message Bitrate',
    category: 'recording',
    unit: 'bps',
    ui: { type: 'radio', name: 'mediaBitrate' }
  },

  // Kayit
  timeslice: {
    type: 'enum',
    values: [0, 100, 250, 500, 1000],
    default: 0,
    label: 'Timeslice',
    category: 'recording',
    unit: 'ms',
    ui: { type: 'radio', name: 'timeslice' }
  }
  // NOT: delay ayari kaldirildi - monitoring'de sabit 1.7sn kullaniliyor (Monitor.js DEFAULT_DELAY_SECONDS)
};

// Varsayilan profil degerleri
// NOT: Bu degerler SETTINGS.*.default ile tutarli olmali
const DEFAULT_VALUES = {
  ec: true, ns: true, agc: true,
  sampleRate: 48000, channelCount: 1,
  pipeline: 'standard', encoder: 'mediarecorder', buffer: 4096,
  loopback: true, bitrate: 64000, mediaBitrate: 0,
  timeslice: 0
};

// Profil fabrika fonksiyonu - tekrari onler
// settings objesi: { locked: [], editable: [], allowedValues: {} } veya 'all' string'i
// locked: Deger sabit, UI'da disabled (kullanici degistiremez)
// editable: Kullanici degistirebilir
// allowedValues: Her ayar icin izin verilen degerler (profil bazli kisitlama)
// 'all': Tum ayarlar editable, tum degerler izinli (test modlari icin)
function createProfile(id, label, desc, icon, category, overrides = {}, settings = {}) {
  // Geriye uyumluluk: Eski array format veya 'all' string destegi
  let lockedSettings = [];
  let editableSettings = [];
  let allowedValues = {};

  if (settings === 'all') {
    // Tum ayarlar editable, tum degerler izinli
    editableSettings = Object.keys(SETTINGS);
    lockedSettings = [];
    allowedValues = {}; // Bos = tum degerler izinli
  } else if (Array.isArray(settings)) {
    // Eski format: array = editable listesi (geriye uyumluluk)
    editableSettings = settings;
    lockedSettings = [];
    allowedValues = {};
  } else {
    // Yeni format: { locked: [], editable: [], allowedValues: {} }
    lockedSettings = settings.locked || [];
    editableSettings = settings.editable || [];
    allowedValues = settings.allowedValues || {};
  }

  // OCP: Profil kendi yeteneklerini biliyor
  // call kategorisi = monitoring, record kategorisi = kayit
  // Istisna: loopback editable ise monitoring de yapilabilir
  const isCallCategory = category === 'call';
  const loopbackEditable = settings === 'all' || editableSettings.includes('loopback');

  return {
    id, label, desc, icon, category,
    values: overrides === null ? null : { ...DEFAULT_VALUES, ...overrides },
    lockedSettings,
    editableSettings,
    allowedValues, // Profil bazli deger kisitlamalari
    // OCP: Yetenekler profilde tanimli
    canMonitor: isCallCategory || loopbackEditable,
    canRecord: !isCallCategory,
    // Geriye uyumluluk
    allowedSettings: editableSettings.length > 0 ? editableSettings : 'all'
  };
}

// Senaryo bazli profil tanimlari
// İKİ ANA KATEGORİ: call (sesli görüşme) ve record (kayıt)
export const PROFILES = {
  // ═══════════════════════════════════════════════════════════════
  // 📞 SESLİ GÖRÜŞME (call) - WebRTC Loopback, Monitoring Only
  // ═══════════════════════════════════════════════════════════════
  // Call profilleri: EC/NS/AGC platformlar tarafindan kesinlikle kullaniliyor
  'discord': createProfile('discord', 'Discord', 'Discord, Guilded - Krisp noise suppression, AudioWorklet',
    'gamepad', 'call', { ec: true, ns: true, agc: true, loopback: true, pipeline: 'worklet', encoder: 'mediarecorder', bitrate: 64000, sampleRate: 48000, channelCount: 1 },
    { locked: ['loopback', 'pipeline', 'encoder', 'sampleRate', 'channelCount', 'ec', 'ns', 'agc'],
      editable: ['bitrate'],
      allowedValues: { bitrate: [64000, 96000, 128000, 256000, 384000] } }),

  'zoom': createProfile('zoom', 'Zoom / Meet / Teams', 'Zoom, Teams, Meet - AudioWorklet pipeline',
    'video', 'call', { ec: true, ns: true, agc: true, loopback: true, pipeline: 'worklet', encoder: 'mediarecorder', bitrate: 48000, sampleRate: 48000, channelCount: 1 },
    { locked: ['loopback', 'pipeline', 'encoder', 'channelCount', 'ec', 'ns', 'agc'],
      editable: ['bitrate', 'sampleRate'],
      allowedValues: { bitrate: [32000, 48000, 64000], sampleRate: [16000, 24000, 48000] } }),

  'whatsapp-call': createProfile('whatsapp-call', 'WhatsApp Web Call', 'WhatsApp Web voice/video call',
    'phone', 'call', { ec: true, ns: true, agc: true, loopback: true, pipeline: 'worklet', encoder: 'mediarecorder', bitrate: 24000, sampleRate: 48000, channelCount: 1 },
    { locked: ['loopback', 'pipeline', 'encoder', 'ec', 'ns', 'agc'],
      editable: ['bitrate'],
      allowedValues: { bitrate: [16000, 24000, 32000] } }),

  'telegram-call': createProfile('telegram-call', 'Telegram Web Call', 'Telegram Web voice call',
    'phone', 'call', { ec: true, ns: true, agc: true, loopback: true, pipeline: 'worklet', encoder: 'mediarecorder', bitrate: 24000, sampleRate: 48000, channelCount: 1 },
    { locked: ['loopback', 'pipeline', 'encoder', 'ec', 'ns', 'agc'],
      editable: ['bitrate'],
      allowedValues: { bitrate: [24000, 32000, 48000, 64000] } }),

  // ═══════════════════════════════════════════════════════════════
  // 🎙️ KAYIT (record) - MediaRecorder, Recording Primary
  // ═══════════════════════════════════════════════════════════════
  'whatsapp-voice': createProfile('whatsapp-voice', 'WhatsApp Voice Message',
    'ScriptProcessor + WASM Opus (16-32kbps) - WhatsApp Web simulation',
    'message', 'record', { mediaBitrate: 16000, timeslice: 0, loopback: false, pipeline: 'scriptprocessor', encoder: 'wasm-opus', buffer: 4096 },
    { locked: ['pipeline', 'encoder', 'buffer', 'timeslice'],
      editable: ['ec', 'ns', 'agc', 'mediaBitrate'],
      allowedValues: { mediaBitrate: [16000, 24000, 32000] } }),

  'telegram-voice': createProfile('telegram-voice', 'Telegram Voice Message',
    'AudioWorklet + MediaRecorder Opus (16-32kbps) - Telegram Web simulation',
    'send', 'record', { mediaBitrate: 32000, timeslice: 250, loopback: false, pipeline: 'worklet', encoder: 'mediarecorder' },
    { locked: ['pipeline', 'encoder'],
      editable: ['ec', 'ns', 'agc', 'mediaBitrate', 'timeslice'],
      allowedValues: { mediaBitrate: [16000, 24000, 32000], timeslice: [0, 100, 250, 500] } }),

  'legacy': createProfile('legacy', 'Legacy Web Recording', 'ScriptProcessor + MediaRecorder - legacy web recording sites',
    'history', 'record', { pipeline: 'scriptprocessor', encoder: 'mediarecorder', buffer: 1024, timeslice: 1000, loopback: false },
    { locked: ['pipeline', 'encoder'], editable: ['ec', 'ns', 'agc', 'buffer', 'timeslice', 'mediaBitrate'] }),
    // allowedValues yok = tum degerler izinli

  'raw': createProfile('raw', 'Raw Recording', 'All filters off, all settings unlocked - for testing and comparison',
    'mic', 'record', { ec: false, ns: false, agc: false, pipeline: 'direct', encoder: 'mediarecorder', loopback: false },
    { locked: [], editable: ['ec', 'ns', 'agc', 'sampleRate', 'channelCount', 'pipeline', 'encoder', 'buffer', 'mediaBitrate', 'timeslice'] })
    // allowedValues yok = tum degerler izinli (test profili)
};

// Profil tema token'lari (UI accent renkleri)
// Yeni profil rengi eklemek icin bu map'e giris eklemek yeterli.
export const PROFILE_THEMES = {
  default: {
    accent: 'var(--color-accent-text)',
    accentGlow: 'rgba(var(--color-accent-text-rgb), 0.55)'
  }
};

// Kategori tanimlari (UI siralama icin)
// Sadece iki ana kategori: call ve record
export const PROFILE_CATEGORIES = {
  call: {
    id: 'call',
    label: 'Voice Calls',
    icon: '📞',
    desc: 'Discord, Zoom, WhatsApp/Telegram calls',
    order: 1
  },
  record: {
    id: 'record',
    label: 'Voice Messages',
    icon: '🎙️',
    desc: 'WhatsApp/Telegram voice messages, raw recording',
    order: 2
  }
};

// Profil bazli Tips mesajlari
// Her profil icin 3 adimlik rehber (tek satir)
export const PROFILE_TIPS = {
  // === CALL Category ===
  'discord': [
    { step: 1, text: 'Click <strong>Monitor</strong> to hear yourself' },
    { step: 2, text: 'Test Nitro quality with <strong>Bitrate</strong>' },
    { step: 3, text: 'Check audio levels with VU meter' }
  ],
  'zoom': [
    { step: 1, text: 'Test meeting audio with <strong>Monitor</strong>' },
    { step: 2, text: 'Try <strong>Sample Rate</strong> compatibility' },
    { step: 3, text: 'Adjust levels with VU meter' }
  ],
  'whatsapp-call': [
    { step: 1, text: 'Hear call quality with <strong>Monitor</strong>' },
    { step: 2, text: 'Test <strong>Bitrate</strong> options' },
    { step: 3, text: 'Watch audio levels on VU meter' }
  ],
  'telegram-call': [
    { step: 1, text: 'Test call audio with <strong>Monitor</strong>' },
    { step: 2, text: 'Adjust quality with <strong>Bitrate</strong>' },
    { step: 3, text: 'Check levels on VU meter' }
  ],

  // === RECORD Category ===
  'whatsapp-voice': [
    { step: 1, text: 'Record voice message with <strong>Record</strong>' },
    { step: 2, text: 'Play back and hear WASM Opus quality' },
    { step: 3, text: 'Adjust quality with <strong>Bitrate</strong>' }
  ],
  'telegram-voice': [
    { step: 1, text: 'Make audio recording with <strong>Record</strong>' },
    { step: 2, text: 'Play back and compare quality' },
    { step: 3, text: 'Try different <strong>Timeslice</strong> values' }
  ],
  'legacy': [
    { step: 1, text: 'Record with legacy API using <strong>Record</strong>' },
    { step: 2, text: 'Play back and test compatibility' },
    { step: 3, text: 'Adjust <strong>Buffer</strong> size' }
  ],
  'raw': [
    { step: 1, text: 'Make raw recording with <strong>Record</strong>' },
    { step: 2, text: 'Compare with other profiles' },
    { step: 3, text: 'Freely adjust all settings' }
  ],

  // Default (fallback)
  'default': [
    { step: 1, text: 'Select a profile from the sidebar' },
    { step: 2, text: 'Use <strong>Monitor</strong> or <strong>Record</strong>' },
    { step: 3, text: 'Customize settings as needed' }
  ]
};

/**
 * Profil degerini al
 * @param {string} profileId - Profil ID
 * @param {string} settingKey - Ayar anahtari
 * @returns {*} Ayar degeri veya default
 */
export function getProfileValue(profileId, settingKey) {
  const profile = PROFILES[profileId];
  if (!profile || !profile.values) {
    return SETTINGS[settingKey]?.default;
  }
  return profile.values[settingKey] ?? SETTINGS[settingKey]?.default;
}

export default {
  SETTINGS,
  PROFILES,
  PROFILE_CATEGORIES,
  PROFILE_TIPS,
  getProfileValue
};
