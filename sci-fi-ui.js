/* Locally bundled Kenney interface samples and finite Web Animations.
 * All sounds start from user interaction and follow the simulation's Sound setting. */
(() => {
  'use strict';
  const soundFiles = {
    activate: 'resources/sounds/ui/click1.wav',
    toggle: 'resources/sounds/ui/switch6.wav',
    slider: 'resources/sounds/ui/rollover2.wav'
  };
  const sounds = Object.create(null);
  let lastSliderCue = -Infinity;
  if (typeof Chart !== 'undefined' && Chart.defaults && Chart.defaults.font)
    Chart.defaults.font.family = 'Orbitron, sans-serif';

  function soundEnabled() {
    return typeof guiControls === 'undefined' || !guiControls ?
      (typeof guiControls_default === 'undefined' || guiControls_default.sound !== false) :
      guiControls.sound !== false;
  }

  function stopSounds() {
    Object.values(sounds).forEach(sound => { sound.pause(); sound.currentTime = 0; });
  }

  function cue(kind) {
    if (!soundEnabled()) { stopSounds(); return; }
    try {
      const sound = sounds[kind] || (sounds[kind] = new Audio(soundFiles[kind]));
      sound.volume = kind === 'slider' ? 0.18 : 0.3;
      sound.currentTime = 0;
      const playing = sound.play();
      if (playing && typeof playing.catch === 'function') playing.catch(() => {});
    } catch (_) { /* Blocked or unsupported audio never interrupts controls. */ }
  }

  function animate(element, keyframes, options) {
    if (!element || !element.animate) return;
    try { element.animate(keyframes, options); } catch (_) { /* Optional visual enhancement. */ }
  }
  function panelEntrance(element) {
    animate(element, [{ opacity: 0, transform: 'translateY(9px)' },
      { opacity: 1, transform: 'translateY(0)' }], { duration: 240, easing: 'ease-out' });
  }
  function controlFeedback(element) {
    animate(element, [{ filter: 'brightness(1)' }, { filter: 'brightness(1.5)', offset: 0.35 },
      { filter: 'brightness(1)' }], { duration: 200, easing: 'ease-out' });
  }
  function startMotion() {
    const menu = document.getElementById('mainMenuContent');
    panelEntrance(document.getElementById('mainMenuChoice'));
    if (menu && typeof MutationObserver !== 'undefined') {
      let configuring = menu.classList.contains('is-configuring');
      new MutationObserver(() => {
        const next = menu.classList.contains('is-configuring');
        if (next !== configuring) {
          configuring = next;
          panelEntrance(document.getElementById(next ? 'mainMenuSetup' : 'mainMenuChoice'));
        }
      }).observe(menu, { attributes: true, attributeFilter: ['class'] });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startMotion, { once: true });
  else startMotion();

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('#mainCanvas, #graphCanvas, #dropletInfoCanvas')) return;
    if (target.closest('input[type="checkbox"], input[type="range"], select, .dg .slider')) return;
    const control = target.closest('button, input[type="button"], a, .dg li.title, .dg .close-button');
    if (control && !control.disabled && control.getAttribute('aria-disabled') !== 'true') {
      cue('activate');
      controlFeedback(control);
    }
  });
  document.addEventListener('change', event => {
    const target = event.target;
    if (target instanceof Element && target.matches('input[type="checkbox"], select')) {
      cue('toggle');
      controlFeedback(target.closest('.cr') || target);
    }
  });
  document.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches('input[type="range"]')) return;
    const now = performance.now();
    if (now - lastSliderCue < 120) return;
    lastSliderCue = now;
    cue('slider');
  });
  document.addEventListener('pointerdown', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('.dg .slider')) cue('slider');
  });
  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const target = event.target instanceof Element ? event.target : null;
    const control = target && target.closest('.main-menu-action, .main-menu-submit, .dg li.title');
    if (!control || (event.relatedTarget && control.contains(event.relatedTarget))) return;
    animate(control, [{ filter: 'brightness(1)' }, { filter: 'brightness(1.25)' },
      { filter: 'brightness(1)' }], { duration: 230, easing: 'ease-out' });
  });
})();
