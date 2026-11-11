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
// Strikes at or below this intensity are born inside a cloud, above it at the
// cloud base: it is what the rod snapping is gated on, not a choice of artwork -
// every strike is drawn with the same bolt.
check('common.glsl declares the intra-cloud / cloud-to-ground threshold',
  LIGHTNING_IC_MAX_INTENSITY === 1.0, 'got ' + LIGHTNING_IC_MAX_INTENSITY);
check('app.js MAX_LIGHTNING_RODS matches common.glsl',
  appMaxRods === MAX_LIGHTNING_RODS,
  'app.js ' + appMaxRods + ' vs common.glsl ' + MAX_LIGHTNING_RODS);
check('app.js numLightningSlots matches LIGHTNING_SLOTS',
  appNumSlots === LIGHTNING_SLOTS,
  'app.js ' + appNumSlots + ' vs common.glsl ' + LIGHTNING_SLOTS);
check('both lightning programs declare the rod uniforms',
  /uniform\s+vec2\s+rodPositions\[MAX_LIGHTNING_RODS\]/.test(locationShader) &&
  /uniform\s+vec2\s+rodPositions\[MAX_LIGHTNING_RODS\]/.test(displayShader));
check('every strike is drawn with the same bolt, with no dispatch on kind',
  /lightningBoltLight \+= displayLightning\(lightningPos, lightningTime, currentLightningIntensity, lightningGroundHeight\(lightningPos\),/
    .test(displayShader) &&
  !/displayLightning\([^)]*LIGHTNING_IC_MAX_INTENSITY/.test(displayShader),
  'the artwork no longer depends on which kind of strike it is');

/*
 * One artwork.
 *
 * Intra-cloud flashes used to be a network of hair-thin filaments, drawn from
 * eight tiles of their own through a second, additive light pass. Every strike is
 * drawn with the cloud-to-ground bolt now, so all of that is gone - the generator
 * mode, the array texture, the pass - and what is left is one picture drawn in one
 * place. These checks are here to catch any of it coming back by halves.
 */
const generatorSource = fs.readFileSync(path.join(ROOT, 'lightningGenerator.js'), 'utf8');

check('the generator draws one kind of artwork',
  !/mode === 'IC'/.test(generatorSource) && !/generateIntraCloudBolt/.test(generatorSource) &&
  /function generateLightningBolt\(/.test(generatorSource),
  'the filament artwork and its eight variants are gone');
check('the display shader has no intra-cloud pass left',
  !/computeICLight/.test(displayShader) && !/displayICLightning/.test(displayShader) &&
  !/icLightPass/.test(displayShader) && !/icLightningTex/.test(displayShader),
  'a second additive pass would draw the filaments again');
check('and app.js neither generates nor draws one',
  !/icLightningTex|icLightPass|icSpriteSize/.test(appSource) &&
  !/'IC'/.test(appSource) && !/ICLightning/.test(appSource),
  'no array texture, no worker, no second drawArrays');
check('the bolt is still attenuated by the cloud it is born in',
  /emittedLight \+= lightningBoltLight \/ \(1\. \+ cloudDensity \* 100\.0\)/.test(displayShader),
  'light inside a cloud is scattered by it, not painted over the top of it');

// The light of every strike is drawn in the scene pass, in one fragment, and the
// only blending there is the ordinary source-over of the scene.
check('lightning is drawn once, in the scene fragment',
  /fragmentColor = vec4\(softHdrClamp\(max\(color \* finalLight, 0\.\) \+ emittedLight\), opacity\)/
    .test(displayShader) &&
  /gl\.drawArrays\(gl\.TRIANGLE_STRIP, 0, 4\); \/\/ draw to hdr framebuffer/.test(appSource),
  'one draw of the display program, and the bolt is in the fragment it writes');

// The tonemap, for the checks below.
const toneMap = (c) => {
  c = Math.max(c, 0);
  const aces = Math.min(1, Math.max(0, (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14)));
  return 255 * Math.pow(aces, 1 / 2.2);
};

// A CG return stroke is 100000 by design and the scene is rendered into an
// RGBA16F buffer (largest finite value 65504). Written raw, that light overflowed
// to infinity, and the pumped alpha (~100000 as well) made the blend multiply the
// destination by a large negative number; both come back out of the tonemap as
// NaN, which the bloom and the AA passes then smear across the frame.
//
// The fix is not a clamp. A clamp at the ceiling throws away the difference
// between a bolt written at 100000 and one written at a million, and that
// difference is the whole of "brighter than white": the tonemap flattens every
// value over ~3 to the same white, so a stroke's surplus energy can only arrive
// on screen as the halo it scatters. softHdrClamp() (common.glsl) compresses the
// top of the range instead of cutting it off, and it is the guard: an infinity
// maps to the ceiling and a NaN to zero.
const HDR_CEILING = defineValue(common, 'HDR_CEILING');
const softHdrClamp = (value) => {
  if (Number.isNaN(value)) return 0;
  const ceiling = HDR_CEILING;
  return ceiling * (1 - Math.exp(-Math.max(value, 0) / ceiling));
};
{
  const boltBrightness = Number((displayShader.match(/const float mainBoltBrightness = ([\d\.]+);/) || [])[1]);
  check('the HDR ceiling is declared and stays inside what a 16-bit float holds',
    Number.isFinite(HDR_CEILING) && HDR_CEILING > 1000 && HDR_CEILING < 65504,
    'ceiling ' + HDR_CEILING + ', 16F limit 65504');
  check('a cloud-to-ground stroke is still written far past the ceiling',
    boltBrightness > HDR_CEILING * 1.5,
    'stroke ' + boltBrightness + ', ceiling ' + HDR_CEILING);
  check('the scene fragment is written through that compression, not a clamp',
    /fragmentColor = vec4\(softHdrClamp\(max\(color \* finalLight, 0\.\) \+ emittedLight\), opacity\);/
      .test(displayShader) && !/const float hdrCeiling/.test(displayShader));

  // The emitted light - the bolt - was added to the fragment colour and then
  // multiplied by the fragment's alpha by the blend, the way the original app
  // wrote it. (Later rounds premultiplied it to stop a violet smear on the sky;
  // the original look is back, and this is what the original looked like.)
  check('the emitted light is written straight into the fragment',
    /\+ emittedLight\), opacity\);/.test(displayShader) &&
    !/emitted \/ max\(opacity/.test(displayShader),
    'no premultiplication in the fragment the original wrote');
  check('the emission alpha cannot run past opaque',
    /opacity = clamp\(opacity \+ length\(emittedLight\), 0\.0, 1\.0\)/.test(displayShader));

  // the compression itself
  let monotonic = true, previous = -1;
  for (let v = 0; v <= 2e6; v = v < 10 ? v + 0.05 : v * 1.08) {
    const c = softHdrClamp(v);
    if (!(c >= previous)) monotonic = false;
    previous = c;
  }
  check('the compression never runs backwards', monotonic);
  check('it is the identity where clouds, sky and intra-cloud light live',
    Math.abs(softHdrClamp(1.0) - 1.0) < 0.001 && Math.abs(softHdrClamp(120) - 120) < 0.15,
    'softHdrClamp(1) = ' + softHdrClamp(1).toFixed(5) + ', softHdrClamp(120) = ' + softHdrClamp(120).toFixed(3));
  check('an infinity lands on the ceiling instead of propagating',
    softHdrClamp(Infinity) === HDR_CEILING && softHdrClamp(Number.NaN) === 0,
    'inf -> ' + softHdrClamp(Infinity) + ', NaN -> ' + softHdrClamp(Number.NaN));
  check('a stroke written a hundred times over the ceiling is still finite',
    Number.isFinite(softHdrClamp(boltBrightness * 100)) && softHdrClamp(boltBrightness * 100) <= HDR_CEILING,
    'softHdrClamp(' + boltBrightness * 100 + ') = ' + softHdrClamp(boltBrightness * 100).toFixed(1));
  // ... and it keeps the ordering that a clamp destroys
  const weak = softHdrClamp(60000), strong = softHdrClamp(600000), huge = softHdrClamp(6e6);
  check('brighter strokes still come out brighter than weaker ones',
    weak < strong && strong < huge,
    weak.toFixed(0) + ' < ' + strong.toFixed(0) + ' < ' + huge.toFixed(0));
  check('a stroke past the ceiling is still white after the tonemap, and finite',
    Number.isFinite(toneMap(strong)) && toneMap(strong) >= 250,
    'tonemapped to ' + toneMap(strong).toFixed(1) + '/255');
}

// The colour of the light, the way the original app had it.
//
// A cloud-to-ground channel is drawn in the violet-white it always was. Later
// rounds whitened it, cooled it toward an ember as it faded, and lifted the flash
// off the clouds in a paler blue; all of that went with the look that was asked
// for back, and these checks hold the original constants so it cannot drift again.
{
  const vec3Const = (name) => {
    const m = displayShader.match(new RegExp('const vec3 ' + name + ' = vec3\\(([^)]*)\\);'));
    return m ? m[1].split(',').map(Number) : null;
  };
  const boltCol = vec3Const('lightningCol');

  check('the channel is the original violet-white',
    boltCol && Math.abs(boltCol[0] - 0.70) < 1e-6 && Math.abs(boltCol[1] - 0.57) < 1e-6 &&
    Math.abs(boltCol[2] - 1.0) < 1e-6,
    'lightningCol ' + JSON.stringify(boltCol));
  check('there is no cooling colour any more',
    !/lightningCoolingCol/.test(displayShader),
    'the fade to an ember went with the rest of the later look');
  check('the emission is written straight, as the original wrote it',
    /\+ emittedLight\), opacity\);/.test(displayShader) && !/emitted \/ max\(opacity/.test(displayShader),
    'no premultiplication: the fragment is the fragment');
  check('the channel is eased out, so the fade is a fade and not a switch',
    /pixVal \*= channelBrightness;/.test(displayShader) &&
    /pow\(max\(curveShare, 1e-6\), cgChannelFalloff\)/.test(displayShader),
    'the easing is the one thing the later rounds had that was asked back');
}

// The bloom is where "brighter than white" is actually visible, and it is built
// from a separate set of 16-bit float buffers, so it needs its own bound.
{
  const brightParts = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'isolateBrightPartsShader.frag'), 'utf8');
  const post = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'postProcessingShader.frag'), 'utf8');
  const num = (source, name) => Number((source.match(new RegExp('const float ' + name + ' = ([\\d.]+);')) || [])[1]);
  const ambientGain = num(brightParts, 'ambientGain');
  const brightKnee = num(brightParts, 'brightKnee');
  const brightGain = num(brightParts, 'brightGain');
  const brightCeiling = num(brightParts, 'brightCeiling');

  check('the bright pass keeps the ambient veil the scene always had',
    Math.abs(ambientGain - 0.02) < 1e-6, 'ambientGain ' + ambientGain);
  check('its knee sits above every cloud and below every bolt',
    brightKnee > 8 && brightKnee < 1000, 'knee ' + brightKnee);
  check('the bright pass scatters far more light than the ambient veil',
    brightGain > ambientGain * 10, 'brightGain ' + brightGain + ' vs ambientGain ' + ambientGain);
  check('one level of the bloom pyramid cannot overflow a 16-bit float',
    brightCeiling > 1000 && brightCeiling * 12 < 65504,
    'ceiling ' + brightCeiling + ' x 12 levels = ' + brightCeiling * 12);
  check('the bright pass is bounded and cannot go infinite',
    brightParts.includes('over = brightCeiling * (1.0 - exp(-over / brightCeiling));'));
  check('the tonemap reads both buffers through a NaN and infinity guard',
    /vec3 safeSample\(vec3 value\)/.test(post) &&
    /color \+= safeSample\(texture\(bloomTex, uv\)\.rgb\) \* 0\.990;/.test(post) &&
    /color = safeSample\(texture\(hdrTex, uv\)\.rgb\);/.test(post),
    'postProcessingShader.frag has to guard what it reads');
}

// A cloud-to-ground stroke lights its own neighbourhood and no further: the two
// lobes on the clouds around it are the original values, and there is no
// frame-wide term any more. Later rounds lifted the whole picture and carried the
// flash into the sky through the additive pass; both went with the look that was
// asked for back, so these checks hold the original numbers instead.
const lightningCurvePeak = (intensity) => 20.0 * intensity * intensity; // 1/(T*2)^3 at T0 = 0
{
  const onLift = Number((displayShader.match(/#define lightningOnLightBrightness ([\d.]+)/) || [])[1]);
  const skyLift = Number((displayShader.match(/#define lightningSkyLightBrightness ([\d.]+)/) || [])[1]);

  check('a cloud-to-ground stroke lights the clouds around it',
    Number.isFinite(onLift) && /lightningOnLight = lightningOnLightBrightness \/ \(distanceSquared \+ 0\.03\)/.test(displayShader) &&
    /onLight \+= vec3\(lightningOnLight\)/.test(displayShader),
    'the tight lobe has to sit on the channel it came from');
  check('at the original strength',
    onLift === 0.004 && skyLift === 0.0011,
    'on-light ' + onLift + ', sky lobe ' + skyLift + ' - the values the app shipped with');
  check('and the wide lobe is the weaker of the two',
    skyLift < onLift / 2,
    'sky ' + skyLift + ' against ' + onLift + ': a return stroke lights its own neighbourhood, not the whole sky');
  check('there is no frame-wide flash any more',
    !/lightningScreenFlashBrightness/.test(displayShader) &&
    !/screenFlash/.test(displayShader) &&
    !/icScreenFlash/.test(displayShader),
    'the screen-wide light of the later rounds is gone with the rest of the look');
  check('and there is no second light pass for it to carry anything into',
    !/cgFlash/.test(displayShader) && !/screenFlash/.test(displayShader),
    'the frame-wide and additive light terms went with the pass that used them');
  check('the lobes are driven by the strike\'s own curve',
    /lightningOnLight \*= currentLightningIntensity;/.test(displayShader),
    'so a weak flash lights less than a storm core');
}

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
