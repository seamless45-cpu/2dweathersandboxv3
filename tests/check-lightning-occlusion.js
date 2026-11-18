'use strict';
// Lightning does not shine through terrain, and the CC/IC halo is a smooth,
// continuous falloff. These are the contracts this suite pins:
//
//   - Solid-terrain pixels (land, lake water, city/runway/fire/industrial/inert
//     walls, and everything below the simulation area) keep their own colour
//     and receive no emitted lightning light at all. The one air-rendered
//     exception - the band above a lake's waterline - keeps the lightning.
//   - The CC halo and outer sheath are pure perpendicular exponentials; they
//     no longer inherit the triangle-wave spine derivative, which quantized
//     the slope-corrected distance into crease bands (the ragged edge).
//   - Both IC polarities split the artwork into the preserved coverage core
//     and a separate soft glow band sampled two mip levels down through one
//     wide continuous ramp.
//   - The ground-to-cloud leader and the anvil crawler render the shared CG
//     artwork tile, projection, coverage curve and violet channel colour
//     (lightningTex), keeping only their own animation staging.
const fs = require('fs');
const display = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag', 'utf8');
let failed = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }

const clearSites = (display.match(/emittedLight = vec3\(0\.0\); \/\/ opaque terrain foreground/g) || []).length;
check('every opaque terrain foreground clears the flash accumulated behind it (7 sites)',
  clearSites === 7,
  'found ' + clearSites + ' sites (water-case shore slopes 2, urban/industrial overlays 2, tree/snow overlay 1, air-branch land slopes 2)');
check('the rod pass composites its corona and strike surge AFTER the opaque foreground is resolved, so rod glow still composites over the ground',
  display.indexOf('vec2 rod = rodPositions[i];') >
  display.lastIndexOf('// opaque terrain foreground'));
check('the final composite itself adds no gate: the rod glow is the deliberate exception for solid terrain',
  !/terrainOccluded/.test(display));
check('wall and below-simulation pixels never call the air path, so they accumulate no flash to begin with',
  (display.match(/computeAirColor\(bndFragCoord\)/g) || []).length === 2 &&
  (display.match(/getAirColor\(fragCoord \+ vec2\(0\., 0\.5\)\)/g) || []).length === 1);

check('CC main halo and outer sheath are pure perpendicular exponentials of |perp|',
  /float glowDist = abs\(dPerp\);/.test(display) &&
  /float mainHalo = exp\(-glowDist \/ max\(coreW \* 3\.2, 0\.0045\)\) \* 0\.20 \* edgeFade;/.test(display) &&
  /float mainOuter = exp\(-glowDist \/ max\(coreW \* 7\.5, 0\.011\)\) \* 0\.018 \* edgeFade;/.test(display) &&
  !/mainHalo = exp\(-distMain/.test(display) && !/mainOuter = exp\(-distMain/.test(display));
check('CC branch halo is a pure perpendicular exponential too',
  /float halo = exp\(-abs\(perp - centerPerp\) \/ max\(bw \* 3\.0, 0\.0040\)\) \* 0\.20 \* endMask;/.test(display) &&
  !/halo = exp\(-dist \/ max\(bw \* 3\.0/.test(display));

check('both IC polarities split the coverage core from a smooth two-mip-blurred glow band',
  (display.match(/textureGrad\(lightningNetworkTex, flashCoord, gradX \* 4\.0, gradY \* 4\.0\)\.r/g) || []).length === 2 &&
  (display.match(/pow\(smoothstep\(0\.004, 0\.42, glowSrc\), 2\.0\) \* 0\.34/g) || []).length === 2 &&
  (display.match(/min\(lightningCoverage\(pixVal, brightnessThreshold\) \+ glow, 1\.0\)/g) || []).length === 2);

check('the upward GC renders the CG artwork tile through the CG projection and violet',
  /vec2 lightningTexCoord;[\s\S]{0,140}lightningTexCoord\.x = texCoord\.x - pos\.x;/.test(display) &&
  /textureGrad\(lightningTex, lightningTexCoord, gradX, gradY\)\.r/.test(display) &&
  /const vec3 lightningCol = vec3\(0\.70, 0\.57, 1\.0\)/.test(display) &&
  /gcLeaderClock/.test(display) && /float returnClock = clamp\(\(time - 0\.78\) \/ 0\.25, 0\.0, 1\.0\)/.test(display));
check('the anvil crawler renders the CG artwork tile for the feeder and every lane',
  (display.match(/textureLod\(lightningTex, vec2\(u, v\), lod\)/g) || []).length === 3 &&
  /vec3\(0\.70, 0\.57, 1\.0\) \* crawler/.test(display) &&
  /float feederRise = clamp\(time \/ 0\.34, 0\.0, 1\.0\)/.test(display));

console.log('\n' + (failed ? 'FAILED' : 'OK'));
if (failed) process.exitCode = 1;
