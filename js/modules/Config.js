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
    values: [16000, 22050, 44100, 48000],
    default: 48000,
    label: 'Örnekleme Hızı',
    category: 'constraints',
    unit: 'Hz',
    ui: { type: 'radio', name: 'sampleRate' }
  },
  channelCount: {
    type: 'enum',
    values: [1, 2],
    default: 1,
    label: 'Kanal Sayısı',
    category: 'constraints',
    labels: { 1: 'Mono', 2: 'Stereo' },
    ui: { type: 'radio', name: 'channelCount' }
  },

  // Ses Isleme Modu (WebAudio entegre)
  // direct: WebAudio yok, ham MediaStream
  // standard: WebAudio basit graph
  // scriptprocessor: WebAudio + ScriptProcessorNode (eski API)
  // worklet: WebAudio + AudioWorkletNode (modern API)
  mode: {
    type: 'enum',
    values: ['direct', 'standard', 'scriptprocessor', 'worklet'],
    default: 'standard',
    label: 'Ses Isleme Modu',
    category: 'pipeline',
    labels: {
      direct: 'Direct (WebAudio yok)',
      standard: 'Standard (WebAudio)',
      scriptprocessor: 'ScriptProcessor (Eski API)',
      worklet: 'AudioWorklet (Modern)'
    },
    ui: { type: 'radio', name: 'processingMode' }
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
    values: [32000, 48000, 64000, 96000, 128000],
    default: 64000,
    label: 'Opus Bitrate (WebRTC)',
    category: 'loopback',
    unit: 'bps',
    ui: { type: 'radio', name: 'bitrate' }
  },

  // MediaRecorder bitrate (Sesli mesaj icin)
  mediaBitrate: {
    type: 'enum',
    values: [0, 16000, 24000, 32000, 64000, 128000],
    default: 0,
    label: 'MediaRecorder Bitrate',
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
  // NOT: delay ayari kaldirildi - monitoring'de sabit 2sn kullaniliyor
};

// Varsayilan profil degerleri
// NOT: Bu degerler SETTINGS.*.default ile tutarli olmali
const DEFAULT_VALUES = {
  ec: true, ns: true, agc: true,
  sampleRate: 48000, channelCount: 1,
  mode: 'standard', buffer: 4096,
  loopback: true, bitrate: 64000, mediaBitrate: 0,
  timeslice: 0
};

// Profil fabrika fonksiyonu - tekrari onler
// settings objesi: { locked: [], editable: [] } veya 'all' string'i
// locked: Deger sabit, UI'da disabled (kullanici degistiremez)
// editable: Kullanici degistirebilir
// 'all': Tum ayarlar editable (ozel/legacy modlar icin)
function createProfile(id, label, desc, icon, category, overrides = {}, settings = {}) {
  // Geriye uyumluluk: Eski array format veya 'all' string destegi
  let lockedSettings = [];
  let editableSettings = [];

  if (settings === 'all') {
    // Tum ayarlar editable
    editableSettings = Object.keys(SETTINGS);
    lockedSettings = [];
  } else if (Array.isArray(settings)) {
    // Eski format: array = editable listesi (geriye uyumluluk)
    editableSettings = settings;
    lockedSettings = [];
  } else {
    // Yeni format: { locked: [], editable: [] }
    lockedSettings = settings.locked || [];
    editableSettings = settings.editable || [];
  }

  return {
    id, label, desc, icon, category,
    values: overrides === null ? null : { ...DEFAULT_VALUES, ...overrides },
    lockedSettings,
    editableSettings,
    // Geriye uyumluluk
    allowedSettings: editableSettings.length > 0 ? editableSettings : 'all'
  };
}

// Senaryo bazli profil tanimlari
export const PROFILES = {
  // CANLI GORUSME SENARYOLARI (WebRTC Loopback)
  // Loopback ON, mode standard (WebRTC simulasyonu icin)
  discord: createProfile('discord', 'Discord Voice', 'Discord, Guilded - yüksek kalite ses',
    'gamepad', 'call', { loopback: true, mode: 'standard', bitrate: 96000, sampleRate: 48000, channelCount: 2 },
    { locked: ['loopback', 'mode'], editable: ['ec', 'ns', 'agc', 'bitrate', 'sampleRate', 'channelCount'] }),
  zoom: createProfile('zoom', 'Zoom / Meet', 'Zoom, Teams, Meet - optimize edilmiş',
    'video', 'call', { loopback: true, mode: 'standard', bitrate: 48000, sampleRate: 48000, channelCount: 1 },
    { locked: ['loopback', 'mode', 'channelCount'], editable: ['ec', 'ns', 'agc', 'bitrate', 'sampleRate'] }),

  // SESLI MESAJ SENARYOLARI (MediaRecorder Bitrate)
  // Loopback OFF, mode standard (MediaRecorder kayit)
  whatsapp: createProfile('whatsapp', 'WhatsApp Sesli Mesaj', 'Dusuk bitrate voice message',
    'message', 'voice', { mediaBitrate: 16000, timeslice: 250, loopback: false, mode: 'standard' },
    { locked: ['loopback', 'mode'], editable: ['ec', 'ns', 'agc', 'mediaBitrate'] }),
  telegram: createProfile('telegram', 'Telegram Sesli Mesaj', 'Orta kalite voice note',
    'send', 'voice', { mediaBitrate: 24000, timeslice: 250, loopback: false, mode: 'standard' },
    { locked: ['loopback', 'mode'], editable: ['ec', 'ns', 'agc', 'mediaBitrate'] }),

  // TEMEL TEST - Ham Kayit
  // Tum ayarlar serbest - dinamik kilitleme JS tarafinda (buffer icin)
  mictest: createProfile('mictest', 'Ham Kayit', 'Tum ayarlar serbest - test ve deneme',
    'mic', 'basic', { ec: false, ns: false, agc: false, mode: 'direct', loopback: false },
    'all'),

  // GELISMIS / OZEL
  // ScriptProcessor odakli kayit profili - mode ve loopback kilitli
  legacy: createProfile('legacy', 'Eski Web Kayıt', 'ScriptProcessor ile kayıt testi',
    'history', 'advanced', { mode: 'scriptprocessor', buffer: 1024, timeslice: 1000, loopback: false },
    { locked: ['mode', 'loopback'], editable: ['ec', 'ns', 'agc', 'buffer', 'timeslice'] })
};

// Kategori tanimlari (UI siralama icin)
export const PROFILE_CATEGORIES = {
  call: {
    id: 'call',
    label: 'Canli Gorusme',
    desc: 'Discord, Zoom, Meet gibi uygulamalar',
    order: 1
  },
  voice: {
    id: 'voice',
    label: 'Sesli Mesaj',
    desc: 'WhatsApp, Telegram voice note',
    order: 2
  },
  basic: {
    id: 'basic',
    label: 'Temel Test',
    desc: 'Mikrofon kontrolu',
    order: 3
  },
  advanced: {
    id: 'advanced',
    label: 'Gelismis',
    desc: 'Ozel ayarlar ve legacy API',
    order: 4
  }
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

/**
 * Ayar degerini dogrula
 * @param {string} settingKey - Ayar anahtari
 * @param {*} value - Deger
 * @returns {boolean} Gecerli mi
 */
export function validateSetting(settingKey, value) {
  const setting = SETTINGS[settingKey];
  if (!setting) return false;

  switch (setting.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return setting.values.includes(value);
    case 'number':
      return typeof value === 'number' &&
             value >= setting.min &&
             value <= setting.max;
    default:
      return true;
  }
}

/**
 * Profil listesini al (UI icin)
 * @returns {Array} Profil listesi
 */
export function getProfileList() {
  return Object.values(PROFILES).map(p => ({
    id: p.id,
    label: p.label,
    desc: p.desc,
    icon: p.icon,
    category: p.category
  }));
}

/**
 * Kategoriye gore profilleri al
 * @param {string} categoryId - Kategori ID
 * @returns {Array} Profil listesi
 */
export function getProfilesByCategory(categoryId) {
  return Object.values(PROFILES)
    .filter(p => p.category === categoryId)
    .map(p => ({
      id: p.id,
      label: p.label,
      desc: p.desc,
      icon: p.icon,
      category: p.category
    }));
}

/**
 * Tum kategorileri sirali olarak al
 * @returns {Array} Kategori listesi
 */
export function getCategoryList() {
  return Object.values(PROFILE_CATEGORIES)
    .sort((a, b) => a.order - b.order);
}

/**
 * Kategori bazli ayarlari al
 * @param {string} category - Kategori
 * @returns {Object} Ayarlar
 */
export function getSettingsByCategory(category) {
  return Object.entries(SETTINGS)
    .filter(([_, s]) => s.category === category)
    .reduce((acc, [key, setting]) => {
      acc[key] = setting;
      return acc;
    }, {});
}

export default {
  SETTINGS,
  PROFILES,
  PROFILE_CATEGORIES,
  getProfileValue,
  validateSetting,
  getProfileList,
  getProfilesByCategory,
  getCategoryList,
  getSettingsByCategory
};
