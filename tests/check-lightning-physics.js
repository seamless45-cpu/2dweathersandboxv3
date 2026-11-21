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
//    IC / +IC 0-2 seeded side leaders, -CC 3-4 vs +CC 1-2, GC 3-5
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
  /planckBlackbody\(14000\.0 \+ 4000\.0/.test(display) &&
  /planckBlackbody\(12000\.0\), planckBlackbody\(26000\.0\)/.test(display) &&
  /planckBlackbody\(10000\.0\), planckBlackbody\(22000\.0\)/.test(display));

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

check('external positives fork per class budget: ordinary family 1, superbolt 2, hyperbolt 3 (count = family or family + 1)',
  /isHyperbolt \? 3\.0 : \(isSuperbolt \? 2\.0 : 1\.0\)\);/.test(display) &&
  /int extBranchCount = int\(branchFamily\) \+ \(extBranchSeed < 0\.5 \? 0 : 1\);/.test(display));

check('IC and +IC flashes get 0-2 seeded side leaders, +IC slightly rarer',
  /floor\(random2d\(vec2\(pos\.x \* 6\.7, pos\.y \* 9\.1\) \+ 0\.93\) \* 2\.4\)/.test(display) &&
  /floor\(random2d\(vec2\(pos\.x \* 8\.9, pos\.y \* 5\.1\) \+ 1\.71\) \* 2\.0\)/.test(display));

check('CC fork budget is strike-seeded: -CC 3-4, +CC 1-2',
  /float branchMax = isPositiveCC \? \(1\.0 \+ floor\(branchBudget \* 2\.0\)\)/.test(display) &&
  /: \(3\.0 \+ floor\(branchBudget \* 2\.0\)\);/.test(display));

check('GC reworked: stepped bursts, streamer fan ahead of the tip, ground-strike shock ring, M-component rebrightenings',
  /float stepFlare = 0\.74 \+ 0\.52 \*/.test(display) &&
  /\/\/ Streamer fan: a cold leader drags a fan of faint streamers in front of the/.test(display) &&
  /float attachmentGlow = exp\(-length\(p\) \/ 0\.16\) \* strokeShock \* 0\.35;/.test(display) &&
  /float mClockA = clamp\(\(time - 1\.16\) \/ 0\.30, 0\.0, 1\.0\);/.test(display) &&
  /float mClockB = clamp\(\(time - 1\.52\) \/ 0\.26, 0\.0, 1\.0\);/.test(display));

check('anvil crawler reworked: horizontal dart-leader restrike along established lanes, stubbled roots, hot junction',
  /float dartClock = clamp\(\(time - \(delay \+ 1\.04\)\) \/ 0\.34, 0\.0, 1\.0\);/.test(display) &&
  /float dartGain = dartLive \* exp\(-pow\(\(along - dartClock\) \/ 0\.055, 2\.0\)\)/.test(display) &&
  /stubDir = normalize\(vec2\(side \* cos\(stubAngle\)/.test(display) &&
  /planckBlackbody\(10000\.0\), planckBlackbody\(22000\.0\)/.test(display));

check('GC leaders fork 4-6 seeded',
  /int branchMax = 4 \+ int\(floor\(branchBudget \* 2\.999\)\);/.test(display));

/* ------------------------------------------- sprites / jets / elves */

check('red sprite reworked: cluster of column/carrot bodies, 5-8 seeded tendrils with stalled beads and forked tips, column core, NT+ 1N cap',
  /int tendrilCount = 5 \+ int\(floor\(seedT \* 3\.999\)\);/.test(display) &&
  /float lobes = exp\(-pow\(\(abs\(dx\) - 1\.8\) \/ 1\.1, 2\.0\)/.test(display) &&
  /vec3 red = vec3\(1\.0, 0\.055, 0\.035\)/.test(display) &&
  /float local = t - 0\.10 - 0\.06 \* seedB;/.test(display) &&
  /int secondaryCount = int\(floor\(random2d\(vec2\(seedR \* 5\.3 \+ 0\.13, seedT \* 7\.9 \+ 0\.41\)\) \* 2\.35\)\);/.test(display) &&
  /spriteBody\(dx - sOffset, altitude/.test(display) &&
  /float columnCore = exp\(-pow\(dx \/ 0\.62, 2\.0\)/.test(display) &&
  /float bead = exp\(-pow\(\(altitude - beadAlt\) \/ 0\.58, 2\.0\)\)/.test(display) &&
  /\/\/ Forked tips: below the foot each tendril splits into two short prongs\./.test(display));

check('blue jet reworked: climbing V-shaped fan, stepped central bolt, hot inner cone, afterglow, front cap, root starter flash',
  /float rise = clamp\(t \/ 0\.55, 0\.0, 1\.0\);/.test(display) &&
  /float frontKm = baseKm \+ \(41\.0 - baseKm\) \* rise;/.test(display) &&
  /float halfAngle = mix\(0\.34, 0\.52, seedJ\);/.test(display) &&
  /vec3\(0\.62, 0\.74, 1\.0\) \* starter \* 0\.8/.test(display) &&
  /float climb = max\(frontKm - baseKm, 1\.0\);/.test(display) &&
  /float channelCore = exp\(-pow\(\(dx - channelWobble\) \/ mix\(0\.16, 0\.075, channelProgress\), 2\.0\)\)/.test(display) &&
  /float fanInner = exp\(-pow\(dx \/ max\(widthInner, 0\.13\), 2\.0\)\);/.test(display) &&
  /float afterglow = exp\(-max\(t - 0\.80, 0\.0\) \/ 0\.40\);/.test(display));

check('elve reworked: expanding thin ring, inner disk, no artificial shaft, 1/r dimming, NT+ rising-edge rim',
  /float radius = mix\(3\.0, 165\.0, pow\(clamp\(t \/ 1\.35, 0\.0, 1\.0\), 1\.32\)\);/.test(display) &&
  /float amplitude = 1\.0 \/ \(1\.0 \+ radius \* 0\.065\);/.test(display) &&
  /1\.0 - smoothstep\(0\.62, 1\.42, t\)/.test(display) &&
  /float disk = \(1\.0 - smoothstep\(radius \* 0\.30, radius, abs\(dx\)\)\)/.test(display) &&
  !/float column = exp\(-pow\(dx \/ 0\.9, 2\.0\)/.test(display));

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
  /vec2 velocity = texture\(velocityTex, simUV\)\.xy;/.test(post) &&
  /flow -= sceneFlow;/.test(post) &&
  /gl\.uniform1i\(getUniformLoc\(postProcessingProgram, 'velocityTex'\), 3\);/.test(app));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
