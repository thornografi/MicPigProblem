/**
 * MicProbe - Landing Page JavaScript
 *
 * Sorumluluklar:
 * - View switching (landing <-> app)
 * - Lazy loading of app.js
 * - Route handling (path + hash based)
 * - Navbar scroll effect
 * - Smooth scroll for anchor links
 * - Wave animator initialization
 * - Dev console toggle
 */

import { initWaveAnimator } from './modules/WaveAnimator.js';

// ============================================
// STATE
// ============================================
let appModule = null;
let appLoading = false;

// ============================================
// VIEW SWITCHING
// ============================================

/**
 * Show App View with lazy loading
 */
export async function showAppView() {
  // Prevent double loading
  if (appLoading) return;

  // Update UI immediately
  document.body.classList.add('app-mode');
  document.getElementById('landing-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  window.scrollTo(0, 0);

  // Update URL (hibrit: path-based tercih, hash fallback)
  const newUrl = window.location.origin + '/app';
  if (window.location.href !== newUrl) {
    history.pushState({ view: 'app' }, '', newUrl);
  }

  // Lazy load app.js if not already loaded
  if (!appModule) {
    appLoading = true;
    try {
      appModule = await import('./app.js');
      console.log('[Landing] App module loaded');
    } catch (err) {
      console.error('[Landing] Failed to load app module:', err);
    } finally {
      appLoading = false;
    }
  }
}

/**
 * Show Landing View
 */
export function showLandingView() {
  document.body.classList.remove('app-mode');
  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('landing-view').classList.remove('hidden');
  window.scrollTo(0, 0);

  // Update URL to root
  if (window.location.pathname !== '/') {
    history.pushState({ view: 'landing' }, '', '/');
  }
}

// ============================================
// ROUTE HANDLING
// ============================================

/**
 * Handle route based on URL path or hash
 * Supports both /app and #app
 */
function handleRoute() {
  const path = window.location.pathname;
  const hash = window.location.hash;

  // Path-based routing (preferred)
  if (path === '/app' || path === '/app/') {
    showAppView();
    return;
  }

  // Hash-based routing (fallback for static hosting)
  if (hash === '#app') {
    showAppView();
    return;
  }

  // Default: show landing
  showLandingView();
}

// ============================================
// NAVBAR
// ============================================

/**
 * Add/remove scrolled class on navbar based on scroll position
 */
function initNavbarScroll() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  const updateNavbar = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
  };

  window.addEventListener('scroll', updateNavbar, { passive: true });
  updateNavbar(); // Initial state
}

// ============================================
// SMOOTH SCROLL
// ============================================

/**
 * Enable smooth scrolling for anchor links in landing view only
 * Excludes #app (handled by view switching) and download links
 */
function initSmoothScroll() {
  document.querySelectorAll('#landing-view a[href^="#"]:not([download])').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const href = this.getAttribute('href');

      // Skip empty hash and #app (handled by showAppView)
      if (href === '#' || href === '#app') return;

      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}

// ============================================
// DEV CONSOLE
// ============================================

/**
 * Toggle dev console visibility
 */
function toggleDevConsole() {
  const devConsole = document.getElementById('devConsole');
  if (devConsole) {
    devConsole.classList.toggle('open');
  }
}

// ============================================
// WAVE ANIMATOR
// ============================================

/**
 * Initialize hero section wave animation
 */
function initWaveAnimation() {
  initWaveAnimator('.hero-soundwave', {
    barCount: 280,
    width: 1600,
    height: 260,
    barWidth: 2.5,
    barGap: 3,
    minBarHeight: 6,
    maxBarHeight: 180,
    waveFrequency: 1.8,
    secondaryFrequency: 4.3,
    tertiaryFrequency: 7.1,
    quaternaryFrequency: 11.7,
    centerGap: 0.10,
    centerFadeZone: 0.06,
    edgeFadeStart: 0.35,
    edgeFadeEnd: 0.05,
    centerHeightMin: 0.15,
    centerHeightEasing: 0.5
  });
}

// ============================================
// INITIALIZATION
// ============================================

function init() {
  // Initialize landing page features
  initNavbarScroll();
  initSmoothScroll();
  initWaveAnimation();

  // Handle initial route
  handleRoute();

  console.log('[Landing] Initialized');
}

// ============================================
// EVENT LISTENERS
// ============================================

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Handle browser back/forward
window.addEventListener('popstate', handleRoute);

// ============================================
// GLOBAL EXPORTS (for onclick handlers in HTML)
// ============================================

window.showAppView = showAppView;
window.showLandingView = showLandingView;
window.toggleDevConsole = toggleDevConsole;
