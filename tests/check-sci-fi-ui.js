'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('sci-fi-ui.css', 'utf8');
const js = fs.readFileSync('sci-fi-ui.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
assert(html.indexOf('sci-fi-ui.css') > html.indexOf('</style>'), 'theme must override the original rules');
assert(!/backdrop-filter|(?:^|[\s:])blur\(/m.test(html + css));
assert(css.includes('orbitron-variable.ttf') && fs.statSync('resources/fonts/orbitron-variable.ttf').size > 1000);
for (const asset of ['sci-fi-ui.css','sci-fi-ui.js','resources/fonts/orbitron-variable.ttf','resources/sounds/ui/activate.wav','resources/sounds/ui/confirm.wav','resources/sounds/ui/denial.wav','resources/sounds/ui/slider.wav','resources/sounds/ui/toggle.wav']) assert(sw.includes(`'./${asset}'`));
assert(!/prefers-reduced-motion/.test(css + js));
const app = fs.readFileSync('app.js', 'utf8');
assert(!/function updateClockTextContrast\(/.test(app));
assert(/clockEl\.dataset\.contrast = 'light'/.test(app), 'opaque clock must keep readable fixed contrast without GPU sampling');
assert(/input\[type="checkbox"\]:checked \+ \.gui-lucide-check/.test(css));
assert(/::-webkit-slider-thumb/.test(css) && /::-moz-range-thumb/.test(css));
// Synthesized sci-fi cues ship in the repo, not Kenney's CC0 set.
for (const rel of ['activate.wav','confirm.wav','denial.wav','slider.wav','toggle.wav']) {
  assert(fs.statSync('resources/sounds/ui/' + rel).size > 1000, rel + ' must be a real audio file');
}
assert(!/kenney|click1|rollover2|switch6/i.test(js + sw));

const listeners = {}, starts = [], animations = [], instances = [];
let time = 1000, observer;
class Element {
  constructor(kind) { this.kind = kind; this.disabled = false; }
  closest(selector) {
    if (selector.includes('#mainCanvas')) return this.kind === 'canvas' ? this : null;
    if (selector.includes('input[type="checkbox"]')) return this.kind === 'checkbox' ? this : null;
    if (selector === '.dg .slider') return this.kind === 'slider' ? this : null;
    if (selector === '.cr') return null;
    if (selector === '.dg li.title') return this.kind === 'title' ? this : null;
    if (selector === 'li.folder') return this.folder || null;
    if (selector === '.sim-option-item') return this.kind === 'option' ? this : null;
    if (selector === '.main-menu-submit') return this.kind === 'submit' ? this : null;
    return (this.kind === 'button' || this.kind === 'submit') ? this : null;
  }
  matches(selector) {
    if (selector === '.main-menu-submit') return this.kind === 'submit';
    return this.kind === 'checkbox' ? selector.includes('checkbox') : this.kind === 'range' && selector.includes('range');
  }
  getAttribute() { return null; }
  animate(frames, options) { animations.push({kind:this.kind, frames, options}); }
  querySelectorAll() { return this.rows || []; }
}
class Audio {
  constructor(url) { this.url=url; this.currentTime=0; instances.push(this); }
  play() { starts.push(this.url); return Promise.resolve(); }
  pause() { this.paused=true; }
}
let configuring = false;
const choice = new Element('choice'), setup = new Element('setup');
const menu = {classList:{contains:()=>configuring}};
class MutationObserver { constructor(fn) { observer=fn; } observe() {} }
const sandbox={document:{readyState:'complete',getElementById:id=>({'mainMenuContent':menu,'mainMenuChoice':choice,'mainMenuSetup':setup}[id]),addEventListener:(type,fn)=>{listeners[type]=fn}},
  window:{}, Element, Audio, MutationObserver,
  guiControls:{sound:true}, performance:{now:()=>time}, Chart:{defaults:{font:{}}}};
vm.createContext(sandbox); vm.runInContext(js,sandbox);
assert.equal(instances.length,0,'audio must be lazy');
assert.equal(animations.length,1,'initial panel animates with JavaScript');
configuring=true; observer(); assert.equal(animations[1].kind,'setup');
configuring=false; observer(); assert.equal(animations[2].kind,'choice');
listeners.click({target:new Element('canvas')}); assert.equal(starts.length,0);
listeners.click({target:new Element('button')}); assert(starts[0].endsWith('activate.wav'));
listeners.click({target:new Element('submit')}); assert(starts[1].endsWith('confirm.wav'));
const blocked = new Element('button'); blocked.disabled = true; listeners.click({target:blocked}); assert(starts[2].endsWith('denial.wav'));
const title = new Element('title');
const innerUl = { classList: { contains: () => false }, querySelectorAll: () => [new Element('cr'), new Element('cr'), new Element('cr')] };
title.folder = { querySelector: () => innerUl };
listeners.click({target:title}); assert(starts[3].endsWith('activate.wav'));
const cascade = animations.filter(a => a.kind === 'cr');
assert.equal(cascade.length,3,'opened category controllers cascade in');
assert.deepEqual(cascade.map(a => a.options.delay), [0,28,56],'cascade is staggered');
listeners.change({target:new Element('checkbox')}); assert(starts[4].endsWith('toggle.wav'));
sandbox.guiControls.sound=false; listeners.click({target:new Element('button')}); listeners.change({target:new Element('checkbox')}); assert.equal(starts.length,5,'mute must silence UI'); assert(instances.every(x=>x.paused));
sandbox.guiControls.sound=true; listeners.input({target:new Element('range')}); listeners.input({target:new Element('range')}); assert.equal(starts.length,6,'slider cues are throttled'); assert(starts[5].endsWith('slider.wav'));
time+=121; listeners.input({target:new Element('range')}); assert.equal(starts.length,7);
assert.equal(sandbox.Chart.defaults.font.family,'Orbitron, sans-serif');
assert(!/AudioContext|createOscillator/.test(js), 'UI should use recorded media, not oscillators');
console.log('Sci-fi theme: synthesized cues, muted-aware audio, cascade and deny animations.');
