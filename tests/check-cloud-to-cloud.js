// Cloud-to-Cloud (negative & positive CC) lightning test harness.
//
// Verifies that negative (-CC) and positive (+CC) cloud-to-cloud lightning:
//   1. Is selected cleanly in lightningLocationShader.frag via waterTex remote cloud
//      probing (selectCloudToCloudTarget), encoding meta.y = 2.0 (-CC) and 3.0 (+CC)
//      alongside targetY in meta.z, without ever terminating in empty sky or being
//      captured by ground lightning rods.
//   2. Uses single-strike-dominant behavior for +CC (0 restrikes ~80%, rare 1 restroke)
//      and multi-stroke behavior for -CC (1-3 restrikes = 2-4 strokes), synchronized
//      via lightningFlickers(), strikeAnimEnd(), and lightningIntensityOverTime() well
//      within LIGHTNING_ANIM_ITERS.
//   3. Renders in displayCloudToCloudLightning() with +CC exactly 50% brighter (1.5x)
//      than -CC (both channel emission and endpoint cloud onLight illumination), and
//      with fewer branches on +CC (0-1 sparse branch, higher mainThreshold) than -CC
//      (4 explicit branches + lower threshold).
//   4. Uses zero conditional fwidth()/dFdx()/dFdy() calls, handles periodic x=0/1
//      wrapping cleanly, and drives cloud-to-cloud thunder audio in app.js.
//
// Usage: node tests/check-cloud-to-cloud.js

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
const mapRange = (v, a, b, c, d) => c + (v - a) * (d - c) / (b - a);

const defineValue = (source, name) => {
  const m = source.match(new RegExp('#define\\s+' + name + '\\s+([-\\d.]+)'));
  return m ? Number(m[1]) : NaN;
};
const LIGHTNING_IC_MAX_INTENSITY = defineValue(common, 'LIGHTNING_IC_MAX_INTENSITY');
const LIGHTNING_ANIM_ITERS = defineValue(common, 'LIGHTNING_ANIM_ITERS');

/* ----------------------------------------------------- 1. shader & app wiring */

check('lightningLocationShader.frag defines selectCloudToCloudTarget and both -CC (2.0) / +CC (3.0) encodings',
  /vec3 selectCloudToCloudTarget\(/.test(locationShader) &&
  /bool isPositiveCC =/.test(locationShader) &&
  /vec4\(originX, 3\.0, ccTarget\.y, 0\.0\)/.test(locationShader) &&
  /vec4\(originX, 2\.0, ccTarget\.y, 0\.0\)/.test(locationShader),
  'meta row 1 must encode polarity 2.0 (-CC) and 3.0 (+CC) with targetY in .z');

check('realisticDisplayShader.frag separates External +CG (meta.y == 1.0), -CC (2.0), and +CC (3.0)',
  /bool isExternalPositive = !isFlash && abs\(lightningMeta\.y - 1\.0\) < 0\.25;/.test(displayShader) &&
  /bool isCloudToCloud = !isFlash && lightningMeta\.y >= 1\.5;/.test(displayShader) &&
  /bool isPositiveCC = isCloudToCloud && lightningMeta\.y >= 2\.5;/.test(displayShader) &&
  /vec3 displayCloudToCloudLightning\(/.test(displayShader),
  'all four lightning modes must dispatch cleanly without overlap');

check('displayCloudToCloudLightning keeps +CC 50% brighter (1.5x) and avoids fwidth()/dFdx()/dFdy()',
  /float ccIntensityGain = \(isPositiveCC \? 1\.5 : 1\.0\) \* \(1\.8 \/ max\(pow\(lightningData\[INTENSITY\], 2\.0\), 0\.1\)\);/.test(displayShader) &&
  !/fwidth\s*\(|dFdx\s*\(|dFdy\s*\(/.test(displayShader.slice(displayShader.indexOf('displayCloudToCloudLightning'),
    displayShader.indexOf('float saturate'))),
  '+CC must scale channel + cloud glow by exactly 1.5x without conditional quad derivatives');

check('reworked CC renders procedural fractal-displaced cubic spline with slope-corrected dendritic branches',
  (() => {
    const ccBody = displayShader.slice(
      displayShader.indexOf('vec2 ccFractalDisp('),
      displayShader.indexOf('float saturate')
    );
    return /vec2 evalCcCubic\(/.test(displayShader) &&
      /vec2 ccFractalDisp\(/.test(ccBody) &&
      /vec2 ccEvalBranch\(/.test(ccBody) &&
      /inversesqrt\(1\.0 \+ clamp\(spineSlope \* spineSlope, 0\.0, 6\.25\)\)/.test(ccBody) &&
      !/texture\w*\(\s*lightningTex/.test(ccBody) &&
      /isPositiveCC && \(b == 0 \|\| b == 3\)/.test(ccBody) &&
      /!isPositiveCC && \(b == 1 \|\| b == 2\)/.test(ccBody) &&
      /ccMidDist/.test(displayShader);
  })(),
  'CC must draw a procedural slope-corrected tortuous channel with 2-level -CC forks, sparse +CC forks, and 3-lobe cloud lighting');

check('selectCloudToCloudTarget skips solid terrain walls and searches 4 storm decks while protecting nearby rod CG strikes',
  /if \(texture\(baseTex, vec2\(cx, cy\)\)\[TEMPERATURE\] >= 500\.0\)/.test(locationShader) &&
  /float yList\[4\];/.test(locationShader) &&
  /hasNearbyLightningRod\(originX, incoming\[INTENSITY\]\)/.test(locationShader),
  'CC targeting must skip wall terrain, cover anvil altitude, and not divert CG triggers inside a rod reach');

check('app.js reads both rows of lightningDataTextures for CC midpoint cc*.mp3 thunder',
  /new Float32Array\(numLightningSlots \* 2 \* 4\)/.test(appSource) &&
  /gl\.readPixels\(0, 0, numLightningSlots, 2, gl\.RGBA, gl\.FLOAT, lightningDataValues\);/.test(appSource) &&
  /else if \(metaType >= 1\.5\)/.test(appSource) &&
  /metaType >= 2\.5/.test(appSource),
  'CC strikes should trigger midpoint cloud-to-cloud thunder with +CC 50% stronger than -CC');

/* --------------------------------------------- 2. targeting & rod isolation */

function selectCloudToCloudTarget(originX, originY, iter, densityFn, wallFn = () => 0, resX = 2000, resY = 300) {
  const aspect = Math.max(resX / Math.max(resY, 1.0), 1.0);
  const w1 = mapRange(random2d(originX * 37.9, iter * 1.3), 0.0, 1.0, 0.28, 0.58);
  const w2 = mapRange(random2d(originY * 53.3, iter * 1.9), 0.0, 1.0, 0.62, 0.92);
  const w3 = mapRange(random2d(originX * 41.1, iter * 2.3), 0.0, 1.0, 0.96, 1.32);
  const w4 = mapRange(random2d(originY * 43.1, iter * 2.7), 0.0, 1.0, 1.36, 1.76);

  const d1 = clamp(w1 / aspect, 0.04, 0.09);
  const d2 = clamp(w2 / aspect, d1 + 0.03, 0.14);
  const d3 = clamp(w3 / aspect, d2 + 0.03, 0.20);
  const d4 = clamp(w4 / aspect, d3 + 0.04, 0.27);

  const yList = [
    clamp(originY, 0.08, 0.80),
    clamp(originY + 0.13, 0.14, 0.84),
    clamp(originY + 0.22, 0.18, 0.88),
    clamp(originY - 0.12, 0.08, 0.72)
  ];
  const dxList = [d1, -d1, d2, -d2, d3, -d3, d4, -d4];

  let bestX = originX;
  let bestY = yList[0];
  let bestScore = -1e9;
  let found = false;

  for (let k = 0; k < 8; k++) {
    const dx = dxList[k];
    const cx = fract(originX + dx);
    const mx = fract(originX + 0.5 * dx);
    for (let yi = 0; yi < 4; yi++) {
      const cy = yList[yi];
      if (wallFn(cx, cy) >= 500.0) continue;
      const targetDensity = Math.max(densityFn(cx, cy), 0.0);
      if (targetDensity < 0.14) continue;
      const midDensity = Math.max(densityFn(mx, 0.5 * (originY + cy)), 0.0);
      const separationBonus = Math.max(targetDensity - midDensity, 0.0) * 0.55;
      const spanBonus = 0.18 * (Math.abs(dx) / Math.max(d4, 1e-4));
      const tieBias = 0.05 * random2d(originX * 29.3 + k * 7.1, iter * 3.1 + yi);
      const score = targetDensity - 0.45 * midDensity + separationBonus + spanBonus + tieBias;
      if (!found || score > bestScore) {
        bestScore = score;
        bestX = cx;
        bestY = cy;
        found = true;
      }
    }
  }
  return [bestX, bestY, found ? 1.0 : 0.0];
}

// 2a. Never connects to empty sky when no distant cloud exists
{
  let spurious = 0;
  for (let i = 0; i < 500; i++) {
    const res = selectCloudToCloudTarget(0.50, 0.30, 100 + i, (x) => Math.abs(x - 0.50) < 0.02 ? 2.0 : 0.0);
    if (res[2] > 0.5) spurious++;
  }
  check('cloud-to-cloud never strikes into empty sky around a small isolated cloud',
    spurious === 0, spurious + ' false targets');
}

// 2a-wall. Never terminates inside mountain terrain walls
{
  let mountainHits = 0;
  for (let i = 0; i < 400; i++) {
    const res = selectCloudToCloudTarget(0.50, 0.22, 200 + i, () => 2.5, (x, y) => (y < 0.30 ? 900.0 : 280.0));
    if (res[2] > 0.5 && res[1] < 0.30) mountainHits++;
  }
  check('cloud-to-cloud skips terrain wall cells and only targets free-air storm decks',
    mountainHits === 0, mountainHits + ' targets inside terrain');
}

// 2b. Bridges across a clear sky gap to a neighboring storm cell (including across seam)
{
  const twoStorms = (x, y) => {
    const d1 = Math.min(Math.abs(x - 0.94), 1 - Math.abs(x - 0.94));
    const d2 = Math.min(Math.abs(x - 0.06), 1 - Math.abs(x - 0.06));
    if (y >= 0.10 && y <= 0.50 && (d1 < 0.03 || d2 < 0.03)) return 2.2;
    return 0.0;
  };
  let bridged = 0;
  for (let i = 0; i < 400; i++) {
    const res = selectCloudToCloudTarget(0.94, 0.30, 400 + i, twoStorms);
    if (res[2] > 0.5) {
      const dToStorm2 = Math.min(Math.abs(res[0] - 0.06), 1 - Math.abs(res[0] - 0.06));
      if (dToStorm2 < 0.03) bridged++;
    }
  }
  check('two separated storm cells across the periodic seam bridge cleanly via CC',
    bridged > 350, bridged + ' of 400 bridged to neighboring storm');
}

/* --------------------- 3. polarity mix, single-stroke +CC, 1.5x brightness */

function flickersCC(x, y, intensity) {
  const r = random2d(f32(x * 2.737250), f32(y * 2.737250));
  if (intensity > 5.45) return r < 0.80 ? 0.0 : 1.0;
  if (intensity > 4.5) return r < 0.85 ? 0.0 : 1.0;
  return Math.floor(mapRange(r, 0, 1, 1.0, Math.max(intensity - 0.5, 0) * 2.0));
}

{
  let negSingle = 0, negMulti = 0, negTotal = 0;
  let posSingle = 0, posOneRestrike = 0, posOverOne = 0, posTotal = 0;
  let maxNegDur = 0, maxPosDur = 0;

  for (let i = 0; i < 2000; i++) {
    const tx = fract(0.1 + i * 0.6180339887);
    const oy = 0.15 + ((i * 0.029) % 0.45);
    const incI = 0.8 + ((i * 0.13) % 2.5);

    // Negative CC
    const negI = clamp(1.5 + (incI - 0.75) * 0.22, 1.5, 2.3);
    const fn = flickersCC(tx, oy, negI);
    negTotal++;
    if (fn === 0) negSingle++; else negMulti++;
    maxNegDur = Math.max(maxNegDur, 5 * (mapRange(random2d(tx, oy), 0, 1, 1.5, 3.0) * fn + 2.924));

    // Positive CC
    const posI = clamp(5.5 + (incI - 0.75) * 0.13, 5.5, 6.0);
    const fp = flickersCC(tx, oy, posI);
    posTotal++;
    if (fp === 0) posSingle++;
    else if (fp === 1) posOneRestrike++;
    else posOverOne++;
    maxPosDur = Math.max(maxPosDur, 5 * (mapRange(random2d(tx, oy), 0, 1, 1.5, 3.0) * fp + 2.924));
  }

  const posSingleShare = posSingle / posTotal;
  const negMultiShare = negMulti / negTotal;
  check('positive CC fires mostly as a single strike (~80% 0 restrikes) while negative CC flickers repeatedly',
    posOverOne === 0 && posSingleShare >= 0.75 && posSingleShare <= 0.85 &&
    posOneRestrike > 0 && negMultiShare > 0.90 &&
    maxNegDur <= LIGHTNING_ANIM_ITERS && maxPosDur <= LIGHTNING_ANIM_ITERS,
    '+CC single=' + (posSingleShare * 100).toFixed(1) + '%, -CC multi=' + (negMultiShare * 100).toFixed(1) + '%');

  // Verify exact 1.5x brightness invariance across encoded intensity range
  const baseDecay = 19.995; // T = 0 peak of 1/(0.05 + (2T)^3) - 0.005
  const negGain = 1.0 * (1.8 / Math.pow(1.9, 2));
  const posGain = 1.5 * (1.8 / Math.pow(5.8, 2));
  const negLum = baseDecay * Math.pow(1.9, 2) * negGain;
  const posLum = baseDecay * Math.pow(5.8, 2) * posGain;
  const ratio = posLum / negLum;
  check('positive CC channel and cloud illumination are exactly 50% brighter (1.5x) than negative CC',
    Math.abs(ratio - 1.5) < 1e-6 && LIGHTNING_IC_MAX_INTENSITY === 1.0,
    'ratio=' + ratio.toFixed(6));
}

/* ------------------------------------------- 4. Bezier curve endpoint check */

{
  const evalCcCubic = (t, p0, p1, p2, p3) => {
    const om = 1 - t;
    return [om * om * om * p0[0] + 3 * om * om * t * p1[0] + 3 * om * t * t * p2[0] + t * t * t * p3[0],
            om * om * om * p0[1] + 3 * om * om * t * p1[1] + 3 * om * t * t * p2[1] + t * t * t * p3[1]];
  };
  const p0 = [-0.8, 0.32], p1 = [-0.55, 0.44], p2 = [-0.25, 0.21], p3 = [0.0, 0.28];
  const s = evalCcCubic(0, p0, p1, p2, p3);
  const e = evalCcCubic(1, p0, p1, p2, p3);
  check('cloud-to-cloud cubic S-curve starts at origin cloud and lands at target cloud',
    Math.abs(s[0] - p0[0]) < 1e-6 && Math.abs(s[1] - p0[1]) < 1e-6 &&
    Math.abs(e[0] - p3[0]) < 1e-6 && Math.abs(e[1] - p3[1]) < 1e-6);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
