/* Locally synthesized sci-fi interface cues and finite Web Animations.
 * All sounds start from user interaction and follow the simulation's Sound setting. */
(() => {
  'use strict';
  const soundFiles = {
    activate: 'resources/sounds/ui/activate.wav',
    confirm: 'resources/sounds/ui/confirm.wav',
    toggle: 'resources/sounds/ui/toggle.wav',
    slider: 'resources/sounds/ui/slider.wav',
    denial: 'resources/sounds/ui/denial.wav'
  };
  const soundVolumes = { activate: 0.3, confirm: 0.34, toggle: 0.28, slider: 0.16, denial: 0.32 };
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
      sound.volume = soundVolumes[kind] || 0.3;
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
  function denyFeedback(element) {
    animate(element, [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)', offset: 0.2 },
      { transform: 'translateX(4px)', offset: 0.4 }, { transform: 'translateX(-3px)', offset: 0.6 },
      { transform: 'translateX(3px)', offset: 0.8 }, { transform: 'translateX(0)' }],
      { duration: 240, easing: 'ease-in-out' });
  }
  /* Controller rows of a freshly opened deck category rise in with a short stagger.
   * Transform-only: rows are never left invisible if the animation clock stalls. */
  function cascadeReveal(folder) {
    const inner = folder.querySelector(':scope > .dg > ul');
    if (!inner || inner.classList.contains('closed')) return;
    const rows = inner.querySelectorAll(':scope > li:not(.title)');
    const limit = Math.min(rows.length, 14);
    for (let i = 0; i < limit; i++) {
      animate(rows[i], [{ transform: 'translateY(10px)' },
        { transform: 'translateY(0)' }],
        { duration: 230, delay: i * 28, easing: 'ease-out' });
    }
  }
  function isDisabled(control) {
    return control.disabled || control.getAttribute('aria-disabled') === 'true' ||
      (control.disabled === undefined && control.classList && control.classList.contains('disabled'));
  }
  /* Children of a menu panel rise in with a short stagger — the whole panel
   * scans in rather than popping as one slab. */
  function staggerChildren(panel) {
    if (!panel) return;
    const children = [...(panel.children || [])].slice(0, 12);
    children.forEach((child, i) => {
      animate(child, [{ transform: 'translateY(14px)' },
        { transform: 'translateY(0)' }],
        { duration: 320, delay: 60 + i * 55, easing: 'cubic-bezier(.2,.9,.25,1)' });
    });
  }
  function startMotion() {
    const menu = document.getElementById('mainMenuContent');
    const choice = document.getElementById('mainMenuChoice');
    const setup = document.getElementById('mainMenuSetup');
    panelEntrance(choice);
    staggerChildren(choice);
    if (menu && typeof MutationObserver !== 'undefined') {
      let configuring = menu.classList.contains('is-configuring');
      new MutationObserver(() => {
        const next = menu.classList.contains('is-configuring');
        if (next !== configuring) {
          configuring = next;
          panelEntrance(document.getElementById(next ? 'mainMenuSetup' : 'mainMenuChoice'));
          if (next) {
            // Configuring view: everything below the choice screen scans in.
            const items = Array.from(menu.children || []).filter(el => el.id !== 'mainMenuChoice');
            staggerChildren({ children: items });
          } else {
            staggerChildren(document.getElementById('mainMenuChoice'));
          }
        }
      }).observe(menu, { attributes: true, attributeFilter: ['class'] });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startMotion, { once: true });
  else startMotion();

  /* ================= Control deck: true hide / show =================
   * dat.gui's built-in close button only collapses the rows (ul.closed);
   * the empty deck slab stayed on screen. The simulation control deck now
   * hides completely (display:none) and a reopen chip floats in its place.
   * The dat.gui "H" shortcut is intercepted here so both paths stay in sync. */
  function deckAc() {
    return document.querySelector('.dg.ac');
  }
  function isDeckHidden() {
    const ac = deckAc();
    return !!ac && ac.style.display === 'none';
  }
  function ensureReopenChip() {
    if (typeof document.createElement !== 'function') return null;
    let chip = document.getElementById('deckReopenBtn');
    if (chip) return chip;
    chip = document.createElement('button');
    chip.id = 'deckReopenBtn';
    chip.type = 'button';
    chip.hidden = true;
    chip.setAttribute('aria-label', 'Show simulation controls');
    chip.setAttribute('title', 'Show simulation controls (H)');
    chip.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h16M4 15h16M8 9v0M12 15v0"/></svg>' +
      '<span>CONTROLS</span>';
    chip.addEventListener('click', () => { showDeck(); cue('confirm'); });
    document.body.appendChild(chip);
    return chip;
  }
  function hideDeck() {
    const ac = deckAc();
    if (!ac) return;
    ac.style.display = 'none';
    const chip = ensureReopenChip();
    if (!chip) return;
    chip.hidden = false;
    animate(chip, [{ transform: 'translateX(-50%) translateY(14px) scale(.96)' },
      { transform: 'translateX(-50%) translateY(0) scale(1)' }], { duration: 260, easing: 'ease-out' });
  }
  function showDeck() {
    const ac = deckAc();
    if (ac) ac.style.display = '';
    // Restore dat.gui's own visibility flag if it hid the container.
    if (ac && getComputedStyle(ac).display === 'none') ac.style.display = 'block';
    const chip = document.getElementById('deckReopenBtn');
    if (chip) chip.hidden = true;
    const main = ac && ac.querySelector('.dg.main');
    if (main) {
      animate(main, [{ transform: 'translateY(16px)' },
        { transform: 'translateY(0)' }], { duration: 280, easing: 'ease-out' });
    }
  }
  function toggleDeck() {
    if (isDeckHidden()) showDeck();
    else hideDeck();
  }
  // Capture phase: runs before dat.gui's own delegated handlers can react.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const closeButton = target && target.closest('.dg.main > .close-button');
    if (!closeButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cue('toggle');
    hideDeck();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'h' && event.key !== 'H') return;
    const active = document.activeElement;
    if (active && (active.type === 'text' || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleDeck();
    cue('toggle');
  }, true);
  // Keep the reopen chip honest if dat.gui re-shows the deck itself (e.g. starting a new simulation).
  try {
    if (typeof MutationObserver !== 'undefined' && typeof document.querySelector === 'function') {
      const syncChip = () => {
        const ac = deckAc();
        if (ac && ac.style.display !== 'none') {
          const chip = document.getElementById('deckReopenBtn');
          if (chip) chip.hidden = true;
        }
      };
      const watchDeck = () => {
        const ac = deckAc();
        if (ac && !ac.__chipWatched) {
          ac.__chipWatched = true;
          new MutationObserver(syncChip).observe(ac, { attributes: true, attributeFilter: ['style', 'class'] });
        }
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchDeck, { once: true });
      else watchDeck();
    }
  } catch (_) { /* Chip sync is best-effort; hide/show still work. */ }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureReopenChip, { once: true });
    else ensureReopenChip();
  } catch (_) { /* No chip in exotic DOMs; the close button still hides the deck. */ }

  const controlSelector = 'button, input[type="button"], a, .dg li.title, .dg .close-button, .sim-option-item';
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('#mainCanvas, #graphCanvas, #dropletInfoCanvas')) return;
    if (target.closest('input[type="checkbox"], input[type="range"], select, .dg .slider')) return;
    // Folder tabs: flash the tab and cascade-reveal the newly opened controls.
    const title = target.closest('.dg li.title');
    if (title && !isDisabled(title)) {
      cue('activate');
      controlFeedback(title);
      const folder = title.closest('li.folder');
      if (folder) cascadeReveal(folder);
      return;
    }
    const control = target.closest(controlSelector);
    if (!control) return;
    if (isDisabled(control)) { cue('denial'); denyFeedback(control); return; }
    if (control.matches('.main-menu-submit')) { cue('confirm'); controlFeedback(control); return; }
    cue('activate');
    controlFeedback(control);
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
