'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('sci-fi-ui.css', 'utf8');
const js = fs.readFileSync('sci-fi-ui.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
assert(html.indexOf('sci-fi-ui.css') > html.indexOf('</style>'), 'theme must override the original rules');
assert(!/backdrop-filter|(?:^|[\s:])blur\(/m.test(html + css));
assert(css.includes('orbitron-variable.ttf') && fs.statSync('resources/fonts/orbitron-variable.ttf').size > 1000);
for (const asset of ['sci-fi-ui.css','sci-fi-ui.js','resources/fonts/orbitron-variable.ttf','resources/sounds/ui/click1.wav','resources/sounds/ui/switch6.wav','resources/sounds/ui/rollover2.wav']) assert(sw.includes(`'./${asset}'`));
assert(/prefers-reduced-motion: reduce/.test(css));
const app = fs.readFileSync('app.js', 'utf8');
assert(!/function updateClockTextContrast\(/.test(app));
assert(/clockEl\.dataset\.contrast = 'light'/.test(app), 'opaque clock must keep readable fixed contrast without GPU sampling');
assert(/input\[type="checkbox"\]:checked \+ \.gui-lucide-check/.test(css));
assert(/::-webkit-slider-thumb/.test(css) && /::-moz-range-thumb/.test(css));

const listeners = {}, starts = [], animations = [], instances = [];
let time = 1000, reduced = false, observer;
class Element {
  constructor(kind) { this.kind = kind; this.disabled = false; }
  closest(selector) {
    if (selector.includes('#mainCanvas')) return this.kind === 'canvas' ? this : null;
    if (selector.includes('input[type="checkbox"]')) return this.kind === 'checkbox' ? this : null;
    if (selector === '.dg .slider') return this.kind === 'slider' ? this : null;
    if (selector === '.cr') return null;
    return this.kind === 'button' ? this : null;
  }
  matches(selector) { return this.kind === 'checkbox' ? selector.includes('checkbox') : this.kind === 'range' && selector.includes('range'); }
  getAttribute() { return null; }
  animate(frames, options) { animations.push({kind:this.kind, frames, options}); }
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
  window:{matchMedia:()=>({get matches(){return reduced;}})}, Element, Audio, MutationObserver,
  guiControls:{sound:true}, performance:{now:()=>time}, Chart:{defaults:{font:{}}}};
vm.createContext(sandbox); vm.runInContext(js,sandbox);
assert.equal(instances.length,0,'audio must be lazy');
assert.equal(animations.length,1,'initial panel animates with JavaScript');
configuring=true; observer(); assert.equal(animations[1].kind,'setup');
reduced=true; configuring=false; observer(); assert.equal(animations.length,2,'reduced motion disables JS animation');
reduced=false;
listeners.click({target:new Element('canvas')}); assert.equal(starts.length,0);
listeners.click({target:new Element('button')}); assert(starts[0].endsWith('click1.wav'));
listeners.change({target:new Element('checkbox')}); assert(starts[1].endsWith('switch6.wav'));
sandbox.guiControls.sound=false; listeners.click({target:new Element('button')}); listeners.change({target:new Element('checkbox')}); assert.equal(starts.length,2,'mute must silence UI'); assert(instances.every(x=>x.paused));
sandbox.guiControls.sound=true; listeners.input({target:new Element('range')}); listeners.input({target:new Element('range')}); assert.equal(starts.length,3,'slider cues are throttled'); assert(starts[2].endsWith('rollover2.wav'));
time+=121; listeners.input({target:new Element('range')}); assert.equal(starts.length,4);
assert.equal(sandbox.Chart.defaults.font.family,'Orbitron, sans-serif');
assert(!/AudioContext|createOscillator/.test(js), 'UI should use recorded media, not oscillators');
console.log('Sci-fi theme: cached samples, muted-aware audio and reduced-motion-aware JS animation.');
