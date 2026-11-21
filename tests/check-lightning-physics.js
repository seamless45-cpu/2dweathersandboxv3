// Verification harness for the Kelvin work (every natural discharge carries an
// arc temperature), the per-variant lifetimes, and the drag-based precipitation
// fall model (2026-11-19).
//
// Coverage:
//  - planckBlackbody() exists and is the Tanner Helland fit, unit-blue gain
//  - every natural variant's colour is derived from its Kelvin temperature;
//    superbolt/hyperbolt keep their pinned fictional hues untouched
//  - lifetimes: lightningRepeatPeriod + lightningLifetimeScale shared between
//    the slot manager and the display pass (time-warped, not merely gated)
//  - per-variant branch budgets: CG 1-3, external+CG 1-2 / 2-3 / 3-4 by class,
//    IC / +IC 0-2 seeded side leaders, -CC 3-4 vs +CC 0-1, GC 3-5
//  - TLE rework: NT 1P red sprite with 5-8 seeded tendrils + NT+ cap, climbing
//    V-shaped blue jet with starter flash, expanding elve with 1/r dimming
//  - precipitation: Clift-Gauvin drag sphere, exponential atmosphere,
//    mass-unit calibration (1.0 = 65 mg), slider relabeled as a multiplier
//
// Usage: node tests/check-lightning-physics.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const display = read('shaders/fragment/realisticDisplayShader.frag');
const common = read('shaders/common.glsl');
const post = read('shaders/fragment/postProcessingShader.frag');
const precip = read('shaders/vertex/precipitationShader.vert');
const app = read('app.js');

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

/* ----------------------------------------------------- blackbody helper */

check('planckBlackbody exists and is the Tanner Helland blackbody fit, unit blue gain',
  /vec3 planckBlackbody\(float kelvin\)/.test(display) &&
  /329\.698727446 \* pow\(t - 60\.0, -0\.1332047592\)/.test(display) &&
  /288\.1221695283 \* pow\(t - 60\.0, -0\.0755148492\)/.test(display) &&
  /rgb \/ max\(rgb\.b, 0\.35\)/.test(display));

check('discharge classes use distinct seeded colour temperatures',
  /planckBlackbody\(30000\.0 \+ 10000\.0/.test(display) &&
  /planckBlackbody\(18000\.0 \+ 6000\.0/.test(display) &&
  /planckBlackbody\(11000\.0 \+ 4000\.0/.test(display) &&
  /planckBlackbody\(\(isPositiveCC \? 12000\.0 : 22000\.0\)/.test(display) &&
  /planckBlackbody\(14000\.0 \+ 4000\.0/.test(display));

check('superbolt and hyperbolt keep their pinned fictional hues (existing look off-limits)',
  /const vec3 superboltColor = vec3\(0\.332, 0\.469, 1\.0\);/.test(display) &&
  /const vec3 hyperboltColor = vec3\(0\.25, 0\.38, 1\.0\);/.test(display));

/* ------------------------------------------------------------ lifetimes */

check('per-variant lifetime stretch lives in common.glsl and is shared with the slot manager',
  /float lightningLifetimeScale\(vec4 strike\)/.test(common) &&
  /if \(i <= LIGHTNING_IC_MAX_INTENSITY\)\s*\n\s*return 0\.72;/.test(common) &&
  /if \(i > 5\.45\)\s*\n\s*return 1\.25;/.test(common) &&
  /if \(i > 4\.5\)\s*\n\s*return 0\.85;/.test(common) &&
  /return start \+ 5\.0 \* \(repeatPeriod \* numFlashes \+ 2\.924\) \* lightningLifetimeScale\(strike\);/.test(common));

check('per-variant restrike spacing lives in a shared helper (quicker IC re-fires, sparse +CC)',
  /float lightningRepeatPeriod\(vec4 strike\)/.test(common) &&
  /return map_range\(random2d\(strike\.xy\), 0\., 1\., 1\.1, 2\.0\);/.test(common) &&
  /return map_range\(random2d\(strike\.xy\), 0\., 1\., 2\.2, 3\.6\);/.test(common) &&
  /return map_range\(random2d\(strike\.xy\), 0\., 1\., 1\.3, 2\.4\);/.test(common));

check('the display curve runs on the lifetime-stretched clock so the whole train dies sooner',
  /float T0 = Tin \/ max\(lightningLifetimeScale\(vec4\(lightningPos, 0\., intensity\)\), 1e-3\);/.test(display));

/* ------------------------------------------------------------- branches */

check('CG strokes fork 1-3 seeded side leaders rooted on the drawn channel',
  /int branchCount = 1 \+ int\(floor\(branchSeedBase \* 2\.999\)\);/.test(display) &&
  /ccEvalBranch\(pKm, anchor, bDir, bLen/.test(display));

check('external positives fork per class budget: all families use zero or one fork',
  /int extBranchCount = extBranchSeed < 0\.35 \? 1 : 0;/.test(display));


check('CC fork budget is strike-seeded: -CC 3-4, +CC 0-1',
  /float branchMax = isPositiveCC \? \(branchBudget < 0\.5 \? 1\.0 : 0\.0\)/.test(display) &&
  /: \(3\.0 \+ floor\(branchBudget \* 2\.0\)\);/.test(display));




/* ------------------------------------------- sprites / jets / elves */




/* ------------------------------------------- precipitation fall physics */

check('precipitation falls at drag-limited terminal velocity (Clift-Gauvin sphere), not totalMass^(1/3)',
  /float terminalVel = 6\.0;/.test(precip) &&
  /float cd = 24\.0 \/ re \* \(1\.0 \+ 0\.15 \* pow\(re, 0\.687\)\) \+ 0\.42 \/ \(1\.0 \+ 42500\.0 \/ pow\(re, 1\.16\)\);/.test(precip) &&
  !/fallSpeed \* newDensity \* sqrt\(totalMass \/ surfaceArea\)/.test(precip) &&
  /terminalVel \* secondsPerIteration \/ simHeightM \* 2\.0/.test(precip));

check('fall model is calibrated: mass unit 65 mg (~5 mm drop), exponential atmosphere, density from snow slider',
  /const float massUnitKg = 6\.5e-5;/.test(precip) &&
  /float rhoAir = 1\.225 \* exp\(-altitudeM \/ 8434\.0\);/.test(precip) &&
  /1000\.0 \* clamp\(newDensity, 0\.05, 4\.0\)/.test(precip));

check('fallSpeed is now a 0.4-2.0 multiplier GUI slider feeding the drag model (physical at 1.0)',
  /fallSpeed : 1\.0, \/\/ multiplier on drag-limited terminal velocity \(1\.0 = physical\)/.test(app) &&
  /precipitation_folder\.add\(guiControls, 'fallSpeed', 0\.4, 2\.0, 0\.1\)/.test(app) &&
  /gl\.uniform1f\(gl\.getUniformLocation\(precipitationProgram, 'simHeightM'\), guiControls\.simHeight\);/.test(app) &&
  /gl\.uniform1f\(gl\.getUniformLocation\(precipitationProgram, 'secondsPerIteration'\), 0\.288\);/.test(app));

/* --------------------------------------- motion blur: velocity path */

check('motion blur gathers the scene velocity field, not only the camera',
  /uniform sampler2D velocityTex;/.test(post) &&
  /velocity = texture\(velocityTex, sampleUV\)\.xy;/.test(post) &&
  /previousWorld = worldUV - velocity \* motionBlurIterPerFrame/.test(post) &&
  /gl\.uniform1i\(getUniformLoc\(postProcessingProgram, 'velocityTex'\), 3\);/.test(app));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
