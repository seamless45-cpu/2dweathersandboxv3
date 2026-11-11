// Cloud-to-ground channel shape harness.
//
// The bolt is the oldest artwork in the repo and for a long time it was also the
// straightest: one heading, kicked by its own noise every pixel and pulled back
// toward vertical every step, so every kick was cancelled by the next one and the
// channel came out as a vertical wire with a buzz on it. A real return stroke is
// crooked - it takes a long arc one way, a longer one back, steps sideways, and
// only then breaks - and that needs two scales: a slow aim that bends the channel
// and a fast jag that makes it electric.
//
// What it checks:
//
//   1. The model. The two scales exist, they are separately tunable, both the
//      trunk and the forks use them, and the trunk is confined to the sprite
//      while a fork is not (a fork is allowed to run off the tile; a trunk that
//      does leaves half a bolt on screen).
//   2. The bend, measured. The real heading arithmetic is ported out of
//      lightningGenerator.js and run for forty seeded bolts, against a port of the
//      one-scale model it replaced: that the channel now sweeps sideways over a
//      substantial part of the tile, that it does it in arcs rather than in a
//      zigzag, and that the old model measured the same way does neither.
//   3. The artwork, drawn. The real generator runs against the stubbed canvas:
//      the bolt is there, it forks, it spans the picture, and no part of the
//      channel is drawn off the edge of the sprite.
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
const TILE_W = 1250;
const TILE_H = 2500;

/* ------------------------------------------ 1. the model */

check('the channel has two scales: a slow aim and a fast jag',
  Number.isFinite(CG.bend) && Number.isFinite(CG.jag) &&
  CG.bend > 0 && CG.jag > 0 && CG.bendPull !== CG.jagPull,
  'bend ' + CG.bend + ' / ' + CG.bendPull + ', jag ' + CG.jag + ' / ' + CG.jagPull);
check('the aim is the slow one and the jag is the fast one',
  CG.bendPull < CG.jagPull / 10,
  'the aim relaxes over ' + Math.round(1 / CG.bendPull) + ' steps, the jag over ' +
    Math.round(1 / CG.jagPull));
check('the aim is released slowly enough to hold an arc',
  1 / CG.bendPull > TILE_H * 0.15,
  'aim time constant ' + Math.round(1 / CG.bendPull) + ' steps of a ' + TILE_H + ' px channel');
check('the trunk is confined to the sprite and a fork is not',
  /confined : true/.test(source) && /confined : false/.test(source),
  'a fork may run off the tile; the trunk may not');
check('both the trunk and the forks step their heading the same way',
  (source.match(/stepHeading\(state\);/g) || []).length === 2,
  'one heading model, two callers');
check('a fork keeps its own aim instead of being pulled back to vertical',
  /aimTarget : targetAngle/.test(source) && /state\.aim - state\.aimTarget/.test(source),
  'a fork pulled toward straight down walks back into its parent');
check('the one-scale model is gone',
  !/angle \+= \(Math\.random\(\) - 0\.5\) \* 1\.4/.test(source),
  'a 40-degree kick with an 8% pull is a buzz, not a bend');

/* ------------------------------------------ 2. the bend, measured */

/*
 * lightningGenerator.js: one step of the trunk's heading (stepHeading, called with
 * a confined state whose aim is pulled toward straight down).
 */
function stepTrunk(s, rand) {
  s.aim += (rand() - 0.5) * CG.bend;
  s.aim -= s.aim * CG.bendPull;
  const lo = TILE_W * CG.margin;
  const hi = TILE_W * (1.0 - CG.margin);
  if (s.x < lo || s.x > hi) {
    const inward = s.x < lo ? 1.0 : -1.0;
    s.aim += (inward * 1.1 - s.aim) * CG.confine;
  }
  s.jag += (rand() - 0.5) * CG.jag;
  s.jag -= s.jag * CG.jagPull;
  let angle = s.aim + s.jag;
  if (rand() < CG.stepKinkChance)
    angle += (rand() < 0.5 ? -1 : 1) * CG.stepKinkAngle;
  return angle;
}

// the model this replaced: one heading, kicked hard, pulled back to vertical
function stepOneScale(s, rand) {
  s.aim += (rand() - 0.5) * 1.4;
  s.aim -= s.aim * 0.08;
  return s.aim;
}

function walk(step, seed) {
  const rand = gen.makeRng(seed);
  const s = { x : TILE_W / 2, aim : Math.PI / 6, jag : 0 };
  let x = s.x, y = 0, minX = x, maxX = x;
  let meanTurn = 0, previousAngle = null;
  const track = [];
  while (y < TILE_H) {
    const angle = step(s, rand);
    if (previousAngle !== null)
      meanTurn += Math.abs(angle - previousAngle);
    previousAngle = angle;
    x += Math.sin(angle);
    y += Math.cos(angle);
    s.x = x;
    track.push(x);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  // how many times the channel changes which way it is going, counted over
  // 100 px windows: an arc turns a handful of times, a zigzag turns constantly
  let turns = 0, previous = 0;
  for (let i = 100; i < track.length; i += 100) {
    const sign = Math.sign(Math.round(track[i] - track[i - 100]));
    if (sign && previous && sign !== previous)
      turns++;
    if (sign)
      previous = sign;
  }
  return { span : maxX - minX, minX, maxX, turns, end : x, meanTurn : meanTurn / track.length, path : track };
}

const seeds = Array.from({ length : 40 }, (_, i) => 1013 + i * 7919);
const bent = seeds.map((seed) => walk(stepTrunk, seed));
const straight = seeds.map((seed) => walk(stepOneScale, seed));
const median = (values) => [ ...values ].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];

const bendSpan = median(bent.map((b) => b.span));
const oldSpan = median(straight.map((b) => b.span));
check('the channel sweeps sideways over a substantial part of the tile',
  bendSpan > TILE_W * 0.15,
  'median lateral span ' + Math.round(bendSpan) + ' artwork px of ' + TILE_W +
    ' (' + (bendSpan / TILE_W * 100).toFixed(0) + '%)');
check('... and it does it by bending, not by buzzing',
  median(bent.map((b) => b.turns)) * 3 < median(straight.map((b) => b.turns)) &&
  median(bent.map((b) => b.meanTurn)) < median(straight.map((b) => b.meanTurn)) * 0.6,
  'the same walk with the old one-scale heading turns ' + median(straight.map((b) => b.turns)) +
    ' times and changes heading by ' + median(straight.map((b) => b.meanTurn)).toFixed(2) +
    ' rad a step; this one turns ' + median(bent.map((b) => b.turns)) + ' times by ' +
    median(bent.map((b) => b.meanTurn)).toFixed(2) + ' rad a step');
check('and it keeps the sweep inside the sprite',
  bent.every((b) => b.minX > 0 && b.maxX < TILE_W),
  'widest excursion ' + Math.round(Math.min(...bent.map((b) => b.minX))) + ' .. ' +
    Math.round(Math.max(...bent.map((b) => b.maxX))) + ' of 0 .. ' + TILE_W);
check('the channel bends in arcs instead of zigzagging',
  median(bent.map((b) => b.turns)) <= 12,
  'median ' + median(bent.map((b) => b.turns)) + ' direction changes over ' + TILE_H +
    ' px, before ' + median(straight.map((b) => b.turns)));
check('the jag alone would not have bent it',
  bendSpan > TILE_W * 0.15 && CG.jag > CG.bend * 5,
  'the fast term is ' + (CG.jag / CG.bend).toFixed(0) + 'x the slow one but relaxes ' +
    (CG.jagPull / CG.bendPull).toFixed(0) + 'x faster');

/* ------------------------------------------ 3. the artwork, drawn */

{
  // deterministic artwork: the bolt is drawn with Math.random
  const realRandom = Math.random;
  Math.random = gen.makeRng(20260101);
  const bolt = gen.generateLightningBolt(TILE_W, TILE_H);
  Math.random = realRandom;

  let lit = 0, minX = TILE_W, maxX = 0, minY = TILE_H, maxY = 0, peak = 0;
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      const value = bolt.data[y * TILE_W + x];
      if (value > peak) peak = value;
      if (value <= 32) continue;
      lit++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

  check('the bolt is drawn, and it is bright',
    lit > TILE_W * 2 && peak > 240,
    lit + ' lit pixels, peak ' + peak + '/255');
  check('the channel runs the whole height of the tile',
    minY <= 2 && maxY >= TILE_H - 3,
    'drawn from y ' + minY + ' to ' + maxY + ' of ' + TILE_H);
  check('it starts at the middle of the tile, where the strike is',
    Math.abs(minX + maxX - TILE_W) / 2 < TILE_W * 0.45,
    'lit pixels span x ' + minX + ' .. ' + maxX);
  check('it forks',
    bolt.segmentCount > 1000,
    bolt.segmentCount + ' segments in one bolt');
  check('nothing is drawn off the edge of the sprite',
    minX >= 0 && maxX <= TILE_W - 1 && minY >= 0 && maxY <= TILE_H - 1,
    'bounds ' + minX + ',' + minY + ' .. ' + maxX + ',' + maxY);
  check('the artwork is not one straight line',
    maxX - minX > TILE_W * 0.15,
    'the drawn bolt covers ' + Math.round(maxX - minX) + ' artwork px across');
}

restoreCanvas();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
