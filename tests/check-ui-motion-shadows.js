'use strict';
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const theme = fs.readFileSync('sci-fi-ui.css', 'utf8');
let failed = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
const shadows = [...css.matchAll(/box-shadow\s*:\s*([^;]+);/g)].map(m => m[1].trim());
check('authored box shadows are absent or zero-blur focus rings', shadows.every(s => s === 'none' || /^0 0 0 2px /.test(s)));
check('no blurred text or drop shadows; vendor inset is overridden',
  !/text-shadow\s*:|drop-shadow\s*\(/.test(css) && /#dg-new-constructor\s*\{\s*box-shadow:\s*none/.test(css));
check('menu keyboard focus retains a visible outline', /\.main-menu-action:focus-visible\s*\{[^}]*outline:\s*2px solid/.test(css));
check('sci-fi interaction motion is finite and honours reduced motion',
  /@keyframes hud-enter/.test(theme) && /animation: hud-enter 220ms/.test(theme) &&
  /prefers-reduced-motion: reduce/.test(theme) && /animation: none !important/.test(theme) &&
  !/animation[^;]*infinite/.test(theme));
check('no UI blur or backdrop filtering', !/backdrop-filter|(?:^|[\s:])blur\(/m.test(css + theme));
check('display-mode announcement remains statically visible and is cleaned up',
  /\.display-mode-toast\.is-visible\s*\{\s*opacity: 1/.test(css) && /aria-live', 'polite'/.test(app) && /\}, 850\);/.test(app));
check('loading has no transition wait and station pages switch without interpolating',
  !/setTimeout\(resolve, (700|350)\)/.test(app.slice(app.indexOf('class LoadingBar'), app.indexOf('var soundingData'))) &&
  /this\.#menuPage = 1 - this\.#menuPage/.test(app) && !/#menuTransitionStart/.test(app) && !/interpolateTextColor/.test(app));
const a = app.indexOf('    function setWindPushExtrasVisibility(visible)');
const b = app.indexOf('    function updateWindPushControlsVisibility()', a);
const row = {style: {height: ''}};
const ctx = {windPushExtrasRow: row};
vm.createContext(ctx);
vm.runInContext(app.slice(a, b) + '\nthis.toggle = setWindPushExtrasVisibility;', ctx);
ctx.toggle(true); const open = row.style.height === 'auto';
ctx.toggle(false); const closed = row.style.height === '0px';
check('wind-push extra controls expand and collapse immediately without transitionend', open && closed && !/transitionend/.test(app));
let JSDOM;
try { ({JSDOM} = require('jsdom')); } catch (_) {}
if (JSDOM) {
  const errors = [];
  const vc = new (require('jsdom').VirtualConsole)();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, {virtualConsole: vc, runScripts: 'outside-only'});
  check('authored CSS parses and main UI selectors remain separate', errors.length === 0 &&
    [...dom.window.document.styleSheets[0].cssRules].some(r => r.selectorText === '.simulation-clock-primary'));
  const w = dom.window;
  const loadingCode = app.slice(app.indexOf('class LoadingBar'), app.indexOf('var soundingData'));
  w.eval('var loadingBar = null; const clamp = (x, a, b) => Math.max(a, Math.min(b, x)); ' +
    loadingCode + '; window.startTestLoading = setLoadingBar; window.finishTestLoading = () => loadingBar.remove(true);');
  w.startTestLoading('Preparing');
  const started = !!w.document.getElementById('loadingScreen') && w.document.body.classList.contains('is-loading');
  w.finishTestLoading();
  check('loading completes immediately and cleans up its screen and state', started &&
    !w.document.getElementById('loadingScreen') && !w.document.getElementById('IntroScreen') &&
    !w.document.body.classList.contains('is-loading'));
  dom.window.close();
}
if (failed) process.exitCode = 1;
