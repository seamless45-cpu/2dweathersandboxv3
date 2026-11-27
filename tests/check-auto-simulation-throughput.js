'use strict';
// Exercise the real auto-controller and startup cadence probe without a browser.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('app.js','utf8');
function extract(name){let a=s.indexOf('function '+name+'(');assert(a>=0,name);return s.slice(a,s.indexOf('\n}',a)+2)}
const code=['frameRateFromIntervals','measureAnimationFrameCeiling','automaticSimulationIterations'].map(extract).join('\n');
(async()=>{
 const context={document:{hidden:false},setTimeout,clearTimeout,Number,Math,Promise,Set};let timestamp=0,period=1000/60,seq=0,pending=new Map(),cancelled=0;
 context.requestAnimationFrame=cb=>{let id=++seq;pending.set(id,setImmediate(()=>{pending.delete(id);timestamp+=period;cb(timestamp)}));return id};
 context.cancelAnimationFrame=id=>{let handle=pending.get(id);if(handle)clearImmediate(handle);pending.delete(id);cancelled++};
 vm.createContext(context);vm.runInContext(code,context);
 for(const hz of [30,50,60,90,120,144,165,240]){timestamp=0;period=1000/hz;const measured=await context.measureAnimationFrameCeiling();assert.equal(measured,hz,`cadence ${hz}`);}
 assert.equal(context.frameRateFromIntervals([16.67,16.67,33.33,16.67,16.67,16.67]),60);
 assert.equal(context.frameRateFromIntervals([8.33,8.33,16.67,8.33,8.33,8.33]),120);
 assert.equal(context.frameRateFromIntervals([16.7,16.7,16.7]),null);
 context.document.hidden=true;assert.equal(await context.measureAnimationFrameCeiling(),null);context.document.hidden=false;
 // A backgrounded or stalled rAF must time out and cancel the queued callback.
 const timeoutContext={document:{hidden:false},Number,Math,Promise,setTimeout:cb=>setImmediate(cb),clearTimeout:clearImmediate,requestAnimationFrame:()=>42,cancelAnimationFrame:id=>{assert.equal(id,42);cancelled++}};
 vm.createContext(timeoutContext);vm.runInContext(code,timeoutContext);assert.equal(await timeoutContext.measureAnimationFrameCeiling(),null);assert(cancelled>0);

 const auto=context.automaticSimulationIterations;
 // The old algorithm collapsed to one step on 60 Hz with a saved 120 target.
 let steps=1;for(let i=0;i<9;i++)steps=auto(steps,59.94,'120',60);assert.equal(steps,10);
 assert.equal(auto(10,59.94,'120',120),7); // 120 Hz goal still respected
 assert.equal(auto(10,29.97,'30',60),11); // explicit lower target respected
 assert(auto(10,35,'120',60)<10); // real overload backs off
 assert.equal(auto(10,60,'Unlocked',60),10);
 // A 60 Hz device with headroom recovers throughput but backs off once the
 // workload genuinely drops frames; it does not collapse merely due to 120.
 steps=1;for(let i=0;i<35;i++)steps=auto(steps,steps<=16?59.94:51,'120',60);assert(steps>=15 && steps<=17,`convergence ${steps}`);
 assert.equal(auto(10,60,'120',null),8); // probe failure uses selected target

 assert.equal(auto(10,60,'invalid',60),10);
 assert.equal(auto(50,60,'120',60),50);assert.equal(auto(1,1,'120',60),1);
 assert.match(s,/if \(guiControls\.auto_IterPerFrame && !airplaneMode\)/);
 assert.match(s,/if \(!guiControls\.paused\) \{[\s\S]*automaticSimulationIterations\(/);
 assert.match(s,/guiControls = \{ \.\.\.guiControls_default, \.\.\.JSON\.parse\(strGuiControls\) \}/);
 assert(!/guiControls\.autoFpsTarget\s*=(?!=)/.test(s.slice(s.indexOf('  function calcFps()'),s.indexOf('  function calcFps()')+3000)));
 assert.match(s,/measuredSimulationStepsPerSecond = Math\.round\(\(iterNum - lastPerformanceIterationNum\) \/ elapsed\)/);
 console.log('Auto simulation throughput, refresh ceilings, saved settings and timer normalization passed');
})().catch(e=>{console.error(e);process.exit(1)});
