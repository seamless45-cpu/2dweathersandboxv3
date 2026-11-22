'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const post = read('shaders/fragment/postProcessingShader.frag');
const display = read('shaders/fragment/realisticDisplayShader.frag');
const app = read('app.js');

// Numerically round-trip the same projection as realDispShader.vert.
function previousUV(uv, view, prev, simAspect, canvasAspect, velocity, steps, resolution, wrap) {
  const ndc = uv.map(n => 2*n-1);
  const world = [(ndc[0]/view[2]-view[0])*0.5+0.5,
    (ndc[1]*simAspect/(view[2]*canvasAspect)-view[1]*simAspect)*0.5+0.5];
  const p = world.map((x,i)=>x - velocity[i]*steps/resolution[i]);
  if (wrap) p[0] -= Math.floor((prev[0]-view[0])*0.5+0.5);
  return [( (p[0]*2-1+prev[0])*prev[2]+1)*0.5,
    ( (p[1]*2-1+prev[1]*simAspect)*prev[2]*canvasAspect/simAspect+1)*0.5];
}
const close = (a,b) => assert(Math.abs(a-b)<1e-9, `${a} != ${b}`);
const calc = (uv,view,prev,v=[0,0],steps=0,wrap=false)=>previousUV(uv,view,prev,2,1,v,steps,[200,100],wrap);
let a=calc([0.75,0.25],[0,0,1],[0,0,1]); close(a[0],0.75);close(a[1],0.25);
a=calc([0.75,0.25],[0,0,1],[0.2,0,1]);close(a[0],0.85);close(a[1],0.25);
a=calc([0.75,0.25],[0,0,2],[0,0,1]);close(a[0],0.625);close(a[1],0.375);
a=calc([0.75,0.25],[0,0,1],[0,0,1],[2,1],10);close(a[0],0.65);close(a[1],0.20);
a=calc([0.75,0.25],[0,0,1],[0,0,1],[2,1],0);close(a[0],0.75);close(a[1],0.25);
a=calc([0.75,0.25],[0,0,1],[2,0,1],[0,0],0,true);close(a[0],0.75);
a=calc([0.75,0.25],[0,0,1],[2,0,1],[0,0],0,false);close(a[0],1.75);
assert.match(app, /let motionBlurSimulationSteps = 0;/);
assert.match(app, /for \(var i = 0; i < numIterations; i\+\+\) \{[^\n]*\n\s*motionBlurSimulationSteps\+\+;/);
assert.match(post, /uniform isampler2D motionBlurWallTex;/);
assert.match(app, /gl\.activeTexture\(gl\.TEXTURE4\);\s*gl\.bindTexture\(gl\.TEXTURE_2D, wallTexture_1\);/);
assert.match(post, /if \(inWorld && motionBlurIterPerFrame > 0\.0\)/);
assert.match(post, /texelFetch\(motionBlurWallTex, cell, 0\)\.y != 0/);

// Ground leader travels downward, return travels upward, and branches do not
// grow before their root is reached. Evaluate the stage's equations numerically.
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=(a,b,x)=>{let t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
const leader=t=>{let p=clamp(t/.45)*12;return Math.min((Math.floor(p)+smooth(0,.42,p-Math.floor(p)))/12,1)};
const branch=(t,root)=>clamp((leader(t)-root)*4.5);
// Read the multipliers from the shader so the numerical checks exercise the
// actual emission used by the renderer, not a disconnected test constant.
const groundMatch = display.match(/return visible \* mix\(([\d.]+), 1\.0, returned\)/);
const cloudMatch = display.match(/return visible \* \(([\d.]+) \+ ([\d.]+) \* smoothstep\(0\.40, 0\.55, time\)/);
assert(groundMatch && cloudMatch, 'leader emission equations missing');
const groundLeader = Number(groundMatch[1]);
const cloudLeader = Number(cloudMatch[1]);
const cloudRise = Number(cloudMatch[2]);
assert(groundLeader >= .003 && groundLeader < .02);
assert(cloudLeader >= .006 && cloudLeader < .03);
close(cloudLeader + cloudRise, 1);
const stage=(t,x)=>{let visible=1-smooth(leader(t),leader(t)+.035,x);let front=clamp((t-.45)/.20);let returned=smooth(1-front-.04,1-front+.04,x);return visible*(groundLeader+(1-groundLeader)*returned)};
assert(branch(.1,.8)===0 && branch(.5,.8)>0);
assert(stage(.2,.15)>stage(.2,.8));
assert(stage(.5,.9)>stage(.5,.1));
assert(stage(.65,.1)>.9);
close(stage(.2,.15), groundLeader);
assert(stage(.65,.1) > 100 * stage(.2,.15));
// Cloud leaders remain luminous before their later reillumination.
close(cloudLeader + cloudRise * smooth(.40,.55,.2), cloudLeader);
assert(cloudLeader + cloudRise * smooth(.40,.55,.55) > 100 * cloudLeader);
for (const f of ['displayLightning','displayExternalLightning']) {
 const start=display.indexOf('vec3 '+f+'('), end=display.indexOf('\n}',start);
 assert(display.slice(start,end).includes('groundChannelStage(lightningTime'));
 if (f === 'displayExternalLightning') assert(display.slice(start,end).includes('dischargeBranchGrowth(lightningTime'));
}
for (const f of ['displayFlash','displayPositiveFlash','displayCloudToCloudLightning']) {
 const start=display.indexOf('vec3 '+f+'('), end=display.indexOf('\n}',start);
 assert(display.slice(start,end).includes('cloudChannelStage(lightningTime'));
 if (f === 'displayCloudToCloudLightning') assert(display.slice(start,end).includes('dischargeBranchGrowth(lightningTime'));
}
console.log('Motion reprojection and staged discharge tests passed');
