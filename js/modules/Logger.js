/**
 * Logger - Konsol ciktisi yonetimi
 * OCP: Yeni log formatlari/hedefleri eklenebilir
 * Kategori filtreleme destegi
 */
import eventBus from './EventBus.js';

class Logger {
  constructor(elementId) {
    this.el = document.getElementById(elementId);
    this.history = [];
    this.activeFilter = null; // null = hepsi, 'error' = sadece error vs.

    // Event dinle
    eventBus.on('log', (msg) => this.log(msg, 'ui'));
    eventBus.on('log:clear', () => this.clear());

    // Kategorili loglar icin
    eventBus.on('log:display', (data) => {
      this.log(data.message, data.category);
    });
  }

  log(message, category = 'ui') {
    const time = new Date().toLocaleTimeString('tr-TR');
    const prefix = category !== 'ui' ? `[${category.toUpperCase()}] ` : '';
    const formattedMessage = `[${time}] ${prefix}${message}`;

    this.history.push({ time, message: formattedMessage, category, raw: message });

    // Aktif filtre varsa ve kategori uyusmuyorsa gosterme
    if (this.activeFilter && this.activeFilter !== category) {
      return;
    }

    this.appendToDisplay(formattedMessage, category);

    // Diger modullere bildir
    eventBus.emit('log:added', { time, message: formattedMessage, category });
  }

  appendToDisplay(message, category) {
    if (!this.el) return;

    const line = document.createElement('div');
    line.className = `log-line log-${category}`;
    line.textContent = message;
    this.el.appendChild(line);
    this.el.scrollTop = this.el.scrollHeight;
  }

  // Kategori filtreleme
  filterByCategory(category) {
    this.activeFilter = category;
    this.renderFilteredLogs();
    this.updateFilterButtons(category);
  }

  // Tum loglari goster
  showAll() {
    this.activeFilter = null;
    this.renderFilteredLogs();
    this.updateFilterButtons(null);
  }

  renderFilteredLogs() {
    if (!this.el) return;

    this.el.innerHTML = '';

    const filteredLogs = this.activeFilter
      ? this.history.filter(h => h.category === this.activeFilter)
      : this.history;

    filteredLogs.forEach(h => {
      this.appendToDisplay(h.message, h.category);
    });
  }

  updateFilterButtons(activeCategory) {
    // Tum filter butonlarini guncelle
    document.querySelectorAll('.btn-filter').forEach(btn => {
      btn.classList.remove('active');
    });

    if (activeCategory) {
      const activeBtn = document.querySelector(`[data-category="${activeCategory}"]`);
      if (activeBtn) activeBtn.classList.add('active');
    } else {
      const allBtn = document.querySelector('[data-category="all"]');
      if (allBtn) allBtn.classList.add('active');
    }
  }

  clear() {
    this.history = [];
    this.activeFilter = null;
    if (this.el) {
      this.el.innerHTML = '';
    }
    this.log('Log temizlendi', 'system');
  }

  getHistory() {
    return [...this.history];
  }

  getFilteredHistory() {
    return this.activeFilter
      ? this.history.filter(h => h.category === this.activeFilter)
      : this.history;
  }
}

export default Logger;
