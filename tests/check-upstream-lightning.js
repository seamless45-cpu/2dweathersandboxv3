'use strict';
// The worker must actually ship the upstream canvas pixels for ordinary CG,
// while preserving the fork's original RG bytes for special variants.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {installOffscreenCanvas} = require('./ic-canvas-stub.js');
const restore = installOffscreenCanvas();
const workerSource = fs.readFileSync('lightningGenerator.js','utf8');
const upstream = fs.readFileSync('upstreamLightningGenerator.js','utf8');
const sw = fs.readFileSync('sw.js','utf8');
assert.match(upstream, /0fe98cf10bc844a41e3c5cdb91b897dfe2080e5f/);
assert.match(sw, /'\.\/upstreamLightningGenerator\.js'/);
function context(seed) {
  let state = seed >>> 0;
  const math = Object.create(Math);
  math.random = () => {state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296;};
  const sandbox = {Math:math, Uint8Array, OffscreenCanvas:global.OffscreenCanvas};
  sandbox.importScripts = () => vm.runInContext(upstream, sandbox);
  sandbox.postMessage = data => {sandbox.result = data;};
  vm.createContext(sandbox);
  vm.runInContext(workerSource, sandbox);
  return sandbox;
}
for (const scale of [1, .5]) {
  const width=200, height=400;
  const expected = context(42);
  const special = expected.generateLightningBolt(width, height, scale);
  const original = expected.generateUpstreamLightningBolt(width, height, scale);
  const actual = context(42);
  actual.onmessage({data:{width,height,logicalScale:scale}});
  const bytes = actual.result.data;
  assert.equal(bytes.length, width*height*3);
  let lit = 0;
  for(let i=0;i<width*height;i++) {
    assert.equal(bytes[i*3],special.data[i*2]);
    assert.equal(bytes[i*3+1],special.data[i*2+1]);
    assert.equal(bytes[i*3+2],Math.round(original.data[i*4]*original.data[i*4+3]/255));
    if(bytes[i*3+2]) lit++;
  }
  assert(lit>height, 'original bolt was not drawn');
}
restore();
console.log('Upstream bolt and special-variant worker packing passed at desktop and mobile scales');
