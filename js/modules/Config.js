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
    values: ['direct', 'webaudio', 'scriptprocessor', 'worklet'],
    default: 'webaudio',
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
    default: false,
    label: 'WebRTC Loopback',
    category: 'loopback'
  },
  bitrate: {
    type: 'enum',
    values: [16000, 32000, 64000],
    default: 32000,
    label: 'Opus Bitrate',
    category: 'loopback',
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

// Profil tanimlari
export const PROFILES = {
  discord: {
    id: 'discord',
    label: 'Discord Modu',
    desc: 'Electron + WebRTC + Krisp - Opus 64kbps',
    values: {
      ec: true,
      ns: true,
      agc: true,
      webaudio: true,
      mode: 'webaudio',
      buffer: 4096,
      loopback: true,
      bitrate: 64000,
      timeslice: 0,
      delay: 2
    }
  },
  zoom: {
    id: 'zoom',
    label: 'Zoom Modu',
    desc: 'SILK/Opus adaptif - WebRTC yok',
    values: {
      ec: true,
      ns: true,
      agc: true,
      webaudio: true,
      mode: 'webaudio',
      buffer: 4096,
      loopback: false,
      bitrate: 32000,
      timeslice: 0,
      delay: 2
    }
  },
  studio: {
    id: 'studio',
    label: 'Studyo Kaydi',
    desc: 'Ham mikrofon - tum isleme kapali',
    values: {
      ec: false,
      ns: false,
      agc: false,
      webaudio: false,
      mode: 'direct',
      buffer: 4096,
      loopback: false,
      bitrate: 32000,
      timeslice: 0,
      delay: 2
    }
  },
  legacy: {
    id: 'legacy',
    label: 'Eski Tarayici',
    desc: 'ScriptProcessor (deprecated) - uyumluluk testi',
    values: {
      ec: true,
      ns: true,
      agc: true,
      webaudio: true,
      mode: 'scriptprocessor',
      buffer: 1024,
      loopback: false,
      bitrate: 32000,
      timeslice: 1000,
      delay: 2
    }
  },
  custom: {
    id: 'custom',
    label: 'Ozel',
    desc: 'Manual ayar kontrolu',
    values: null // null = mevcut UI degerlerini kullan
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
    desc: p.desc
  }));
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
  getProfileValue,
  validateSetting,
  getProfileList,
  getSettingsByCategory
};
