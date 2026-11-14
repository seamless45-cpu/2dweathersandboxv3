// Verification harness for:
//   1. Fullscreen Mode toggle in dat.GUI Display folder (display_folder)
//   2. WebGL2 / shader / DOM performance optimizations
//   3. Superbolt positive lightning (7.2% chance, 12x brighter, 0.1s shorter,
//      40 Hz random-axis decaying camera shake only for superbolts)
//
// Usage: node tests/check-superbolt-fullscreen-perf.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const locationShader = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'lightningLocationShader.frag'), 'utf8');
const displayShader = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'realisticDisplayShader.frag'), 'utf8');
const common = fs.readFileSync(path.join(ROOT, 'shaders', 'common.glsl'), 'utf8');

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
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const glslMod = (x, y) => x - y * Math.floor(x / y);

/* ------------------------------------------- 1. Fullscreen Mode in Display */

check('guiControls_default initializes fullscreenMode to false',
  /fullscreenMode\s*:\s*false/.test(appSource));

check('Display folder adds Fullscreen Mode toggle bound to guiControls.fullscreenMode',
  /fullscreenModeController\s*=\s*display_folder\.add\(guiControls,\s*'fullscreenMode'\)\s*\n\s*\.name\('Fullscreen Mode'\)\s*\n\s*\.listen\(\)\s*\n\s*\.onChange\(function\(enabled\)\s*\{\s*\n\s*void setFullscreenMode\(enabled\);\s*\n\s*\}\);/.test(appSource));

check('setFullscreenMode targets documentElement and syncs on fullscreenchange/resetSettings',
  /const target = document\.documentElement;/.test(appSource) &&
  /target\.requestFullscreen \|\| target\.webkitRequestFullscreen/.test(appSource) &&
  /document\.exitFullscreen \|\| document\.webkitExitFullscreen/.test(appSource) &&
  /document\.addEventListener\('fullscreenchange', syncFullscreenControl\);/.test(appSource) &&
  /document\.addEventListener\('webkitfullscreenchange', syncFullscreenControl\);/.test(appSource) &&
  /guiControls\.fullscreenMode = isDocumentFullscreen\(\);/.test(appSource) &&
  /guiControls\.resetSettings[\s\S]{0,250}setFullscreenMode\(false\)/.test(appSource));

/* ------------------------------------------- 2. Performance optimizations */

const drawBlockMatch = appSource.match(/function draw\(\)[\s\S]*$/);
const drawBlock = drawBlockMatch ? drawBlockMatch[0] : '';

check('WeakMap uniform location cache getUniformLoc eliminates hot driver lookups',
  /const uniformLocationCache = new WeakMap\(\);/.test(appSource) &&
  /function getUniformLoc\(program, name\)/.test(appSource) &&
  drawBlock.length > 0 &&
  !/gl\.getUniformLocation\(/.test(drawBlock));

check('ambientLightDirty skips redundant 44-pass ambient light blur when emitted light did not update',
  /let ambientLightDirty = true;/.test(appSource) &&
  /if \(ambientLightDirty\) \{\s*\/\/\s*Ambient Light Calculation/.test(appSource) &&
  /ambientLightDirty = false;/.test(appSource));

check('rodUploadedVersion avoids redundant lightning rod uniform uploads when rods have not changed',
  /const rodUploadedVersion = new WeakMap\(\);/.test(appSource) &&
  /if \(rodUploadedVersion\.get\(program\) === lightningRodsVersion\)\s*\n\s*return;/.test(appSource));

check('realisticDisplayShader.frag reuses fetched field state in computeAirColor and skips sky/underground wasted fetches',
  /vec4 computeAirColor\(vec2 bndFragCoord\)/.test(displayShader) &&
  /vec4 airColor = computeAirColor\(bndFragCoord\);/.test(displayShader) &&
  /if \(texCoord\.y > 1\.0\) \{[\s\S]{0,120}if \(rodCount == 0\)/.test(displayShader) &&
  /function updateDiagnosticOverlays\(\)\s*\{[\s\S]{0,650}if \(!capeMode/.test(appSource) &&
  /const precipSampleValues = new Float32Array\(4\);/.test(appSource) &&
  /gl\.viewport\(0, 0, bloomFBOs\[0\]\.width, bloomFBOs\[0\]\.height\)/.test(appSource) &&
  !/\bbloomFBO\./.test(appSource) &&
  !/gl\.bindTexture\(gl\.TEXTURE_2D, bloomFBOs\[0\]\.texture\);\s*\n\s*gl\.texParameteri/.test(appSource));

/* ------------------------------------------- 3. Superbolt positive CG */

check('only external positive CG can receive the 7.2% superbolt flag',
  /bool isSuperboltExt = superboltWorldWidthMeters\(\) \* 0\.4999 >= 9000\.0 &&/.test(locationShader) &&
  /random2d\(vec2\(originX \* 89\.3 \+ incoming\.y \* 47\.1, iterNum \* 1\.13\)\) < 0\.072/.test(locationShader) &&
  /vec4\(originX, 1\.0, 0\.0, isSuperboltExt \? 1\.0 : 0\.0\)/.test(locationShader) &&
  /vec4\(originX, 0\.0, 0\.0, 0\.0\)/.test(locationShader) &&
  !/isSuperboltCG/.test(locationShader));

check('superbolts are blue 52000 K external strikes, 12x brighter and 0.1s shorter',
  /bool isSuperbolt = isExternalPositive && lightningMeta\.w >= 0\.5;/.test(displayShader) &&
  /const float superboltBrightnessMult = 12\.0;/.test(displayShader) &&
  /const float superboltDurationShorten = 0\.1;/.test(displayShader) &&
  /const vec3 superboltColor = vec3\(0\.332, 0\.469, 1\.0\);/.test(displayShader) &&
  /isSuperbolt \? superboltColor : positiveLightningCol/.test(displayShader) &&
  /vec3 lightningIlluminationTint = isSuperbolt \? superboltColor : vec3\(1\.0\)/.test(displayShader) &&
  /lightningTime >= repeatPeriod \* lightningFlickers\(lightningData\) \+ \(2\.924 - superboltDurationShorten\)/.test(displayShader) &&
  /if \(isSuperbolt\)\s*\n\s*lightningOnLight \*= superboltBrightnessMult;/.test(displayShader));

check('app.js implements 40 Hz decaying random-axis camera shake triggered only by superbolts (even when sound is off)',
  /const SUPERBOLT_SHAKE_HZ = 40\.0;/.test(appSource) &&
  appSource.indexOf('let superboltShakeStartTimeMs = -1;') < appSource.indexOf('async function setupTextures()') &&
  /const superboltCheckDue = lightningReadbackTick;/.test(appSource) &&
  /if \(lightningDataValues\[metaOffset \+ 3\] >= 0\.5\)/.test(appSource) &&
  /Math\.exp\(-SUPERBOLT_SHAKE_DECAY_PER_SEC \* elapsedSec\)/.test(appSource) &&
  /Math\.sin\(2\.0 \* Math\.PI \* phaseCycles\)/.test(appSource) &&
  /Math\.cos\(angle\)/.test(appSource) &&
  /Math\.sin\(angle\)/.test(appSource) &&
  /const renderViewX = cam\.curXpos \+ shakeOffset\.x;/.test(appSource) &&
  /const renderViewY = cam\.curYpos \+ shakeOffset\.y;/.test(appSource));

// Distribution of the independent superbolt roll, only after external classification.
{
  let extTotal = 0, extSuperbolts = 0, otherSuperbolts = 0;
  for (let i = 0; i < 100000; i++) {
    const ox = fract(0.11 + i * 0.01731);
    const oy = 0.22 + ((i * 0.031) % 0.45);
    const iter = 400 + i;
    const isExt = random2d(ox * 31.7 + oy * 59.3, iter * 0.73) < 0.18;
    const sb = isExt && random2d(f32(ox * 89.3 + oy * 47.1), f32(iter * 1.13)) < 0.072;
    if (isExt) { extTotal++; if (sb) extSuperbolts++; }
    else if (sb) otherSuperbolts++;
  }
  const rate = extSuperbolts / extTotal;
  check('superbolt share is approximately 7.2% of external CG and zero for other types',
    otherSuperbolts === 0 && rate >= 0.064 && rate <= 0.080,
    (rate * 100).toFixed(2) + '% of ' + extTotal);
}

// Exercise world-height scaling, periodic seams, narrow worlds, and rods that
// attempt to move endpoints outside the allowed range. Mirrors the shader math.
{
  check('physical range and rod checks are wired to the configured sim height',
    /uniform float simHeightMeters;/.test(locationShader) &&
    /simHeightMeters \* resolution\.x \/ max\(resolution\.y, 1\.0\)/.test(locationShader) &&
    /float minDx = 9000\.0 \/ widthMeters;/.test(locationShader) &&
    /float maxDx = min\(42000\.0 \/ widthMeters, 0\.4999\);/.test(locationShader) &&
    /rodRangeMeters >= 9000\.0 && rodRangeMeters <= 42000\.0/.test(locationShader) &&
    /uniform1f\(gl\.getUniformLocation\(lightningLocationProgram, 'simHeightMeters'\), guiControls\.simHeight\)/.test(appSource));
  const wrappedDist = (a,b) => Math.abs(glslMod(a - b + 0.5, 1) - 0.5);
  let valid = true, minFound = Infinity, maxFound = 0, crossing = false;
  for (const [height, rx, ry] of [[12000, 2000, 300], [5000, 1000, 200], [15000, 1600, 200]]) {
    const width = height * rx / ry;
    const lo = 9000 / width, hi = Math.min(42000 / width, 0.4999);
    for (let i = 0; i <= 1000; i++) {
      const origin = i % 2 ? 0.99 : 0.01;
      const target = fract(origin + (i % 3 ? 1 : -1) * mix(lo, hi, i / 1000));
      const distance = wrappedDist(origin, target) * width;
      valid &&= distance >= 8999.999 && distance <= 42000.001;
      crossing ||= Math.abs(origin - target) > 0.5;
      minFound = Math.min(minFound, distance); maxFound = Math.max(maxFound, distance);
      for (const rod of [origin, fract(origin + 0.125), fract(origin + 0.49)]) {
        const rodDistance = wrappedDist(origin, rod) * width;
        const final = rodDistance >= 9000 && rodDistance <= 42000 ? rod : target;
        const finalDist = wrappedDist(origin, final) * width;
        valid &&= finalDist >= 8999.999 && finalDist <= 42000.001;
      }
    }
  }
  check('9–42 km distances hold at multiple heights, across seams and after rod capture',
    valid && crossing && Math.abs(minFound - 9000) < 0.001 && Math.abs(maxFound - 42000) < 0.001);
  check('narrow periodic worlds reject superbolts instead of violating minimum distance',
    18000 * 0.4999 < 9000 && 20000 * 0.4999 >= 9000);
}

// Independently integrate a 52,000 K Planck spectrum against analytic CIE
// 1931 matching functions, then convert XYZ to linear sRGB (D65 primaries).
{
  const gauss = (w, mu, left, right) => Math.exp(-0.5 * ((w - mu) * (w < mu ? left : right)) ** 2);
  let X = 0, Y = 0, Z = 0;
  for (let w = 360; w <= 830; w++) {
    const x = 1.056 * gauss(w, 599.8, 0.0264, 0.0323) + 0.362 * gauss(w, 442.0, 0.0624, 0.0374) - 0.065 * gauss(w, 501.1, 0.0490, 0.0382);
    const y = 0.821 * gauss(w, 568.8, 0.0213, 0.0247) + 0.286 * gauss(w, 530.9, 0.0613, 0.0322);
    const z = 1.217 * gauss(w, 437.0, 0.0845, 0.0278) + 0.681 * gauss(w, 459.0, 0.0385, 0.0725);
    const wavelength = w * 1e-9;
    const radiance = wavelength ** -5 / Math.expm1(0.01438776877 / (wavelength * 52000));
    X += x * radiance; Y += y * radiance; Z += z * radiance;
  }
  const red = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const green = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const blue = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  const match = displayShader.match(/const vec3 superboltColor = vec3\(([\d.]+), ([\d.]+), ([\d.]+)\)/);
  check('superbolt linear RGB approximates a 52000 K Planck spectrum',
    !!match && Math.abs(+match[1] - red / blue) < 0.01 &&
    Math.abs(+match[2] - green / blue) < 0.01 && +match[3] === 1);
}

// Duration & brightness math check: peak ignition at T=0 is 12x, ends 0.1s earlier (T=2.824)
{
  const HDR_CEILING = 60000.0;
  const softHdrClamp = (v) => HDR_CEILING * (1.0 - Math.exp(-Math.max(v, 0) / HDR_CEILING));
  const intensityCurve = (T, pos, I) => {
    const rp = mapRange(random2d(pos[0], pos[1]), 0, 1, 1.5, 3.0);
    const nf = I > 4.5 ? (random2d(f32(pos[0] * 2.737250), f32(pos[1] * 2.737250)) < 0.85 ? 0 : 1) : 0;
    const minT = Math.max(T - rp * nf, 0);
    const curT = Math.max(glslMod(T, rp), minT);
    return Math.max(1 / (0.05 + Math.pow(curT * 2.0, 3)) - 0.005, 0) * Math.pow(I, 2);
  };
  const pos = [0.41, 0.33];
  const I = 5.0;
  const normalPeak = intensityCurve(0.0, pos, I);
  const superPeak = intensityCurve(0.0, pos, I) * 12.0;
  const effectiveT = (T) => T > 0 ? T + 0.1 * smoothstep(0.0, 0.35, T) : 0.0;
  const normalAt283 = intensityCurve(2.83, pos, I);
  const superAt283 = 2.83 >= (2.924 - 0.1) ? 0.0 : intensityCurve(effectiveT(2.83), pos, I) * 12.0;

  check('superbolt ignites at 12x peak at T=0, clamps finitely in softHdrClamp, and shuts off 0.1s earlier (T >= 2.824)',
    Math.abs(superPeak / normalPeak - 12.0) < 1e-9 &&
    Number.isFinite(softHdrClamp(superPeak * 200000)) &&
    softHdrClamp(superPeak * 200000) <= HDR_CEILING &&
    normalAt283 > 0 && superAt283 === 0.0,
    'ratio=' + (superPeak / normalPeak) + ', normalAt283=' + normalAt283 + ', superAt283=' + superAt283);
}

// Camera shake waveform & decay check: 40 Hz, random axes, decaying to 0, non-superbolts untouched
{
  const SUPERBOLT_SHAKE_HZ = 40.0;
  const SUPERBOLT_SHAKE_DECAY_PER_SEC = 7.5;
  const SUPERBOLT_SHAKE_DURATION_MS = 650.0;
  const SUPERBOLT_SHAKE_PEAK_AMP = 0.024;
  const hashShakeStep = (seed, step) => {
    const s = Math.sin(seed * 12.9898 + step * 78.233) * 43758.5453123;
    return s - Math.floor(s);
  };
  function evalShake(elapsedMs, seed, canvasAspect = 16 / 9, zoom = 1.0) {
    if (elapsedMs < 0 || elapsedMs >= SUPERBOLT_SHAKE_DURATION_MS) return { x: 0, y: 0 };
    const elapsedSec = elapsedMs * 0.001;
    const decay = Math.exp(-SUPERBOLT_SHAKE_DECAY_PER_SEC * elapsedSec);
    const phaseCycles = elapsedSec * SUPERBOLT_SHAKE_HZ;
    const wave = Math.sin(2.0 * Math.PI * phaseCycles);
    const angle = hashShakeStep(seed, Math.floor(phaseCycles)) * Math.PI * 2.0;
    const amp = SUPERBOLT_SHAKE_PEAK_AMP * decay * wave;
    const denom = Math.max(canvasAspect, 0.1) * Math.max(zoom, 0.5);
    return { x: (amp * Math.cos(angle)) / denom, y: (amp * Math.sin(angle)) / denom };
  }

  // Quarter cycle of 40 Hz is 6.25 ms -> peak positive; three-quarter cycle 18.75 ms -> peak negative
  const pQuarter = evalShake(6.25, 123.456);
  const pThreeQuarter = evalShake(18.75, 123.456);
  const pLater = evalShake(306.25, 123.456);
  const pDone = evalShake(650.0, 123.456);
  const magQuarter = Math.hypot(pQuarter.x, pQuarter.y);
  const magLater = Math.hypot(pLater.x, pLater.y);

  // Verify multiple cycles hit diverse random axes
  const angles = new Set();
  for (let c = 0; c < 12; c++) {
    const s = evalShake(c * 25.0 + 6.25, 777.0);
    angles.add(Math.atan2(s.y, s.x).toFixed(3));
  }

  check('40 Hz superbolt camera shake oscillates at 40 Hz across random axes, decays, and returns to 0',
    magQuarter > 0.01 &&
    (pQuarter.x * pThreeQuarter.x + pQuarter.y * pThreeQuarter.y) < 0 &&
    magLater > 0 && magLater < magQuarter * 0.15 &&
    pDone.x === 0 && pDone.y === 0 &&
    angles.size >= 10,
    'mag6.25ms=' + magQuarter.toFixed(5) + ', mag306.25ms=' + magLater.toFixed(5) + ', distinctAxes=' + angles.size);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
