/**
 * BasePipeline - Pipeline Strategy Interface
 * OCP: Yeni pipeline eklemek icin bu class'i extend et
 *
 * Her pipeline:
 * - setup(): WebAudio graph'i kur
 * - cleanup(): Kaynaklari temizle
 * - getNodes(): Olusturulan node'lari dondur
 */
import eventBus from '../modules/EventBus.js';

export default class BasePipeline {
  constructor(audioContext, sourceNode, destinationNode) {
    this.audioContext = audioContext;
    this.sourceNode = sourceNode;
    this.destinationNode = destinationNode;

    // Alt class'lar bu node'lari dolduracak
    this.nodes = {
      processor: null,  // ScriptProcessor veya Worklet
      mute: null,       // WASM Opus icin mute GainNode
      worklet: null     // AudioWorkletNode
    };
  }

  /**
   * Pipeline'i kur
   * @param {Object} options - Pipeline options (bufferSize, encoder, etc.)
   * @returns {Promise<void>}
   */
  async setup(options = {}) {
    throw new Error('BasePipeline.setup() must be implemented by subclass');
  }

  /**
   * Pipeline'i temizle
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Ortak temizlik mantigi
    Object.values(this.nodes).forEach(node => {
      if (node) {
        try {
          node.disconnect();
        } catch {
          // Node zaten disconnect olmus olabilir
        }
      }
    });

    // ScriptProcessor onaudioprocess temizligi
    if (this.nodes.processor?.onaudioprocess) {
      this.nodes.processor.onaudioprocess = null;
    }

    this.nodes = { processor: null, mute: null, worklet: null };
  }

  /**
   * Olusturulan node'lari dondur
   * @returns {Object} - { processor, mute, worklet }
   */
  getNodes() {
    return { ...this.nodes };
  }

  /**
   * Pipeline tipi (subclass override etmeli)
   * @returns {string}
   */
  get type() {
    return 'base';
  }

  /**
   * Log helper
   */
  log(message, details = {}) {
    eventBus.emit('log:webaudio', { message, details });
  }
}
