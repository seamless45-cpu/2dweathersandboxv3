// Positive Intra-Cloud (+IC) lightning test harness.
//
// Verifies that positive intra-cloud (+IC) discharges:
//   1. Originate inside upper convective decks (y >= 0.16) at ~20-36% of normal
//      IC flashes, encoding row 1 metadata meta.y = 4.0 while keeping row 0
//      intensity within [0.88, LIGHTNING_IC_MAX_INTENSITY].
//   2. Are never captured by ground lightning rods (because intensity <= 1.0).
//   3. Render via displayPositiveFlash() with warm positive polarity color
//      vec3(1.0, 0.88, 0.80), broader anvil spread (0.095 vs 0.075), 50% brighter
//      peak radiance (10500 vs 7000), and 50% brighter cloud onLight glow without
//      disturbing normal negative IC flashes (-IC).
//   4. Route in app.js before cloud-to-cloud (metaType >= 3.5) so cloud thunder
//      fires from (targetX, originY) using cc*.mp3.
//
// Usage: node tests/check-positive-ic.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const common = fs.readFileSync(path.join(ROOT, 'shaders', 'common.glsl'), 'utf8');
const locationShader = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'lightningLocationShader.frag'), 'utf8');
const displayShader = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'realisticDisplayShader.frag'), 'utf8');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

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

/* ---------------------------------------------------------- GLSL math port */

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
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const defineValue = (source, name) => {
  const m = source.match(new RegExp('#define\\s+' + name + '\\s+([-\\d.]+)'));
  return m ? Number(m[1]) : NaN;
};

const LIGHTNING_IC_MAX_INTENSITY = defineValue(common, 'LIGHTNING_IC_MAX_INTENSITY');

/* ------------------------------------------------ 1. shader & audio wiring */

check('lightningLocationShader.frag encodes +IC as meta.y = 4.0 while keeping intensity <= LIGHTNING_IC_MAX_INTENSITY',
  /bool isNormalIC = normalStrike\[INTENSITY\] <= LIGHTNING_IC_MAX_INTENSITY;/.test(locationShader) &&
  /bool isPositiveIC = isNormalIC && incoming\.y >= 0\.16/.test(locationShader) &&
  /vec4\(originX, 4\.0, 0\.0, 0\.0\)/.test(locationShader),
  'positive IC must share IC intensity budget and encode meta.y == 4.0');

check('realisticDisplayShader.frag defines displayPositiveFlash() with +50% brightness, warm polarity, and wider anvil spread',
  /vec3 displayPositiveFlash\(/.test(displayShader) &&
  /bool isPositiveIC = isFlash && lightningMeta\.y >= 3\.5;/.test(displayShader) &&
  /const float flashHeight = 0\.095;/.test(displayShader) &&
  /const float mainBoltBrightness = 10500\.;/.test(displayShader) &&
  /const vec3 positiveIcCol = vec3\(1\.0, 0\.88, 0\.80\);/.test(displayShader) &&
  /if \(isPositiveIC\)\s*\n\s*lightningOnLight \*= 1\.5;/.test(displayShader),
  'expected dedicated positive IC render path and 1.5x cloud glow');

check('realisticDisplayShader.frag preserves normal -IC displayFlash() path untouched',
  /vec3 displayFlash\(vec2 pos, float lightningTime, float currentLightningIntensity\)/.test(displayShader) &&
  /const float flashHeight = 0\.075;/.test(displayShader) &&
  /const float mainBoltBrightness = 7000\.;/.test(displayShader),
  '-IC flashes must retain original geometry and violet-blue intensity');

check('app.js handles +IC metaType >= 3.5 before CC routing using origin coordinates and cc*.mp3 audio',
  /if \(metaType >= 3\.5\) \{[\s\S]*soundSystem\.soundThunder\(targetX, originY, Math\.min\(Math\.pow\(strikeIntensity, 2\.0\), 1\.0\)\);[\s\S]*\} else if \(metaType >= 1\.5\)/.test(appSource),
  '+IC must dispatch before CC midpoint logic and stay within cc*.mp3 gain range (<= 1.0)');

/* ------------------------------------------- 2. altitude & rod isolation */

function attractToRod(strike, rods) {
  if (strike[3] <= LIGHTNING_IC_MAX_INTENSITY) return strike.slice();
  if (rods.length > 0 && Math.abs(strike[0] - rods[0].x) < 0.08) {
    const out = strike.slice();
    out[0] = rods[0].x;
    out[3] = Math.max(out[3], LIGHTNING_IC_MAX_INTENSITY + 0.6);
    return out;
  }
  return strike.slice();
}

function resolveNormalBranch(originX, originY, iter, incomingIntensity, rods = []) {
  let normalStrike = attractToRod([originX, originY, iter, incomingIntensity], rods);
  const isNormalIC = normalStrike[3] <= LIGHTNING_IC_MAX_INTENSITY;
  const posIcChance = mix(0.20, 0.36, clamp((originY - 0.16) / 0.28, 0.0, 1.0));
  const isPositiveIC = isNormalIC && originY >= 0.16 &&
    random2d(originX * 61.3 + originY * 41.7, iter * 1.91) < posIcChance;
  if (isPositiveIC) {
    normalStrike[3] = clamp(Math.max(incomingIntensity, 0.88), 0.88, LIGHTNING_IC_MAX_INTENSITY);
    return { row0 : normalStrike, row1 : [originX, 4.0, 0.0, 0.0] };
  }
  return { row0 : normalStrike, row1 : [originX, 0.0, 0.0, 0.0] };
}

{
  let lowPosCount = 0;
  for (let i = 0; i < 1000; i++) {
    const res = resolveNormalBranch(fract(0.15 + i * 0.017), 0.08 + (i % 7) * 0.01, 100 + i, 0.82);
    if (res.row1[1] >= 3.5) lowPosCount++;
  }
  check('low cloud triggers (y < 0.16) never emit +IC', lowPosCount === 0,
    lowPosCount + ' unexpected triggers');
}

{
  const rods = [{ x : 0.45, y : 0.03 }];
  let posIcCount = 0;
  let capturedCount = 0;
  let minPosI = Infinity;
  let maxPosI = 0;
  const total = 3000;
  for (let i = 0; i < total; i++) {
    const ox = 0.45 + ((i % 9) - 4) * 0.005;
    const oy = 0.20 + ((i * 0.023) % 0.35);
    const incI = 0.75 + ((i * 0.019) % 0.24);
    const res = resolveNormalBranch(ox, oy, 500 + i, incI, rods);
    if (res.row1[1] >= 3.5) {
      posIcCount++;
      minPosI = Math.min(minPosI, res.row0[3]);
      maxPosI = Math.max(maxPosI, res.row0[3]);
      if (Math.abs(res.row0[0] - rods[0].x) < 1e-6 && res.row0[3] > LIGHTNING_IC_MAX_INTENSITY) {
        capturedCount++;
      }
    }
  }
  const share = posIcCount / total;
  check('upper storm IC flashes emit realistic ~20%-36% +IC share and never get captured by lightning rods',
    share >= 0.20 && share <= 0.36 && capturedCount === 0 &&
    minPosI >= 0.88 && maxPosI <= LIGHTNING_IC_MAX_INTENSITY,
    'share=' + (share * 100).toFixed(1) + '%, I=[' + minPosI.toFixed(2) + ',' + maxPosI.toFixed(2) + ']');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
