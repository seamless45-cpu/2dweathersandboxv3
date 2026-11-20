// Lightning branch anti-aliasing harness.
//
// Procedural side branches (ccEvalBranch) used to shape coverage with a
// distance-based smoothstep whose width was fixed in world units. When the
// branch is narrower than a screen pixel - the common case at zoomed-out and
// mid zooms, and always for the decimetre-scale forks - a pixel straddling
// the edge snapped between 0 and 1, so channels dissolved into stair-stepped
// dashes that crawled as the storm moved. The core is now filtered over the
// pixel footprint with a 0.75-pixel Gaussian (the channelGlow idiom), which
// keeps coverage continuous and preserves integrated energy exactly:
//
//     sum over the line of core(dist)  ==  bw * sqrt(pi)   for any aa >= 0
//
// This file pins the shader formula and verifies that invariant numerically
// across a range of pixel footprints (zoom levels), plus the call-site
// contract (every call passes its pixel footprint, derivatives are never
// called inside the divergent branch loop).
//
// Usage:  node tests/check-lightning-antialias.js

'use strict';

const fs = require('fs');

const display = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag', 'utf8');

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('OK  ', name);
  } else {
    fail++;
    console.log('FAIL', name, detail === undefined ? '' : '- ' + detail);
  }
}

// ---------------------------------------------------------------------
// 1. shader pins: the unfiltered core must be gone; the filtered one present
// ---------------------------------------------------------------------
check('branch core is footprint-filtered, not a fixed world-space smoothstep',
  !/smoothstep\(bw \* 1\.45/.test(display) &&
  /float aa = max\(pixelT, 1e-6\);/.test(display) &&
  /float f2 = bw \* bw \+ 0\.5625 \* aa \* aa;/.test(display) &&
  /float core = exp\(-dist \* dist \* invF \* invF\) \* clamp\(bw \* invF, 0\.0, 1\.0\) \* endMask;/.test(display));

check('cloud-to-cloud main channel core is footprint-filtered too',
  !/smoothstep\(coreW \* 1\.50/.test(display) &&
  /float mainInvF = inversesqrt\(mainF2\);/.test(display) &&
  /float mainCore = exp\(-distMain \* distMain \* mainInvF \* mainInvF\)/.test(display));

check('ccEvalBranch takes the pixel footprint as its last argument',
  /vec2 ccEvalBranch\(vec2 target, vec2 bStart, vec2 bDir, float bLen, float curveSign,\s*\n\s*float seed, float coreW, float weight, float pixelT\)/.test(display));

{
  const calls = display.match(/ccEvalBranch\(/g) || [];
  const definition = 1; // the definition itself
  const callSites = calls.length - definition;
  // Every call must pass a footprint expression as its final argument.
  const argPattern = /,\s*(pixelKm|worldPix|branchPixelT|max\(length\(vec2\(screenTexDx\.x \* aspectRatios\[0\], screenTexDx\.y\)\), length\(vec2\(screenTexDy\.x \* aspectRatios\[0\], screenTexDy\.y\)\)\) \* (heightKm|icHeightKm|picHeightKm)|max\(length\(vec2\(screenTexDx\.x \* aspectRatios\[0\], screenTexDx\.y\)\),\s*\n?\s*length\(vec2\(screenTexDy\.x \* aspectRatios\[0\], screenTexDy\.y\)\)\))\s*\)/g;
  const good = (display.match(argPattern) || []).length;
  check('all ' + callSites + ' branch call sites pass their pixel footprint', good === callSites,
        good + ' of ' + callSites + ' matched');
}

{
  const body = display.slice(display.indexOf('vec2 ccEvalBranch('), display.indexOf('vec3 displayLightning('));
  check('no derivative calls inside the branch evaluator',
        !/fwidth\s*\(|dFdx\s*\(|dFdy\s*\(/.test(body));
}

check('channel identity pins survive (end mask, halo, jag all unchanged)',
  /float endMask = smoothstep\(-0\.006 \* hScale, 0\.004 \* hScale, along\) \* smoothstep\(bLen \+ 0\.008 \* hScale, bLen - 0\.006 \* hScale, along\);/.test(display) &&
  /float halo = exp\(-dist \/ max\(bw \* 3\.0, 0\.0040 \* hScale\)\) \* 0\.20 \* endMask;/.test(display) &&
  /vec2 jag = ccFractalDisp\(along, max\(bLen, 0\.12 \* hScale\), seed \* 11\.3, jagScale\);/.test(display));

// ---------------------------------------------------------------------
// 2. the GLSL formula, evaluated in JS across zoom levels
// ---------------------------------------------------------------------
function coreSample(dist, bw, aa) {
  const f2 = bw * bw + 0.5625 * aa * aa;
  const invF = 1 / Math.sqrt(f2);
  return Math.exp(-dist * dist * invF * invF) * Math.min(1, Math.max(0, bw * invF));
}

// Integrated energy across the channel centreline must equal bw*sqrt(pi)
// regardless of the pixel footprint (the filtered Gaussian normalisation).
let energyHolds = true;
let worstRatio = 0;
for (const bw of [0.0004, 0.001, 0.003, 0.008, 0.02]) {
  for (const aa of [0.00001, 0.0005, 0.002, 0.01, 0.05, 0.2]) {
    const limit = Math.max(8 * Math.sqrt(bw * bw + 0.5625 * aa * aa), 0.05);
    let sum = 0;
    const step = limit / 2000;
    for (let d = -limit; d <= limit; d += step)
      sum += coreSample(d, bw, aa) * step;
    const ratio = sum / (bw * Math.sqrt(Math.PI));
    worstRatio = Math.max(worstRatio, Math.abs(1 - ratio));
    if (!(ratio > 0.985 && ratio < 1.015))
      energyHolds = false;
  }
}
check('filtered core preserves integrated energy at every zoom level', energyHolds,
      'worst deviation ' + (worstRatio * 100).toFixed(2) + '%');

// Peak amplitude: a wide (near) branch reads as a solid line, a sub-pixel
// branch must dim smoothly - never binary.
check('near zoom keeps full peak, sub-pixel zoom dims proportionally',
  coreSample(0, 0.01, 0.0001) > 0.999 &&
  coreSample(0, 0.001, 0.05) < 0.05 &&
  coreSample(0, 0.001, 0.01) < 0.15);

// Continuity across the edge: no 0->1 snapping between neighbouring pixels.
// A filtered profile must pass through intermediate coverage bands, so no
// pixel can snap from empty to full across the channel edge.
let intermediateFound = true;
let worstBand = 1;
for (const bw of [0.0004, 0.001, 0.003, 0.01]) {
  for (const aa of [0.0005, 0.005, 0.05]) {
    const peak = coreSample(0, bw, aa);
    let band = 0;
    for (let d = 0; d <= 0.2; d += 0.0004) {
      const r = coreSample(d, bw, aa) / peak;
      if (r > 0.15 && r < 0.85) band++;
    }
    worstBand = Math.min(worstBand, band);
    if (band === 0) intermediateFound = false;
  }
}
check('filtered profile has a real transition band at every zoom (no 0-to-full snap)',
  intermediateFound, 'min intermediate samples ' + worstBand);

// A sub-pixel branch still contributes nonzero, phase-independent light:
// averaging over subpixel phases must not produce dashes.
let phaseLeak = true;
for (const bw of [0.0004, 0.001, 0.002]) {
  for (const phase of [-0.5, -0.25, 0, 0.25, 0.5]) {
    const aa = 0.003; // ~2-6 m pixels at 12 km world scale
    const atPixel = coreSample(Math.abs(phase * 0.003), bw, aa);
    if (!(atPixel > 0 && atPixel < coreSample(0, bw, aa) + 1e-6))
      phaseLeak = false;
  }
}
check('sub-pixel branches shade every phase of sub-pixel placement (no dashes)', phaseLeak);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
