'use strict';
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
let failed = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
const shadows = [...css.matchAll(/box-shadow\s*:\s*([^;]+);/g)].map(m => m[1].trim());
check('authored box shadows are absent or zero-blur focus rings', shadows.every(s => s === 'none' || /^0 0 0 2px /.test(s)));
check('no authored blurred text or drop shadows; vendor save-dialog inset is overridden',
  !/text-shadow\s*:|drop-shadow\s*\(/.test(css) && /#dg-new-constructor\s*\{\s*box-shadow:\s*none/.test(css));
check('menu keyboard focus retains a visible outline', /\.main-menu-action:focus-visible\s*\{[^}]*outline:\s*2px solid/.test(css));
check('loading transition uses modest movement and keeps its 700ms JS timer',
  /translate3d\(0, 24px, 0\)/.test(css) && !/translate3d\(0, 100vh, 0\)/.test(css) &&
  /simulation-slide-up 700ms/.test(css) && /setTimeout\(resolve, 700\)/.test(app));
check('menu and display transitions use reworked motion while cleanup follows animation',
  /translateX\(-18px\)/.test(css) && /translateX\(18px\)/.test(css) &&
  /25%, 70% \{ opacity: 1/.test(css) && /\}, 850\);/.test(app));
check('reduced motion covers all transitions, delays, repeated animations, and keeps mode label legible',
  /animation-iteration-count: 1 !important/.test(css) && /transition-delay: 0ms !important/.test(css) &&
  /\.display-mode-toast\.is-visible\s*\{\s*animation: none;\s*opacity: 1;/.test(css) &&
  /prefers-reduced-motion: reduce/.test(css));
if (failed) process.exitCode = 1;
