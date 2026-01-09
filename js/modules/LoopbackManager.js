/**
 * LoopbackManager - WebRTC Loopback yonetimi
 * OCP: Loopback ile ilgili tum state ve fonksiyonlar tek yerde
 * DRY: Tekrarlanan WebRTC/AudioContext islemleri merkezi
 */

import eventBus from './EventBus.js';
import { createAudioContext, getAudioContextOptions, stopStreamTracks } from './utils.js';
import { DELAY, SIGNAL, BUFFER, LOOPBACK } from './constants.js';
import { createPassthroughWorkletNode, ensurePassthroughWorklet } from './WorkletHelper.js';

/**
 * LoopbackManager class - WebRTC loopback state ve islemlerini yonetir
 */
class LoopbackManager {
  constructor() {
    // WebRTC state
    this.pc1 = null;
    this.pc2 = null;
    this.localStream = null;
    this.remoteStream = null;
    this.audioCtx = null;

    // Monitor playback state
    this.monitorCtx = null;
    this.monitorSrc = null;
    this.monitorProc = null;
    this.monitorWorklet = null;
    this.monitorDelay = null;
    this.monitorMode = null;

    // Stats polling state
    this.statsInterval = null;
    this.signalCheckTimeout = null;
    this.lastBytesSent = 0;
    this.lastStatsTimestamp = 0;

    // Worklet support flag (dısarıdan set edilir)
    this.workletSupported = true;
  }

  /**
   * SDP'yi Opus bitrate ile modifiye et
   * @param {string} sdp - Orijinal SDP
   * @param {number} bitrate - Hedef bitrate (bps)
   * @returns {string} Modifiye edilmis SDP
   */
  setOpusBitrate(sdp, bitrate) {
    const lines = sdp.split('\r\n');

    // Opus payload type'ini bul (a=rtpmap:111 opus/48000/2)
    let opusPayloadType = null;
    for (const line of lines) {
      const match = line.match(/^a=rtpmap:(\d+)\s+opus\//i);
      if (match) {
        opusPayloadType = match[1];
        break;
      }
    }

    // Opus bulunamadiysa SDP'yi degistirme
    if (!opusPayloadType) {
      return sdp;
    }

    const modifiedLines = lines.map(line => {
      // Opus fmtp satirini bul (payload type ile eslesme)
      if (line.startsWith(`a=fmtp:${opusPayloadType}`)) {
        // Mevcut maxaveragebitrate varsa kaldir
        let newLine = line.replace(/;?maxaveragebitrate=\d+/g, '');
        // Yeni bitrate ekle
        newLine += `;maxaveragebitrate=${bitrate}`;
        return newLine;
      }
      return line;
    });

    return modifiedLines.join('\r\n');
  }

  /**
   * WebRTC loopback baglantisi kurar
   * @param {MediaStream} localStream - Mikrofon stream
   * @param {Object} options - Seçenekler
   * @param {boolean} options.useWebAudio - WebAudio pipeline kullanılsın mı
   * @param {number} options.opusBitrate - Opus bitrate (bps)
   * @returns {Promise<MediaStream>} Remote stream (WebRTC'den gelen ses)
   */
  async setup(localStream, options = {}) {
    const { useWebAudio = false, opusBitrate = 32000 } = options;

    eventBus.emit('log:stream', {
      message: 'WebRTC Loopback kuruluyor',
      details: { useWebAudio, opusBitrate }
    });

    this.localStream = localStream;

    // WebAudio pipeline (opsiyonel)
    let sendStream = localStream;
    if (useWebAudio) {
      const acOptions = getAudioContextOptions(localStream);
      this.audioCtx = await createAudioContext(acOptions);

      const src = this.audioCtx.createMediaStreamSource(localStream);
      const dest = this.audioCtx.createMediaStreamDestination();
      src.connect(dest);
      sendStream = dest.stream;

      const localTrack = localStream.getAudioTracks()[0];
      const localSampleRate = localTrack?.getSettings()?.sampleRate;

      eventBus.emit('log:webaudio', {
        message: 'Loopback: WebAudio pipeline aktif',
        details: {
          contextSampleRate: this.audioCtx.sampleRate,
          micSampleRate: localSampleRate || 'N/A',
          sampleRateMatch: !localSampleRate || localSampleRate === this.audioCtx.sampleRate,
          state: this.audioCtx.state,
          sendStreamActive: sendStream.active
        }
      });
    }

    // PeerConnection'lar
    this.pc1 = new RTCPeerConnection({ iceServers: [] });
    this.pc2 = new RTCPeerConnection({ iceServers: [] });

    this.pc1.onicecandidate = (e) => {
      if (e.candidate) {
        this.pc2.addIceCandidate(e.candidate).catch(err => {
          eventBus.emit('log:warning', {
            message: 'ICE candidate hatasi (pc2)',
            details: { error: err.message }
          });
        });
      }
    };
    this.pc2.onicecandidate = (e) => {
      if (e.candidate) {
        this.pc1.addIceCandidate(e.candidate).catch(err => {
          eventBus.emit('log:warning', {
            message: 'ICE candidate hatasi (pc1)',
            details: { error: err.message }
          });
        });
      }
    };

    // Track handler - WebRTC'nin sagladigi stream'i kullan
    this.pc2.ontrack = (e) => {
      eventBus.emit('log:stream', {
        message: 'Loopback: Remote track alindi',
        details: {
          trackKind: e.track.kind,
          trackId: e.track.id,
          trackEnabled: e.track.enabled,
          trackMuted: e.track.muted,
          trackReadyState: e.track.readyState,
          hasStreams: e.streams?.length > 0,
          streamId: e.streams?.[0]?.id
        }
      });

      // KRITIK: WebRTC'nin sagladigi stream'i kullan, manuel olusturma!
      if (e.streams && e.streams.length > 0) {
        this.remoteStream = e.streams[0];
        eventBus.emit('log:stream', {
          message: 'Loopback: WebRTC stream kullaniliyor',
          details: { streamId: this.remoteStream.id, active: this.remoteStream.active }
        });
      } else {
        // Fallback: Manuel stream olustur (eski yontem)
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(e.track);
        eventBus.emit('log:stream', {
          message: 'Loopback: Manuel stream olusturuldu (fallback)',
          details: {}
        });
      }
    };

    // Track ekle
    sendStream.getAudioTracks().forEach(track => {
      this.pc1.addTrack(track, sendStream);
    });

    // SDP exchange - TUM ADIMLARI AWAIT ILE BEKLE
    const offer = await this.pc1.createOffer({ offerToReceiveAudio: true });

    // Offer SDP'yi Opus bitrate ile modifiye et
    const modifiedOfferSdp = this.setOpusBitrate(offer.sdp, opusBitrate);
    const modifiedOffer = { type: offer.type, sdp: modifiedOfferSdp };

    eventBus.emit('log:stream', {
      message: `Loopback: Opus bitrate ayarlandi - ${opusBitrate / 1000} kbps`,
      details: { opusBitrate, sdpModified: modifiedOfferSdp !== offer.sdp }
    });

    await this.pc1.setLocalDescription(modifiedOffer);
    await this.pc2.setRemoteDescription(modifiedOffer); // ontrack burada tetiklenir

    const answer = await this.pc2.createAnswer();

    // Answer SDP'yi de Opus bitrate ile modifiye et
    const modifiedAnswerSdp = this.setOpusBitrate(answer.sdp, opusBitrate);
    const modifiedAnswer = { type: answer.type, sdp: modifiedAnswerSdp };

    await this.pc2.setLocalDescription(modifiedAnswer);
    await this.pc1.setRemoteDescription(modifiedAnswer);

    // ICE baglanti durumunu bekle
    await this._waitForIceConnection();

    // Stream kontrolu
    if (!this.remoteStream) {
      throw new Error('Remote stream olusturulamadi - ontrack tetiklenmedi');
    }

    const remoteTrack = this.remoteStream.getAudioTracks()[0];

    // Track muted ise unmute olmasini bekle
    if (remoteTrack && remoteTrack.muted) {
      await this._waitForTrackUnmute(remoteTrack);
    }

    eventBus.emit('log:stream', {
      message: `Loopback: WebRTC baglantisi kuruldu - ICE:${this.pc1.iceConnectionState}/${this.pc2.iceConnectionState} Track:${remoteTrack?.readyState} Muted:${remoteTrack?.muted}`,
      details: {
        pc1Ice: this.pc1.iceConnectionState,
        pc2Ice: this.pc2.iceConnectionState,
        remoteTrackCount: this.remoteStream.getAudioTracks().length,
        remoteTrackEnabled: remoteTrack?.enabled,
        remoteTrackReadyState: remoteTrack?.readyState,
        remoteTrackMuted: remoteTrack?.muted,
        remoteTrackLabel: remoteTrack?.label,
        streamActive: this.remoteStream.active
      }
    });

    // WebRTC getStats ile gercek bitrate olcumu baslat
    this.startStatsPolling(opusBitrate);

    return this.remoteStream;
  }

  /**
   * ICE baglanti durumunu bekle
   * @private
   */
  async _waitForIceConnection() {
    return new Promise((resolve, reject) => {
      const cleanupListeners = () => {
        this.pc1.oniceconnectionstatechange = null;
        this.pc2.oniceconnectionstatechange = null;
      };

      const timeout = setTimeout(() => {
        cleanupListeners();
        eventBus.emit('log:error', {
          message: 'Loopback: ICE baglanti zaman asimi',
          details: {
            pc1Ice: this.pc1.iceConnectionState,
            pc2Ice: this.pc2.iceConnectionState
          }
        });
        reject(new Error('ICE connection timeout'));
      }, LOOPBACK.ICE_WAIT_MS);

      let lastIce1 = null;
      let lastIce2 = null;

      const checkConnection = () => {
        const ice1 = this.pc1.iceConnectionState;
        const ice2 = this.pc2.iceConnectionState;

        if (ice1 !== lastIce1 || ice2 !== lastIce2) {
          eventBus.emit('log:stream', {
            message: `Loopback: ICE durumu ${ice1}/${ice2}`,
            details: { pc1Ice: ice1, pc2Ice: ice2 }
          });
          lastIce1 = ice1;
          lastIce2 = ice2;
        }

        if ((ice1 === 'connected' || ice1 === 'completed') &&
            (ice2 === 'connected' || ice2 === 'completed')) {
          clearTimeout(timeout);
          cleanupListeners();
          resolve();
        } else if (ice1 === 'failed' || ice2 === 'failed') {
          clearTimeout(timeout);
          cleanupListeners();
          reject(new Error('ICE connection failed'));
        } else {
          setTimeout(checkConnection, 100);
        }
      };

      this.pc1.oniceconnectionstatechange = checkConnection;
      this.pc2.oniceconnectionstatechange = checkConnection;
      checkConnection();
    });
  }

  /**
   * Track unmute olmasini bekle
   * @private
   */
  async _waitForTrackUnmute(track) {
    eventBus.emit('log:stream', {
      message: 'Loopback: Track muted, unmute bekleniyor...',
      details: { muted: track.muted }
    });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        eventBus.emit('log:error', {
          message: 'Loopback: Track unmute zaman asimi',
          details: { stillMuted: track.muted }
        });
        resolve();
      }, 5000);

      track.onunmute = () => {
        clearTimeout(timeout);
        eventBus.emit('log:stream', {
          message: 'Loopback: Track unmuted!',
          details: { muted: track.muted }
        });
        resolve();
      };

      if (!track.muted) {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  /**
   * WebRTC getStats ile gercek bitrate olcumu
   */
  startStatsPolling(requestedBitrate) {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    this.lastBytesSent = 0;
    this.lastStatsTimestamp = Date.now();
    let statsErrorCount = 0;

    this.statsInterval = setInterval(async () => {
      if (!this.pc1) {
        clearInterval(this.statsInterval);
        this.statsInterval = null;
        return;
      }

      try {
        const stats = await this.pc1.getStats();
        let currentBytesSent = 0;

        stats.forEach(report => {
          if (report.type === 'outbound-rtp' && report.kind === 'audio') {
            currentBytesSent = report.bytesSent || 0;
          }
        });

        const now = Date.now();
        const timeDelta = (now - this.lastStatsTimestamp) / 1000;

        if (this.lastBytesSent > 0 && timeDelta > 0) {
          const bytesDelta = currentBytesSent - this.lastBytesSent;
          const actualBitrate = Math.round((bytesDelta * 8) / timeDelta);
          const actualKbps = (actualBitrate / 1000).toFixed(1);
          const requestedKbps = (requestedBitrate / 1000).toFixed(0);

          eventBus.emit('loopback:stats', {
            requestedBitrate,
            actualBitrate,
            requestedKbps,
            actualKbps
          });

          const deviation = Math.abs(actualBitrate - requestedBitrate) / requestedBitrate;
          if (deviation > 0.5) {
            eventBus.emit('log:warning', {
              message: `WebRTC bitrate sapmasi: Istenen ${requestedKbps}kbps, Gercek ~${actualKbps}kbps`,
              details: { requestedBitrate, actualBitrate, deviation: (deviation * 100).toFixed(0) + '%' }
            });
          }
        }

        this.lastBytesSent = currentBytesSent;
        this.lastStatsTimestamp = now;
        statsErrorCount = 0;

      } catch (err) {
        statsErrorCount++;
        if (statsErrorCount > 10) {
          clearInterval(this.statsInterval);
          this.statsInterval = null;
          eventBus.emit('log:error', {
            message: 'Loopback stats: Cok fazla hata, polling durduruluyor',
            details: { errorCount: statsErrorCount, lastError: err.message }
          });
        }
      }
    }, 2000);
  }

  /**
   * Loopback kaynaklarini temizler
   */
  async cleanup() {
    // Stats polling durdur
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Signal check timeout durdur
    if (this.signalCheckTimeout) {
      clearTimeout(this.signalCheckTimeout);
      this.signalCheckTimeout = null;
    }

    this.pc1?.close();
    this.pc2?.close();
    this.pc1 = null;
    this.pc2 = null;

    stopStreamTracks(this.remoteStream);
    this.remoteStream = null;

    if (this.audioCtx) {
      await this.audioCtx.close();
      this.audioCtx = null;
    }

    eventBus.emit('log:stream', {
      message: 'Loopback: Kaynaklar temizlendi',
      details: {}
    });
  }

  /**
   * Monitor playback kaynaklarini temizle
   */
  async cleanupMonitorPlayback() {
    if (this.monitorProc) {
      try {
        this.monitorProc.disconnect();
      } catch { /* ignore */ }
      this.monitorProc.onaudioprocess = null;
      this.monitorProc = null;
    }

    if (this.monitorWorklet) {
      try {
        this.monitorWorklet.disconnect();
      } catch { /* ignore */ }
      this.monitorWorklet = null;
    }

    if (this.monitorDelay) {
      try {
        this.monitorDelay.disconnect();
      } catch { /* ignore */ }
      this.monitorDelay = null;
    }

    if (this.monitorSrc) {
      try {
        this.monitorSrc.disconnect();
      } catch { /* ignore */ }
      this.monitorSrc = null;
    }

    if (this.monitorCtx) {
      try {
        const prevState = this.monitorCtx.state;
        await this.monitorCtx.close();
        eventBus.emit('log:webaudio', {
          message: 'Loopback Monitor: AudioContext kapatildi',
          details: { previousState: prevState, newState: 'closed' }
        });
      } catch (err) {
        eventBus.emit('log:error', {
          message: 'Loopback Monitor: AudioContext kapatma hatasi',
          details: { error: err.message }
        });
      } finally {
        this.monitorCtx = null;
      }
    }

    if (window._loopbackMonitorActivatorAudio) {
      try {
        window._loopbackMonitorActivatorAudio.pause();
        window._loopbackMonitorActivatorAudio.srcObject = null;
      } catch { /* ignore */ }
      window._loopbackMonitorActivatorAudio = null;
    }

    this.monitorMode = null;
  }

  /**
   * Monitor playback baslat
   * @param {MediaStream} remoteStream - WebRTC remote stream
   * @param {Object} options - Seçenekler
   * @param {string} options.mode - Processing mode (direct, standard, scriptprocessor, worklet)
   * @param {number} options.bufferSize - Buffer size (for scriptprocessor)
   */
  async startMonitorPlayback(remoteStream, options = {}) {
    await this.cleanupMonitorPlayback();

    if (!remoteStream) {
      throw new Error('Loopback Monitor: remote stream yok');
    }

    const { mode: requestedMode = 'standard', bufferSize = BUFFER.DEFAULT_SIZE } = options;

    const safeMode = (() => {
      // Loopback monitoring icin izin verilen modlar (ScriptProcessor YASAK - sadece record icin)
      const allowed = new Set(['direct', 'standard', 'worklet']);
      if (!allowed.has(requestedMode)) return 'standard';
      if (requestedMode === 'worklet' && !this.workletSupported) return 'standard';
      return requestedMode;
    })();

    this.monitorMode = safeMode;

    // Chrome/WebRTC: Remote stream'i WebAudio'ya baglamadan once Audio element ile aktive et
    const activatorAudio = document.createElement('audio');
    activatorAudio.srcObject = remoteStream;
    activatorAudio.muted = true;
    activatorAudio.volume = 0;
    activatorAudio.playsInline = true;
    window._loopbackMonitorActivatorAudio = activatorAudio;

    try {
      await activatorAudio.play();
      eventBus.emit('log:webaudio', {
        message: 'Loopback Monitor: Activator audio baslatildi',
        details: { paused: activatorAudio.paused, muted: activatorAudio.muted }
      });
    } catch (playErr) {
      eventBus.emit('log:error', {
        message: 'Loopback Monitor: Activator audio play hatasi (devam ediliyor)',
        details: { error: playErr.message }
      });
    }

    // Remote track sample rate (varsa) ile context olustur
    const acOptions = getAudioContextOptions(remoteStream);
    this.monitorCtx = await createAudioContext(acOptions);

    this.monitorSrc = this.monitorCtx.createMediaStreamSource(remoteStream);

    // DelayNode olustur - gecikme (feedback onleme)
    this.monitorDelay = this.monitorCtx.createDelay(DELAY.MAX_SECONDS);
    this.monitorDelay.delayTime.value = DELAY.DEFAULT_SECONDS;

    const delaySeconds = this.monitorDelay.delayTime.value;

    if (safeMode === 'worklet') {
      await ensurePassthroughWorklet(this.monitorCtx);
      this.monitorWorklet = createPassthroughWorkletNode(this.monitorCtx);
      this.monitorSrc.connect(this.monitorWorklet);
      this.monitorWorklet.connect(this.monitorDelay);
    } else {
      // direct / standard: Source -> Delay
      this.monitorSrc.connect(this.monitorDelay);
    }

    this.monitorDelay.connect(this.monitorCtx.destination);

    const remoteTrack = remoteStream.getAudioTracks?.()?.[0];
    const remoteSampleRate = remoteTrack?.getSettings?.()?.sampleRate;

    const graphByMode = {
      direct: `WebRTC RemoteStream -> Source -> DelayNode(${delaySeconds}s) -> Destination`,
      standard: `WebRTC RemoteStream -> Source -> DelayNode(${delaySeconds}s) -> Destination`,
      worklet: `WebRTC RemoteStream -> Source -> AudioWorklet(passthrough) -> DelayNode(${delaySeconds}s) -> Destination`
    };

    eventBus.emit('log:webaudio', {
      message: 'Loopback Monitor: Playback grafigi tamamlandi',
      details: {
        mode: safeMode,
        contextSampleRate: this.monitorCtx.sampleRate,
        remoteSampleRate: remoteSampleRate || 'N/A',
        delaySeconds,
        graph: graphByMode[safeMode] || graphByMode.standard
      }
    });

    eventBus.emit('monitor:started', { mode: safeMode, delaySeconds, loopback: true });
    eventBus.emit('log', `🎧 Loopback monitor aktif (${safeMode} + ${delaySeconds.toFixed(1)}s Delay -> Speaker)`);
  }

  /**
   * Loopback aktif mi?
   */
  get isActive() {
    return this.pc1 !== null && this.pc2 !== null;
  }

  /**
   * Remote stream'i dondur
   */
  getRemoteStream() {
    return this.remoteStream;
  }
}

// Singleton export
const loopbackManager = new LoopbackManager();
export default loopbackManager;
