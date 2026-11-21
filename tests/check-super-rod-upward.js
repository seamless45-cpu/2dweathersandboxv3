'use strict';
// Ground-to-cloud initiation, 2.5-fold attraction, and slot/render integration.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('app.js');
const location = read('shaders/fragment/lightningLocationShader.frag');
const display = read('shaders/fragment/realisticDisplayShader.frag');
const common = read('shaders/common.glsl');
let passed = 0, failed = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (ok) passed++; else failed++; }

check('super rods scale base attraction radius by 2.5 while keeping height and current factors',
  /const SUPER_LIGHTNING_ROD_REACH_MULT = 2\.5;/.test(app) &&
  /rodTypes\[rodIdx\] > 0\.5 \? 2\.5 : 1\.0/.test(location) &&
  /return rodAttractRadius \* reachMultiplier \* heightFactor \* currentFactor;/.test(location) &&
  /cursorType >= 5\.0 \? SUPER_LIGHTNING_ROD_REACH_MULT : 1\.0/.test(app));
// Preview shows base reach (currently below its cap) and is clipped at tile
// edges; actual capture also depends on mast height and strike current.
const normalRadius = 0.11 * 1.1 * 1.1, superRadius = 0.11 * 2.5 * 1.1 * 1.1;
check('2.5-fold base reach does not capture across the world edge',
  Math.abs(superRadius / normalRadius - 2.5) < 1e-12 && superRadius < 0.5 &&
  Math.abs(0.99 - 0.01) > superRadius && /return abs\(a - b\)/.test(location) &&
  /Math\.min\(0\.5, LIGHTNING_ROD_ATTRACT_RADIUS/.test(app));
check('superbolt attraction keeps its updated 9–37 km ground range',
  /float minRangeMeters = isSuperboltExt \? 9000\.0 : 5500\.0;/.test(location) && /float maxRangeMeters = isSuperboltExt \? 37000\.0 : 34000\.0;/.test(location) && /rodRangeMeters < minRangeMeters \|\| rodRangeMeters > maxRangeMeters/.test(location));
check('super rods no longer initiate upward leaders',
  !/upwardLeaderCloudTarget|isGroundInitiated/.test(location) &&
  !/hasSuperLightningRods/.test(app) &&
  /abs\(lightningMeta\.y - 5\.0\) < 0\.25/.test(display));
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
