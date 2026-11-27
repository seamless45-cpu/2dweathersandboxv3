'use strict';
// Numeric regression for timing and the actual linear-HDR -> display path.
const assert = require('assert');
const fs = require('fs');
const shader = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag', 'utf8') + '\n' + fs.readFileSync('shaders/fragment/lightningRenderStateShader.frag','utf8');
const common = fs.readFileSync('shaders/common.glsl', 'utf8');
const post = fs.readFileSync('shaders/fragment/postProcessingShader.frag', 'utf8');
assert.match(shader, /max\(curve, firstReturnIntensity\(Tin, intensity, 0\.65, 0\.78\)\)/);
assert.match(shader, /firstReturnIntensity\(lightningTime, lightningData\[INTENSITY\], 0\.10, 0\.26\) \* extIntensityGain/);
assert.match(shader, /lightningOnLight \*= isExternalPositive \? extCurve : currentLightningIntensity/);
assert.match(shader, /const vec3 upstreamLightningColor = vec3\(0\.70, 0\.57, 1\.0\)/);
assert.match(common, /positive \* \(softHdrClamp\(peak\) \/ max\(peak, 1e-6\)\)/);
assert.match(post, /hdrReadCeiling \/ max\(hdrPeak, 1e-6\)/);
const smooth = (a,b,x) => { const t = Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
const old = (t, scale, period, flashes) => {
  const t0 = t/scale, phase = Math.max(t0 % period, Math.max(t0-period*flashes,0));
  return Math.max(1/(.05+(phase*2)**3)-.005,0);
};
const first = (t, hold=.65, end=.78) => (20-.005)*(1-smooth(hold,end,t));
for (const [scale,period] of [[1,1.5],[.72,1.1],[.85,1.3],[1.25,2.2]]) {
  const peak = old(period*scale, scale, period, 2);
  const atReturn = Math.max(old(.65,scale,period,2), first(.65));
  assert(atReturn >= peak*.999, 'first completed return should match restrike peak');
  assert(first(.78) === 0 && first(period*scale) === 0, 'envelope must not alter restrikes or slot end');
}
assert(first(.1,.1,.26) > 19 && first(.26,.1,.26) === 0);
console.log('First-return timing and hyperbolt envelope checks passed');
