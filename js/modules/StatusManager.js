/**
 * StatusManager - Durum gostergesi yonetimi
 * OCP: Yeni durumlar eklenebilir
 */
import eventBus from './EventBus.js';

class StatusManager {
  constructor(elementId) {
    this.el = document.getElementById(elementId);
    this.currentStatus = 'idle';

    this.statusConfig = {
      idle: { class: 'status-idle', text: 'Ready' },
      recording: { class: 'status-recording', text: 'Recording' },
      monitoring: { class: 'status-monitoring', text: 'Monitor Active' },
      webaudio: { class: 'status-webaudio', text: 'WebAudio Active' },
      loopback: { class: 'status-loopback', text: 'WebRTC Loopback' }
    };

    // Inline CSS vars allow new status colors without touching CSS.
    this.statusVarKeys = [
      '--status-bg',
      '--status-border',
      '--status-color',
      '--status-shadow',
      '--status-dot',
      '--status-dot-shadow'
    ];

    // Event dinle
    eventBus.on('recorder:started', () => this.setStatus('recording'));
    eventBus.on('recorder:stopped', () => this.setStatus('idle'));
    eventBus.on('monitor:started', (data) => {
      if (data?.loopback) {
        this.setStatus('loopback');
      } else if (data.mode === 'scriptprocessor' || data.mode === 'worklet') {
        this.setStatus('webaudio');
      } else {
        this.setStatus('monitoring');
      }
    });
    eventBus.on('monitor:stopped', () => this.setStatus('idle'));
    eventBus.on('loopback:started', () => this.setStatus('loopback'));
    eventBus.on('loopback:stopped', () => this.setStatus('idle'));
  }

  setStatus(status) {
    const config = this.statusConfig[status] || this.statusConfig.idle;
    this.currentStatus = status;

    if (this.el) {
      this.el.className = `status ${config.class || ''}`.trim();
      this.el.dataset.status = status;
      this.statusVarKeys.forEach((key) => this.el.style.removeProperty(key));
      if (config.vars) {
        Object.entries(config.vars).forEach(([key, value]) => {
          this.el.style.setProperty(key, value);
        });
      }
      this.el.innerHTML = `<span class="status-dot"></span>${config.text}`;
    }

    eventBus.emit('status:changed', { status, text: config.text });
  }

  getStatus() {
    return this.currentStatus;
  }

  // OCP: Yeni durum eklemek icin
  addStatus(key, config) {
    this.statusConfig[key] = config;
  }
}

export default StatusManager;
