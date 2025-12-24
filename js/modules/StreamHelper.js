/**
 * StreamHelper - Ortak stream islemleri
 * requestStream fonksiyonu Monitor ve Recorder tarafindan kullanilir
 */
import eventBus from './EventBus.js';

const DEFAULT_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

/**
 * Mikrofon stream'i iste
 * @param {Object} constraints - Audio constraints (EC, NS, AGC)
 * @returns {Promise<MediaStream>} - Mikrofon stream'i
 */
export async function requestStream(constraints = {}) {
  const merged = { ...DEFAULT_CONSTRAINTS, ...constraints };

  const deviceLabel = merged.deviceId ? `[${typeof merged.deviceId === 'object' ? merged.deviceId.exact || merged.deviceId : merged.deviceId}]` : '[varsayilan]';
  eventBus.emit('log', `Mikrofon isteniyor... ${deviceLabel} EC:${merged.echoCancellation} NS:${merged.noiseSuppression} AGC:${merged.autoGainControl}`);

  // Detayli log
  eventBus.emit('log:stream', {
    message: 'getUserMedia cagriliyor',
    details: { constraints: merged }
  });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: merged,
      video: false
    });

    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();

    // Gercek ayarlari logla - tarayici farkli deger uygulayabilir
    eventBus.emit('log', `Gercek Track Ayarlari:`);
    eventBus.emit('log', `  - device: ${track.label || settings.deviceId || 'N/A'}`);
    eventBus.emit('log', `  - echoCancellation: ${settings.echoCancellation}`);
    eventBus.emit('log', `  - noiseSuppression: ${settings.noiseSuppression}`);
    eventBus.emit('log', `  - autoGainControl: ${settings.autoGainControl}`);
    eventBus.emit('log', `  - sampleRate: ${settings.sampleRate || 'N/A'}Hz`);
    eventBus.emit('log', `  - channelCount: ${settings.channelCount || 'N/A'}`);

    // Detayli log
    eventBus.emit('log:stream', {
      message: 'MediaStream olusturuldu',
      details: {
        streamId: stream.id,
        trackId: track.id,
        trackLabel: track.label,
        trackSettings: settings,
        trackConstraints: track.getConstraints(),
        trackCapabilities: track.getCapabilities?.() || 'N/A'
      }
    });

    return stream;
  } catch (err) {
    eventBus.emit('log', 'HATA: Mikrofon erisimi basarisiz - ' + err.message);
    eventBus.emit('log:error', {
      message: 'getUserMedia hatasi',
      details: { error: err.message, name: err.name }
    });
    throw err;
  }
}

/**
 * Stream'i durdur ve temizle
 * @param {MediaStream} stream - Durdurulacak stream
 */
export function stopStream(stream) {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }
}
