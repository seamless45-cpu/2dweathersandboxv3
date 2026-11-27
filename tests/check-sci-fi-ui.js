'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('sci-fi-ui.css', 'utf8');
const js = fs.readFileSync('sci-fi-ui.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
assert(html.indexOf('sci-fi-ui.css') > html.indexOf('</style>'), 'theme must override the original rules');
assert(!/backdrop-filter|(?:^|[\s:])blur\(/m.test(html + css));
assert(css.includes('orbitron-variable.ttf') && fs.statSync('resources/fonts/orbitron-variable.ttf').size > 1000);
for (const asset of ['sci-fi-ui.css','sci-fi-ui.js','resources/fonts/orbitron-variable.ttf']) assert(sw.includes(`'./${asset}'`));
assert(/prefers-reduced-motion: reduce/.test(css));
const app = fs.readFileSync('app.js', 'utf8');
assert(!/function updateClockTextContrast\(/.test(app));
assert(/clockEl\.dataset\.contrast = 'light'/.test(app), 'opaque clock must keep readable fixed contrast without GPU sampling');
assert(/input\[type="checkbox"\]:checked \+ \.gui-lucide-check/.test(css));
assert(/::-webkit-slider-thumb/.test(css) && /::-moz-range-thumb/.test(css));

const listeners = {}, starts = [], oscillators = [];
let time = 1000, contexts = 0;
class Element {
  constructor(kind) { this.kind = kind; this.disabled = false; }
  closest(selector) {
    if (selector.includes('#mainCanvas')) return this.kind === 'canvas' ? this : null;
    if (selector.includes('input[type="checkbox"]')) return this.kind === 'checkbox' ? this : null;
    if (selector === '.dg .slider') return this.kind === 'slider' ? this : null;
    return this.kind === 'button' ? this : null;
  }
  matches(selector) { return this.kind === 'checkbox' ? selector.includes('checkbox') : this.kind === 'range' && selector.includes('range'); }
  getAttribute() { return null; }
}
class AudioContext {
  constructor() { contexts++; this.state='running'; this.currentTime=0; this.destination={}; }
  createGain() { return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}; }
  createOscillator() { const o={frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){},start(){starts.push(true)},stop(){}}; oscillators.push(o); return o; }
}
const sandbox={document:{addEventListener:(type,fn)=>{listeners[type]=fn}},window:{AudioContext},Element,
  guiControls:{sound:true}, soundSystem:null, performance:{now:()=>time}, Chart:{defaults:{font:{}}}};
vm.createContext(sandbox); vm.runInContext(js,sandbox);
assert.equal(contexts,0,'audio must be lazy');
listeners.click({target:new Element('canvas')}); assert.equal(starts.length,0);
listeners.click({target:new Element('button')}); assert.equal(starts.length,1); assert.equal(contexts,1);
listeners.change({target:new Element('checkbox')}); assert.equal(starts.length,2);
sandbox.guiControls.sound=false; listeners.click({target:new Element('button')}); listeners.change({target:new Element('checkbox')}); assert.equal(starts.length,2,'mute must silence UI');
sandbox.guiControls.sound=true; listeners.input({target:new Element('range')}); listeners.input({target:new Element('range')}); assert.equal(starts.length,3,'slider cues are throttled');
time+=121; listeners.input({target:new Element('range')}); assert.equal(starts.length,4);
assert.equal(sandbox.Chart.defaults.font.family,'Orbitron, sans-serif');
console.log('Sci-fi theme: offline font, no blur, reduced motion, controls and gesture-only muted-aware audio.');
