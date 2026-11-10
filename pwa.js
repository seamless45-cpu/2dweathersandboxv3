/*
 * 2D Weather Sandbox — PWA glue
 * ---------------------------------------------------------------------------
 * Two jobs, both progressive enhancements: nothing here runs (or breaks
 * anything) when service workers or install prompts are unavailable.
 *
 *   1. Register sw.js so a second visit — and every launch after an install —
 *      boots straight from cache, with no network.
 *   2. Offer the browser's "install app" prompt from the main menu, but only
 *      once the browser has actually decided the app is installable.
 */

(function () {
  'use strict';

  var SERVICE_WORKER = 'sw.js';
  var isHttp = /^https?:$/.test(window.location.protocol);

  // -------------------------------------------------------------------------
  // 1. Service worker
  // -------------------------------------------------------------------------

  if (isHttp && 'serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(SERVICE_WORKER, { scope: './' }).catch(function (error) {
        // file://, private-mode quotas and old browsers all land here; the app
        // works exactly as before without a worker.
        console.info('[pwa] service worker not registered:', error && error.message);
      });
    });
  }

  // -------------------------------------------------------------------------
  // 2. Install button
  // -------------------------------------------------------------------------

  var deferredPrompt = null;
  var wrap = null;
  var button = null;

  function isStandalone() {
    return (
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true
    );
  }

  function setButtonVisible(visible) {
    if (!wrap) return;
    if (visible) {
      wrap.hidden = false;
      wrap.removeAttribute('aria-hidden');
    } else {
      wrap.hidden = true;
      wrap.setAttribute('aria-hidden', 'true');
    }
  }

  function onBeforeInstallPrompt(event) {
    // Keep the browser's mini-infobar away and use our own button instead.
    event.preventDefault();
    if (isStandalone()) return;
    deferredPrompt = event;
    setButtonVisible(true);
  }

  function onAppInstalled() {
    deferredPrompt = null;
    setButtonVisible(false);
  }

  function onInstallClick() {
    if (!deferredPrompt) return;
    var prompt = deferredPrompt;
    deferredPrompt = null;
    setButtonVisible(false);

    prompt.prompt();
    var choice = prompt.userChoice;
    if (choice && typeof choice.then === 'function') {
      choice.then(function (result) {
        console.info('[pwa] install prompt:', result && result.outcome);
      });
    }
  }

  // Registered before first paint: the prompt event can fire before
  // DOMContentLoaded on fast repeat visits.
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);

  function init() {
    wrap = document.getElementById('installAppWrap');
    button = document.getElementById('installAppButton');

    if (button) button.addEventListener('click', onInstallClick);
    setButtonVisible(deferredPrompt !== null && !isStandalone());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
