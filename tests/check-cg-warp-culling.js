'use strict';
// The coarse test must never reject a pixel that the original, warped artwork
// bounds would accept. Exercise different heights, rod shears and warp phases.
const assert = require('assert');
const fs = require('fs');
const shader = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag', 'utf8');
const cg = shader.slice(shader.indexOf('vec3 displayLightning('), shader.indexOf('vec3 displayFlash('));
assert.match(cg, /maxJagU = 1\.001 \* boltJagAmp \/ \(lightningTexAspect \* spanY\)/);
assert(cg.indexOf('0.01 - maxJagU') < cg.indexOf('fractalLateralJag(boltT'));
assert(cg.indexOf('lightningTexCoord.x > 1.01 ||') < cg.indexOf('float boltJagDeriv ='));
// Fail if the triangle-wave amplitudes or envelope change without revisiting
// the analytic bound used above. extTriWave is in [-1,1].
assert.match(shader, /0\.58 \* extTriWave\(s \* f1 \+ seed\) \+\s*0\.28 \* extTriWave\(s \* f2 \+ seed \* 1\.73 \+ 0\.31\) \+\s*0\.13 \* extTriWave\(s \* f3 \+ seed \* 2\.91 \+ 0\.67\)/);
assert.match(shader, /return 4\.0 \* abs\(fract\(x\) - 0\.5\) - 1\.0/);
const tri = x => 4 * Math.abs((x - Math.floor(x)) - .5) - 1;
for (const span of [.04, .1, .5, 1]) for (const height of [.25, 1, 4])
  for (const shift of [-.5, 0, .5]) for (let i = 0; i < 10000; i++) {
    const t = (i % 101) / 100, seed = i * .013, amp = .01 * height, aspect = .5;
    const s = t * span * 12 * height, norm = Math.max(span * 12 * height, .18 * height);
    const jag = Math.sin(Math.PI * t) * amp * (.58 * tri(s * 2.3 / norm + seed) + .28 * tri(s * 6.1 / norm + seed * 1.73 + .31) + .13 * tri(s * 14.8 / norm + seed * 2.91 + .67));
    const bound = 1.001 * amp / (aspect * span);
    const x = -1 + (i % 1000) * .003 + shift * Math.pow(t, 1.25);
    const warped = x + jag / (aspect * span);
    if (warped >= .01 && warped <= 1.01)
      assert(x >= .01 - bound && x <= 1.01 + bound, 'visible warped pixel was culled');
  }
console.log('CG warp bound and deferred gradient checks passed');
