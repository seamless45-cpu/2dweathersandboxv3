'use strict';
// Lightning does not shine through opaque terrain foregrounds. This suite pins
// that contract only; it says nothing about how any channel is drawn:
//
//   - Wall faces and everything below the simulation area never call the air
//     path, so they accumulate no flash to begin with.
//   - Every place an opaque terrain foreground overwrites the air - the 45°
//     slope triangles at shorelines and ridge edges, urban and industrial
//     silhouettes, the tree canopy and its snow caps - drops the flash the
//     air behind it accumulated, before the final composite runs.
//   - The rod's own light (tip corona, surge down the mast) composites
//     afterwards, so the mast stands in front of the terrain by design.
const fs = require('fs');
const display = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag', 'utf8');
let passed = 0, failed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : (detail ? '\n     ' + detail : '')));
  if (ok) passed++; else failed++;
}

const clearSites = (display.match(/emittedLight = vec3\(0\.0\); \/\/ opaque terrain foreground/g) || []).length;
check('every opaque terrain foreground clears the flash accumulated behind it (7 sites)',
  clearSites === 7,
  'found ' + clearSites + ' sites (water-case shore slopes 2, urban/industrial overlays 2, tree/snow overlay 1, air-branch land slopes 2)');
check('the rod pass composites its corona and strike surge AFTER the opaque foreground is resolved, so rod glow still composites over the ground',
  display.indexOf('vec2 rod = rodPositions[i];') >
  display.lastIndexOf('// opaque terrain foreground'));
check('the composite choke point carries no occlusion gate that would also drop the rod glow',
  !/if \(terrainOccluded\)/.test(display));
check('wall and below-simulation pixels never call the air path, so they accumulate no flash to begin with',
  (display.match(/computeAirColor\(bndFragCoord\)/g) || []).length === 2 &&
  (display.match(/getAirColor\(fragCoord \+ vec2\(0\., 0\.5\)\)/g) || []).length === 1);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
