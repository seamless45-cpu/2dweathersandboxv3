const assert=require('assert'),fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('app.js','utf8');const code=src.slice(src.indexOf('const sceneContrastStates'),src.indexOf('var lastFrameNum = 0;'));
let now=0,reads=0,downloads=0,deleted=0,status=0;let mock={PIXEL_PACK_BUFFER:1,FRAMEBUFFER:2,BACK:3,STREAM_READ:4,RGBA:5,UNSIGNED_BYTE:6,SYNC_GPU_COMMANDS_COMPLETE:7,WAIT_FAILED:8,ALREADY_SIGNALED:9,CONDITION_SATISFIED:10,isContextLost:()=>false,createBuffer:()=>({}),bindFramebuffer(){},readBuffer(){},bindBuffer(){},bufferData(){},readPixels(...args){reads++;assert.strictEqual(args[6],0)},fenceSync:()=>({}),clientWaitSync:()=>status,getBufferSubData(target,offset,values){downloads++;values.fill(255)},deleteSync(){},deleteBuffer(){deleted++}};
const context={gl:mock,canvas:{width:100,height:100,getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})},performance:{now:()=>now},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),Uint8Array,WeakMap,Math};vm.createContext(context);vm.runInContext(code,context);let owner={};assert.equal(context.getSceneContrastTextColor(20,20,owner),'#ffffff');assert.equal(reads,1);assert.equal(context.getSceneContrastTextColor(20,20,owner),'#ffffff');assert.equal(downloads,0);status=mock.CONDITION_SATISFIED;assert.equal(context.getSceneContrastTextColor(20,20,owner),'#111820');assert.equal(downloads,1);assert.equal(reads,1);now=1001;context.getSceneContrastTextColor(20,20,owner);assert.equal(reads,2);context.disposeSceneContrast(owner);assert.equal(deleted,1);console.log('Contrast readback polls fences, reuses colours and releases buffers.');
// Profiling only observes the existing readback sequence, and isolates the
// expensive calls rather than attributing every spike to the whole UI section.
const events=[];context.observer={cpuBegin:n=>events.push('begin:'+n),cpuEnd:n=>events.push('end:'+n)};
vm.runInContext('sceneContrastProfiler = observer',context);
now=3000;status=0;const profiledOwner={};context.getSceneContrastTextColor(20,20,profiledOwner);
status=mock.CONDITION_SATISFIED;context.getSceneContrastTextColor(20,20,profiledOwner);
for (const name of ['contrast layout','contrast read enqueue','contrast fence poll','contrast buffer download']) {
  assert(events.includes('begin:'+name),name);assert(events.includes('end:'+name),name);
}
context.disposeSceneContrast(profiledOwner);
console.log('Contrast profiler isolates layout, fence, enqueue and download.');
