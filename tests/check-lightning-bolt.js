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
  check('the artwork is capped at four tiles',
    /const numLightningTextures = 4;/.test(app) &&
    /if \(lightningTexturesReady < numLightningTextures\)/.test(workerBlock),
    '12.5 MB a tile: ten of them is 125 MB of texture');
  check('the flash network is one small tile, asked for after the first bolt',
    /kind : 'network'/.test(workerBlock) &&
    /kind : 'network', width : 2048, height : 512/.test(workerBlock) &&
    /if \(lightningTexturesReady < 1\)\s*\n\s*return \{kind : 'bolt', index : 0\};\s*\n\s*if \(!lightningNetworkReady\)/.test(workerBlock),
    'both kinds need a picture early, and the network is a megabyte, not twelve');
  check('the display never samples a tile that has not been drawn yet',
    /const lightningTexNum = Math\.min\(wantedLightningTexNum, Math\.max\(lightningTexturesReady - 1, 0\)\);/.test(app),
    'a missing tile must not mean an invisible bolt');
  check('a failed worker backs off instead of retrying every frame',
    /lightningTextureFailures\+\+/.test(workerBlock) &&
    /lightningTextureFailures >= 4/.test(workerBlock),
    'four attempts, six seconds apart, then it gives up quietly');
  check('a lost graphics context is reported instead of leaving a black tab',
    /addEventListener\('webglcontextlost'/.test(app) &&
    /event\.preventDefault\(\);/.test(app) &&
    /graphicsContextLost\)\s*\/\/ nothing left to draw with/.test(app),
    'the overlay offers a reload; draw() stops instead of writing into a dead context');
}

restoreCanvas();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
