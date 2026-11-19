'use strict';
// Regression checks for weather-gated, slot-owned optical lightning effects.
// Run: node tests/check-upper-lightning.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const location = fs.readFileSync(path.join(root, 'shaders/fragment/lightningLocationShader.frag'), 'utf8');
const display = fs.readFileSync(path.join(root, 'shaders/fragment/realisticDisplayShader.frag'), 'utf8');
const vertex = fs.readFileSync(path.join(root, 'shaders/vertex/realDispShader.vert'), 'utf8');
const common = fs.readFileSync(path.join(root, 'shaders/common.glsl'), 'utf8');
const precip = fs.readFileSync(path.join(root, 'shaders/vertex/precipitationShader.vert'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
let passed = 0, failed = 0;
function check(name, ok) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (ok) passed++; else failed++;
}

check('all probabilities are applied only during creation of an occupied slot, once on metadata row',
  /if \(hasNewStrike && !duplicate && slot == freeSlot\)/.test(location) &&
  /if \(row == 1 && !artificialMeta\(result\.z\)\) \{[\s\S]*?0\.00014/.test(location));
check('storm gate requires cloud water, cold origin, and tall storm in physical meters',
  /originTempK < CtoK\(-10\.0\)/.test(location) && /incoming\.y \* simHeightMeters >= 4000\.0/.test(location) &&
  /cloudTopMeters >= 7000\.0/.test(location) && /\[CLOUD\] > 0\.02/.test(location) &&
  /float findStormCloudTop\(/.test(location));
check('crawler and jet require mature intra-cloud lightning, with cloud top preserved for IC only',
  /if \(intraCloud && matureStorm\)\s*\{[\s\S]*?result\.z = cloudTop;[\s\S]*?< 0\.09[\s\S]*?< 0\.00025/.test(location) &&
  /result\.w \+= 1\.0 \/ 32\.0/.test(location) && /result\.w \+= 4\.0 \/ 32\.0/.test(location));
check('sprite requires positive CG with a 0.05% independent roll',
  /positiveCG && matureStorm && random2d\(vec2\(seedX \+ 47\.9, iterNum \* 2\.73\)\) < 0\.0005/.test(location));
check('elve requires energetic CG of either polarity with a 0.014% independent roll',
  /matureStorm && \(positiveCG \|\| \(negativeCG && incoming\[INTENSITY\] >= 2\.0\)\)/.test(location) &&
  /random2d\(vec2\(seedX \+ 59\.7, iterNum \* 3\.17\)\) < 0\.00014/.test(location));
check('rendering uses wrapped physical coordinates, cloud top, and altitude-specific red/blue/elve shapes',
  /drawAnvilCrawler\(/.test(display) && /drawUpperAtmosphereLightning\(/.test(display) &&
  /cellHeight \* resolution\.y \* 0\.001/.test(display) && /altitude >= 45\.0 && altitude <= 90\.0/.test(display) &&
  /altitude >= baseKm && altitude <= 43\.0/.test(display) && /altitude >= 82\.0 && altitude <= 98\.0/.test(display) &&
  /vec3\(1\.0, 0\.05, 0\.04\)/.test(display) && /vec3\(0\.30, 0\.38, 1\.0\)/.test(display) &&
  /int tendrilCount = 5 \+ int\(floor\(seedT \* 3\.999\)\);/.test(display) &&
  /1\.0 \/ \(1\.0 \+ radius \* 0\.065\)/.test(display) &&                       // elve 1/r dimming
  /float rise = clamp\(t \/ 0\.55, 0\.0, 1\.0\);/.test(display));                   // jet climbing front
check('sky effects render above the simulation when there are no rods as well as with rods',
  /vec3 upperAtmosphereLight = drawUpperAtmosphereLightning\(\);[\s\S]{0,120}if \(rodCount == 0\)/.test(display) &&
  /fragmentColor = vec4\(softHdrClamp\(upperAtmosphereLight\)/.test(display) && /emittedLight \+= upperAtmosphereLight/.test(display));
check('display mesh and camera can reach 100 km even for a 5 km simulation',
  /const float Ymult = 45\./.test(vertex) && /100000\.0 \/ guiControls\.simHeight/.test(app));

check('both slot manager and precipitation reserve effect slots for 100 iterations without changing parent duration',
  /fract\(meta\.w\) > 0\.0/.test(common) && /max\(end, strike\[START_ITERNUM\] \+ 100\.0\)/.test(common) &&
  /lightningSlotEnd\(data, meta\)/.test(location) && /lightningSlotEnd\(slotData, slotMeta\)/.test(precip) &&
  /iterNum >= strikeAnimEnd\(lightningData\)/.test(display) &&
  /opticalTime = \(iterNum - lightningStartIterNum\) \/ 40\.0/.test(display));
// For every phase of a frame running 50 steps, at least one sample lies in
// each effect's nonzero animation window before the slot can be reused.
let visibleAtFastSpeed = true;
for (let first = 0; first < 50; first++) {
  const samples = [first / 40, (first + 50) / 40];
  visibleAtFastSpeed &&= samples.some(t => t > 0.15 && t < 2.1); // sprite
  visibleAtFastSpeed &&= samples.some(t => t < 2.5); // jet and crawler
  visibleAtFastSpeed &&= samples.some(t => t < 1.6); // elve
}
check('effect windows remain observable at 50 simulation steps per frame', visibleAtFastSpeed);

// Every subset of optical flags must round-trip exactly without breaking the
// legacy >= 0.5 superbolt check; combinations can coexist independently.
let flagsOK = true;
for (const superbolt of [0, 1]) for (let bits = 0; bits < 16; bits++) {
  const w = superbolt + bits / 32;
  flagsOK &&= (w >= 0.5) === !!superbolt;
  for (const bit of [1, 2, 4, 8]) {
    const decoded = (Math.floor((w - Math.floor(w)) * 32 + 0.5) / bit) % 2 >= 1;
    flagsOK &&= decoded === !!(bits & bit);
  }
}
check('all effect flag combinations coexist with existing superbolt flag checks', flagsOK);

// Port GLSL hash and its IEEE-754 seeds to test the actual rare-event rolls.
const f = Math.fround, dv = new DataView(new ArrayBuffer(4));
function bits(x) { dv.setFloat32(0, x, true); return dv.getUint32(0, true); }
function hash(x) {
  x = (x + (x << 10)) >>> 0; x = (x ^ (x >>> 6)) >>> 0;
  x = (x + (x << 3)) >>> 0; x = (x ^ (x >>> 11)) >>> 0;
  return (x + (x << 15)) >>> 0;
}
function random2d(x, y) {
  const h = hash((bits(x) + hash(bits(y))) >>> 0);
  dv.setUint32(0, (h & 0x007fffff) | 0x3f800000, true);
  return dv.getFloat32(0, true) - 1;
}
let sprite = 0, jet = 0, elve = 0;
const n = 1000000;
for (let i = 1; i <= n; i++) {
  const x = f((i * 0.61803398875) % 1), y = f(0.35 + ((i * 0.271828) % 0.55));
  const seed = f(f(x * f(73.1)) + f(y * f(29.9)));
  if (random2d(f(seed + f(47.9)), f(i * f(2.73))) < 0.0005) sprite++;
  if (random2d(f(seed + f(31.3)), f(i * f(2.11))) < 0.00025) jet++;
  if (random2d(f(seed + f(59.7)), f(i * f(3.17))) < 0.00014) elve++;
}
check('seeded GLSL hash gives the requested rare-event rates within sampling tolerance (' + [sprite, jet, elve] + ')',
  sprite > 400 && sprite < 600 && jet > 185 && jet < 315 && elve > 90 && elve < 190);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
