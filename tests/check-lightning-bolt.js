// Cloud-to-ground channel shape harness.
//
// The bolt is the oldest artwork in the repo. Its shape is one heading, kicked by
// its own noise every artwork pixel and pulled back toward straight down - a
// channel that buzzes down the picture. A two-scale heading (a slow aim for arcs,
// a fast jag for the buzz) was tried once and taken back out: it bent the channel,
// but it also thinned the bolt into a wandering line, and a return stroke reads as
// a *crack* - straight down, hard, and thick. What this file holds in place is
// therefore the original shape on purpose, the width of the channel, and the fact
// that the bolt is drawn at all.
//
// What it checks:
//
//   1. The model. One heading, the original two numbers, the same walk for the
//      forks, and no leftover of the two-scale version.
//   2. The channel's weight. It is the original 9 pixel channel on the original
//      2500 x 5000 tile, and asserted on the constant so it cannot quietly become
//      a hair or a slab. The fork this repo started from halved both and doubled
//      the brightness gain; the radiance is the same either way, so the check that
//      matters is pow(lineWidth, 2) and the ratio of the two.
//   3. The buzz, measured. The real heading arithmetic is ported out of
//      lightningGenerator.js and run for forty seeded bolts: the heading moves a
//      third of a radian per pixel and reverses direction many times over the
//      height - a saw, which is what the original was and what it is again - and
//      the trunk stays inside the sprite while it does it.
//   4. The artwork, drawn. The real generator runs against the stubbed canvas: the
//      bolt is there, it forks, and it spans the picture.
//
// Usage: node tests/check-lightning-bolt.js

'use strict';

const fs = require('fs');
const path = require('path');
const { installOffscreenCanvas } = require('./ic-canvas-stub.js');

const ROOT = path.join(__dirname, '..');
const restoreCanvas = installOffscreenCanvas();

const gen = require(path.join(ROOT, 'lightningGenerator.js'));
const source = fs.readFileSync(path.join(ROOT, 'lightningGenerator.js'), 'utf8');

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

const CG = gen.CG_SHAPE;
const TILE_W = gen.ARTWORK_SIZE.width;  // 2500, the original tile
const TILE_H = gen.ARTWORK_SIZE.height; // 5000

/* ---------------------------------------------- 1. the model */

check('the heading is the original jittered walk',
  CG.jitter === 1.4 && CG.straighten === 0.08 &&
  Math.abs(CG.startAngle - Math.PI / 6) < 1e-9 && CG.branchJitter === 0.7,
  'jitter ' + CG.jitter + ' rad, pull ' + CG.straighten + ', fork jitter ' + CG.branchJitter);
check('the two-scale heading is gone',
  !/state\.jag/.test(source) && !/aimTarget/.test(source) && !/CG_SHAPE\.bend/.test(source),
  'a slow aim plus a fast jag bent the channel, and thinned the bolt doing it');
check('the original step is what runs: next position, then the kick',
  /const nextX = startX \+ Math\.sin\(angle\);\s*\n\s*const nextY = startY \+ Math\.cos\(angle\);\s*\n\s*\n\s*angle \+= \(Math\.random\(\) - 0\.5\) \* CG_SHAPE\.jitter;/
    .test(source),
  'the order of the step and the kick is part of the shape');

/* ---------------------------------------------- 2. the channel's weight */

check('the tile is the original 2500 x 5000',
  TILE_W === 2500 && TILE_H === 5000,
  'artwork ' + TILE_W + ' x ' + TILE_H + ' - the fork this repo started from had halved it');
check('a return stroke is drawn at the original channel width',
  CG.lineWidth === 9.0,
  'lineWidth ' + CG.lineWidth + ' artwork px on a ' + TILE_W + ' px tile - the width the app shipped with');
check('a fork sheds the original fifth of a pixel as it narrows',
  CG.taper === 0.2,
  'taper ' + CG.taper + ' artwork px per step');
check('the artwork carries the original radiance, not the fork\'s doubled gain',
  /Math\.pow\(lineWidth, 2\.0\)/.test(source) && Math.pow(CG.lineWidth, 2) === 81,
  'pow(' + CG.lineWidth + ', 2) = ' + Math.pow(CG.lineWidth, 2) +
    '; the half-size fork wrote pow(lineWidth * 2, 2) to match, which is why halving it changed nothing on screen but everything in texels');
check('its forks leave at up to half the trunk, as they always did',
  CG.branchWidthRatio === 0.5,
  'a fork leaves at up to ' + CG.branchWidthRatio + ' of the trunk');
check('and it is the only channel width there is now',
  CG.lineWidth >= 9 && !/IC_WIDTH/.test(source),
  'every strike is drawn with this one channel');

/* ---------------------------------------------- 3. the buzz, measured */

/*
 * lightningGenerator.js: the trunk's step. `state.angle` is the heading, `state.x`
 * the chicken scratch this harness walks, which is the channel's own x.
 */
function stepTrunk(s, rand) {
  const nextX = s.x + Math.sin(s.angle);
  s.angle += (rand() - 0.5) * CG.jitter;
  s.angle -= (s.angle - 0) * CG.straighten;
  s.x = nextX;
  return nextX;
}

function walk(seed) {
  const rand = gen.makeRng(seed);
  const s = { x : TILE_W / 2, angle : CG.startAngle };
  let x = s.x, y = 0, minX = x, maxX = x;
  let turnSum = 0, previous = null;
  const track = [];
  while (y < TILE_H) {
    const before = s.angle;
    x = stepTrunk(s, rand);
    y += Math.cos(before);
    track.push(x);
    if (s.angle !== previous) {
      if (previous !== null)
        turnSum += Math.abs(s.angle - previous);
      previous = s.angle;
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  // how many times the channel changes which way it is going, over 100 px windows
  let turns = 0, sign = 0;
  for (let i = 100; i < track.length; i += 100) {
    const here = Math.sign(Math.round(track[i] - track[i - 100]));
    if (here && sign && here !== sign)
      turns++;
    if (here)
      sign = here;
  }
  return { span : maxX - minX, minX, maxX, turns, meanTurn : turnSum / track.length };
}

const bolts = Array.from({ length : 40 }, (_, i) => walk(1013 + i * 7919));
const median = (values) => [ ...values ].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];

check('the channel buzzes: it changes heading by about a third of a radian a pixel',
  median(bolts.map((b) => b.meanTurn)) > 0.25,
  'median ' + median(bolts.map((b) => b.meanTurn)).toFixed(2) + ' rad per artwork pixel');
check('... and reverses direction many times over the height of the picture',
  median(bolts.map((b) => b.turns)) >= 10,
  'median ' + median(bolts.map((b) => b.turns)) + ' changes of direction over ' + TILE_H + ' px');
check('the wire it runs down is straight enough to be a wire',
  median(bolts.map((b) => b.span)) < TILE_W * 0.45,
  'median lateral span ' + Math.round(median(bolts.map((b) => b.span))) + ' of ' + TILE_W +
    ' artwork px');
check('and the trunk stays inside the sprite',
  bolts.every((b) => b.minX > 0 && b.maxX < TILE_W),
  'widest excursion ' + Math.round(Math.min(...bolts.map((b) => b.minX))) + ' .. ' +
    Math.round(Math.max(...bolts.map((b) => b.maxX))) + ' of 0 .. ' + TILE_W);

/* ---------------------------------------------- 4. the artwork, drawn */

{
  const realRandom = Math.random;
  Math.random = gen.makeRng(20260101);
  const bolt = gen.generateLightningBolt(TILE_W, TILE_H);
  Math.random = realRandom;

  let lit = 0, minY = TILE_H, maxY = 0, peak = 0;
  let trunkRows = 0;
  const rowWidths = [];
  for (let y = 0; y < TILE_H; y++) {
    let run = 0, longest = 0;
    for (let x = 0; x < TILE_W; x++) {
      const value = bolt.data[y * TILE_W + x];
      if (value > peak) peak = value;
      if (value <= 32) {
        run = 0;
        continue;
      }
      lit++;
      run++;
      if (run > longest) longest = run;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (longest > 0) { trunkRows++; rowWidths.push(longest); }
  }
  // The widest run in a row is the trunk where the channel is near vertical and a
  // long smear where it kinks, so the median of that over the height of the tile
  // is the width of the channel the player actually sees.
  const sortedWidths = rowWidths.slice().sort((a, b) => a - b);
  const medianRun = sortedWidths.length ? sortedWidths[Math.floor(sortedWidths.length / 2)] : 0;

  check('the bolt is drawn, and it is bright',
    lit > TILE_W * 2 && peak > 240,
    lit + ' lit pixels, peak ' + peak + '/255');
  check('the channel runs the whole height of the tile',
    minY <= 2 && maxY >= TILE_H - 3,
    'drawn from y ' + minY + ' to ' + maxY + ' of ' + TILE_H);
  check('the drawn channel is as wide on the artwork as its constant says',
    medianRun >= CG.lineWidth - 1 && medianRun <= CG.lineWidth + 4,
    'the median crossing is ' + medianRun + ' px for a lineWidth of ' + CG.lineWidth);
  check('it forks',
    bolt.segmentCount > 1000,
    bolt.segmentCount + ' segments in one bolt');
  check('it is not one straight line',
    trunkRows > TILE_H * 0.9 && bolts[0].span > TILE_W * 0.04,
    trunkRows + ' rows carry the channel, and it wanders as it goes');
}

/* ---------------------------------------- 5. the artwork at load time */

/*
 * A tile is a 2500 x 5000 canvas in a worker (a 50 MB backing store, drawn with
 * tens of thousands of line segments) and then a 12.5 MB texture. Doing that at
 * load - which is what this did, two at once, in the middle of shader compilation
 * and buffer creation - is the hitch at the end of the loading bar, and on a
 * device with a tight memory budget it takes the graphics context with it.
 */
{
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const workerBlock = app.slice(app.indexOf('let lightningTexturesReady'),
                                app.indexOf('const emptyLightningTexturePixel'));

  check('no artwork is generated while the loading screen is up',
    !/for \(let i = 0; i < Math\.min\(2/.test(app) &&
    /setTimeout\(startLightningTextureWorker, 1200\);/.test(app),
    'the first tile is asked for after the first frames, not during them');
  check('one worker at a time, and never twice in a second',
    /lightningTextureWorkerBusy/.test(workerBlock) &&
    /performance\.now\(\) - lightningTextureLastStart < 1000/.test(workerBlock) &&
    !/startLightningTextureWorker\(\);\s*\}\);/.test(workerBlock),
    'the old code chained the next worker straight out of onmessage');
  check('the artwork is capped at two tiles, and at one after a context loss',
    /const numLightningTextures = readLightningTileBudget\(\);/.test(app) &&
    /if \(Number\.isFinite\(stored\) && stored >= 1 && stored <= 2\)\s*\n\s*return stored;/.test(app) &&
    /return 2;/.test(app) &&
    /if \(lightningTexturesReady < numLightningTextures\)/.test(workerBlock),
    '12.5 MB a tile: two is a quarter of the renderer, ten was all of it and more');
  check('the artwork crosses to the main thread as one byte per texel',
    /postMessage\(\{width : artwork\.width, height : artwork\.height, data : artwork\.data\},/.test(source) &&
    /const rgba = ctx\.getImageData\(0, 0, width, height\)\.data;/.test(source) &&
    !/transferToImageBitmap\(\)/.test(source.split('function readRedChannel')[1] || ''),
    'a canvas is RGBA whatever is drawn on it: 50 MB handed over to become 12.5 MB');

  /* The artwork is posted, not returned: it has to survive the structured clone
   * that postMessage performs. Anything hung off it that is not data - a method, a
   * getter on a class instance - throws DataCloneError *inside the worker*, the
   * artwork never arrives, and the display has no lightning channel at all, of
   * either kind. That is what happened when a `close()` method on the returned
   * object outlived the ImageBitmap it was written for. */
  check('the artwork survives being posted out of the worker',
    (() => {
      for (const artwork of [gen.generateLightningBolt(400, 700), gen.generateLightningNetwork(320, 80)]) {
        let clone;
        try {
          clone = structuredClone(artwork, {transfer : [artwork.data.buffer]});
        } catch (error) {
          return 'postMessage would throw: ' + error.name + ': ' + error.message;
        }
        if (!(clone.data instanceof Uint8Array) || clone.data.length !== artwork.width * artwork.height)
          return 'the clone did not carry the picture';
        if (!clone.data.some((value) => value > 0))
          return 'the clone carried an empty picture';
      }
      return true;
    })(),
    'this is the whole lightning channel: if it cannot be sent, nothing is drawn');

  check('the worker says what it is sending, field by field',
    /data : artwork\.data\}/.test(source) &&
    /\[artwork\.data\.buffer\]\);/.test(source) &&
    !/close\(\)\s*\{\s*\}/.test(source),
    'the payload is built here, so nothing added to the generator can break the wire');
  check('the upload asks the driver for exactly the bytes it has',
    /gl\.texImage2D\(gl\.TEXTURE_2D, 0, gl\.R8, artwork\.width, artwork\.height, 0, gl\.RED, gl\.UNSIGNED_BYTE, artwork\.data\)/
      .test(app) && !/bitmap\.close\(\)/.test(app),
    'no RGBA bitmap in the upload path, so no RGBA temporary on the GPU');
  check('a lost context leaves a lighter next load behind',
    /localStorage\.setItem\('lightningTileBudget', '1'\)/.test(app) &&
    /if \(graphicsContextLost\)\s*\/\/ nothing can be uploaded/.test(workerBlock),
    'the browser does not say how much memory it wanted; it says no');
  check('the bolt tiles carry no mip chain, because nothing samples one',
    !/gl\.generateMipmap\(gl\.TEXTURE_2D\);\s*\n\s*gl\.texParameteri\(gl\.TEXTURE_2D, gl\.TEXTURE_MIN_FILTER, gl\.LINEAR_MIPMAP_LINEAR\);/
      .test(app.split('function generateLightningTexture')[1].split('function generateLightningNetworkTexture')[0]) &&
    /textureLod\(lightningTex, lightningTexCoord, 0\.0\)/
      .test(fs.readFileSync(path.join(ROOT, 'shaders/fragment/realisticDisplayShader.frag'), 'utf8')),
    '33% of 12.5 MB a tile, plus a generateMipmap over four megatexels, for nothing');
  check('the flash network is one small tile, asked for after the first bolt',
    /kind : 'network'/.test(workerBlock) &&
    /kind : 'network', width : 512, height : 256/.test(workerBlock) &&
    /if \(lightningTexturesReady < 1\)\s*\n\s*return \{kind : 'bolt', index : 0\};\s*\n\s*if \(!lightningNetworkReady\)/.test(workerBlock),
    'both kinds need a picture early, and the compact network is ~128 KB, not twelve MB');
  check('the display never samples a tile that has not been drawn yet',
    /const lightningTexNum = Math\.min\(wantedLightningTexNum, Math\.max\(lightningTexturesReady - 1, 0\)\);/.test(app),
    'a missing tile must not mean an invisible bolt');
  check('a failed worker backs off instead of retrying every frame',
    /lightningTextureFailures\+\+/.test(workerBlock) &&
    /lightningTextureFailures >= 4/.test(workerBlock),
    'four attempts, six seconds apart, then it gives up');

  /* A worker that dies takes every channel with it and there is no fallback, so a
   * failure has to arrive in the console with enough detail to find it: the file and
   * line the worker threw on, and a second line when the retries are exhausted. The
   * bug that made both kinds of lightning invisible was a `DataCloneError` inside
   * the worker and a single generic console line on this side. */
  check('a worker that dies says so, with the file and line, and again when it gives up',
    /onerror = event =>/.test(workerBlock) &&
    /event\.filename/.test(workerBlock) && /event\.lineno/.test(workerBlock) &&
    /onmessageerror/.test(workerBlock) &&
    /could not be transferred out of the worker/.test(workerBlock) &&
    /no lightning channel will be drawn/.test(workerBlock),
    'silence here is indistinguishable from "lightning does not work"');
  check('a lost graphics context is reported instead of leaving a black tab',
    /addEventListener\('webglcontextlost'/.test(app) &&
    /event\.preventDefault\(\);/.test(app) &&
    /graphicsContextLost\)\s*\/\/ nothing left to draw with/.test(app),
    'the overlay offers a reload; draw() stops instead of writing into a dead context');
}

/* The artwork has to be bright enough for the display to draw it at all.
 *
 * `displayLightning` subtracts a threshold from the tile's red channel and
 * multiplies what is left by a hundred thousand; on the main stroke that threshold
 * is 0.95, so a texel below 243/255 contributes nothing and a trunk drawn dimmer
 * than that would be a bolt that is not there. The trunk is written at
 * `12 * lineWidth^2` on a 9 pixel channel, which saturates, and this is the check
 * that it still does after anything touches the generator. */
const boltArtwork = gen.generateLightningBolt(TILE_W, TILE_H);
const trunkPeaks = [0.2, 0.5, 0.8].map((yFraction) => {
  const row = Math.floor(boltArtwork.height * yFraction);
  let peak = 0;
  for (let x = 0; x < boltArtwork.width; x++)
    peak = Math.max(peak, boltArtwork.data[row * boltArtwork.width + x]);
  return peak;
});
check('the trunk is bright enough to survive the display threshold',
  trunkPeaks.every((peak) => peak >= 245),
  'peaks ' + trunkPeaks.join(', ') + ' out of 255; the display subtracts 0.95 before it draws anything');

const networkArtwork = gen.generateLightningNetwork(512, 256);
check('the flash network carries light too',
  networkArtwork.data.some((value) => value >= 245),
  'a tile with no bright texel is not a channel');

/* ---------------------------------------- the network curves, it does not rake
 *
 * A flash is fine curved channels arcing through a cloud cell, not a giant
 * horizontal rake of straight lines. `makeIcStrand`/`icHeadingStep` sweeps
 * continuously along C-arcs and S-bends (`sweepAmp`, `waveAmp`) rather than
 * oscillating symmetrically back and forth around one straight line.
 */
function traceNetwork(rand) {
  const S = gen.IC_SHAPE;
  let bow = 0, ratio = 0, reach = 0, n = 0;
  for (let r = 0; r < 200; r++) {
    const axis = (r / 200) * Math.PI * 2;
    const sign = r % 2 === 0 ? 1 : -1;
    const steps = 140;
    const strand = gen.makeIcStrand(axis, sign, steps, rand);
    let x = 256, y = 128; // centered strike point on the 512 x 256 tile
    const pts = [[x, y]];
    for (let i = 0; i < steps; i++) {
      const angle = gen.icHeadingStep(strand, rand, x / 512, y / 256, 0.5);
      const nextX = x + Math.cos(angle) * S.stepLength;
      const nextY = y + Math.sin(angle) * S.stepLength;
      if (nextX < 2 || nextX > 510 || nextY < 2 || nextY > 254) break;
      x = nextX; y = nextY; pts.push([x, y]);
    }
    if (pts.length < 40) continue;
    const length = Math.hypot(x - 256, y - 128) || 1;
    const ux = (x - 256) / length, uy = (y - 128) / length;
    let deviation = 0;
    for (const [px, py] of pts)
      deviation = Math.max(deviation, Math.abs((px - 256) * uy - (py - 128) * ux));
    bow += deviation; ratio += deviation / length; reach += length; n++;
  }
  return {bow : bow / n, ratio : ratio / n, reach : reach / n, strands : n};
}

const seeded = (seed) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const curvedNetwork = traceNetwork(seeded(4242));

// The same walk with curvature zeroed out - straight rays with jitter only.
const savedSweep = gen.IC_SHAPE.sweepAmp;
const savedSweepSpread = gen.IC_SHAPE.sweepSpread;
const savedAmplitude = gen.IC_SHAPE.waveAmp;
const savedSpread = gen.IC_SHAPE.waveAmpSpread;
gen.IC_SHAPE.sweepAmp = 0;
gen.IC_SHAPE.sweepSpread = 0;
gen.IC_SHAPE.waveAmp = 0;
gen.IC_SHAPE.waveAmpSpread = 0;
const rakedNetwork = traceNetwork(seeded(4242));
gen.IC_SHAPE.sweepAmp = savedSweep;
gen.IC_SHAPE.sweepSpread = savedSweepSpread;
gen.IC_SHAPE.waveAmp = savedAmplitude;
gen.IC_SHAPE.waveAmpSpread = savedSpread;

check('a channel sweeps through the layer instead of running in a straight line',
  curvedNetwork.ratio > 0.11,
  'the paths bow ' + (curvedNetwork.ratio * 100).toFixed(1) + '% of their own chord; ' +
  'straight lines with noise bow under 4%');

check('that bow is the course curving, not the buzz',
  curvedNetwork.bow > rakedNetwork.bow * 3.0,
  'curved ' + curvedNetwork.bow.toFixed(1) + 'px against ' + rakedNetwork.bow.toFixed(1) +
  'px with curvature zeroed out: the arc must dominate the noise');

check('the arcs stay inside the tile, so a channel keeps its length',
  curvedNetwork.reach > 120,
  'mean chord ' + curvedNetwork.reach.toFixed(0) + 'px on a 512 x 256 tile: strands should stay cleanly inside the tile');

const curvedCoverage = [];
for (let i = 0; i < 8; i++) {
  const artwork = gen.generateLightningNetwork(512, 256);
  let lit = 0;
  for (const value of artwork.data)
    if (value > 38) lit++;
  curvedCoverage.push(lit / artwork.data.length * 100);
}
const coverageMin = Math.min(...curvedCoverage);
const coverageMax = Math.max(...curvedCoverage);
check('the curved network is fine and sparse, not a bloated white web',
  coverageMin > 1.0 && coverageMax < 6.0,
  'coverage above the display threshold is ' + coverageMin.toFixed(1) + '-'
  + coverageMax.toFixed(1) + '% of the tile');

{
  const displayShader = fs.readFileSync(path.join(ROOT, 'shaders/fragment/realisticDisplayShader.frag'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const flashHeight = Number((displayShader.match(/const float flashHeight = ([\d.]+);/) || [])[1]);
  const threshold = Number((displayShader.match(/const float flashThreshold = ([\d.]+);/) || [])[1]);

  check('displayFlash keeps compact world scale instead of filling huge stretches of sky',
    Number.isFinite(flashHeight) && flashHeight > 0.03 && flashHeight <= 0.10,
    'flashHeight ' + flashHeight + ' (must stay compact inside a convective cell)');

  check('displayFlash keeps true 2:1 world aspect ratio so IC curves are not squashed',
    /vec2 flashSpan = vec2\(flashHeight \* networkTexAspect \/ aspectRatios\[0\], flashHeight\);/.test(displayShader) &&
    /const vec2 networkTexRes = vec2\(512\.0, 256\.0\);/.test(displayShader),
    'flashSpan must match the 512 x 256 artwork aspect ratio via aspectRatios[0]');

  check('displayFlash keeps flashThreshold low enough that mipmapped fine curved branches stay continuous',
    Number.isFinite(threshold) && threshold > 0 && threshold <= 0.05,
    'flashThreshold ' + threshold + ' (high thresholds break thin curved branches into dots under mipmapping)');

  check('app.js requests the IC network tile early even before iterNum >= 400 or on low tile budget',
    /if \(!lightningNetworkReady \|\| wantedLightningTexNum >= lightningTexturesReady\)/.test(app),
    'waiting for wantedLightningTexNum >= lightningTexturesReady stalls IC network generation');
}

restoreCanvas();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
