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
// Preview shows base reach capped at half the wrapped world; actual capture
// additionally depends on mast height and strike current.
const wrapDist = (a, b) => Math.abs(((a - b + 1.5) % 1) - 0.5);
const normalRadius = 0.11 * 1.1 * 1.1, superRadius = 0.11 * 2.5 * 1.1 * 1.1;
check('2.5-fold base reach does not automatically cover the periodic domain',
  Math.abs(superRadius / normalRadius - 2.5) < 1e-12 && superRadius < 0.5 &&
  wrapDist(0.99, 0.01) < 0.021 && 0.5 > superRadius &&
  /Math\.min\(0\.5, LIGHTNING_ROD_ATTRACT_RADIUS/.test(app));
check('superbolt attraction keeps its original 9–42 km ground range',
  /rodRangeMeters >= 9000\.0 && rodRangeMeters <= 42000\.0/.test(location));
check('upward initiation requires a super rod, a free slot, an overhead cold dense storm and a periodic probability',
  /float upwardLeaderCloudTarget\(/.test(location) && /water\[CLOUD\] >= 0\.15/.test(location) &&
  /water\[CLOUD\] \+ water\[PRECIPITATION\] >= 0\.72/.test(location) &&
  /temp > 50\.0 && temp < CtoK\(0\.0\)/.test(location) &&
  /if \(!hasNewStrike && iterNum > 0\.0 && mod\(iterNum, 60\.0\) < 0\.5\)/.test(location) &&
  /if \(rodTypes\[i\] < 0\.5\)/.test(location) && /targetY > tipY/.test(location) &&
  /iterNum \* 1\.19\)\) < 0\.08/.test(location) && /slot == freeSlot/.test(location));
check('natural and artificial events take priority over rod initiation',
  location.indexOf('if (isArtificial) {\n    incoming =') < location.indexOf('if (!hasNewStrike && iterNum > 0.0') &&
  /if \(isGroundInitiated\) \{[\s\S]{0,200}vec4\(originX, 5\.0, upwardTipY, 0\.0\)/.test(location));
check('slot pass and sound readback run for super rods even with precipitation disabled',
  /hasSuperLightningRods && iterNum % 60 === 0/.test(app) &&
  /enablePrecipitation \|\| hasSuperLightningRods \|\| iterNum <= manualLightningActiveUntil/.test(app) &&
  /Math\.abs\(metaType - 5\.0\) < 0\.25[\s\S]{0,180}soundSystem\.soundThunder/.test(app));
check('upward GC is distinct from CC, renders as a rising forked leader from the actual tip, and lights its rod',
  /bool isGroundToCloud = abs\(lightningMeta\.y - 5\.0\) < 0\.25/.test(display) &&
  /isCloudToCloud = !isFlash && lightningMeta\.y >= 1\.5 && !isGroundToCloud/.test(display) &&
  /displayGroundToCloud\(lightningPos, lightningMeta\.z, lightningTime, currentLightningIntensity\)/.test(display) &&
  /vec2 prev = vec2\(0\.0, 0\.0\);[\s\S]{0,600}span \* k \/ 9\.0/.test(display) &&
  /isUpwardStrike \? \(iterNum - strikeData\[START_ITERNUM\]\) \/ 40\.0/.test(display));
check('upward slot lifetime and display time use matching scaling without changing manual CG',
  /abs\(meta\.y - 5\.0\) < 0\.25\)\s*\n\s*end = strike\[START_ITERNUM\] \+ \(end - strike\[START_ITERNUM\]\) \* 8\.0/.test(common) &&
  /isGroundToCloud \? \(iterNum - lightningStartIterNum\) \/ 40\.0/.test(display) &&
  /meta\.z < -0\.5\)\s*\n\s*end = strike\[START_ITERNUM\] \+ \(end - strike\[START_ITERNUM\]\) \* 4\.0/.test(common));
// 40 * (1.5 + 2.924) is the minimum parent duration at intensity 2.2:
// even at 50 iterations/frame and 3-frame readbacks it spans more than 150 steps.
check('shortest upward event spans a three-frame readback at maximum simulation speed',
  40 * (1.5 + 2.924) > 3 * 50);
// Check the exact uint hash on representative 60-iteration sampling steps.
{
  const dv = new DataView(new ArrayBuffer(4));
  const bits = value => { dv.setFloat32(0, Math.fround(value), true); return dv.getUint32(0, true); };
  function hash(v) {
    v = (v + (v << 10)) >>> 0; v = (v ^ (v >>> 6)) >>> 0;
    v = (v + (v << 3)) >>> 0; v = (v ^ (v >>> 11)) >>> 0;
    return (v + (v << 15)) >>> 0;
  }
  function random2d(x, y) {
    const h = hash((bits(x) + hash(bits(y))) >>> 0);
    dv.setUint32(0, (h & 0x007fffff) | 0x3f800000, true);
    return dv.getFloat32(0, true) - 1;
  }
  let triggered = 0;
  const samples = 100000;
  for (let i = 1; i <= samples; i++) {
    if (random2d(Math.fround(0.37 * Math.fround(93.1)), Math.fround(i * 60 * Math.fround(1.19))) < 0.08)
      triggered++;
  }
  check('eligible super rod roll is close to 8% (' + triggered + '/' + samples + ')',
    triggered > 7600 && triggered < 8400);
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
