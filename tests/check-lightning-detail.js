'use strict';
const assert = require('assert');
const fs = require('fs');
const { installOffscreenCanvas } = require('./ic-canvas-stub');
const restore = installOffscreenCanvas();
const gen = require('../lightningGenerator');
const original = Math.random;
Math.random = gen.makeRng(624); const low = gen.generateLightningNetwork(512, 256);
Math.random = gen.makeRng(624); const high = gen.generateLightningNetwork(1024, 512);
Math.random = original; restore();
assert.strictEqual(high.width,1024); assert.strictEqual(high.height,512);
assert.strictEqual(high.strokeCount,low.strokeCount);
assert.strictEqual(high.segmentCount,low.segmentCount);
let error=0, energy=0;
for (let y=0;y<256;y++) for (let x=0;x<512;x++) {
  const avg = (high.data[2*y*1024+2*x]+high.data[2*y*1024+2*x+1]+high.data[(2*y+1)*1024+2*x]+high.data[(2*y+1)*1024+2*x+1])/4;
  error += Math.abs(avg-low.data[y*512+x]); energy += low.data[y*512+x];
}
assert(energy > 0 && error/energy < .35, `scaled network geometry drifted: ${error/energy}`);
const shader=fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
for (const name of ['displayFlash','displayPositiveFlash']) {
 const start=shader.indexOf('vec3 '+name+'('), end=shader.indexOf('\n}', start);
 const body=shader.slice(start,end);
 assert(body.includes('textureGrad(lightningNetworkTex, flashCoord, gradX, gradY)'));
 assert(!body.includes('flashLateralJag') && !body.includes('ccEvalBranch'));
}
// Match the shader's analytic derivative against finite differences, away from
// triangular-wave corners. The old sign and omitted octave produced ragged AA.
assert.match(shader,/float sgn1 = fract\(x1\) < 0\.5 \? -4\.0 : 4\.0/);
assert.match(shader,/0\.06 \* extTriWave\(x3\)/);
assert.match(shader,/0\.06 \* sgn3 \* f3/);
assert.match(shader,/jag\.x \* rootDerivative/);
assert.match(shader,/spineDisp\.x \* PI \* cos\(PI \* t\)/);
const fract=x=>x-Math.floor(x), tri=x=>4*Math.abs(fract(x)-.5)-1;
const fsx=[2.3,6.1,14.8], weights=[.58,.28,.06], phases=[.4,.4*1.73+.31,.4*2.91+.67];
const value=x=>fsx.reduce((sum,f,i)=>sum+weights[i]*tri(x*f+phases[i]),0);
const deriv=x=>fsx.reduce((sum,f,i)=>sum+weights[i]*f*(fract(x*f+phases[i])<.5?-4:4),0);
for (let i=0;i<1000;i++) { const x=i/1000, eps=1e-6;
 if(fsx.some((f,j)=>{let v=fract(x*f+phases[j]);return Math.min(v,Math.abs(v-.5),1-v)<1e-4})) continue;
 assert(Math.abs((value(x+eps)-value(x-eps))/(2*eps)-deriv(x))<1e-6);
}
console.log('Network supersampling, continuity and CC slope checks passed');
