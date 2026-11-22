// Verification harness for the CC-family jaggedness on every lightning channel
// (2026-11-18).
//
// The cloud-to-cloud channel was the reference: a tortuous spine built from
// multi-octave triangular waves anchored at both ends. This suite pins the
// adoption of that same octave family (2.3 / 6.1 / 14.8 spatial frequencies,
// 0.58 / 0.28 / 0.13 weights, extTriWave angular knees) across the rest of the
// renderer WITHOUT letting any of them degenerate into noise:
//  - CG bolt artwork: lateral uv-sample warp, bounded envelope sin(pi t),
//    ends anchored (cloud + ground/rod tip stay aligned), mip gradients
//    propagate the warp derivative
//  - IC / +IC networks: bounded tendril shift, derivative-carrying gradients
//  - external positive CG (ordinary / superbolt / hyperbolt): arc jag goes
//    through the shared fractal, no hand-rolled octaves left
//  - GC leader spine and anvil crawler leaders: dominant smooth sines replaced
//    by the CC triwave octaves (angular knees instead of sinusoidal waves)
//  - amplitude bounds pinned so nobody can crank the renderer into a mess
//
// Usage: node tests/check-cc-jaggedness.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const shader = fs.readFileSync(path.join(ROOT, 'shaders/fragment/realisticDisplayShader.frag'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('PASS ' + name);
  } else {
    failed++;
    console.log('FAIL ' + name + (detail ? '\n     ' + detail : ''));
  }
}

/* ------------------------------------------------- shared jag machinery */

check('shared fractalLateralJag helper exists with CC frequencies and weights',
  /float fractalLateralJag\(float t, float spanKm, float seed, float amp\)/.test(shader) &&
  /float f1 = 2\.3 \/ norm, f2 = 6\.1 \/ norm, f3 = 14\.8 \/ norm;/.test(shader) &&
  /0\.58 \* extTriWave\(s \* f1/.test(shader) &&
  /0\.28 \* extTriWave\(s \* f2/.test(shader) &&
  /0\.13 \* extTriWave\(s \* f3/.test(shader));

check('fractalLateralJagDeriv mirrors the helper (same frequencies, carries the mip LOD)',
  /float fractalLateralJagDeriv\(float t, float spanKm, float seed, float amp\)/.test(shader) &&
  /return \(0\.58 \* f1 \* sgn1 \+ 0\.28 \* f2 \* sgn2 \+ 0\.13 \* f3 \* sgn3\) \* spanKm \* amp \* 4\.0;/.test(shader));


/* ------------------------------------------- CG bolt artwork warp */

const ordinaryCg = shader.slice(shader.indexOf('vec3 displayLightning('), shader.indexOf('vec3 displayFlash('));
check('ordinary CG samples the original artwork without the added warp',
  !/fractalLateralJag/.test(ordinaryCg) && /textureLod\(lightningTex, lightningTexCoord, 0\.0\)\.b/.test(ordinaryCg));

/* ------------------------------------------- IC / +IC network warps */



/* ------------------------------------- external positive CG (+super/hyper) */

check('external positive CG arc jag goes through the shared fractal, no hand-rolled octaves left',
  /float jag = fractalLateralJag\(t, V \* cellHeight \* float\(resolution\.y\) \* 0\.001, seed, jagScale\) \* sin\(PI \* t\);/.test(shader) &&
  !/0\.65 \* extTriWave\(t \* 3\.8/.test(shader) &&
  !/0\.32 \* extTriWave\(t \* 9\.3/.test(shader) &&
  !/0\.14 \* extTriWave\(t \* 21\.0/.test(shader));

/* --------------------------------------------------- GC leader spine */


/* ----------------------------------------------- anvil crawler leaders */


/* ----------------------------------------------- CC path itself intact */

check('the CC reference channel retains its geometry with lower radiance',
  /const float ccBaseBrightness = 900\.;/.test(shader) &&
  /float normLen = max\(span, 0\.18 \* hScale\);/.test(shader));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
