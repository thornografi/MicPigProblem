/**
 * Config - Merkezi yapilandirma modulu
 * Ayar tanimlari ve profil degerleri
 */

// Ayar tanimlari (metadata)
export const SETTINGS = {
  // Mikrofon constraints
  ec: {
    type: 'boolean',
    default: true,
    label: 'Echo Cancellation',
    category: 'constraints'
  },
  ns: {
    type: 'boolean',
    default: true,
    label: 'Noise Suppression',
    category: 'constraints'
  },
  agc: {
    type: 'boolean',
    default: true,
    label: 'Auto Gain Control',
    category: 'constraints'
  },

  // WebAudio pipeline
  webaudio: {
    type: 'boolean',
    default: true,
    label: 'WebAudio Pipeline',
    category: 'pipeline'
  },
  mode: {
    type: 'enum',
    values: ['direct', 'standard', 'scriptprocessor', 'worklet'],
    default: 'standard',
    label: 'Processing Mode',
    category: 'pipeline'
  },
  buffer: {
    type: 'enum',
    values: [1024, 2048, 4096],
    default: 4096,
    label: 'Buffer Size',
    category: 'pipeline',
    unit: 'samples'
  },

  // Loopback (WebRTC)
  loopback: {
    type: 'boolean',
    default: true,
    label: 'WebRTC Loopback',
    category: 'loopback'
  },
  bitrate: {
    type: 'enum',
    values: [16000, 24000, 32000, 64000],
    default: 64000,
    label: 'Opus Bitrate (WebRTC)',
    category: 'loopback',
    unit: 'bps'
  },

  // MediaRecorder bitrate (Sesli mesaj icin)
  mediaBitrate: {
    type: 'enum',
    values: [0, 16000, 24000, 32000, 64000, 128000],
    default: 0,
    label: 'MediaRecorder Bitrate',
    category: 'recording',
    unit: 'bps'
  },

  // Kayit
  timeslice: {
    type: 'enum',
    values: [0, 100, 500, 1000],
    default: 0,
    label: 'Timeslice',
    category: 'recording',
    unit: 'ms'
  },

  // Monitor
  delay: {
    type: 'number',
    min: 0.5,
    max: 5,
    default: 2,
    label: 'Monitor Delay',
    category: 'monitor',
    unit: 's'
  }
};

// Varsayilan profil degerleri
const DEFAULT_VALUES = {
  ec: true, ns: true, agc: true,
  webaudio: true, mode: 'standard', buffer: 4096,
  loopback: false, bitrate: 32000, mediaBitrate: 0,
  timeslice: 0, delay: 2
};

// Profil fabrika fonksiyonu - tekrari onler
function createProfile(id, label, desc, icon, category, overrides = {}) {
  return {
    id, label, desc, icon, category,
    values: overrides === null ? null : { ...DEFAULT_VALUES, ...overrides }
  };
}

// Senaryo bazli profil tanimlari
export const PROFILES = {
  // CANLI GORUSME SENARYOLARI (WebRTC Loopback)
  discord: createProfile('discord', 'Discord Voice', 'Canli sesli/goruntulu gorusme',
    'gamepad', 'call', { loopback: true, bitrate: 64000 }),
  zoom: createProfile('zoom', 'Zoom / Meet', 'Video konferans uygulamalari',
    'video', 'call', { loopback: true }),

  // SESLI MESAJ SENARYOLARI (MediaRecorder Bitrate)
  whatsapp: createProfile('whatsapp', 'WhatsApp Sesli Mesaj', 'Dusuk bitrate voice message',
    'message', 'voice', { mediaBitrate: 16000 }),
  telegram: createProfile('telegram', 'Telegram Sesli Mesaj', 'Orta kalite voice note',
    'send', 'voice', { mediaBitrate: 24000 }),

  // TEMEL TEST
  mictest: createProfile('mictest', 'Ham Kayit', 'Ham mikrofon - codec/isleme yok',
    'mic', 'basic', { ec: false, ns: false, agc: false, webaudio: false, mode: 'direct' }),

  // GELISMIS / OZEL
  legacy: createProfile('legacy', 'Eski Web Uygulamalari', 'ScriptProcessor API testi',
    'history', 'advanced', { mode: 'scriptprocessor', buffer: 1024, timeslice: 1000 }),
  custom: createProfile('custom', 'Gelismis Ayarlar', 'Tum ayarlari manuel kontrol et',
    'settings', 'advanced', null)
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
