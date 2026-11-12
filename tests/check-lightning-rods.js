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
check('a stroke draws the bolt and a flash draws the network',
  /lightningBoltLight \+= isFlash \? displayFlash\(lightningPos, lightningTime, currentLightningIntensity\)\s*\n\s*: displayLightning\(lightningPos, lightningTime, currentLightningIntensity\);/
    .test(displayShader) &&
  /bool isFlash = lightningData\[INTENSITY\] <= LIGHTNING_IC_MAX_INTENSITY;/.test(displayShader) &&
  !/lightningGroundHeight/.test(displayShader),
  'one channel down the picture for a stroke, one network across it for a flash');
check('a flash is not masked to the cloud it was born in',
  !/strikeLight \*= smoothstep\(0\.0, 3\.0, cloudDensity\);/.test(displayShader) &&
  /emittedLight \+= lightningBoltLight \/ \(1\. \+ cloudDensity \* 100\.0\);/.test(displayShader),
  'a channel that leaves one deck and crosses to the next is cloud-to-cloud lightning; the cloud filters the light, it does not cut the channel');
check('a flash reads its own artwork, mip-filtered, over a slab of the sky at true aspect ratio',
  /float pixVal = texture\(lightningNetworkTex, flashCoord\)\.r;/.test(displayShader) &&
  /const float networkTexAspect = networkTexRes\.x \/ networkTexRes\.y;/.test(displayShader) &&
  /vec2 flashSpan = vec2\(flashHeight \* networkTexAspect \/ aspectRatios\[0\], flashHeight\);/.test(displayShader) &&
  /texCoord\.x - mod\(pos\.x, 1\.\)\) \/ flashSpan\.x/.test(displayShader) &&
  /0\.5 \+ flashFlip \* \(texCoord\.y - pos\.y\) \/ flashSpan\.y/.test(displayShader),
  'the network artwork must keep its 2:1 world aspect ratio via aspectRatios[0] instead of squashing vertically');
check('a flash lights the slab it lives in and a stroke lights the cloud under it',
  /if \(isFlash\) \{\s*\n\s*\/\/ A flash lights the whole slab/.test(displayShader) &&
  /vec2 flashDist = vec2\(\(lightningPos\.x - texCoord\.x\) \* aspectRatios\[0\], texCoord\.y - lightningPos\.y\);/.test(displayShader) &&
  /vec2 dist = vec2\(lightningPos\.x - texCoord\.x, max\(\(abs\(lightningPos\.y \/ 2\. - texCoord\.y\) - 0\.1\), 0\.\)\);/.test(displayShader),
  'the shipped lobe is a point below the strike; a network is a slab');
check('a stroke still takes the shipped level-0 fetch of the bolt tile',
  /float pixVal = textureLod\(lightningTex, lightningTexCoord, 0\.0\)\.r;/.test(displayShader) &&
  !/mipped/.test(displayShader) && !/flash \? texture/.test(displayShader),
  'the stroke path must stay the code the app shipped with');
check('the network tile has a mip chain, and the bolt tiles do not need one',
  /gl\.generateMipmap\(gl\.TEXTURE_2D\);/.test(appSource) &&
  /gl\.TEXTURE_MIN_FILTER, gl\.LINEAR_MIPMAP_LINEAR/.test(appSource) &&
  /textureLod\(lightningTex, lightningTexCoord, 0\.0\)/.test(displayShader),
  'a flash reads the network averaged; a stroke reads level 0 of the bolt, so its chain was 33% of 12.5 MB for nothing');

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

check('the generator draws the two kinds of channel',
  !/mode === 'IC'/.test(generatorSource) && !/generateIntraCloudBolt/.test(generatorSource) &&
  /function generateLightningBolt\(/.test(generatorSource) &&
  /function generateLightningNetwork\(/.test(generatorSource) &&
  /const IC_ARTWORK_SIZE = \{ width : 512, height : 256 \};/.test(generatorSource),
  'the old filament mode stays gone; the network is the compact 2:1 curved tile');
check('the network forks, fans out from one strike point and never tapers to nothing',
  /leaders      : 6,/.test(generatorSource) && /forkChance   : 0\.018,/.test(generatorSource) &&
  /maxLevel     : 2,/.test(generatorSource) &&
  /IC_LEVELS = \[1\.0, 0\.78, 0\.58\]/.test(generatorSource),
  'a ladder of brightness, not pow(width, 2), and delicate curved forks');
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
  check('the channel is written as the shipped code wrote it',
    /pixVal \*= currentLightningIntensity;/.test(displayShader) &&
    !/curveShare/.test(displayShader) && !/cgChannelFalloff/.test(displayShader) &&
    !/lightningCurvePeak/.test(displayShader),
    'the curve times mainBoltBrightness, straight - no envelope and no easing of the tail');
}

// The bloom is where a bolt's light actually shows, and the shipped app took two
// percent of the whole frame into it and nothing else. That is what is back: no
// knee to single the channel out, no ceiling of its own, and no second lobe on the
// clouds. The one thing kept is the NaN backstop at the read, which cannot change
// the picture and is the guard the HDR chain is required to have.
{
  const brightParts = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'isolateBrightPartsShader.frag'), 'utf8');
  const post = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'postProcessingShader.frag'), 'utf8');

  check('the bright pass takes the two percent the app always took',
    /outputCol \*= 0\.02;/.test(brightParts) && /fragmentColor = vec3\(outputCol\);/.test(brightParts),
    'one multiply, the shipped one');
  check('nothing in the bright pass singles the channel out',
    !/brightKnee/.test(brightParts) && !/brightCeiling/.test(brightParts) &&
    !/brightGain/.test(brightParts) && !/ambientGain/.test(brightParts),
    'no knee, no ceiling, no second gain');
  check('the bloom composite is the shipped 0.990',
    /color \+= safeSample\(texture\(bloomTex, uv\)\.rgb\) \* 0\.990;/.test(post));
  check('the tonemap reads both buffers through a NaN and infinity guard',
    /vec3 safeSample\(vec3 value\)/.test(post) &&
    /color = safeSample\(texture\(hdrTex, uv\)\.rgb\);/.test(post),
    'postProcessingShader.frag has to guard what it reads');
}

// A cloud-to-ground stroke lights its own neighbourhood and no further: one lobe
// on the clouds around the channel, at the value the app shipped with, and no
// frame-wide term.
{
  const onLift = Number((displayShader.match(/#define lightningOnLightBrightness ([\d.]+)/) || [])[1]);

  check('a cloud-to-ground stroke lights the clouds around it',
    onLift === 0.004 &&
    /lightningOnLight = lightningOnLightBrightness \/ \(pow\(length\(dist\), 2\.\) \+ 0\.03\);/.test(displayShader) &&
    /onLight \+= vec3\(lightningOnLight\)/.test(displayShader),
    'the tight lobe has to sit on the channel it came from');
  check('there is no second, wide lobe any more',
    !/lightningSkyLightBrightness/.test(displayShader) && !/distanceSquared/.test(displayShader),
    'one lobe, as shipped');
  check('there is no frame-wide flash any more',
    !/lightningScreenFlashBrightness/.test(displayShader) &&
    !/screenFlash/.test(displayShader) &&
    !/icScreenFlash/.test(displayShader),
    'the screen-wide light of the later rounds is gone with the rest of the look');
  check('the lobe is driven by the strike\'s own curve',
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

// industrial cooling towers emit 10x the previous 2.5 water vapour output with a 30% bigger emitting spot
check('industrial vapour output was raised 10x with 30% bigger emitting spot',
  /water\[TOTAL\] \+= 25\.0 \* coolingSpotWeight;/.test(boundaryShader) &&
  /coolingSpotWeight = 0\.15;/.test(boundaryShader) &&
  /stackSpotWeight = 0\.15;/.test(boundaryShader) &&
  !/water\[TOTAL\] \+= 0\.25;/.test(boundaryShader));

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
