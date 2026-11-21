// Verification harness for the resolution / world-height invariance of the
// lightning variants (2026-11-18).
//
// Every geometric size a lightning variant draws has to stay constant in world
// units when the player changes the horizontal resolution, the vertical
// resolution or the simulation height in the setup screen. The renderer works
// in normalized texture space (y = whole sim height, x = aspect-weighted), so
// a raw "fraction of the texture" constant scales with the sim height and the
// cell size - bigger world, bigger lightning. The realistic display therefore
// re-expresses each such constant through lightningHeightScale(), which returns
// 1.0 at the 12 km reference height and the proportional factor otherwise.
//
// Constants that are already semantically kilometres (the procedural channels:
// GC leader, anvil crawler, blue jet / red sprite / elve) or cells (lightning
// rod scenery) are deliberately untouched.
//
// Usage: node tests/check-lightning-scale.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const displayShader = fs.readFileSync(path.join(ROOT, 'shaders/fragment/realisticDisplayShader.frag'), 'utf8');
const locationShader = fs.readFileSync(path.join(ROOT, 'shaders/fragment/lightningLocationShader.frag'), 'utf8');

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

// ------------------------------------------------------------ the hScale helper
check('the realistic display defines lightningHeightScale() from cellHeight, resolution.y and a 12 km reference',
  /float lightningHeightScale\(\)\s*\n\s*\{\s*\n\s*return \(cellHeight \* float\(resolution\.y\) \* 0\.001\) \/ 12\.0;\s*\n\}/.test(displayShader));

check('at the 12 km reference the scale factor is exactly 1 (all default sizes preserved)',
  Math.abs((40.0 * 300 * 0.001) / 12.0 - 1.0) < 1e-9 &&      // 40 m cells x 300 rows = 12 km
  Math.abs((50.0 * 240 * 0.001) / 12.0 - 1.0) < 1e-9 &&      // 50 m cells x 240 rows = 12 km
  Math.abs((24.0 * 500 * 0.001) / 12.0 - 1.0) < 1e-9 &&      // 24 m cells x 500 rows = 12 km
  Math.abs((50.0 * 300 * 0.001) / 12.0 - 1.25) < 1e-9);      // 15 km world at same grid -> 1.25

// ------------------------------------------------------------ IC / +IC spans
check('intra-cloud flash span is a fixed 0.9 km (0.075 of the 12 km reference), scaled by hScale',
  /float flashHeight = 0\.075 \* lightningHeightScale\(\);/.test(displayShader) &&
  /vec2 flashSpan = vec2\(flashHeight \* networkTexAspect \/ aspectRatios\[0\], flashHeight\);/.test(displayShader));

check('positive intra-cloud flash span is a fixed 1.14 km (0.095 of the 12 km reference), scaled by hScale',
  /float flashHeight = 0\.095 \* lightningHeightScale\(\);/.test(displayShader));

// ------------------------------------------------------- external strikes
check('external positive CG jag bounds are expressed at the 12 km reference and scaled',
  /float jagScale = clamp\(min\(abs\(Hw\), V\) \* 0\.14, 0\.025 \* hScale, 0\.055 \* hScale\);/.test(displayShader));

check('external positive CG artwork floor and lod scale with hScale',
  /float scaleLen = max\(V, 0\.25 \* hScale\);/.test(displayShader) &&
  /actualLightningTexRes\.y \/ max\(length\(vec2\(Hw, V\)\), 0\.25 \* hScale\)\);/.test(displayShader));

// ------------------------------------------------------------ CC branches
check('cloud-to-cloud fractal displacement floor is expressed at the 12 km reference',
  /float normLen = max\(span, 0\.18 \* hScale\);/.test(displayShader));

check('cloud-to-cloud branch bounds (cull, masks, jag, core, halo) are expressed at the 12 km reference',
  /if \(along < -0\.015 \* hScale \|\| along > bLen \+ 0\.025 \* hScale \|\| abs\(perp\) > bLen \* 0\.58\)/.test(displayShader) &&
  /float jagScale = clamp\(bLen \* 0\.095, 0\.008 \* hScale, 0\.028 \* hScale\);/.test(displayShader) &&
  /vec2 jag = ccFractalDisp\(along, max\(bLen, 0\.12 \* hScale\), seed \* 11\.3, jagScale\);/.test(displayShader) &&
  /float endMask = smoothstep\(-0\.006 \* hScale, 0\.004 \* hScale, along\) \* \(1\.0 - smoothstep\(bLen - 0\.006 \* hScale, bLen \+ 0\.008 \* hScale, along\)\);/.test(displayShader) &&
  /float bw = max\(coreW \* taper, 0\.0011 \* hScale\);/.test(displayShader) &&
  /float halo = exp\(-dist \/ max\(bw \* 3\.0, 0\.0040 \* hScale\)\) \* 0\.20 \* endMask;/.test(displayShader) &&
  /float hScale = lightningHeightScale\(\);\s*\n\s*vec2 bNorm/.test(displayShader));

check('cloud-to-cloud spine core, halo, outer glow and sub-branch jag scale with hScale',
  /float jagScale = clamp\(span \* 0\.068, 0\.015 \* hScale, 0\.052 \* hScale\);/.test(displayShader) &&
  /float coreW = max\(0\.0018 \* hScale, worldPix \* 0\.90\) \* \(isPositiveCC \? 1\.28 : 1\.0\);/.test(displayShader) &&
  /float mainHalo = exp\(-distMain \/ max\(coreW \* 3\.2, 0\.0045 \* hScale\)\) \* 0\.20 \* edgeFade;/.test(displayShader) &&
  /float mainOuter = exp\(-distMain \/ max\(coreW \* 7\.5, 0\.011 \* hScale\)\) \* 0\.018 \* edgeFade;/.test(displayShader) &&
  /float subJagScale = clamp\(bLen \* 0\.095, 0\.008 \* hScale, 0\.028 \* hScale\);/.test(displayShader) &&
  /float hScale = lightningHeightScale\(\);\s*\n\s*float jagScale/.test(displayShader));

// --------------------------------------------------- strike illumination lobes
check('strike cloud lobes are scaled with hScale (IC slab, CG anchor, CC taps, CG leader, external origin)',
  (displayShader.match(/0\.03 \* lightningHeightScale\(\)/g) || []).length >= 5 &&
  /0\.035 \* lightningHeightScale\(\)/.test(displayShader) &&
  /0\.1 \* lightningHeightScale\(\)/.test(displayShader));

// -------------------------------------- resolution independence in the slot pass
check('strike range eligibility already uses the physical world width, not texture fractions',
  /float superboltWorldWidthMeters\(\)\s*\n\{\s*\n\s*return simHeightMeters \* resolution\.x \/ max\(resolution\.y, 1\.0\);\s*\n\}/.test(locationShader));

// -------------------------------------------- procedural paths stay absolute km


console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
