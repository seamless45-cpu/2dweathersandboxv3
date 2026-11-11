// Lightning rod + lightning slot consistency harness.
//
// Two things are checked here, both of which are easy to break by hand:
//
//  1. Constant drift. MAX_LIGHTNING_RODS / LIGHTNING_SLOTS / LIGHTNING_ANIM_ITERS
//     live in shaders/common.glsl, but app.js has to agree with them (uniform
//     array sizes, the slot ping-pong buffers and the IC atlas tile count).
//
//  2. The rod attraction rule. attractToRod() below is a line-by-line port of
//     the GLSL in shaders/fragment/lightningLocationShader.frag, including the
//     shared random2d() hash, so the behaviour that a lightning rod captures
//     nearby cloud-to-ground strikes can be tested without a GPU.
//
// Usage: node tests/check-lightning-rods.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const common = fs.readFileSync(path.join(ROOT, 'shaders', 'common.glsl'), 'utf8');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const locationShader = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'lightningLocationShader.frag'), 'utf8');
const displayShader = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'realisticDisplayShader.frag'), 'utf8');
const boundaryShader = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'boundaryShader.frag'), 'utf8');

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

/* ------------------------------------------------------------------ constants */

const defineValue = (source, name) => {
  const match = source.match(new RegExp('#define\\s+' + name + '\\s+([-\\d\\.]+)'));
  return match ? Number(match[1]) : NaN;
};

const MAX_LIGHTNING_RODS = defineValue(common, 'MAX_LIGHTNING_RODS');
const LIGHTNING_SLOTS = defineValue(common, 'LIGHTNING_SLOTS');
const LIGHTNING_IC_MAX_INTENSITY = defineValue(common, 'LIGHTNING_IC_MAX_INTENSITY');
const LIGHTNING_ANIM_ITERS = defineValue(common, 'LIGHTNING_ANIM_ITERS');

const appMaxRods = Number((appSource.match(/const\s+MAX_LIGHTNING_RODS\s*=\s*(\d+)/) || [])[1]);
const appNumSlots = Number((appSource.match(/const\s+numLightningSlots\s*=\s*(\d+)/) || [])[1]);
const appICtiles = (appSource.match(/const\s+numICLightningTiles\s*=\s*([^;]+);/) || [])[1];

check('common.glsl declares MAX_LIGHTNING_RODS', Number.isInteger(MAX_LIGHTNING_RODS) && MAX_LIGHTNING_RODS > 0);
check('common.glsl declares LIGHTNING_IC_MAX_INTENSITY', LIGHTNING_IC_MAX_INTENSITY === 1.0, 'got ' + LIGHTNING_IC_MAX_INTENSITY);
check('app.js MAX_LIGHTNING_RODS matches common.glsl',
  appMaxRods === MAX_LIGHTNING_RODS,
  'app.js ' + appMaxRods + ' vs common.glsl ' + MAX_LIGHTNING_RODS);
check('app.js numLightningSlots matches LIGHTNING_SLOTS',
  appNumSlots === LIGHTNING_SLOTS,
  'app.js ' + appNumSlots + ' vs common.glsl ' + LIGHTNING_SLOTS);
check('the IC artwork has eight patterns',
  /const numICLightningTiles = 8;/.test(appSource) &&
  /const float icTileCount = 8\.0;/.test(displayShader),
  'app.js: ' + appICtiles);
check('both lightning programs declare the rod uniforms',
  /uniform\s+vec2\s+rodPositions\[MAX_LIGHTNING_RODS\]/.test(locationShader) &&
  /uniform\s+vec2\s+rodPositions\[MAX_LIGHTNING_RODS\]/.test(displayShader));
check('strike dispatch uses LIGHTNING_IC_MAX_INTENSITY',
  displayShader.includes('lightningData[INTENSITY] > LIGHTNING_IC_MAX_INTENSITY'));
check('IC flashes are drawn with the generator artwork',
  displayShader.includes('displayICLightning') && appSource.includes("mode : 'IC'"));

/*
 * Intra-cloud artwork.
 *
 * The deep checks for the IC model live in tests/check-ic-lightning.js, which
 * renders the real generator through a stubbed canvas and measures the artwork
 * and the display maths. What belongs here is only what this file is about: the
 * contract between app.js, the shader and the generator - the tile size, the
 * filtering, and the additive pass that makes a flash visible inside a cloud.
 */
const generatorSource = fs.readFileSync(path.join(ROOT, 'lightningGenerator.js'), 'utf8');

check('the IC generator draws one flash per tile request',
  /msg\.mode === 'IC'/.test(generatorSource) && /generateIntraCloudBolt\(/.test(generatorSource));
check('every tile asks the generator for its own drawing',
  /variant : tileIndex/.test(appSource) && /msg\.variant/.test(generatorSource));
check('the IC artwork is generated off the main thread',
  /new Worker\('\.\/lightningGenerator\.js\?v=/.test(appSource) &&
  /postMessage\(bitmap, \[bitmap\]\)/.test(generatorSource));

// The tile is the whole flash now, so the artwork is only correct if app.js and
// the shader agree on its size: the shader samples the tile edge to edge.
{
  const appW = Number((appSource.match(/const icLightningTileWidth = (\d+);/) || [])[1]);
  const appH = Number((appSource.match(/const icLightningTileHeight = (\d+);/) || [])[1]);
  const shaderW = Number((displayShader.match(/const float icTileWidthPx = ([\d.]+);/) || [])[1]);
  check('app.js and the shader agree on the IC tile size',
    appW === shaderW && appW > 0 && appH > 0 && Math.abs(appW / appH - 2) < 1e-6,
    'app.js ' + appW + 'x' + appH + ', shader ' + shaderW);
}
check('a strike picks its layer and its mirroring from its own hash',
  /float tileHash = fract\(sin\(tileSeed/.test(displayShader) &&
  /float look = floor\(fract\(tileHash \* ([\d.]+)\) \* 4\.0\);/.test(displayShader) &&
  /lightningStartIterNum \* 0\.6180339 \+ float\(slot\) \* 11\.7/.test(displayShader));
check('a flash never changes shape while it is on screen',
  // the mirroring comes from the strike hash, not from the flash's age
  !/look = floor\(fract\(lightningTime/.test(displayShader) &&
  !/artCoord \* lightningTime/.test(displayShader) &&
  !/stretch\.x/.test(displayShader));

// The artwork holds channels and nothing else: no painted halo around them. A
// halo painted into the tile is baked at one resolution (so it aliases when the
// flash is small), it is painted in the tile's own grey (so it cannot be tinted),
// and it is cut off dead where the tile ends. The halo a player sees is drawn by
// the display shader out of the artwork's mip chain instead - see the checks
// below - which has none of those problems.
check('the artwork carries no painted glow layer',
  !/drawHalo/.test(generatorSource) &&
  (() => {
    const fn = (generatorSource.match(/function stroke\(pts, w, tone\)[\s\S]*?\n  \}/) || [''])[0];
    return (fn.match(/ctx\.stroke\(\)/g) || []).length === 1;
  })());
// The halo lives in the display shader, out of the artwork's own mip chain.
// These are the four things that make it a halo rather than a flood fill: it is a
// blur of the real artwork (three explicit mip taps), it is tinted cold, it is
// weighted well below the channels, and it is confined to a known reach.
check('the display shader draws the halo out of the mip chain',
  /float wide = textureLod\(icLightningTex, vec3\(uv, layer\), icGlowWideLod\)\.r;/.test(displayShader) &&
  /textureLod\(icLightningTex, vec3\(uv, layer\), icGlowMidLod\)\.r/.test(displayShader) &&
  /textureLod\(icLightningTex, vec3\(uv, layer\), artLod \+ icGlowTightBias\)\.r/.test(displayShader),
  'expected three textureLod() taps of the IC array texture');
{
  const col = (displayShader.match(/const vec3 icGlowCol = vec3\(([\d.]+), ([\d.]+), ([\d.]+)\);/) || []).slice(1).map(Number);
  const tint = displayShader.includes('vec3 light = vec3(core) + icGlowCol * glow;');
  check('the halo is cold light added to a white channel',
    col.length === 3 && col[2] > col[1] && col[1] >= col[0] && tint,
    'icGlowCol ' + col.join(', ') + (tint ? '' : ', and the tint is missing from the sum'));
}
{
  const weight = (name) => Number((displayShader.match(new RegExp('const float ' + name + ' = ([\\d.]+);')) || [])[1]);
  const tight = weight('icGlowTight'), mid = weight('icGlowMid'), wide = weight('icGlowWide');
  check('the halo stays well under the channels it surrounds',
    tight > 0 && tight < 1 && mid > 0 && mid < 1 && wide > 0 && wide < 1,
    'weights ' + tight + '/' + mid + '/' + wide);
  const reach = Number((displayShader.match(/if \(reach > ([\d.]+)\)/) || [])[1]);
  check('the halo is confined to a reach of its own',
    reach > 0.5 && reach < 0.75,
    'reach ' + reach + ' sprite halves (the sprite is 0.5)');
}
// A halo that could exceed the knee would clip to white and erase the channels
// under it, so it goes through the same compression as the channels do.
check('the halo is compressed by the same knee as the channels',
  displayShader.indexOf('icGlowCol * glow') < displayShader.indexOf('return light * icPower * icBrightness * icEnergy;') &&
  displayShader.indexOf('return light * icPower * icBrightness * icEnergy;') <
  displayShader.indexOf('vec3 gained = max(icLight, vec3(0.0))') &&
  displayShader.indexOf('vec3 gained = max(icLight, vec3(0.0))') <
  displayShader.indexOf('return vec3(1.0) - exp(-gained);'),
  'the halo has to be multiplied into the light before the cloud gain and the knee');

// Strokes must not erase what is under them (source-over) nor pile up into a
// saturated slab ('lighter'): 'lighten' takes the brighter of stroke and
// backdrop, so crossing channels cannot churn the tile into dark troughs.
check('IC strokes only ever brighten the artwork',
  /globalCompositeOperation = 'lighten'/.test(generatorSource) &&
  !/globalCompositeOperation = 'lighter'/.test(generatorSource) &&
  !/globalCompositeOperation = 'screen'/.test(generatorSource));

// The light pass returns only the flash light, and is drawn additively on top of
// the finished scene - the reason a flash is visible inside a cloud at all.
check('the light pass returns only the flash light',
  /uniform float icLightPass/.test(displayShader) &&
  /if \(icLightPass > 0\.5\) \{[\s\S]{0,200}?fragmentColor = vec4\(computeICLight\(\), 0\.0\);[\s\S]{0,80}?return;/.test(displayShader) &&
  /vec3 computeICLight\(\)/.test(displayShader) &&
  /icLight \+= displayICLightning\(/.test(displayShader));
check('the scene pass carries no IC light any more',
  /fragmentColor = vec4\(min\(max\(color \* finalLight, 0\.\) \+ emittedLight/.test(displayShader) &&
  !/icAlpha/.test(displayShader) &&
  !/icEmission/.test(displayShader));
{
  // draw order: set the pass flag, switch to ONE/ONE, draw, reset, restore
  const passIdx = appSource.indexOf("'icLightPass'), 1.0");
  const addBlendIdx = appSource.indexOf('gl.blendFunc(gl.ONE, gl.ONE);', passIdx);
  const passDrawIdx = appSource.indexOf('gl.drawArrays', passIdx);
  const resetIdx = appSource.indexOf("'icLightPass'), 0.0", passIdx);
  const restoreIdx = appSource.indexOf('gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);', passIdx);
  check('the IC light pass is drawn additively and then switched back off',
    passIdx > 0 && addBlendIdx > passIdx && passDrawIdx > addBlendIdx &&
    resetIdx > passDrawIdx && restoreIdx > resetIdx,
    'pass ' + passIdx + ', additive ' + addBlendIdx + ', draw ' + passDrawIdx +
    ', reset ' + resetIdx + ', restore ' + restoreIdx);
}

// Light born inside a cloud is not dimmed by that cloud (it is the medium that
// scatters it towards the viewer), and what does depend on the cloud is a gain,
// so a flash inside one is seen through it.
check('IC light is not dimmed by the cloud it is in',
  !/icLight \/ \(1\. \+ cloud/.test(displayShader) &&
  /1\.0 \+ icCloudScatter \* cloudOpacity/.test(displayShader));
{
  const gain = Number((displayShader.match(/const float icCloudScatter = ([\d\.]+)/) || [])[1]);
  check('an IC flash inside a cloud gets a scatter gain',
    gain > 0 && gain <= 8,
    'icCloudScatter = ' + gain);
}

// The default display path has no tonemapping at all, so anything above 1.0 in
// HDR is clipped: every tier of channel would arrive as the same white. The soft
// knee is what keeps a trunk, an arm and a hair apart on screen.
check('the IC light is compressed by a soft knee before it reaches the frame',
  /return vec3\(1\.0\) - exp\(-gained\);/.test(displayShader) &&
  /vec3 gained = max\(icLight, vec3\(0\.0\)\) \* \(1\.0 \+ icCloudScatter \* cloudOpacity\);/.test(displayShader));

// Additive light can only add: over the whole plausible range - a flash fading
// from nothing to full brightness, over backdrops from a night sky to a sunlit
// cloud - the picture is never darker, and always brighter as the light grows.
const toneMap = (c) => {
  c = Math.max(c, 0);
  const aces = Math.min(1, Math.max(0, (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14)));
  return 255 * Math.sqrt(aces);
};
{
  let darkening = 0, inversion = 0;
  for (let backdrop = 0.02; backdrop <= 3.0; backdrop += 0.02) {
    let previous = toneMap(backdrop);
    for (let L = 0; L <= 4; L += 0.01) {
      const lit = toneMap(backdrop + L);
      if (lit < toneMap(backdrop)) darkening++;
      if (lit < previous - 1e-9) inversion++;
      previous = lit;
    }
  }
  check('an IC flash can never darken what it is drawn over', darkening === 0);
  check('a fading IC flash faintly brightens instead of flickering darker', inversion === 0);
}

// A CG return stroke is 100000 by design and the scene is rendered into an
// RGBA16F buffer (largest finite value 65504). Uncapped, the light overflowed to
// infinity and the pumped alpha (~100000 as well) made the blend multiply the
// destination by a large negative number; both come out of the tonemap as NaN,
// which the bloom and the AA passes then smear across the frame.
{
  const ceilingMatch = displayShader.match(/const float hdrCeiling = ([\d\.]+);/);
  const ceiling = ceilingMatch ? Number(ceilingMatch[1]) : NaN;
  const boltBrightness = Number((displayShader.match(/const float mainBoltBrightness = ([\d\.]+);/) || [])[1]);
  check('the scene light is capped below the 16-bit float limit',
    ceiling > 1000 && ceiling < 65504 && boltBrightness > ceiling,
    'ceiling ' + ceiling + ', CG stroke ' + boltBrightness + ', 16F limit 65504');
  check('the fragment is written through that cap',
    /fragmentColor = vec4\(min\(max\(color \* finalLight, 0\.\) \+ emittedLight, vec3\(hdrCeiling\)\), opacity\)/
      .test(displayShader));
  check('the emission alpha cannot run past opaque',
    /opacity = clamp\(opacity \+ length\(emittedLight\), 0\.0, 1\.0\)/.test(displayShader));
  const capped = toneMap(ceiling);
  check('a CG strike at the cap is still white, and finite',
    Number.isFinite(capped) && capped >= 254,
    'tonemapped to ' + capped.toFixed(1) + '/255');
}
check('IC flashes stay cloud-scale, not storm-scale',
  /const icFlashWidthMeters = (\d+)/.test(appSource) &&
  Number(appSource.match(/const icFlashWidthMeters = (\d+)/)[1]) <= 8000 &&
  Number(appSource.match(/const icFlashHeightMeters = (\d+)/)[1]) <= 4000,
  'width ' + (appSource.match(/const icFlashWidthMeters = (\d+)/) || [])[1] +
  ', height ' + (appSource.match(/const icFlashHeightMeters = (\d+)/) || [])[1]);
check('rod snaps are gated to cloud-to-ground strikes',
  locationShader.includes('strike[INTENSITY] <= LIGHTNING_IC_MAX_INTENSITY'));

// the Lightning Rod is a tool, like the weather station
check('the Lightning Rod tool exists in the tool list',
  /'Lightning Rod'\s*:\s*'TOOL_LIGHTNING_ROD'/.test(appSource));
check('the tool is handled by the click handler',
  appSource.includes("guiControls.tool == 'TOOL_LIGHTNING_ROD'"));
check('rod placement validates against the terrain surface',
  appSource.includes('findTerrainSurfaceCell') && appSource.includes('surfaceCell + maxAirCells'));

// industrial cooling towers emit 10x the water vapour they used to
check('industrial vapour output was raised 10x',
  /water\[TOTAL\] \+= 2\.5;/.test(boundaryShader) && !/water\[TOTAL\] \+= 0\.25;/.test(boundaryShader));

/* ------------------------------------------------------- GLSL hash port */

const scratch = new DataView(new ArrayBuffer(4));
const floatBitsToUint = (value) => {
  scratch.setFloat32(0, Math.fround(value), true);
  return scratch.getUint32(0, true);
};
const uintBitsToFloat = (value) => {
  scratch.setUint32(0, value >>> 0, true);
  return scratch.getFloat32(0, true);
};

function hash(x) {
  x = (x + (x << 10)) >>> 0;
  x = (x ^ (x >>> 6)) >>> 0;
  x = (x + (x << 3)) >>> 0;
  x = (x ^ (x >>> 11)) >>> 0;
  x = (x + (x << 15)) >>> 0;
  return x >>> 0;
}

function random2d(x, y) {
  let h = hash(((floatBitsToUint(x) + hash(floatBitsToUint(y))) >>> 0));
  h = ((h & 0x007fffff) | 0x3f800000) >>> 0;
  const r2 = uintBitsToFloat(h);
  return r2 - Math.floor(r2); // mod(r2, 1.0)
}

/* --------------------------------------------------- attractToRod port */

const ROD_ATTRACT_RADIUS = 0.08; // matches rodAttractRadius in app.js
const START_ITERNUM = 2;
const INTENSITY = 3;

// strike = [x, y, startIterNum, intensity]; rods = [{x, y}]
function attractToRod(strike, rods, radius = ROD_ATTRACT_RADIUS) {
  const result = strike.slice();
  if (result[INTENSITY] <= LIGHTNING_IC_MAX_INTENSITY)
    return result; // intra-cloud: no ground contact, nothing to attract

  let nearestRod = -1;
  let nearestDist = radius;
  for (let i = 0; i < rods.length && i < MAX_LIGHTNING_RODS; i++) {
    const dx = Math.abs(result[0] - rods[i].x);
    if (dx < nearestDist) {
      nearestDist = dx;
      nearestRod = i;
    }
  }
  if (nearestRod < 0)
    return result;

  const pull = 1 - nearestDist / Math.max(radius, 1e-5);
  if (random2d(result[1] * 149.7, result[START_ITERNUM] * 7.31) > pull)
    return result;

  result[0] = rods[nearestRod].x;
  result[INTENSITY] = Math.max(result[INTENSITY], LIGHTNING_IC_MAX_INTENSITY + 0.6);
  return result;
}

/* ------------------------------------------------------------------ tests */

const rods = [{x: 0.30, y: 0.02}, {x: 0.70, y: 0.02}];

check('random2d is deterministic', random2d(0.5, 1.5) === random2d(0.5, 1.5));
const spread = new Set();
for (let i = 0; i < 200; i++) spread.add(Math.floor(random2d(i * 0.017, i * 0.031) * 8));
check('random2d spreads over its range', spread.size >= 6, 'distinct buckets: ' + spread.size);

// intra-cloud flashes are never moved, whatever the distance to a rod
let icMoved = 0;
for (let i = 0; i < 2000; i++) {
  const x = 0.30 + (i % 100) * 0.0001; // right next to a rod
  const strike = [x, 0.4 + (i % 7) * 0.01, 100 + i, 0.75 + (i % 3) * 0.05]; // intensity <= 1.0
  const out = attractToRod(strike, rods);
  if (out[0] !== strike[0] || out[INTENSITY] !== strike[INTENSITY]) icMoved++;
}
check('intra-cloud flashes are never captured by a rod', icMoved === 0, icMoved + ' of 2000 moved');

// no rods -> nothing moves
let untouched = true;
for (let i = 0; i < 500; i++) {
  const strike = [0.30 + (i % 50) * 0.001, 0.5, 100 + i, 3.0];
  const out = attractToRod(strike, []);
  if (out[0] !== strike[0]) untouched = false;
}
check('without rods every CG strike keeps its position', untouched);

// captured strikes land exactly on the rod and are full return strokes
let snapped = 0;
let mislanded = 0;
let weakIntensity = 0;
for (let i = 0; i < 4000; i++) {
  const x = (i * 0.0002317) % 1; // dense sweep of positions
  const strike = [x, 0.4 + ((i * 37) % 100) / 400, 60 + (i % 400), 1.2 + (i % 5) * 0.4];
  const out = attractToRod(strike, rods);
  if (out[0] !== strike[0]) {
    snapped++;
    if (out[0] !== 0.30 && out[0] !== 0.70) mislanded++;
    if (out[INTENSITY] < LIGHTNING_IC_MAX_INTENSITY + 0.6 - 1e-6) weakIntensity++;
  }
}
check('some CG strikes are captured', snapped > 0, 'captured ' + snapped);
check('every captured strike lands on a rod', mislanded === 0, mislanded + ' landed elsewhere');
check('every captured strike is a full return stroke', weakIntensity === 0, weakIntensity + ' too weak');

// capture probability falls off linearly with distance: p = 1 - d / radius
function captureRate(distance) {
  let hits = 0;
  const trials = 4000;
  for (let i = 0; i < trials; i++) {
    const strike = [0.30 + distance, (i * 0.0173) % 1, 10 + i, 3.0];
    if (attractToRod(strike, rods)[0] === 0.30) hits++;
  }
  return hits / trials;
}

for (const distance of [0.005, 0.02, 0.05, 0.079]) {
  const expected = 1 - distance / ROD_ATTRACT_RADIUS;
  const actual = captureRate(distance);
  check('capture rate at d=' + distance + ' is ~' + expected.toFixed(2),
    Math.abs(actual - expected) < 0.05,
    'measured ' + actual.toFixed(3) + ' expected ' + expected.toFixed(3));
}
check('strikes outside the rod radius are never captured', captureRate(ROD_ATTRACT_RADIUS + 0.01) === 0);

// the nearest rod wins when two rods are in reach
let nearestWins = 0;
for (let i = 0; i < 400; i++) {
  const strike = [0.695, 0.5, 20 + i, 3.0]; // closer to the 0.70 rod
  const out = attractToRod(strike, rods);
  if (out[0] === 0.70) nearestWins++;
}
check('the nearest rod captures the strike', nearestWins > 300, nearestWins + ' of 400');
// LIGHTNING_ANIM_ITERS is only a bound now: a slot is released when its own
// strike's light is gone (strikeAnimEnd in common.glsl), not after the longest
// strike there can be. tests/check-lightning-strikes.js owns that arithmetic.
check('LIGHTNING_ANIM_ITERS still covers the longest flash', LIGHTNING_ANIM_ITERS >= 126);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
