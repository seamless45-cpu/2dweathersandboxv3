'use strict';
// Behavior and wiring checks for artificial strikes, stronger rods, and crawlers.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const app = read('app.js');
const location = read('shaders/fragment/lightningLocationShader.frag');
const display = read('shaders/fragment/realisticDisplayShader.frag');
const common = read('shaders/common.glsl');
const cursor = read('shaders/commonDisplay.glsl');
let passed = 0, failed = 0;
function check(name, condition) {
  console.log((condition ? 'PASS ' : 'FAIL ') + name);
  if (condition) passed++; else failed++;
}

// Extract the actual UI helpers and run them against a minimal terrain fixture.
function extract(name) {
  const start = app.indexOf('  function ' + name + '(');
  if (start < 0) throw Error('missing ' + name);
  let depth = 0, begun = false;
  for (let i = app.indexOf('{', start); i < app.length; i++) {
    if (app[i] === '{') { begun = true; depth++; }
    if (app[i] === '}' && begun && --depth === 0) return app.slice(start, i + 1);
  }
  throw Error('unterminated ' + name);
}
const fixture = {
  lightningRods: [], lightningRodsVersion: 0, MAX_LIGHTNING_RODS: 12,
  sim_res_x: 200, sim_res_y: 100, cellHeight: 120,
  pendingArtificialLightning: [], artificialLightningStatus: {status: 'Ready'}, guiControls: { wrapHorizontally: false, paused: true },
  canvas: { getBoundingClientRect: () => ({left: 0, top: 0}) },
  screenToSimX: x => x, screenToSimY: y => y,
  findTerrainSurfaceCell: x => x === 0 ? -1 : 10,
  clamp: (v, a, b) => Math.min(b, Math.max(a, v)), mod: (x, y) => ((x % y) + y) % y,
  updateLightningRodStatus: () => {}, Math, Number, Infinity
};
vm.createContext(fixture);
vm.runInContext(['tryPlaceLightningRod', 'tryRemoveNearestLightningRod', 'queueArtificialLightningAtClientPoint'].map(extract).join('\n'), fixture);
check('normal and super tools place distinct rods on terrain',
  fixture.tryPlaceLightningRod(0.25, 0.11) && fixture.tryPlaceLightningRod(0.6, 0.11, true) &&
  !fixture.lightningRods[0].isSuper && fixture.lightningRods[1].isSuper && fixture.lightningRodsVersion === 2);
check('placement rejects sky, missing ground, and overlapping rods',
  !fixture.tryPlaceLightningRod(0.4, 0.9, true) && !fixture.tryPlaceLightningRod(0.001, 0.11, true) &&
  !fixture.tryPlaceLightningRod(0.25, 0.11, true));
const superRod = fixture.lightningRods[1];
check('taller super rod can be removed near its tip',
  fixture.tryRemoveNearestLightningRod(superRod.x, superRod.y + (8 / 100) * 1.8) && fixture.lightningRods.length === 1);
check('paused manual ground and sky clicks enqueue strikes with valid source height',
  fixture.queueArtificialLightningAtClientPoint(0.3, 0.11) && fixture.queueArtificialLightningAtClientPoint(0.7, 0.8) &&
  fixture.pendingArtificialLightning[0].y === 0.6 && fixture.pendingArtificialLightning[1].y === 0.8);
check('manual click rejects off-world or missing terrain without mutating the queue',
  !fixture.queueArtificialLightningAtClientPoint(-0.01, 0.4) && !fixture.queueArtificialLightningAtClientPoint(0.5, 1.1) &&
  !fixture.queueArtificialLightningAtClientPoint(0, 0.4) && fixture.pendingArtificialLightning.length === 2);
fixture.guiControls.wrapHorizontally = true;
check('manual strike wraps horizontally when wrap is enabled',
  fixture.queueArtificialLightningAtClientPoint(1.25, 0.4) && Math.abs(fixture.pendingArtificialLightning[2].x - 0.25) < 1e-9);
while (fixture.pendingArtificialLightning.length < 16) fixture.queueArtificialLightningAtClientPoint(0.5, 0.5);
check('manual queue is bounded without dropping existing requests',
  !fixture.queueArtificialLightningAtClientPoint(0.5, 0.5) && fixture.pendingArtificialLightning.length === 16);

check('UI exposes both tools to mouse and touch; both rods support removal',
  /'Super Lightning Rod'\s*:\s*'TOOL_SUPER_LIGHTNING_ROD'/.test(app) &&
  /'Artificial Lightning'\s*:\s*'TOOL_ARTIFICIAL_LIGHTNING'/.test(app) &&
  /queueArtificialLightningAtClientPoint\(e.clientX, e.clientY\)/.test(app) &&
  /queueArtificialLightningAtClientPoint\(event.changedTouches\[0\].clientX/.test(app) &&
  /e.button == 2[^\n]*TOOL_SUPER_LIGHTNING_ROD/.test(app));
check('rod types are uploaded to both shader programs with dirty tracking',
  /rodTypes\[0\]/.test(app) && /gl\.uniform1fv\(locations.types, rodTypeData\)/.test(app) &&
  /uploadLightningRodUniforms\(lightningLocationProgram\)/.test(app) && /uploadLightningRodUniforms\(realisticDisplayProgram\)/.test(app));
check('super rod extends reach, guaranteed capture, visible height, tip termination and preview',
  /rodTypes\[rodIdx\] > 0\.5 \? 2\.5 : 1\.0/.test(location) &&
  /rodTypes\[nearestRod\] > 0\.5 \? 0\.70 : 0\.35/.test(location) &&
  /rodAttractRadius \* reachMultiplier \* heightFactor \* currentFactor/.test(location) &&
  /rodHeight \* \(rodTypes\[i\] > 0\.5 \? 1\.8 : 1\.0\)/.test(display) &&
  /float thisRodHeight = rodHeight \* \(isSuperRod \? 1\.8 : 1\.0\)/.test(display) &&
  /cursor\.w >= 5\.0/.test(cursor));
check('superbolt rod capture still preserves 9–37 km range',
  /float minRangeMeters = isSuperboltExt \? 9000\.0 : 5500\.0;/.test(location) && /float maxRangeMeters = isSuperboltExt \? 37000\.0 : 34000\.0;/.test(location) && /rodRangeMeters < minRangeMeters \|\| rodRangeMeters > maxRangeMeters/.test(location));
check('manual strikes use the variant picker with rod capture for the ground-striking variants',
  /incoming = vec4\(artificialStrike\.xy, iterNum, artificialStrike\.z\)/.test(location) &&
  /float variant = artificialStrikeVariant;/.test(location) &&
  (location.match(/artData = attractToRod\(artData\);/g) || []).length >= 4 &&
  /\/\/ ordinary cloud-to-ground \(default\)[\s\S]{0,120}artData = attractToRod\(artData\);/.test(location) &&
  /vec4 artMeta = vec4\(originX, 0\.0, -1\.0, 0\.0\)/.test(location));
check('full slots cause a retry next frame, not lost clicks or overwritten events',
  /!artificialAttemptedThisFrame[^\n]*pendingArtificialLightning\[0\]/.test(app) &&
  /if \(acceptedSlot >= 0\)\s*\{\s*pendingArtificialLightning\.shift\(\)/.test(app) &&
  /slot == freeSlot/.test(location) && /lightningSlotEnd\(data, meta\)/.test(location));
check('manual strike pass runs when precipitation is disabled and acknowledges once',
  /if \(guiControls.enablePrecipitation \|\| pendingArtificialLightning.length > 0\)/.test(app) &&
  /gl\.readPixels\(0, 0, numLightningSlots, 1, gl\.RGBA, gl\.FLOAT, manualSlotReadback\)/.test(app) &&
  /countedSlotStartIter\[acceptedSlot\] = iterNum/.test(app) && /soundSystem\.soundThunder\(targetX, manualSlotReadback/.test(app));
check('artificial channel and rod share the same extended animation clock and lifetime',
  /artificialMeta\(meta\.z\)[\s\S]{0,120}\* 4\.0/.test(common) &&
  /\(iterNum - lightningStartIterNum\) \/ 20\.0/.test(display) &&
  /\(iterNum - strikeData\[START_ITERNUM\]\) \/ 20\.0/.test(display));
// Propagation remains attached, including every sub-branch; growth begins only
// after the feeder reaches the common anvil root and the relevant parent joint is complete.
const smoothstep = (edge0, edge1, value) => {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
let connected = true, visible = false;
for (let time = 0; time <= 2.5; time += 0.005) for (let lane = 0; lane < 4; lane++) for (let k = 2; k <= 8; k++) {
  const rank = lane % 2;
  const sideSign = lane < 2 ? -1 : 1;
  const delay = 0.34 + rank * 0.15 + (sideSign > 0 ? 0.055 : 0);
  const feeder = clamp(time / 0.34, 0, 1);
  const raw = clamp((time - delay) / 1.16, 0, 1);
  const phase = raw * 11;
  const progress = (Math.floor(phase) + smoothstep(0.03, 0.34, phase - Math.floor(phase))) / 11;
  const parent = clamp((progress - (k - 1) / 11) * 11, 0, 1);
  const branch = clamp((progress * 11 - k) / 3.1, 0, 1); // branchStep in the shader
  const established = 3.8 * branch;                       // branchLen * branchStep, for representative reach
  const joint = 3.8 * 0.46;
  const finger = clamp((established - joint) / (3.8 * 0.34), 0, 1);
  const hasFork = (k + lane) % 3 < 0.52;
  connected &&= (!raw || feeder === 1) && (!branch || parent === 1) && (!finger || branch > 0) && (!finger || parent === 1);
  visible ||= hasFork && branch > 0 && finger > 0;
}
check('all leader and branch levels grow from completed connections', connected && visible);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
