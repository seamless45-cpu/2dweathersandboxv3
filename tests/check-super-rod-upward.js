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

check('super rods keep their boosted reach and taller geometry',
  /const SUPER_LIGHTNING_ROD_REACH_MULT = 2\.5;/.test(app) &&
  /heightMeters \* \(superRod \? 1\.8 : 1\.0\)/.test(location) &&
  /radiusMeters \* \(superRod \? 2\.5 : 1\.0\) \/ worldWidth/.test(location) &&
  /lightningRodPreviewRadius\(cursorType >= 5\.0\)/.test(app));
check('rod capture remains inside the same world tile',
  /return abs\(a - b\)/.test(location) && /Math\.min\(0\.5, radius/.test(app));
check('superbolt attraction keeps its updated 9–37 km ground range',
  /float minRangeMeters = isSuperboltExt \? 9000\.0 : 5500\.0;/.test(location) && /float maxRangeMeters = isSuperboltExt \? 37000\.0 : 34000\.0;/.test(location) && /rodRangeMeters < minRangeMeters \|\| rodRangeMeters > maxRangeMeters/.test(location));
check('super rods no longer initiate upward leaders',
  !/upwardLeaderCloudTarget|isGroundInitiated/.test(location) &&
  !/hasSuperLightningRods/.test(app) &&
  /abs\(lightningMeta\.y - 5\.0\) < 0\.25/.test(display));
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
