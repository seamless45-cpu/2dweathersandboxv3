'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const app = fs.readFileSync('app.js', 'utf8');
const source = app.slice(app.indexOf('function createLightningReadback('), app.indexOf('\nfunction createHdrFBO()'));
const context = {}; vm.createContext(context); vm.runInContext(source, context);
function fakeGL() {
  const calls = []; let wait = 0, failedAlloc = false, failedFence = false, count = 0;
  const gl = {PIXEL_PACK_BUFFER:1, STREAM_READ:2, FRAMEBUFFER:3, COLOR_ATTACHMENT0:4,
    RGBA:5, FLOAT:6, SYNC_GPU_COMMANDS_COMPLETE:7, WAIT_FAILED:8, ALREADY_SIGNALED:9, CONDITION_SATISFIED:10,
    createBuffer:()=>{calls.push('create');return failedAlloc?null:{id:++count}},
    deleteBuffer:()=>calls.push('deleteBuffer'), bindBuffer:(...v)=>calls.push(['bind',...v]),
    bufferData:(...v)=>calls.push(['allocate',...v]), bindFramebuffer:()=>{}, readBuffer:()=>{},
    readPixels:(...v)=>{calls.push(['read',...v]); if (v[6] instanceof Float32Array) v[6].fill(7)},
    fenceSync:()=>failedFence?null:{}, flush:()=>calls.push('flush'),
    clientWaitSync:()=>wait, deleteSync:()=>calls.push('deleteSync'),
    getBufferSubData:(_,__,v)=>{calls.push('get');v.fill(42)} };
  return {gl,calls,setWait:v=>wait=v,failAlloc:()=>failedAlloc=true,failFence:()=>failedFence=true};
}
const a = fakeGL(), values = new Float32Array(48);
const r = context.createLightningReadback(a.gl, values, 6);
assert.strictEqual(r.poll(), null);
assert.strictEqual(r.request({}, {iteration:1}).accepted, true);
assert.strictEqual(r.request({}, {iteration:2}).accepted, false, 'do not overwrite an in-flight buffer');
assert.strictEqual(r.poll(), null); assert(!a.calls.includes('get'), 'do not block on unsignaled GPU work');
a.setWait(a.gl.CONDITION_SATISFIED);
assert.strictEqual(r.poll().iteration, 1); assert(values.every(v=>v===42));
assert.strictEqual(r.request({}, {iteration:2}).accepted, true);
assert.strictEqual(r.poll().iteration, 2);
assert.strictEqual(a.calls.filter(c=>c==='create').length,1);
assert.strictEqual(a.calls.filter(c=>Array.isArray(c)&&c[0]==='allocate').length,1);
assert.strictEqual(a.calls.filter(c=>Array.isArray(c)&&c[0]==='read'&&c[7]===0).length,2);
r.dispose(); assert(a.calls.includes('deleteBuffer'));
const b = fakeGL(); b.failAlloc(); const fallbackValues = new Float32Array(48);
const fallback = context.createLightningReadback(b.gl, fallbackValues, 6);
assert.strictEqual(fallback.request({}, {iteration:3}).result.iteration,3);
assert(fallbackValues.every(v=>v===7));
assert.strictEqual(fallback.request({}, {iteration:4}).result.iteration,4);
assert.strictEqual(b.calls.filter(c=>c==='create').length,1);
const c = fakeGL(); c.failFence(); const fallbackFence = context.createLightningReadback(c.gl, new Float32Array(48), 6);
assert.strictEqual(fallbackFence.request({}, {iteration:5}).result.iteration,5);
assert(c.calls.includes('deleteBuffer'));
const d = fakeGL(); const failed = context.createLightningReadback(d.gl, new Float32Array(48), 6);
failed.request({}, {iteration:6}); d.setWait(d.gl.WAIT_FAILED); assert.strictEqual(failed.poll(), null);
assert.strictEqual(failed.request({}, {iteration:7}).result.iteration,7);
assert.match(app, /completedLightning\.generation !== lightningReadbackGeneration/);
assert.match(app, /if \(!compactDropletSample \|\| compactDropletSample\.length !== NUM_DROPLETS \* 5\)/);
const poll = app.slice(app.indexOf('    #pollAmbientSoundReadback()'), app.indexOf('    #cancelAmbientSoundReadback()'));
assert.match(poll, /if \(!this\.#ambientWeatherReadbackBuffer\)/);
assert.doesNotMatch(poll, /gl\.deleteBuffer\(this\.#ambientWallReadbackBuffer\)/);
// Deletion on fence failure is intentional; successful completion keeps the buffer.
assert.strictEqual((poll.match(/gl\.deleteBuffer\(this\.#ambientWeatherReadbackBuffer\)/g)||[]).length, 1);
console.log('Reusable and asynchronous readback checks passed');
