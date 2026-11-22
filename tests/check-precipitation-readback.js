'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const app = fs.readFileSync('app.js', 'utf8');
const source = app.slice(app.indexOf('function createPrecipitationCountReadback('), app.indexOf('\nfunction createHdrFBO()'));
const ctx = {}; vm.createContext(ctx); vm.runInContext(source,ctx);
function fakeGL(compact) {
 const calls=[]; let status=0, failAlloc=false, failFence=false;
 const gl={COPY_READ_BUFFER:1,COPY_WRITE_BUFFER:2,PIXEL_PACK_BUFFER:3,STREAM_READ:4,COLOR_ATTACHMENT0:5,RGBA:6,FLOAT:7,SYNC_GPU_COMMANDS_COMPLETE:8,WAIT_FAILED:9,ALREADY_SIGNALED:10,CONDITION_SATISFIED:11,
 createBuffer:()=>{calls.push('create');return failAlloc?null:{}},deleteBuffer:()=>calls.push('delete'),bindBuffer:(...x)=>calls.push(['bind',...x]),bufferData:(...x)=>calls.push(['allocate',...x]),copyBufferSubData:()=>calls.push('copy'),readBuffer:()=>{},readPixels:(...x)=>{calls.push(['read',...x]);if(typeof x[6] !== 'number')x[6][0]=7},
 fenceSync:()=>failFence?null:{},flush:()=>{},clientWaitSync:()=>status,deleteSync:()=>{},getBufferSubData:(_,__,v)=>{calls.push('get');if(compact){v[2]=-1;v[7]=1;v[12]=-2}else v[0]=7}};
 return {gl,calls,signal:()=>status=gl.CONDITION_SATISFIED,waitFail:()=>status=gl.WAIT_FAILED,failAlloc:()=>failAlloc=true,failFence:()=>failFence=true};
}
for(const compact of [true,false]) {
 const f=fakeGL(compact), readback=ctx.createPrecipitationCountReadback(f.gl,3,compact);
 assert.strictEqual(readback.request({},3),null);assert.strictEqual(readback.request({},4),null);
 assert.strictEqual(readback.poll(),null);assert(!f.calls.includes('get'));
 assert.strictEqual(f.calls.filter(x=>x==='copy').length,compact?1:0);
 assert.strictEqual(f.calls.filter(x=>Array.isArray(x)&&x[0]==='read').length,compact?0:1);
 f.signal();let result=readback.poll();assert.strictEqual(result.count,compact?2:7);assert.strictEqual(result.generation,3);
 readback.request({},4);result=readback.poll();assert.strictEqual(result.generation,4);
 assert.strictEqual(f.calls.filter(x=>x==='create').length,1);
 assert.strictEqual(f.calls.filter(x=>Array.isArray(x)&&x[0]==='allocate').length,1);
 readback.dispose();assert(f.calls.includes('delete'));
 const bad=fakeGL(compact);bad.failAlloc();const fallback=ctx.createPrecipitationCountReadback(bad.gl,3,compact);
 assert.strictEqual(fallback.request({},7).count,compact?2:7);
 const failed=fakeGL(compact);failed.failFence();const retry=ctx.createPrecipitationCountReadback(failed.gl,3,compact);
 assert.strictEqual(retry.request({},8).count,compact?2:7);assert(failed.calls.includes('delete'));
 const timeout=fakeGL(compact);const retry2=ctx.createPrecipitationCountReadback(timeout.gl,3,compact);retry2.request({},1);timeout.waitFail();assert.strictEqual(retry2.poll(),null);assert.strictEqual(retry2.request({},2).count,compact?2:7);
}
assert.match(app,/result\.generation !== precipitationBufferGeneration/);
assert.match(app,/precipitationBufferGeneration\+\+/);
console.log('Reusable precipitation readback checks passed');
