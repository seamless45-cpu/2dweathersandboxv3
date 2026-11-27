/* Short synthesized interface cues: no media downloads or per-frame audio work.
 * Audio starts only from a user gesture and follows the existing Sound setting. */
(() => {
  'use strict';
  let uiContext = null;
  let lastSliderCue = 0;
  if (typeof Chart !== 'undefined' && Chart.defaults && Chart.defaults.font)
    Chart.defaults.font.family = 'Orbitron, sans-serif';

  function soundEnabled() {
    return typeof guiControls === 'undefined' || !guiControls ?
      (typeof guiControls_default === 'undefined' || guiControls_default.sound !== false) :
      guiControls.sound !== false;
  }

  function contextForGesture() {
    const gameContext = typeof soundSystem !== 'undefined' && soundSystem && soundSystem.audioCtx;
    if (gameContext) {
      if (uiContext && uiContext !== gameContext && uiContext.state !== 'closed') uiContext.close().catch(() => {});
      uiContext = gameContext;
    } else if (!uiContext || uiContext.state === 'closed') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      uiContext = new AudioContextClass();
    }
    if (uiContext.state === 'suspended') uiContext.resume().catch(() => {});
    return uiContext;
  }

  function cue(kind) {
    if (!soundEnabled()) return;
    try {
      const ctx = contextForGesture();
      if (!ctx || ctx.state === 'closed') return;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(kind === 'slider' ? 0.025 : 0.045, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      gain.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = kind === 'toggle' ? 'square' : 'triangle';
      const start = kind === 'toggle' ? 540 : kind === 'slider' ? 980 : 760;
      osc.frequency.setValueAtTime(start, now);
      osc.frequency.exponentialRampToValueAtTime(kind === 'toggle' ? 810 : start * 1.45, now + 0.055);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.1);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    } catch (_) { /* Unsupported or blocked audio never interrupts controls. */ }
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('#mainCanvas, #graphCanvas, #dropletInfoCanvas')) return;
    if (target.closest('input[type="checkbox"], input[type="range"], select, .dg .slider')) return;
    const control = target.closest('button, input[type="button"], a, .dg li.title, .dg .close-button');
    if (control && !control.disabled && control.getAttribute('aria-disabled') !== 'true') cue('activate');
  });
  document.addEventListener('change', event => {
    const target = event.target;
    if (target instanceof Element && target.matches('input[type="checkbox"], select')) cue('toggle');
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
})();
