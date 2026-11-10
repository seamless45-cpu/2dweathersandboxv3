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
check('the IC atlas holds eight patterns in a 4x2 grid',
  String(appICtiles).trim() === 'icLightningAtlasColumns * icLightningAtlasRows' &&
  /const icLightningAtlasColumns = 4;/.test(appSource) &&
  /const icLightningAtlasRows = 2;/.test(appSource),
  'got ' + appICtiles);
check('the shader atlas grid matches app.js',
  /const vec2 icAtlasTiles = vec2\(4\.0, 2\.0\);/.test(displayShader) &&
  /const float icTileCount = 8\.0;/.test(displayShader) &&
  /const float icTileWidthPx = 1024\.0;/.test(displayShader) &&
  /const icLightningTileWidth = 1024;/.test(appSource));
check('the atlas texture is sized from those constants',
  /icLightningTileWidth \* icLightningAtlasColumns/.test(appSource) &&
  /icLightningTileHeight \* icLightningAtlasRows/.test(appSource) &&
  /tile % icLightningAtlasColumns/.test(appSource));
check('both lightning programs declare the rod uniforms',
  /uniform\s+vec2\s+rodPositions\[MAX_LIGHTNING_RODS\]/.test(locationShader) &&
  /uniform\s+vec2\s+rodPositions\[MAX_LIGHTNING_RODS\]/.test(displayShader));
check('strike dispatch uses LIGHTNING_IC_MAX_INTENSITY',
  displayShader.includes('lightningData[INTENSITY] > LIGHTNING_IC_MAX_INTENSITY'));
check('IC flashes are drawn with the generator artwork',
  displayShader.includes('displayICLightning') && appSource.includes("mode : 'IC'"));

const generatorSource = fs.readFileSync(path.join(ROOT, 'lightningGenerator.js'), 'utf8');

// Eight genuinely different shapes, and every one of them is reachable: a name
// in IC_VARIANTS that no branch draws would be a pattern that never appears.
const icVariants = (generatorSource.match(/const IC_VARIANTS = \[([^\]]*)\]/) || [])[1];
const variantNames = icVariants
  ? icVariants.split(',').map((name) => name.trim().replace(/^'|'$/g, '')).filter(Boolean)
  : [];
check('the IC generator offers eight different patterns',
  variantNames.length === 8,
  'IC_VARIANTS = ' + icVariants);
check('every IC pattern has its own drawing branch',
  variantNames.length > 0 && variantNames.every((name) =>
    new RegExp("style === '" + name + "'").test(generatorSource)),
  variantNames.filter((name) => !new RegExp("style === '" + name + "'").test(generatorSource)).join(','));
check('each atlas tile asks for its own pattern',
  /variant : tileIndex % 8/.test(appSource) && /msg\.variant/.test(generatorSource));

// A strike no longer shows the tile belonging to its slot: it picks one of the
// eight from its own start iteration and position, so consecutive flashes
// differ. That hash is the whole reason "the same patterns every time" is gone.
check('every strike picks its own tile instead of inheriting its slot\'s',
  /float tileHash = fract\(sin\(tileSeed/.test(displayShader) &&
  /float tileIndex = floor\(tileHash \* icTileCount\);/.test(displayShader) &&
  /vec2 tile = vec2\(mod\(tileIndex, icAtlasTiles\.x\), floor\(tileIndex \/ icAtlasTiles\.x\)\);/.test(displayShader) &&
  /lightningStartIterNum \* 0\.6180339 \+ float\(slot\) \* 11\.7/.test(displayShader));

// curvature has to survive the trip to the screen: the artwork is sampled
// zoomed-in (icArtZoom < 1) inside the same window the generator draws into
check('IC artwork is sampled zoomed-in so its curves reach the screen',
  /uniform float icArtZoom/.test(displayShader) && /local \* icArtZoom/.test(displayShader) &&
  /const icArtZoom = 0\.\d+/.test(appSource) &&
  parseFloat((appSource.match(/const icArtZoom = (0\.\d+)/) || [])[1]) < 1.0);
check('the generator draws only inside the window the shader samples',
  /const IC_STAGE_FRACTION = 0\.\d+/.test(generatorSource) &&
  Number(generatorSource.match(/const IC_STAGE_FRACTION = (0\.\d+)/)[1]) ===
    parseFloat(appSource.match(/const icArtZoom = (0\.\d+)/)[1]));

// Hair, not ribbon: the stroke widths are the point of this round.
const widthConst = (name) => {
  const match = generatorSource.match(new RegExp('const ' + name + ' = ([\\d.]+);'));
  return match ? Number(match[1]) : NaN;
};
check('IC strands are drawn hair-thin, not as ribbons',
  !/STROKE_SCALE = [\d.]+ \*/.test(generatorSource) &&
  widthConst('HAIR_W') > 0 && widthConst('HAIR_W') <= 0.6 &&
  widthConst('ARM_W') <= 1.6 && widthConst('TRUNK_W') <= 2.0,
  'HAIR_W=' + widthConst('HAIR_W') + ' ARM_W=' + widthConst('ARM_W') + ' TRUNK_W=' + widthConst('TRUNK_W'));
check('nothing widens a stroke after it is measured for tone',
  /ctx\.lineWidth = Math\.max\(0\.35, w\);/.test(generatorSource));
check('the strands taper, as a filament does',
  /const taper = st\.taper === undefined/.test(generatorSource) && /w = Math\.max\(minW, w \* taper\)/.test(generatorSource));

// The shader shows the tile as light, so a stroke that is nearly black is a
// channel that emits nothing: it reads as a dark silhouette instead of a
// channel. Every stroke has to stay above a floor.
check('no IC stroke is painted as a black silhouette',
  /const TONE_FLOOR = (\d+)/.test(generatorSource) &&
  Number(generatorSource.match(/const TONE_FLOOR = (\d+)/)[1]) >= 32 &&
  /Math\.max\(TONE_FLOOR, Math\.min\(255/.test(generatorSource));
// Strokes must not erase the halo (source-over) nor pile up into a saturated
// slab ('lighter'): 'lighten' takes the brighter of stroke and backdrop.
check('IC strokes only ever brighten the artwork',
  /globalCompositeOperation = 'lighten'/.test(generatorSource) &&
  !/globalCompositeOperation = 'lighter'/.test(generatorSource));

// The heading model is the round-7 change: noise-driven curvature instead of a
// heading that holds and kinks, which is what collapsed every IC channel into a
// horizontal noodle.
check('IC channels are grown from a drifting curvature (curls, not kinks)',
  /function stepHeading\(/.test(generatorSource) &&
  /s\.curvTarget \+= \(rand\(\) - 0\.5\) \* st\.curlDrift;/.test(generatorSource) &&
  /s\.curv \+= \(s\.curvTarget - s\.curv\) \* st\.curlResponse;/.test(generatorSource) &&
  /s\.axis \+= s\.curv;/.test(generatorSource));
check('no sine wave, no meander, no heading momentum',
  !/meanderAmp|meanderWave|meanderPhase/.test(generatorSource) &&
  !/wanderVel|maxCurve/.test(generatorSource) &&
  !/s\.runLeft/.test(generatorSource) &&
  !/Math\.sin\(s\.axis/.test(generatorSource) &&
  !/Math\.sin\(/.test((generatorSource.match(/function stepHeading[\s\S]*?\n\}/) || [''])[0]));
check('every IC channel class is tuned for curling (drift, response, maxCurv)',
  (generatorSource.match(/curlDrift : [\d.]+, curlResponse : [\d.]+, maxCurv : [\d.]+/g) || []).length >= 5);

{
  // The heading model is pure maths, so drive it here instead of trusting the
  // source: extract stepHeading() and makeRng() and run a long channel through
  // them, well inside the layer so the edge steering never fires.
  const fnSrc = (re) => (generatorSource.match(re) || [''])[0];
  const rngSrc = fnSrc(/function makeRng\(seed\) \{[\s\S]*?\n\}/);
  const headingSrc = fnSrc(/function stepHeading\(s, st, y, bandLo, bandHi, rand\) \{[\s\S]*?\n\}/);
  check('the IC heading model can be tested without a canvas', rngSrc.length > 0 && headingSrc.length > 0);

  const stepHeading = new Function(rngSrc + '\n' + headingSrc + '\nreturn stepHeading;')();
  const makeRng = new Function(rngSrc + '\nreturn makeRng;')();
  const rand = makeRng(20261124);

  const styleSrc = (generatorSource.match(/const armStyle = \{[\s\S]*?\};/) || [''])[0];
  const num = (name) => Number((styleSrc.match(new RegExp(name + ' : ([\\d.]+)')) || [])[1]);
  const st = {
    curlDrift : num('curlDrift'), curlResponse : num('curlResponse'), maxCurv : num('maxCurv'),
    kink : num('kink'), kinkChance : num('kinkChance'), bend : num('bend')
  };
  check('the arm style is readable', st.curlDrift > 0 && st.maxCurv > 0 && st.curlResponse > 0);

  const STEP_LEN_PX = 1024 / 900; // stepLen, in artwork pixels
  const N = 4000;
  const s = { axis : 0, curv : 0, curvTarget : 0 };
  const headings = new Float64Array(N);
  for (let i = 0; i < N; i++) headings[i] = stepHeading(s, st, 0, -1000, 1000, rand);

  const curv = [];
  for (let i = 1; i < N; i++) {
    let d = headings[i] - headings[i - 1];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    curv.push(d);
  }
  const absSorted = curv.map(Math.abs).sort((a, b) => a - b);
  const q = (p) => absSorted[Math.min(absSorted.length - 1, Math.floor(p * absSorted.length))];
  const radius = (c) => STEP_LEN_PX / Math.max(c, 1e-9);
  const medianRadius = radius(q(0.5));
  const tightRadius = radius(q(0.95));
  const totalTurn = curv.reduce((a, b) => a + Math.abs(b), 0);

  // How much of the channel runs at a real angle instead of hugging horizontal.
  const steep = Array.from(headings).filter((a) => Math.abs(Math.sin(a)) >= 0.25).length / N;
  // Direction reversals: a curler doubles back, a straight line never does.
  let reversals = 0;
  for (let i = 1; i < N; i++) {
    if (Math.cos(headings[i]) * Math.cos(headings[i - 1]) < 0) reversals++;
  }

  // Curl varies along a strand: window the curvature and see how much the local
  // amount of bending changes.
  const windows = [];
  for (let w = 0; w + 200 <= curv.length; w += 200) {
    let sum = 0;
    for (let i = w; i < w + 200; i++) sum += Math.abs(curv[i]);
    windows.push(sum / 200);
  }
  const windowMean = windows.reduce((a, b) => a + b, 0) / windows.length;
  const windowSpread = Math.sqrt(windows.reduce((a, b) => a + (b - windowMean) ** 2, 0) / windows.length)
    / Math.max(windowMean, 1e-9);

  check('an IC channel curls, it does not run straight',
    totalTurn >= Math.PI * 2,
    'the channel turns through ' + (totalTurn / Math.PI).toFixed(1) + ' pi over the run');
  check('the curl is hair-sized, not a coil',
    medianRadius >= 12 && medianRadius <= 120,
    'median arc radius ' + medianRadius.toFixed(0) + ' artwork px');
  check('and it tightens into real curls at times',
    tightRadius <= 30,
    'the tightest 5% of steps curl on a radius of ' + tightRadius.toFixed(0) + ' artwork px');
  check('an IC channel doubles back on itself like a hair',
    reversals >= N / 400,
    reversals + ' direction reversals in ' + N + ' steps');
  check('an IC channel is not a straight line hugging the horizontal',
    steep >= 0.45,
    'only ' + (steep * 100).toFixed(0) + '% of the channel runs at 14 degrees or more off horizontal');

  check('the curl keeps changing along a strand',
    windowSpread >= 0.25,
    'bending varies by ' + (windowSpread * 100).toFixed(0) + '% between stretches');
  check('the curl never exceeds the tightest radius the style allows',
    absSorted[absSorted.length - 1] <= st.maxCurv + st.kink + 1e-9,
    'largest step turn ' + absSorted[absSorted.length - 1].toFixed(3) + ' rad, limit '
    + (st.maxCurv + st.kink).toFixed(3));
}

check('the artwork is generated once per tile from a fixed, versioned seed',
  /seed : 1013 \+ tileIndex \* 7919/.test(appSource) &&
  /new Worker\('\.\/lightningGenerator\.js\?v=/.test(appSource));
check('a flash keeps its pattern for its whole life (no per-frame mirror or stretch)',
  // the shader must not derive any per-frame variation from the flash's age
  !/vec2 mirrored/.test(displayShader) && !/stretch\.x/.test(displayShader) &&
  !/seedA/.test(displayShader) &&
  /const float revealSpeed = 2\.4;/.test(displayShader));
// The flash is no longer masked or dimmed by the cloud it is in: light born
// inside a cloud does not have to get through that cloud, and the cloud is the
// medium that scatters it towards the viewer.
const icLightFn = (displayShader.match(/vec3 computeICLight\(\)[\s\S]*?\n\}/) || [''])[0];
// Light born inside a cloud is not dimmed by that cloud (it is the medium that
// scatters it towards the viewer), and what *does* depend on the cloud is a
// gain, so a flash inside one is seen through it.
check('IC light is not dimmed by the cloud it is in',
  icLightFn.length > 0 &&
  !/lightningICLight \//.test(displayShader) &&
  !/icLight \/ \(1\. \+ cloud/.test(icLightFn) &&
  /1\.0 \+ icCloudScatter \* cloudOpacity/.test(icLightFn));
{
  const gain = Number((displayShader.match(/const float icCloudScatter = ([\d\.]+)/) || [])[1]);
  check('an IC flash inside a cloud is seen through it',
    gain > 0 && gain <= 8,
    'icCloudScatter = ' + gain);
}
// The strike curve peaks around 20 for a couple of iterations; driving the
// artwork straight from it clipped the whole flash to a white slab.
check('the IC flash brightness is compressed so it cannot clip to a slab',
  /float icPower = currentLightningIntensity \//.test(displayShader) &&
  /\* reveal \* window \* icPower \* icBrightness/.test(displayShader));

// A sunlit cloud is brighter than the light of a channel, and alpha blending can
// only trade a backdrop for a source: a channel had to give up as much cloud as
// it was opaque and could not pay for it, which is why a flash that was plain
// against a dark sky was invisible inside a cloud. The light is therefore drawn
// by its own additive pass on top of the finished scene - addition cannot lose
// that trade.
check('the light pass returns only the flash light',
  /uniform float icLightPass/.test(displayShader) &&
  /if \(icLightPass > 0\.5\) \{\s*\n\s*fragmentColor = vec4\(computeICLight\(\), 0\.0\);\s*\n\s*return;\s*\n\s*\}/.test(displayShader) &&
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

// "Visible inside a cloud" as a number instead of an opinion. Everything below
// works in HDR units up to the tonemap in postProcessingShader.frag (ACES curve,
// then a gamma of 2.0 - see shaders/commonDisplay.glsl).
const toneMap = (c) => {
  c = Math.max(c, 0);
  const aces = Math.min(1, Math.max(0, (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14)));
  return 255 * Math.sqrt(aces);
};
check('the display model is the tonemap postProcessingShader.frag applies',
  /\(color \* \(2\.51 \* color \+ 0\.03\)\) \/ \(color \* \(2\.43 \* color \+ 0\.59\) \+ 0\.14\)/.test(
    fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'postProcessingShader.frag'), 'utf8')) &&
  /const float GAMMA = 2\.0;/.test(
    fs.readFileSync(path.join(ROOT, 'shaders', 'commonDisplay.glsl'), 'utf8')));

{
  const icBrightness = parseFloat((displayShader.match(/const float icBrightness = ([\d\.]+)/) || [])[1]);
  const icPowerPeak = 20 / (1 + 20 * 0.85); // the strike curve peaks around 20
  // The shader also multiplies by the minification of the sprite (artPerPixel,
  // clamped to 1..8): a hair-thin channel loses that much of itself to
  // filtering, and getting it back is what keeps a hair bright enough to see
  // without making every stroke a white slab. 4.3 is a flash covering 120 px.
  const energyClamp = displayShader.match(/clamp\(artPerPixel, 1\.0, ([\d\.]+)\)/);
  const icEnergyMax = energyClamp ? Number(energyClamp[1]) : 1;
  const icEnergy = Math.min(icEnergyMax, 4.3);
  // luminance of a channel, as the shader computes it (reveal and window are 1
  // at the core of a flash at full brightness)
  const channelLight = (artwork) => artwork * icPowerPeak * icBrightness * icEnergy;
  // What a channel samples to after the tile is minified into a flash of ~120
  // px: measured from the generated tiles (tools-level raster of the eight
  // patterns), the faintest hairs land near 0.03 and a bright trunk near 0.5.
  const artworkValues = [0.03, 0.06, 0.12, 0.3, 0.6, 1.0];
  const backdrops = { 'night sky': 0.02, 'day sky': 0.35, 'shaded cloud': 0.55, 'sunlit cloud': 1.0 };
  let worst = Infinity, worstWhere = '';
  for (const [name, backdrop] of Object.entries(backdrops)) {
    for (const art of artworkValues) {
      const contrast = toneMap(backdrop + channelLight(art)) - toneMap(backdrop);
      if (contrast < worst) { worst = contrast; worstWhere = name + ' at artwork ' + art; }
    }
  }
  check('an IC channel is visible inside a sunlit cloud', worst >= 12,
    'weakest channel is only ' + worst.toFixed(1) + '/255 above the backdrop (' + worstWhere + ')');

  // Seen through the cloud: inside one, the light is scaled by the cloud it is
  // scattered in, which is what keeps a channel readable against a sunlit cloud.
  {
    const scatter = Number((displayShader.match(/const float icCloudScatter = ([\d\.]+)/) || [])[1]);
    const density = Number((displayShader.match(/float cloudDensity = cloudWater \* ([\d\.]+)/) || [])[1]) || 13.6;
    const opacityOf = (water) => 1 - 1 / (1 + water * density);
    let worstInCloud = Infinity, where = '';
    for (const water of [0.005, 0.02, 0.05, 0.1, 0.2, 0.5]) {
      const gain = 1 + scatter * opacityOf(water);
      for (const art of [0.06, 0.12, 0.3, 0.6, 1.0]) {
        const contrast = toneMap(1.0 + channelLight(art) * gain) - toneMap(1.0);
        if (contrast < worstInCloud) { worstInCloud = contrast; where = 'cloud water ' + water + ', artwork ' + art; }
      }
    }
    check('a channel stays readable through a cloud (not just on its edge)',
      worstInCloud >= 20,
      'weakest is ' + worstInCloud.toFixed(1) + '/255 (' + where + ')');
  }

  // The square that used to be applied to the artwork (it suppressed the halo)
  // is what made this impossible: it left a hairline channel with a fraction of
  // a unit of light.
  const squared = (artwork) => toneMap(1.0 + artwork * artwork * icPowerPeak * icBrightness) - toneMap(1.0);
  check('the artwork is not squared any more (that crushed thin channels)',
    !/pow\(max\(pixVal, 0\.0\), 2\.0\)/.test(displayShader) &&
    squared(0.08) < 12,
    'squared curve would give ' + squared(0.08).toFixed(1) + '/255');

  // Additive light can only add: over the whole plausible range - a flash
  // fading from nothing to full brightness, over backdrops from a night sky to
  // a sunlit cloud - the picture is never darker, and always brighter as the
  // light grows.
  let darkening = 0, inversion = 0;
  for (let backdrop = 0.02; backdrop <= 3.0; backdrop += 0.02) {
    let previous = toneMap(backdrop);
    for (let L = 0; L <= 80; L += 0.05) {
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
  // what the tonemap in the post pass does to a value at the cap: finite, white,
  // not NaN
  const capped = toneMap(ceiling);
  check('a CG strike at the cap is still white, and finite',
    Number.isFinite(capped) && capped >= 254,
    'tonemapped to ' + capped.toFixed(1) + '/255');
}

// Glow layers are what a fading flash leaves behind as a dark rim, so an IC
// channel has to be the stroke and nothing else, like a CG bolt.
check('IC channels carry no glow layer',
  !/drawHalo/.test(generatorSource) &&
  !/faint glow pass/.test(generatorSource) &&
  (() => {
    const fn = (generatorSource.match(/function strokePath[\s\S]*?\n  \}/) || [''])[0];
    return (fn.match(/ctx\.stroke\(\)/g) || []).length === 1;
  })());
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
check('LIGHTNING_ANIM_ITERS covers the longest flash', LIGHTNING_ANIM_ITERS >= 112);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
