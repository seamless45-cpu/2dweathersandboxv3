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
// The threshold between an intra-cloud flash and a cloud-to-ground stroke. It
// came down from 1.0 to 0.9 this round: a strike a tenth of an intensity unit
// below the old line now reaches the ground, which is what makes CG lightning more
// common in a storm without touching how the strikes themselves are drawn.
check('common.glsl declares the intra-cloud / cloud-to-ground threshold',
  LIGHTNING_IC_MAX_INTENSITY === 0.9, 'got ' + LIGHTNING_IC_MAX_INTENSITY);
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
    if (!fn || /shadowBlur|filter\s*=/.test(fn))
      return false;
    // Every stroke is either the channel itself or a *narrower* core inside it. A
    // painted halo would be a wider, dimmer stroke behind the channel, so that is
    // exactly what this rules out.
    const widths = fn.match(/ctx\.lineWidth = [^;]+;/g) || [];
    return widths.length >= 2 &&
           widths[0] === 'ctx.lineWidth = w;' &&
           widths.every((line) => line === 'ctx.lineWidth = w;' || /ctx\.lineWidth = w \* IC_CORE_WIDTH;/.test(line));
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
  displayShader.indexOf('icGlowCol * glow') < displayShader.indexOf('return vec4(light * icPower * icBrightness * icEnergy,') &&
  displayShader.indexOf('return vec4(light * icPower * icBrightness * icEnergy,') <
  displayShader.indexOf('vec3 gained = max(icLight, vec3(0.0))') &&
  displayShader.indexOf('vec3 gained = max(icLight, vec3(0.0))') <
  displayShader.indexOf('vec3 flashLight = vec3(1.0) - exp(-gained);'),
  'the halo has to be multiplied into the light before the cloud gain and the knee');

// The glare on a channel is the one part of an intra-cloud flash that is allowed
// past white, so that a channel blooms the way a cloud-to-ground bolt does. It has
// to go through its own ceiling - a ceiling high enough to reach the bloom's bright
// pass - and the wide ring must stay out of it.
{
  const num = (source, name) => Number((source.match(new RegExp('const (?:float|vec3) ' + name + ' = (?:vec3\\()?([\\d.]+)')) || [])[1]);
  const boost = num(displayShader, 'icFlareBoost');
  const ceiling = num(displayShader, 'icFlareCeiling');
  check('an intra-cloud channel carries a glare that is brighter than white',
    boost > 1 && ceiling > 100,
    'icFlareBoost ' + boost + ', icFlareCeiling ' + ceiling);
  check('the glare reaches past the bloom knee, so it actually blooms',
    /const float icFlareBoost = ([\d.]+);/.test(displayShader) &&
    Number((displayShader.match(/const float icFlareBoost = ([\d.]+);/) || [])[1]) * 0.02 > 0 &&
    /vec3 glareLight = vec3\(icFlareCeiling\) \* \(1\.0 - exp\(-max\(glare, vec3\(0\.0\)\) \/ icFlareCeiling\)\);/.test(displayShader),
    'the glare has to bypass the 1.0 knee that squeezes the rest of the flash');
  check('the wide ring and the network itself are not boosted',
    /glare = tight \* icGlowTight \+ mid \* icGlowMid \* 0\.55;/.test(displayShader) &&
    !/glare = wide/.test(displayShader),
    'a boosted wide ring is the white slab this pass exists to avoid');
  check('the flash itself is still compressed under 1.0',
    /vec3 flashLight = vec3\(1\.0\) - exp\(-gained\);/.test(displayShader) &&
    /return flashLight \+ glareLight \+ screenLight;/.test(displayShader));
}

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
  /if \(icLightPass > 0\.5\) \{[\s\S]{0,400}?fragmentColor = vec4\(softHdrClamp\(computeICLight\(\)\), 0\.0\);[\s\S]{0,80}?return;/.test(displayShader) &&
  /vec3 computeICLight\(\)/.test(displayShader) &&
  /vec4 ic = displayICLightning\(/.test(displayShader) &&
  /icLight \+= ic\.rgb;/.test(displayShader) &&
  /icGlare \+= ic\.a;/.test(displayShader));
check('the scene pass carries no IC light any more',
  /fragmentColor = vec4\(softHdrClamp\(max\(color \* finalLight, 0\.\) \+ emittedLight\), opacity\)/.test(displayShader) &&
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
  /vec3 flashLight = vec3\(1\.0\) - exp\(-gained\);/.test(displayShader) &&
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
  check('the intra-cloud pass is written through it too',
    /fragmentColor = vec4\(softHdrClamp\(computeICLight\(\), 0\.0\);|fragmentColor = vec4\(softHdrClamp\(computeICLight\(\)\), 0\.0\);/
      .test(displayShader) || /softHdrClamp\(computeICLight\(\)\)/.test(displayShader));
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

// A cloud-to-ground stroke does not only draw a bolt and a halo around it: it
// lights the frame. The scene pass lifts the cloudscape (through onLight, which
// multiplies the scene's own colour, so the structure survives), and the additive
// intra-cloud pass - which runs over the finished picture - carries the same flash
// into the sky the scene pass never touches. Both are driven by the strike's own
// intensity curve and both take the strongest running stroke, not the sum.
const lightningCurvePeak = (intensity) => 20.0 * intensity * intensity; // 1/(T*2)^3 at T0 = 0
{
  const screenGain = Number((displayShader.match(/const float icScreenFlashGain = ([\d.]+);/) || [])[1]);
  const screenCeiling = Number((displayShader.match(/const float icScreenFlashCeiling = ([\d.]+);/) || [])[1]);
  const sceneLift = Number((displayShader.match(/#define lightningScreenFlashBrightness ([\d.]+)/) || [])[1]);
  const skyLift = Number((displayShader.match(/#define lightningSkyLightBrightness ([\d.]+)/) || [])[1]);
  const frameLight = (intensity) => {
    const flash = lightningCurvePeak(intensity);
    return screenCeiling * (1 - Math.exp(-flash * screenGain / screenCeiling));
  };

  check('a cloud-to-ground stroke lights the frame, not just its own halo',
    Number.isFinite(sceneLift) && sceneLift > 0 &&
    /if \(lightningData\[INTENSITY\] > LIGHTNING_IC_MAX_INTENSITY\) \{[\s\S]{0,400}?screenFlash = max\(screenFlash, currentLightningIntensity\);/ .test(displayShader) &&
    /onLight \+= vec3\(0\.50, 0\.58, 1\.0\) \* \(screenFlash \* lightningScreenFlashBrightness\);/.test(displayShader),
    'the scene pass has to lift the whole cloudscape from the strongest stroke');
  check('... and the sky above the cloud deck as well',
    /cgFlash = max\(cgFlash, cgIntensity\);/ .test(displayShader) &&
    /return flashLight \+ glareLight \+ screenLight;/.test(displayShader),
    'the scene pass only draws clouds and terrain; the sky needs the additive pass');
  check('a storm-core stroke covers the frame',
    frameLight(2.5) > 1.0 && frameLight(4.5) <= screenCeiling,
    'frame-wide light ' + frameLight(2.5).toFixed(2) + ' HDR at intensity 2.5, ' +
    frameLight(4.5).toFixed(2) + ' at 4.5 (ceiling ' + screenCeiling.toFixed(2) + ')');
  check('a weak stroke only lifts it a little',
    frameLight(0.95) > 0.15 && frameLight(0.95) < frameLight(2.5) * 0.75,
    frameLight(0.95).toFixed(2) + ' HDR at the lowest cloud-to-ground intensity');
  check('the frame-wide light is bounded and cannot go infinite',
    Number.isFinite(screenCeiling) && screenCeiling > 0.5 && screenCeiling < 4 &&
    /screenCeiling \*|icScreenFlashCeiling \*/.test(displayShader),
    'ceiling ' + screenCeiling);
  check('an intra-cloud flash never lights the whole frame',
    !/screenFlash = max\(screenFlash, icIntensity\)/.test(displayShader),
    'an IC flash is light inside a cloud; the screen-wide term is for return strokes');
  check('the local sky lobe of a strike grew with it',
    Number.isFinite(skyLift) && skyLift > 0.0011,
    'lightningSkyLightBrightness ' + skyLift);
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
