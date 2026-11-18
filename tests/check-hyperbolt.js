// Verification harness for the hyperbolt positive lightning variant.
//
// Spec (2026-11-18): 720,000 K; a nominal 80 terrawatts and 120 gigaamps
// (both figures fictional - the current and amps are not modelled); 0.3 s
// lifetime; camera shake intensity 90 / duration 2.5 s; half as rare as an
// ordinary superbolt (0.072 * 0.5 = 0.036). A hyperbolt is superbolt-class:
// every consumer that only checks integer meta.w >= 0.5 treats it as a
// superbolt; the 1.5 threshold separates the two classes.
//
// Usage: node tests/check-hyperbolt.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const locationShader = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'lightningLocationShader.frag'), 'utf8');
const displayShader = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'realisticDisplayShader.frag'), 'utf8');

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

/* ------------------------------------------- GLSL math port (same as superbolt suite) */

const f32 = Math.fround;
const dv = new DataView(new ArrayBuffer(4));
const floatBitsToUint = (f) => { dv.setFloat32(0, f32(f), true); return dv.getUint32(0, true); };
const uintBitsToFloat = (u) => { dv.setUint32(0, u >>> 0, true); return dv.getFloat32(0, true); };

function hashU(x) {
  x = (x + (x << 10)) >>> 0;
  x = (x ^ (x >>> 6)) >>> 0;
  x = (x + (x << 3)) >>> 0;
  x = (x ^ (x >>> 11)) >>> 0;
  x = (x + (x << 15)) >>> 0;
  return x >>> 0;
}

function random2d(x, y) {
  let h = hashU((floatBitsToUint(x) + hashU(floatBitsToUint(y))) >>> 0);
  h = ((h & 0x007fffff) | 0x3f800000) >>> 0;
  const r2 = uintBitsToFloat(h);
  return r2 - Math.floor(r2);
}

const fract = (x) => x - Math.floor(x);

/* ------------------------------------------------------------- display path */

check('hyperbolt is an external positive CG class selected by integer meta.w >= 1.5',
  /bool isHyperbolt = isExternalPositive && lightningMeta\.w >= 1\.5;/.test(displayShader) &&
  /bool isSuperbolt = isExternalPositive && lightningMeta\.w >= 0\.5;/.test(displayShader));

check('720,000 K hyperbolt color is blue and deeper than the 52,000 K superbolt',
  (() => {
    const hyper = displayShader.match(/const vec3 hyperboltColor = vec3\(([0-9., ]+)\);/);
    const superBolt = displayShader.match(/const vec3 superboltColor = vec3\(([0-9., ]+)\);/);
    if (!hyper || !superBolt) return false;
    const [hr, hg, hb] = hyper[1].split(',').map(Number);
    const [sr, sg, sb] = superBolt[1].split(',').map(Number);
    return hb === 1.0 && sb === 1.0 && hr < sr && hg < sg;
  })());

check('hyperbolt spec figures (80 terrawatts, 120 gigaamps) are recorded as fiction',
  /80 terrawatts/.test(displayShader) && /120 gigaamps/.test(displayShader));

check('hyperbolt is 30x brighter (2.5x a superbolt) and lives 0.3 s instead of 2.924',
  /const float hyperboltBrightnessMult = 30\.0;/.test(displayShader) &&
  /const float hyperboltDurationShorten = 2\.624;/.test(displayShader) &&
  Math.abs(2.924 - 2.624 - 0.3) < 1e-9 &&
  /float strokeBrightnessMult = isHyperbolt \? hyperboltBrightnessMult : superboltBrightnessMult;/.test(displayShader) &&
  /float strokeDurationShorten = isHyperbolt \? hyperboltDurationShorten : superboltDurationShorten;/.test(displayShader));

check('hyperbolt uses the shared superbolt-class gate with the shorter window',
  /if \(isSuperbolt && lightningTime >= repeatPeriod \* lightningFlickers\(lightningData\) \+ \(2\.924 - strokeDurationShorten\)\)/.test(displayShader));

check('hyperbolt keeps the optical-effect fractional bits out of the class test',
  /hasOpticalEffect\(float flags, float bit\)/.test(displayShader) &&
  /mod\(floor\(fract\(flags\) \* 32\.0 \+ 0\.5\) \/ bit, 2\.0\) >= 1\.0/.test(displayShader));

check('captured-rod surge honours the 0.3 s hyperbolt window and 30x gain',
  /bool rodStrikeIsHyperbolt = strikeMeta\.w >= 1\.5;/.test(displayShader) &&
  /float rodEndWindow = rodStrikeIsHyperbolt \? 0\.3 : 2\.824;/.test(displayShader) &&
  /float rodBrightnessMult = rodStrikeIsHyperbolt \? 30\.0 : 12\.0;/.test(displayShader));

/* ------------------------------------------------------------- spawn logic */

check('hyperbolt spawn is a nested halved roll on the external positive CG path',
  /bool isHyperboltExt = isSuperboltExt &&/.test(locationShader) &&
  /random2d\(vec2\(originX \* 97\.7 \+ incoming\.y \* 53\.3, iterNum \* 1\.29\)\) < 0\.5;/.test(locationShader));

check('external positive CG encodes hyperbolt as integer meta.w = 2 (superbolt stays 1)',
  /vec4\(originX, 1\.0, 0\.0, isHyperboltExt \? 2\.0 : \(isSuperboltExt \? 1\.0 : 0\.0\)\)/.test(locationShader));

{
  let extTotal = 0, hyperbolts = 0, superboltsOnly = 0;
  for (let i = 0; i < 100000; i++) {
    const ox = fract(0.11 + i * 0.01731);
    const oy = 0.22 + ((i * 0.031) % 0.45);
    const iter = 400 + i;
    const isExt = random2d(ox * 31.7 + oy * 59.3, iter * 0.73) < 0.18;
    // The shader only reaches the hyperbolt roll inside the external-positive-CG
    // branch; anywhere else the nested roll is never evaluated.
    if (!isExt) continue;
    extTotal++;
    if (random2d(ox * 89.3 + oy * 47.1, iter * 1.13) < 0.072) {
      if (random2d(ox * 97.7 + oy * 53.3, iter * 1.29) < 0.5) hyperbolts++;
      else superboltsOnly++;
    }
  }
  const rate = hyperbolts / extTotal;
  const classRate = (hyperbolts + superboltsOnly) / extTotal;
  check('hyperbolt share is approximately 3.6% of external CG, superbolt-class unchanged at ~7.2%',
    rate >= 0.030 && rate <= 0.042 && classRate >= 0.064 && classRate <= 0.080,
    (rate * 100).toFixed(2) + '% hyperbolt, ' + (classRate * 100).toFixed(2) + '% superbolt-class, of ' + extTotal);
}

check('artificial Hyperbolt variant (index 12, 720,000 K positive CG) dispatches to meta.w = 2 and rod capture',
  /variant > 11\.5 && variant < 12\.5/.test(locationShader) &&
  /integer meta\.w = 2 hyperbolt flag/.test(locationShader) &&
  appSource.includes("'Hyperbolt' : 'hyperbolt'") &&
  /hyperbolt: 12,/.test(appSource));

/* ------------------------------------------------------------- camera shake */

check('hyperbolt camera shake: intensity 90 (0.090 view height at 40 Hz), 2.5 s duration',
  /const HYPERBOLT_SHAKE_HZ = 40\.0;/.test(appSource) &&
  /const HYPERBOLT_SHAKE_DURATION_MS = 2500\.0;/.test(appSource) &&
  /const HYPERBOLT_SHAKE_PEAK_AMP = 0\.090;/.test(appSource) &&
  /const HYPERBOLT_SHAKE_DECAY_PER_SEC = 2\.2;/.test(appSource));

check('hyperbolt shake is triggered from the readback (even when sound is off) and never stacked on the superbolt shake',
  /if \(strikeClass >= 1\.5\) \{/.test(appSource) &&
  /triggerHyperboltCameraShake\(\); \/\/ hyperbolt alone, not stacked on the superbolt shake/.test(appSource) &&
  /const shakeOffset = getLightningShakeOffset\(performance\.now\(\)\);/.test(appSource));

check('hyperbolt thunder is louder still (2.5x), superbolt unchanged at 1.5x',
  /const strikeSoundMult = strikeClassMetaW >= 1\.5 \? 2\.5 : \(isSuperbolt \? 1\.5 : 1\.0\);/.test(appSource));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
