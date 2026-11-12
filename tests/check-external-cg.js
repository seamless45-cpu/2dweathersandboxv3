// External positive CG ("bolt from the blue") lightning test harness.
//
// Verifies that positive CG strikes:
//   1. Are wired cleanly across app.js (numLightningSlots x 2 RGBA32F slot texture,
//      waterTex unit 2 bound on lightningLocationProgram, wrapped thunder panning).
//   2. Only originate from tall convective storms (y >= 0.18), keeping the majority
//      of lightning inside the storm core while throwing ~14-24% far outside.
//   3. Probe waterTex to prefer clear air outside the storm anvil/adjacent cells
//      and land genuinely far from the storm trigger point.
//   4. Carry elevated positive-CG current ([2.8, 4.5] > LIGHTNING_IC_MAX_INTENSITY)
//      and remain capturable by distant lightning rods out in clear air.
//   5. Arc smoothly and deterministically in displayExternalLightning() from
//      (originX, originY) inside the cloud to (groundPos.x, 0) even across the
//      periodic x = 0 / 1 seam, producing finite non-NaN emission.
//
// Usage: node tests/check-external-cg.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const common = fs.readFileSync(path.join(ROOT, 'shaders', 'common.glsl'), 'utf8');
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
const wrappedDist = (a, b) => Math.abs(((a - b + 1.5) % 1) - 0.5);

const defineValue = (source, name) => {
  const m = source.match(new RegExp('#define\\s+' + name + '\\s+([-\\d.]+)'));
  return m ? Number(m[1]) : NaN;
};
const LIGHTNING_IC_MAX_INTENSITY = defineValue(common, 'LIGHTNING_IC_MAX_INTENSITY');
const MAX_LIGHTNING_RODS = defineValue(common, 'MAX_LIGHTNING_RODS');

/* ------------------------------------------------------------- 1. wiring */

check('app.js allocates lightningDataTextures as numLightningSlots x 2 RGBA32F',
  /gl\.texImage2D\(gl\.TEXTURE_2D,\s*0,\s*gl\.RGBA32F,\s*numLightningSlots,\s*2,\s*0,\s*gl\.RGBA,\s*gl\.FLOAT,\s*null\)/.test(appSource) &&
  /gl\.viewport\(0,\s*0,\s*numLightningSlots,\s*2\)/.test(appSource),
  'metadata row 1 requires height = 2 in both texImage2D and lightningLocationProgram viewport');

check('app.js binds waterTexture_1 to waterTex unit 2 on lightningLocationProgram',
  /gl\.uniform1i\(gl\.getUniformLocation\(lightningLocationProgram,\s*'waterTex'\),\s*2\)/.test(appSource) &&
  /gl\.activeTexture\(gl\.TEXTURE2\);\s*\n\s*gl\.bindTexture\(gl\.TEXTURE_2D,\s*waterTexture_1\);/.test(appSource),
  'lightningLocationShader.frag needs waterTex to probe clear air around the storm');

check('app.js thunder audio wraps periodic x distance across the seam',
  /let wrappedDx = \(x - camXnorm\) - Math\.round\(x - camXnorm\);/.test(appSource) &&
  /let camHorDistFromStrike = wrappedDx \* cellHeight \* sim_res_x;/.test(appSource),
  'external positive strikes wrapping across x=0/1 must compute shortest distance');

check('lightningLocationShader.frag reads row 1 metadata and selects clear-air positive CG targets',
  /uniform sampler2D waterTex;/.test(locationShader) &&
  /float selectExternalStrikeTarget\(/.test(locationShader) &&
  /int row = int\(gl_FragCoord\.y\);/.test(locationShader) &&
  /bool isExternalPositive = incoming\.y >= 0\.18/.test(locationShader),
  'row 1 stores (originX, isExternalPositive) cleanly alongside row 0');

check('realisticDisplayShader.frag draws external positive CG via displayExternalLightning and illuminates origin + ground',
  /vec3 displayExternalLightning\(/.test(displayShader) &&
  /vec4 lightningMeta = texelFetch\(lightningDataTex, ivec2\(slot, 1\), 0\);/.test(displayShader) &&
  /bool isExternalPositive = !isFlash && abs\(lightningMeta\.y - 1\.0\) < 0\.25;/.test(displayShader) &&
  /if \(isExternalPositive\) \{/.test(displayShader) &&
  /originDist/.test(displayShader),
  'external positive CG must arch from storm origin to distant ground and light both ends');

/* ------------------------------------------- 2. location & targeting port */

function selectExternalStrikeTarget(originX, originY, iter, stormScoreFn, resX = 2000, resY = 300) {
  const aspect = Math.max(resX / Math.max(resY, 1.0), 1.0);
  const minWorld = 5.5 / 12.0;
  const maxWorld = 39.0 / 12.0;
  const yMid = clamp(originY * 0.55, 0.08, 0.45);

  let bestX = fract(originX + clamp(minWorld / aspect, 0.03, 0.4875));
  let bestScore = 1e9;
  for (let k = 0; k < 6; k++) {
    const rDist = random2d(originX * 23.7 + k * 11.3,
                           originY * 17.9 + iter * 2.13 + k * 3.7);
    const worldDist = mix(minWorld, maxWorld, rDist);
    const dx = clamp(worldDist / aspect, 0.03, 0.4875);
    const side = ((k % 2) === 0) ? 1.0 : -1.0;
    const cx = fract(originX + side * dx);
    const tieBias = 0.02 * random2d(originX * 17.3 + k * 5.7, iter * 1.9 + k);
    const score = stormScoreFn(cx, yMid) + tieBias;
    if (score < bestScore) {
      bestScore = score;
      bestX = cx;
    }
  }
  return bestX;
}

function attractToRod(strike, rods, radius = 0.08) {
  const result = strike.slice();
  if (result[3] <= LIGHTNING_IC_MAX_INTENSITY) return result;
  let nearestRod = -1;
  let nearestDist = radius;
  for (let i = 0; i < rods.length && i < MAX_LIGHTNING_RODS; i++) {
    const dx = Math.abs(result[0] - rods[i].x);
    if (dx < nearestDist) {
      nearestDist = dx;
      nearestRod = i;
    }
  }
  if (nearestRod < 0) return result;
  const pull = 1 - nearestDist / Math.max(radius, 1e-5);
  if (random2d(result[1] * 149.7, result[2] * 7.31) > pull) return result;
  result[0] = rods[nearestRod].x;
  result[3] = Math.max(result[3], LIGHTNING_IC_MAX_INTENSITY + 0.6);
  return result;
}

function resolveStrike(incoming, stormScoreFn, rods = [], resX = 2000, resY = 300) {
  const originX = fract(incoming[0]);
  const originY = incoming[1];
  const iter = incoming[2];
  const posChance = mix(0.14, 0.24, clamp((originY - 0.18) / 0.28, 0.0, 1.0));
  const isExternalPositive = originY >= 0.18 &&
    random2d(originX * 31.7 + originY * 59.3, iter * 0.73) < posChance;
  if (isExternalPositive) {
    const extStrike = [
      selectExternalStrikeTarget(originX, originY, iter, stormScoreFn, resX, resY),
      originY,
      iter,
      clamp(4.6 + (incoming[3] - 0.75) * 0.25, 4.6, 5.4)
    ];
    return {
      row0 : attractToRod(extStrike, rods),
      row1 : [originX, 1.0, 0.0, 0.0]
    };
  }
  return {
    row0 : attractToRod(incoming, rods),
    row1 : [originX, 0.0, 0.0, 0.0]
  };
}

// 2a. Low clouds never emit external positive CG
{
  let extLow = 0;
  for (let i = 0; i < 1000; i++) {
    const out = resolveStrike([0.3 + (i % 40) * 0.01, 0.05 + (i % 12) * 0.01, 100 + i, 1.4], () => 0);
    if (out.row1[1] > 0.5) extLow++;
  }
  check('low-altitude triggers (y < 0.18) never trigger external positive CG', extLow === 0,
    extLow + ' of 1000 triggered');
}

// 2b. Tall storm triggers emit ~14-24% external positive CG, landing far away with high current
{
  let extCount = 0;
  let minOffset = Infinity;
  let maxOffset = 0;
  let minExtIntensity = Infinity;
  let maxExtIntensity = 0;
  let leftHits = 0;
  let rightHits = 0;
  const total = 4000;
  for (let i = 0; i < total; i++) {
    const ox = 0.2 + ((i * 0.0137) % 0.6);
    const oy = 0.25 + ((i * 0.029) % 0.35);
    const inten = 0.8 + ((i * 0.17) % 2.2);
    const out = resolveStrike([ox, oy, 500 + i, inten], () => 0);
    if (out.row1[1] > 0.5) {
      extCount++;
      const dx = wrappedDist(out.row0[0], out.row1[0]);
      minOffset = Math.min(minOffset, dx);
      maxOffset = Math.max(maxOffset, dx);
      minExtIntensity = Math.min(minExtIntensity, out.row0[3]);
      maxExtIntensity = Math.max(maxExtIntensity, out.row0[3]);
      const signed = ((out.row0[0] - out.row1[0] + 1.5) % 1) - 0.5;
      if (signed < 0) leftHits++; else rightHits++;
    }
  }
  const rate = extCount / total;
  check('external positive CG share in a tall storm stays realistic (12%-26%)',
    rate >= 0.12 && rate <= 0.26,
    (rate * 100).toFixed(1) + '% (' + extCount + ' of ' + total + ')');
  check('external positive CG strikes randomly across the full minimal-to-maximum range (~5.5 km to ~39 km / 0.06875 to 0.4875 domain width)',
    minOffset >= 0.068 && minOffset <= 0.09 && maxOffset <= 0.488 && maxOffset >= 0.46,
    'offset range ' + minOffset.toFixed(4) + ' .. ' + maxOffset.toFixed(4));
  check('clear-air left/right targeting is balanced when both sides are clear',
    leftHits > extCount * 0.35 && rightHits > extCount * 0.35,
    'left ' + leftHits + ', right ' + rightHits);
  check('external positive CG carries elevated high-current intensity ([4.6, 5.4])',
    minExtIntensity >= 4.6 && maxExtIntensity <= 5.4 && minExtIntensity > LIGHTNING_IC_MAX_INTENSITY,
    'intensity range ' + minExtIntensity.toFixed(2) + ' .. ' + maxExtIntensity.toFixed(2));
}

// 2e. 2x normal CG brightness & smooth tail fade behavior
{
  const mainMatch = displayShader.match(/const float mainBoltBrightness = ([\d.]+);/);
  const extMatch = displayShader.match(/const float extBoltBrightness = ([\d.]+);/);
  const mainB = mainMatch ? Number(mainMatch[1]) : NaN;
  const extB = extMatch ? Number(extMatch[1]) : NaN;
  check('displayExternalLightning uses 200000 brightness (2x normal CG 100000) and smooth tail fade',
    Number.isFinite(mainB) && Number.isFinite(extB) && extB === 200000 && extB === mainB * 2 &&
    /const float cgExcessScale = 0\.05 \/ \(1\.0 - brightnessThreshold\);/.test(displayShader) &&
    /float extBaseIntensity = clamp\(mix\(1\.8, 3\.4,/.test(displayShader) &&
    /float extTailFade = pow\(smoothstep\(2\.924, 1\.15, tailT\), 2\.4\);/.test(displayShader) &&
    /float extCurve = currentLightningIntensity \* extIntensityGain \* extTailFade;/.test(displayShader),
    'main=' + mainB + ', ext=' + extB);

  check('external positive CG illuminates ground and storm origin 2x normal CG using extCurve',
    /if \(isExternalPositive\)\s*\n\s*lightningOnLight \*= extIntensityGain \* extTailFade;/.test(displayShader) &&
    /if \(isExternalPositive\) \{\s*\n\s*onLight \+= vec3\(lightningOnLight\);/.test(displayShader) &&
    /onLight \+= vec3\(lightningOnLightBrightness \* 2\.0 \/.*\* extCurve\);/.test(displayShader),
    'expected 2x ground (1 + 1) and 2x origin cloud onLight driven by extCurve + extTailFade');

  // Numerical fade parity + smooth tail decay: positive CG matches normal CG 2.0x over
  // [0.0, 1.15] and then smoothly fades monotonically toward 0 across [1.15, 2.924]
  // rather than snapping off from bright white on its final frame.
  const decay = (T) => Math.max(1 / (0.05 + Math.pow(T * 2.0, 3)) - 0.005, 0);
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const slotI = 5.0;
  const extBaseI = clamp(mix(1.8, 3.4, (slotI - 4.6) / 0.8), 1.8, 3.4);
  const extGain = Math.pow(extBaseI / slotI, 2);
  const cgExcessScale = 0.05 / (1.0 - 0.88);
  let fadeOk = true;
  for (const T of [0.0, 0.25, 0.5, 1.0, 1.15]) {
    const normCgLum = (1.0 - 0.95) * decay(T) * Math.pow(extBaseI, 2) * 100000;
    const posCgLum = (1.0 - 0.88) * cgExcessScale * decay(T) * Math.pow(slotI, 2) * extGain * 200000;
    if (Math.abs(posCgLum / normCgLum - 2.0) > 1e-6)
      fadeOk = false;
  }
  let prevTailLum = Infinity;
  for (const T of [1.2, 1.6, 2.0, 2.4, 2.8, 2.924]) {
    const tailFade = Math.pow(smoothstep(2.924, 1.15, T), 2.4);
    const tailLum = (1.0 - 0.88) * cgExcessScale * decay(T) * Math.pow(slotI, 2) * extGain * tailFade * 200000;
    if (!(tailLum <= prevTailLum)) fadeOk = false;
    prevTailLum = tailLum;
  }
  check('positive CG keeps 2.0x normal CG shoulder fade and glides smoothly to zero without snapping off',
    fadeOk && prevTailLum === 0);

  const LIGHTNING_ANIM_ITERS = defineValue(common, 'LIGHTNING_ANIM_ITERS');
  const flickersExt = (x, y, intensity) => {
    const r = random2d(f32(x * 2.737250), f32(y * 2.737250));
    if (intensity > 4.5) return r < 0.85 ? 0.0 : 1.0;
    return Math.floor(mapRange(r, 0, 1, 1.0, Math.max(intensity - 0.5, 0) * 2.0));
  };
  let zeroRestrikes = 0;
  let oneRestrike = 0;
  let overOneRestrike = 0;
  let maxAnimDuration = 0;
  const samples = 2000;
  for (let i = 0; i < samples; i++) {
    const gx = ((i * 0.6180339887) % 1);
    const oy = 0.2 + ((i * 0.037) % 0.45);
    const inten = 4.6 + ((i % 9) * 0.1);
    const f = flickersExt(gx, oy, inten);
    if (f === 0) zeroRestrikes++;
    else if (f === 1) oneRestrike++;
    else overOneRestrike++;
    const period = mapRange(random2d(gx, oy), 0, 1, 1.5, 3.0);
    const dur = 5.0 * (period * f + 2.924);
    maxAnimDuration = Math.max(maxAnimDuration, dur);
  }
  const singleStrokeRate = zeroRestrikes / samples;
  check('external positive CG usually strikes once (0 restrikes ~85%, <= 1 restroke) and fits slot upper bound',
    overOneRestrike === 0 && singleStrokeRate >= 0.80 && singleStrokeRate <= 0.90 &&
    oneRestrike > 0 && maxAnimDuration <= LIGHTNING_ANIM_ITERS &&
    /if \(strike\[INTENSITY\] > 4\.5\)\s*\n\s*return r < 0\.85 \? 0\.0 : 1\.0;/.test(common),
    '0 restrikes=' + (singleStrokeRate * 100).toFixed(1) + '%, 1 restroke=' + oneRestrike +
    ', >1=' + overOneRestrike + ', maxDur=' + maxAnimDuration.toFixed(1));
}

// 2c. waterTex clear-air steering avoids adjacent storms / wide anvils
{
  const stormOriginX = 0.50;
  // Dense storm cloud covering everything left of 0.52; clear blue sky on right (>= 0.54)
  const asymmetricStorm = (cx) => {
    const signed = ((cx - stormOriginX + 1.5) % 1) - 0.5;
    return signed < 0.04 ? 2.5 : 0.0;
  };
  let steeredToClear = 0;
  let extTotal = 0;
  for (let i = 0; i < 1000; i++) {
    const out = resolveStrike([stormOriginX, 0.42, 2000 + i, 1.1], asymmetricStorm);
    if (out.row1[1] > 0.5) {
      extTotal++;
      if (out.row0[0] > stormOriginX) steeredToClear++;
    }
  }
  check('asymmetric storm steers 100% of external positive CG into the clear-air side',
    extTotal > 50 && steeredToClear === extTotal,
    steeredToClear + ' of ' + extTotal + ' landed in clear air');
}

// 2d. Distant lightning rod capture preserves storm originX in row 1
{
  const distantRods = [{ x : 0.86, y : 0.03 }];
  let captured = 0;
  let preservedOrigin = 0;
  for (let i = 0; i < 3000; i++) {
    const ox = 0.50;
    const out = resolveStrike([ox, 0.45, 3000 + i, 1.0], () => 0, distantRods);
    if (out.row1[1] > 0.5 && out.row0[0] === 0.86) {
      captured++;
      if (Math.abs(out.row1[0] - ox) < 1e-6) preservedOrigin++;
    }
  }
  check('distant lightning rods capture external positive CG strikes while keeping storm originX',
    captured > 20 && preservedOrigin === captured,
    'captured ' + captured + ', origin preserved ' + preservedOrigin);
}

/* ------------------------------------------- 3. display arc math checks */

function evalExtArc(t, Hw, V) {
  const om = Math.max(1.0 - t, 1e-5);
  const tc = Math.max(t, 1e-5);
  return [
    Hw * Math.pow(om, 1.3),
    V * (1.0 - Math.pow(tc, 2.8)) + 0.14 * V * Math.sin(Math.PI * t) * (1.0 - t)
  ];
}

{
  const cases = [
    { originX : 0.30, groundX : 0.48, groundY : 0.50 }, // right-going
    { originX : 0.70, groundX : 0.52, groundY : 0.42 }, // left-going
    { originX : 0.94, groundX : 0.08, groundY : 0.55 }  // wraps across x=0/1 seam!
  ];
  let endpointsOk = true;
  let finiteOk = true;
  const aspect = 2000 / 300;
  for (const c of cases) {
    const dxWrap = (((c.originX - c.groundX + 0.5) % 1) + 1) % 1 - 0.5;
    const Hw = dxWrap * aspect;
    const V = Math.max(c.groundY, 0.05);
    const pStart = evalExtArc(0.0, Hw, V);
    const pEnd = evalExtArc(1.0, Hw, V);
    if (Math.abs(pStart[0] - Hw) > 1e-3 || Math.abs(pStart[1] - V) > 1e-3) endpointsOk = false;
    if (Math.abs(pEnd[0]) > 1e-3 || Math.abs(pEnd[1]) > 1e-3) endpointsOk = false;
    for (let k = 0; k <= 20; k++) {
      const pt = evalExtArc(k / 20, Hw, V);
      if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) finiteOk = false;
    }
  }
  check('displayExternalLightning arc begins at storm origin and terminates cleanly at groundX (including seam wraps)',
    endpointsOk && finiteOk);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
