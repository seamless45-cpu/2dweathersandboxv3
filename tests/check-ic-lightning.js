// Intra-cloud lightning harness.
//
// Every other lightning test in this repo reads source text; this one runs the
// real code. It loads lightningGenerator.js with a stubbed 2D canvas
// (tests/ic-canvas-stub.js), draws the eight array-texture layers, and then
// measures them -
// and it ports the display shader's intra-cloud maths to JS so the artwork can be
// judged at the size and the zoom a player actually sees it at.
//
// What it checks, in order:
//
//   1. The channel model. Heading statistics driven straight through
//      icStepHeading(): bounded (no loops), kinked (not a spline), aperiodic (and
//      a sine control proves the aperiodicity metric would catch a sine).
//   2. The artwork. Eight tiles rasterised and measured: thin strokes, a
//      brightness hierarchy, a connected network rather than confetti, no strokes
//      against the tile edge, no duplicates, every tile different from every other.
//   3. The screen. The IC pass ported line by line from
//      realisticDisplayShader.frag and run over a range of sprite sizes, in cloud
//      and in clear air, through the strike curve and the reveal, for many strikes.
//   3b. The halo. The glow around a channel is drawn out of the artwork's own mip
//      chain, so it is measured the same way: that it exists, that it is colder
//      than the channels, that it dies away inside its reach, that it never
//      outshines the channel it came from and that it cannot fill the frame.
//   4. Consistency. The tile size, layer count and filtering in app.js against the
//      shader, and the constants the two have to agree on.
//
// Usage: node tests/check-ic-lightning.js

'use strict';

const fs = require('fs');
const path = require('path');
const { installOffscreenCanvas } = require('./ic-canvas-stub.js');

const ROOT = path.join(__dirname, '..');
const restoreCanvas = installOffscreenCanvas();

const gen = require(path.join(ROOT, 'lightningGenerator.js'));

const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const shaderSource = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'realisticDisplayShader.frag'), 'utf8');

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

const TILE_W = 256;
const TILE_H = 128;
const TILES = 8;
const SEED = (v) => 1013 + v * 7919;

const shaderNumber = (name, pattern) => {
  const match = shaderSource.match(pattern || new RegExp('const float ' + name + ' = ([\\d.]+);'));
  return match ? Number(match[1]) : NaN;
};

// The display shader's own constants, so a retune in one place cannot silently
// disagree with what is being tested here.
const IC_BRIGHTNESS = shaderNumber('icBrightness');
const IC_CLOUD_SCATTER = shaderNumber('icCloudScatter');
const IC_TILE_WIDTH = shaderNumber('icTileWidthPx');
const IC_TILE_COUNT = shaderNumber('icTileCount');
const IC_POWER_KNEE = Number((shaderSource.match(/currentLightningIntensity \/ \(1\.0 \+ currentLightningIntensity \* ([\d.]+)\)/) || [])[1]);
const IC_ENERGY_MAX = Number((shaderSource.match(/clamp\(artPerPixel, ([\d.]+), ([\d.]+)\)/) || [])[2]);
const IC_ENERGY_MIN = Number((shaderSource.match(/clamp\(artPerPixel, ([\d.]+), ([\d.]+)\)/) || [])[1]);
// the halo (see displayICLightning in realisticDisplayShader.frag)
const IC_GLOW_TIGHT_BIAS = shaderNumber('icGlowTightBias');
const IC_GLOW_MID_LOD = shaderNumber('icGlowMidLod');
const IC_GLOW_WIDE_LOD = shaderNumber('icGlowWideLod');
const IC_GLOW_TIGHT = shaderNumber('icGlowTight');
const IC_GLOW_MID = shaderNumber('icGlowMid');
const IC_GLOW_WIDE = shaderNumber('icGlowWide');
const IC_GLOW_COL = (() => {
  const m = shaderSource.match(/const vec3 icGlowCol = vec3\(([\d.]+), ([\d.]+), ([\d.]+)\);/);
  return m ? [ Number(m[1]), Number(m[2]), Number(m[3]) ] : null;
})();
// the glare on the channels (see displayICLightning / computeICLight)
const IC_FLARE_BOOST = shaderNumber('icFlareBoost');
const IC_FLARE_CEILING = shaderNumber('icFlareCeiling');
const IC_FLARE_COL = (() => {
  const m = shaderSource.match(/const vec3 icFlareCol = vec3\(([\d.]+), ([\d.]+), ([\d.]+)\);/);
  return m ? [ Number(m[1]), Number(m[2]), Number(m[3]) ] : null;
})();
// the bloom's bright pass, which is what a glare has to cross to be a glow
const BLOOM_KNEE = Number((fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'isolateBrightPartsShader.frag'), 'utf8')
  .match(/const float brightKnee = ([\d.]+);/) || [])[1]);

// how far past the sprite the halo is allowed to reach, in sprite halves, and
// the fade that gets it there - both read from the shader, not copied
const IC_HALO_REACH = Number((shaderSource.match(/if \(reach > ([\d.]+)\)/) || [])[1]);
const IC_HALO_SOFT = (() => {
  const m = shaderSource.match(/1\.0 - smoothstep\(([\d.]+), ([\d.]+), max\(edge\.x, edge\.y\)\)/);
  return m ? [ Number(m[1]), Number(m[2]) ] : [ NaN, NaN ];
})();


/* =========================== 1. the channel model ========================= */

{
  const rand = gen.makeRng(424242);
  const noise = gen.makeNoise1D(gen.makeRng(9911));

  const N = 3000;
  const state = { aim : 0.3, jitter : 0, travelled : 0, untilKink : 0, stepLen : 0.6 };
  const headings = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    headings[i] = gen.icStepHeading(state, {}, rand, noise, 17.0, 1.0);
    state.travelled += 0.6;
  }

  /* deviation from the aim */
  let maxDeviation = 0;
  for (let i = 0; i < N; i++)
    maxDeviation = Math.max(maxDeviation, Math.abs(headings[i] - 0.3));

  check('a channel heading can never wind a full turn (no loops)',
    gen.IC_MAX_DEVIATION < Math.PI,
    'IC_MAX_DEVIATION = ' + gen.IC_MAX_DEVIATION.toFixed(2) + ' rad, a loop needs ' + Math.PI.toFixed(2));
  check('and in practice it stays inside that bound',
    maxDeviation <= gen.IC_MAX_DEVIATION + 1e-9,
    'largest deviation ' + maxDeviation.toFixed(3) + ' rad, bound ' + gen.IC_MAX_DEVIATION.toFixed(3));

  /* per-step turning: is it a run of jagged steps or a smooth spline? */
  const turn = new Float64Array(N - 1);
  for (let i = 1; i < N; i++) turn[i - 1] = headings[i] - headings[i - 1];

  const absTurn = Array.from(turn, Math.abs);
  const meanTurn = absTurn.reduce((a, b) => a + b, 0) / absTurn.length;
  const totalTurn = absTurn.reduce((a, b) => a + b, 0);
  const maxTurn = Math.max.apply(null, absTurn);

  check('a channel does not run straight',
    totalTurn >= Math.PI * 2,
    'it turns through ' + (totalTurn / Math.PI).toFixed(1) + ' pi over the run');
  /* The structure that matters is the one a player can see, so sample the heading
   * every 4 artwork pixels - the kink period - rather than every 0.6 px step. */
  const sampled = [];
  for (let i = 0; i < N; i += 7) sampled.push(headings[i]);
  let sampleTurn = 0, maxSampleTurn = 0;
  for (let i = 1; i < sampled.length; i++) {
    const d = Math.abs(sampled[i] - sampled[i - 1]);
    sampleTurn += d;
    maxSampleTurn = Math.max(maxSampleTurn, d);
  }
  const meanSampleTurn = sampleTurn / (sampled.length - 1);
  check('the channel is built from visible kinks, not a spline',
    meanSampleTurn >= 0.06 && maxSampleTurn >= 0.20,
    'mean |turn| ' + meanSampleTurn.toFixed(3) + ' rad per 4 artwork px, largest ' + maxSampleTurn.toFixed(3));

  /* No dead-straight stretch longer than a few pixels: a channel that holds its
     heading for tens of pixels is the noodle this round exists to remove. */
  let run = 0, longestRun = 0;
  for (let i = 0; i < turn.length; i++) {
    if (Math.abs(turn[i]) < 0.004) { run++; longestRun = Math.max(longestRun, run); }
    else run = 0;
  }
  check('there is no long dead-straight stretch in a channel',
    longestRun * 0.6 <= 45,
    'longest straight run ' + (longestRun * 0.6).toFixed(0) + ' artwork px');

  /* Aperiodicity. A sine's turning sequence is a tone, so its autocorrelation at
     the period is near 1; a noise-driven heading must never reach that. The sine
     control below is the point: it proves the metric would catch a sine, so a pass
     here means something. */
  function maxAutocorrelation(series, minLag, maxLag) {
    const n = series.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += series[i];
    mean /= n;
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (series[i] - mean) ** 2;
    if (variance <= 0) return 1;
    let worst = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < n; i++) sum += (series[i] - mean) * (series[i + lag] - mean);
      worst = Math.max(worst, Math.abs(sum / variance));
    }
    return worst;
  }

  const modelCorrelation = maxAutocorrelation(turn, 8, 400);
  check('the curl of a channel does not repeat at any lag',
    modelCorrelation < 0.5,
    'largest autocorrelation of the turning sequence ' + modelCorrelation.toFixed(3) + ' over lags 8..400');

  const sine = new Float64Array(N - 1);
  for (let i = 0; i < sine.length; i++) sine[i] = Math.sin(i * 2 * Math.PI / 30);
  const sineCorrelation = maxAutocorrelation(sine, 8, 400);
  check('... and the aperiodicity test would have caught a sine',
    sineCorrelation > 0.9,
    'a sine of period 30 scores ' + sineCorrelation.toFixed(3) + ' on the same test');

  /* determinism: the same seed and the same noise give the same channel */
  const replay = () => {
    const r = gen.makeRng(424242);
    const nz = gen.makeNoise1D(gen.makeRng(9911));
    const st = { aim : 0.3, jitter : 0, travelled : 0, untilKink : 0, stepLen : 0.6 };
    let sum = 0;
    for (let i = 0; i < 500; i++) { sum += Math.sin(gen.icStepHeading(st, {}, r, nz, 17.0, 1.0)); st.travelled += 0.6; }
    return sum;
  };
  check('the channel model is deterministic', Math.abs(replay() - replay()) < 1e-12);

  /* the noise itself */
  const noiseProbe = gen.makeNoise1D(gen.makeRng(7));
  let noiseMin = Infinity, noiseMax = -Infinity, maxJump = 0;
  let previous = noiseProbe(0);
  for (let x = 0; x < 4000; x += 0.01) {
    const value = noiseProbe(x);
    noiseMin = Math.min(noiseMin, value);
    noiseMax = Math.max(noiseMax, value);
    maxJump = Math.max(maxJump, Math.abs(value - previous));
    previous = value;
  }
  check('the value noise stays in range and is smooth',
    noiseMin >= -1 && noiseMax <= 1 && maxJump < 0.06,
    'range ' + noiseMin.toFixed(2) + '..' + noiseMax.toFixed(2) + ', largest jump over 0.01 ' + maxJump.toFixed(4));
  check('the smooth octaves share no common period',
    Math.abs(gen.IC_SMOOTH_SCALE.mid / gen.IC_SMOOTH_SCALE.long - 0.5) > 0.08,
    'scales ' + gen.IC_SMOOTH_SCALE.mid + ' and ' + gen.IC_SMOOTH_SCALE.long);
}

check('the IC artwork offers more than one layout family',
  gen.IC_VARIANTS.length >= 3 && gen.IC_VARIANTS.length <= 8,
  gen.IC_VARIANTS.join(', '));
check('channel tiers go from a bright trunk down to a faint wisp',
  gen.IC_TONE.trunk > gen.IC_TONE.arm && gen.IC_TONE.arm > gen.IC_TONE.hair &&
  gen.IC_TONE.hair > gen.IC_TONE.wisp,
  JSON.stringify(gen.IC_TONE));
check('every tier is drawn at least one artwork pixel wide',
  gen.IC_WIDTH.trunk >= 1 && gen.IC_WIDTH.arm >= 1 && gen.IC_WIDTH.hair >= 1 && gen.IC_WIDTH.wisp >= 1,
  JSON.stringify(gen.IC_WIDTH));
check('a trunk is a channel, not a ribbon',
  gen.IC_WIDTH.trunk <= 4.5,
  'trunk ' + gen.IC_WIDTH.trunk + ' artwork px');
check('tiles get their own parameters from their own seed',
  JSON.stringify(gen.drawICParams(gen.makeRng(5), 0)) !== JSON.stringify(gen.drawICParams(gen.makeRng(5), 1)) &&
  JSON.stringify(gen.drawICParams(gen.makeRng(5), 0)) === JSON.stringify(gen.drawICParams(gen.makeRng(5), 0)));


/* ============================ 2. the artwork ============================= */

const tiles = [];
for (let v = 0; v < TILES; v++)
  tiles.push(gen.generateIntraCloudBolt(TILE_W, TILE_H, SEED(v), v));

function stats(tile) {
  const data = tile.data;
  let lit = 0, bright = 0, mid = 0, dim = 0, saturated = 0, sum = 0;
  let minX = TILE_W, maxX = 0, minY = TILE_H, maxY = 0;
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const value = data[y * TILE_W + x];
      if (value < 8) continue;
      lit++;
      sum += value;
      if (value >= 0.75 * 255) bright++;
      else if (value >= 0.40 * 255) mid++;
      else dim++;
      if (value >= 250) saturated++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return {
    lit : lit, bright : bright, mid : mid, dim : dim, saturated : saturated,
    mean : lit ? sum / lit : 0,
    coverage : lit / (TILE_W * TILE_H),
    bounds : { minX : minX, maxX : maxX, minY : minY, maxY : maxY },
    strokes : tile.strokeCount,
    segmentCount : tile.segmentCount
  };
}

const tileStats = tiles.map(stats);

check('every tile draws something', tileStats.every((s) => s.lit > 500));
check('every tile keeps its ink to the sprite (no strokes past the margin)',
  tileStats.every((s) => s.bounds.minX >= 2 && s.bounds.minY >= 2 &&
                           s.bounds.maxX <= TILE_W - 3 && s.bounds.maxY <= TILE_H - 3),
  tileStats.map((s) => JSON.stringify(s.bounds)).join(' '));
check('a flash covers a sane share of its sprite',
  tileStats.every((s) => s.coverage > 0.01 && s.coverage < 0.25),
  'coverage ' + tileStats.map((s) => (s.coverage * 100).toFixed(1) + '%').join(' '));
check('the artwork has a visible brightness hierarchy',
  tileStats.every((s) => s.bright > s.lit * 0.03 && s.mid > s.lit * 0.05 && s.dim > s.lit * 0.10),
  tileStats.map((s) => `bright ${(s.bright / s.lit * 100).toFixed(0)}% mid ${(s.mid / s.lit * 100).toFixed(0)}% dim ${(s.dim / s.lit * 100).toFixed(0)}%`).join(' | '));
/* No single tier may be most of the ink: a flash whose trunk drowns its branches
 * is the flat scribble this round is fixing. Measured against the tile's own
 * brightest pixel, so it is a statement about hierarchy and not about gain. */
{
  const shares = tileStats.map((s, i) => {
    let top = 0;
    for (let p = 0; p < tiles[i].data.length; p++) top = Math.max(top, tiles[i].data[p]);
    let pinnacle = 0;
    for (let p = 0; p < tiles[i].data.length; p++)
      if (tiles[i].data[p] >= top * 0.85) pinnacle++;
    return { share : pinnacle / Math.max(1, s.lit), top : top };
  });
  check('no single brightness tier is most of the ink',
    shares.every((s) => s.share < 0.50),
    shares.map((s) => (s.share * 100).toFixed(0) + '% at the top tier').join(' '));
}
/* The channel itself, as opposed to the network it makes: a stroke that fades
 * toward its tip, a hot centreline inside it, and a spark where a branch leaves. */
{
  const source = fs.readFileSync(path.join(ROOT, 'lightningGenerator.js'), 'utf8');
  check('a channel fades toward its tip instead of glowing evenly',
    Number.isFinite(gen.IC_TIP_TONE) && gen.IC_TIP_TONE > 0.25 && gen.IC_TIP_TONE < 0.9 &&
    /tone \* \(1 - \(1 - IC_TIP_TONE\) \* along\)/.test(source),
    'IC_TIP_TONE ' + gen.IC_TIP_TONE);
  check('a channel is drawn again as a hot centreline inside its sheath',
    /const IC_CORE_WIDTH = 0\.\d+;/.test(source) &&
    /const IC_CORE_GAIN = 1\.\d+;/.test(source) &&
    /ctx\.lineWidth = w \* IC_CORE_WIDTH;/.test(source),
    'the core has to be narrower and brighter than the stroke it sits in');
  check('every fork is a hot junction, not two lines that touch',
    /function junction\(x, y, w, tone\)/.test(source) &&
    tiles.every((t) => t.fillCount >= 6),
    'junction sparks per tile: ' + tiles.map((t) => t.fillCount).join(' '));
}

check('the strokes are hair-thin',
  tiles.every((t) => t.lineWidths === undefined || true) &&
  gen.IC_WIDTH.trunk <= 4.5 && gen.IC_WIDTH.hair <= 1.5,
  'hair ' + gen.IC_WIDTH.hair + ' px, trunk ' + gen.IC_WIDTH.trunk + ' px');

/* Connected network, not confetti: dilate the lit mask by one pixel and measure
   the largest connected component. */
function largestComponentShare(tile) {
  const data = tile.data;
  const mask = new Uint8Array(TILE_W * TILE_H);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i] >= 8 ? 1 : 0;
  const dilated = new Uint8Array(mask);
  for (let y = 1; y < TILE_H - 1; y++)
    for (let x = 1; x < TILE_W - 1; x++) {
      if (!mask[y * TILE_W + x]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) dilated[(y + dy) * TILE_W + (x + dx)] = 1;
    }
  const seen = new Uint8Array(dilated.length);
  let best = 0, total = 0;
  const stack = [];
  for (let start = 0; start < dilated.length; start++) {
    if (!dilated[start]) continue;
    total++;
    if (seen[start]) continue;
    let size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % TILE_W, y = (i - x) / TILE_W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= TILE_W || ny >= TILE_H) continue;
        const j = ny * TILE_W + nx;
        if (dilated[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    best = Math.max(best, size);
  }
  return { share : best / Math.max(1, total), best : best, total : total };
}

const connectivity = tiles.map(largestComponentShare);
check('a flash is a connected network, not a sprinkle of fragments',
  connectivity.every((c) => c.share >= 0.45),
  connectivity.map((c) => (c.share * 100).toFixed(0) + '%').join(' '));

/* Determinism and variety */
const repeat = gen.generateIntraCloudBolt(TILE_W, TILE_H, SEED(3), 3);
let identical = repeat.data.length === tiles[3].data.length;
for (let i = 0; identical && i < repeat.data.length; i++)
  if (repeat.data[i] !== tiles[3].data[i]) identical = false;
check('the same seed draws exactly the same flash', identical);

function difference(a, b) {
  let diff = 0, both = 0, either = 0;
  for (let i = 0; i < a.data.length; i++) {
    const x = a.data[i] >= 8, y = b.data[i] >= 8;
    if (x !== y) diff++;
    if (x && y) both++;
    if (x || y) either++;
  }
  return { iou : either ? both / either : 1, mismatch : diff / a.data.length };
}

let worstPair = { iou : 0, mismatch : 0 }, closest = '';
for (let i = 0; i < TILES; i++) {
  for (let j = i + 1; j < TILES; j++) {
    const d = difference(tiles[i], tiles[j]);
    if (d.iou > worstPair.iou) { worstPair = d; closest = i + ' vs ' + j; }
  }
}
check('no two tiles are the same picture',
  worstPair.iou < 0.6,
  'the most similar pair (' + closest + ') overlaps on ' + (worstPair.iou * 100).toFixed(0) + '% of its lit pixels');

const families = new Set();
for (let v = 0; v < TILES; v++)
  families.add(gen.drawICParams(gen.makeRng(SEED(v)), v).family);
check('the eight tiles use several different layouts',
  families.size >= 2,
  'layouts present: ' + Array.from(families).join(', '));

check('a tile is a network, not a hairball (stroke count is bounded)',
  tileStats.every((s) => s.strokes >= 40 && s.strokes <= 4000),
  'stroke counts ' + tileStats.map((s) => s.strokes).join(' '));


/* ============================= 3. the screen ============================= */

/*
 * displayICLightning() + computeICLight() from realisticDisplayShader.frag, ported
 * to JS. The constants it uses are the shader's own (parsed above), not copies.
 */

function mipChain(tile) {
  const mips = [{ w : TILE_W, h : TILE_H, data : Float32Array.from(tile.data, (v) => v / 255) }];
  while (mips[mips.length - 1].w > 1 && mips[mips.length - 1].h > 1) {
    const src = mips[mips.length - 1];
    const w = Math.max(1, src.w >> 1), h = Math.max(1, src.h >> 1);
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const at = (yy, xx) => src.data[Math.min(src.h - 1, yy) * src.w + Math.min(src.w - 1, xx)];
        data[y * w + x] = (at(2 * y, 2 * x) + at(2 * y, 2 * x + 1) +
                           at(2 * y + 1, 2 * x) + at(2 * y + 1, 2 * x + 1)) * 0.25;
      }
    mips.push({ w : w, h : h, data : data });
  }
  return mips;
}

const tileMips = tiles.map(mipChain);

const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const smoothstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

function sampleMip(mip, u, v) {
  const x = clamp01(u) * (mip.w - 1), y = clamp01(v) * (mip.h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const at = (xx, yy) => mip.data[Math.min(mip.h - 1, Math.max(0, yy)) * mip.w + Math.min(mip.w - 1, Math.max(0, xx))];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy)
       + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

function sampleTile(layer, u, v, lod) {
  const mips = tileMips[layer];
  const l = Math.min(mips.length - 1, Math.max(0, lod));
  const i0 = Math.floor(l), i1 = Math.min(mips.length - 1, i0 + 1), t = l - i0;
  return sampleMip(mips[i0], u, v) * (1 - t) + sampleMip(mips[i1], u, v) * t;
}

/* the strike's tile and mirroring, exactly as the shader works it out */
function strikeLook(tileSeed) {
  const tileHash = fract(Math.sin(tileSeed * 12.9898 + 0 * 41.7) * 43758.5453);
  return {
    layer : Math.min(Math.floor(tileHash * IC_TILE_COUNT), IC_TILE_COUNT - 1),
    look : Math.floor(fract(tileHash * 17.31) * 4)
  };
}

/*
 * One screen pixel of the IC pass: the additive light before the cloud gain.
 *
 * Returns the two parts separately, because they are what the look is made of:
 * `core` is the channel itself, `glow` is the light the artwork's mip chain
 * spreads around it (already weighted, before the cold tint is applied).
 */
function icPixel(layer, look, lx, ly, time, intensity, artPerPixel, opts) {
  opts = opts || {};
  const reach = Math.max(Math.abs(lx), Math.abs(ly));
  if (reach > IC_HALO_REACH) return { core : 0, glow : 0, glare : 0 };
  const ax = (look % 2 === 0) ? lx : -lx;
  const ay = (look < 2) ? ly : -ly;
  const artLod = Math.log2(Math.max(1e-4, artPerPixel));
  const channel = Math.max(0, sampleTile(layer, ax + 0.5, 0.5 - ay, artLod));

  const radial = reach * 2;
  const spread = clamp01(time * 2.4);
  const reveal = clamp01((spread - radial * 0.9) / 0.3);
  const haloReveal = clamp01((spread * 1.30 - radial * 0.55) / 0.45);
  if (reveal <= 0 && haloReveal <= 0) return { core : 0, glow : 0, glare : 0 };

  const edgeX = Math.abs(lx) * 2, edgeY = Math.abs(ly) * 2;
  const window_ = (1 - smoothstep(0.80, 0.99, edgeX)) * (1 - smoothstep(0.80, 0.99, edgeY));
  const glowWindow = 1 - smoothstep(IC_HALO_SOFT[0], IC_HALO_SOFT[1], Math.max(edgeX, edgeY));

  const energy = Math.min(IC_ENERGY_MAX, Math.max(IC_ENERGY_MIN, artPerPixel));
  const power = intensity / (1 + intensity * IC_POWER_KNEE);
  const scale = power * IC_BRIGHTNESS * energy;

  const core = channel * reveal * window_ * scale;

  let glow = 0;
  let glare = 0;
  if (opts.glow !== false && haloReveal > 0) {
    const wide = sampleTile(layer, ax + 0.5, 0.5 - ay, IC_GLOW_WIDE_LOD);
    glow = wide * IC_GLOW_WIDE;
    if (wide > 0 || channel > 0) {
      const mid = sampleTile(layer, ax + 0.5, 0.5 - ay, IC_GLOW_MID_LOD);
      const tight = sampleTile(layer, ax + 0.5, 0.5 - ay, artLod + IC_GLOW_TIGHT_BIAS);
      glow += mid * IC_GLOW_MID;
      glow += tight * IC_GLOW_TIGHT;
      // the glare: the two rings that hug a channel, the part allowed past white
      glare = tight * IC_GLOW_TIGHT + mid * IC_GLOW_MID * 0.55;
    }
    glow *= haloReveal * glowWindow * scale;
    glare *= haloReveal * glowWindow * scale;
  }
  return { core : core, glow : glow, glare : glare };
}

const knee = (x) => 1 - Math.exp(-x);
const glowLuma = IC_GLOW_COL ? (IC_GLOW_COL[0] + IC_GLOW_COL[1] + IC_GLOW_COL[2]) / 3 : 0;

/*
 * Render the flash into a frame and report what a player would see.
 *
 * `spritePx` is how many screen pixels the 2400 m flash covers, which depends on
 * the camera: about a hundred at the default zoom on a 1280-wide canvas. The
 * frame is drawn larger than the sprite, because the halo is allowed to spill a
 * little past it and this has to be measurable.
 */
const FRAME_HALF = 0.72; // local units; the sprite is 0.5 and the halo 0.62

function renderFlash(options) {
  const spritePx = options.spritePx;
  const spriteH = spritePx / 2; // the sprite is 2:1
  const width = Math.max(8, Math.round(2 * FRAME_HALF * spritePx));
  const height = Math.max(8, Math.round(2 * FRAME_HALF * spriteH));
  const artPerPixel = IC_TILE_WIDTH / spritePx;
  const cloud = options.cloud ? 1.0 : 0.0;
  const cloudGain = 1 + IC_CLOUD_SCATTER * cloud;
  const { layer, look } = strikeLook(options.tileSeed === undefined ? 3.7 : options.tileSeed);

  const light = new Float32Array(width * height);
  const display = new Float32Array(width * height);
  const glowOnly = new Float32Array(width * height);
  const glareOnly = new Float32Array(width * height);
  const localX = (px) => (px + 0.5) / width * 2 * FRAME_HALF - FRAME_HALF;
  const localY = (py) => FRAME_HALF - (py + 0.5) / height * 2 * FRAME_HALF;

  let peak = 0, lit = 0, inside = 0, sum = 0, nan = 0;
  let glowPeak = 0;
  let glarePeak = 0, glareAboveKnee = 0;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const lx = localX(px), ly = localY(py);
      const pixel = icPixel(layer, look, lx, ly, options.time, options.intensity, artPerPixel, options);
      const raw = (pixel.core + pixel.glow * glowLuma) * cloudGain;
      if (!Number.isFinite(raw)) nan++;
      light[py * width + px] = raw;
      glowOnly[py * width + px] = pixel.glow * glowLuma * cloudGain;
      // The glare is written against its own ceiling (computeICLight), so this is
      // the value that reaches the bloom's bright pass.
      const glareValue = IC_FLARE_CEILING * (1 - Math.exp(-Math.max(0, pixel.glare * (IC_FLARE_COL ? (IC_FLARE_COL[0] + IC_FLARE_COL[1] + IC_FLARE_COL[2]) / 3 : 1) * IC_FLARE_BOOST * cloudGain) / IC_FLARE_CEILING));
      glareOnly[py * width + px] = glareValue;
      glarePeak = Math.max(glarePeak, glareValue);
      if (glareValue > BLOOM_KNEE) glareAboveKnee++;
      display[py * width + px] = Math.pow(clamp01(knee(Math.max(0, raw)) + (options.backdrop || 0)), 1 / 2.2);
      if (Math.abs(lx) <= 0.5 && Math.abs(ly) <= 0.5) {
        inside++;
        peak = Math.max(peak, raw);
        sum += raw;
        if (raw > 0.25) lit++;
        glowPeak = Math.max(glowPeak, pixel.glow * glowLuma * cloudGain);
      }
    }
  }
  return {
    width : width, height : height, light : light, display : display, glowOnly : glowOnly,
    localX : localX, localY : localY,
    peak : peak, coverage : lit / Math.max(1, inside), mean : sum / Math.max(1, inside),
    glowPeak : glowPeak, glareOnly : glareOnly, glarePeak : glarePeak,
    glareAboveKnee : glareAboveKnee / Math.max(1, width * height),
    nan : nan, artPerPixel : artPerPixel, cloudGain : cloudGain,
    layer : layer, look : look, spritePx : spritePx,
    // the light anywhere near the flash, including the part outside the sprite
    maxLight : (() => { let m = 0; for (let i = 0; i < light.length; i++) m = Math.max(m, light[i]); return m; })(),
    at : (px, py) => light[py * width + px]
  };
}

const DEFAULT_SPRITE = 100; // 2400 m at the default camera, 1280 px canvas

check('the shader constants needed by this test are readable',
  Number.isFinite(IC_BRIGHTNESS) && Number.isFinite(IC_CLOUD_SCATTER) &&
  Number.isFinite(IC_TILE_WIDTH) && Number.isFinite(IC_TILE_COUNT) &&
  Number.isFinite(IC_POWER_KNEE) && Number.isFinite(IC_ENERGY_MAX),
  `brightness ${IC_BRIGHTNESS} scatter ${IC_CLOUD_SCATTER} tile ${IC_TILE_WIDTH} count ${IC_TILE_COUNT} knee ${IC_POWER_KNEE} energyMax ${IC_ENERGY_MAX}`);

const inCloud = renderFlash({ spritePx : DEFAULT_SPRITE, time : 0.45, intensity : 20, cloud : true, tileSeed : 3.7 });
const clearAir = renderFlash({ spritePx : DEFAULT_SPRITE, time : 0.45, intensity : 20, cloud : false, tileSeed : 3.7 });

check('the IC pass produces no NaN or infinity', inCloud.nan === 0 && clearAir.nan === 0,
  inCloud.nan + ' bad pixels');

check('a flash inside a cloud reaches full brightness',
  inCloud.peak >= 2.0,
  'peak additive light ' + inCloud.peak.toFixed(2) + ' (the knee saturates at 1.0)');
check('a flash inside a cloud is visible over a real area',
  inCloud.coverage >= 0.03 && inCloud.coverage <= 0.45,
  'lit area ' + (inCloud.coverage * 100).toFixed(1) + '% of the sprite');
check('a flash in clear air is dimmer than the same flash in cloud',
  clearAir.peak < inCloud.peak * 0.75 && clearAir.peak > 0.3,
  'clear air peak ' + clearAir.peak.toFixed(2) + ' vs cloud ' + inCloud.peak.toFixed(2));
check('the soft knee keeps the flash inside the frame',
  knee(inCloud.peak) <= 1.0 && knee(inCloud.peak) > 0.8,
  'knee(' + inCloud.peak.toFixed(2) + ') = ' + knee(inCloud.peak).toFixed(3));

/* the knee really does separate tiers instead of clipping them together */
check('the knee separates a trunk from a hair',
  knee(3.0) - knee(0.8) > 0.2,
  'knee(3.0) = ' + knee(3.0).toFixed(2) + ', knee(0.8) = ' + knee(0.8).toFixed(2));

/*
 * The halo, and the border.
 *
 * A flash is allowed a margin of light outside its own rectangle - that is what
 * makes it read as light scattered in cloud rather than as a decal - but the
 * light has to be gone before its reach ends, and nothing may step at the border.
 */
{
  const frame = renderFlash({ spritePx : DEFAULT_SPRITE, time : 1.0, intensity : 20, cloud : true, tileSeed : 3.7 });
  let beyond = 0, spillPeak = 0, spillPixels = 0, edgePixels = 0;
  for (let py = 0; py < frame.height; py++)
    for (let px = 0; px < frame.width; px++) {
      const reach = Math.max(Math.abs(frame.localX(px)), Math.abs(frame.localY(py)));
      const v = frame.at(px, py);
      if (reach > IC_HALO_REACH)
        beyond = Math.max(beyond, v);
      else if (reach > 0.5) {
        edgePixels++;
        if (v > 0) spillPixels++;
        spillPeak = Math.max(spillPeak, v);
      }
    }
  check('no light at all survives past the halo\'s reach',
    beyond === 0,
    'brightest ' + beyond.toFixed(4) + ' beyond ' + IC_HALO_REACH + ' sprite halves');
  check('the halo reaches a little way past the sprite edge',
    spillPeak > 0 && spillPixels > edgePixels * 0.5,
    spillPixels + ' of ' + edgePixels + ' pixels past the edge are lit, peak ' + spillPeak.toFixed(3));
  check('the spill is dimmer than the flash it came from',
    spillPeak < frame.peak * 0.5,
    'brightest light past the edge ' + spillPeak.toFixed(3) + ' vs peak ' + frame.peak.toFixed(2));
}

{
  // A step at the sprite border would show up as a jump between two neighbouring
  // pixels that straddle it. Light may legitimately vary quickly *inside* the
  // sprite (a channel crossing a row), so only the straddling pair is compared.
  const frame = renderFlash({ spritePx : DEFAULT_SPRITE, time : 1.0, intensity : 20, cloud : true, tileSeed : 3.7 });
  let worst = 0;
  for (let py = 1; py < frame.height; py++) {
    for (let px = 1; px < frame.width; px++) {
      const lx0 = frame.localX(px - 1), lx1 = frame.localX(px);
      const ly0 = frame.localY(py - 1), ly1 = frame.localY(py);
      const acrossX = Math.abs(lx0) <= 0.5 && Math.abs(lx1) > 0.5;
      const acrossY = Math.abs(ly0) <= 0.5 && Math.abs(ly1) > 0.5;
      if (acrossX) worst = Math.max(worst, Math.abs(frame.at(px, py) - frame.at(px - 1, py)));
      if (acrossY) worst = Math.max(worst, Math.abs(frame.at(px, py) - frame.at(px, py - 1)));
    }
  }
  check('the light does not step at the sprite border',
    worst <= frame.peak * 0.25,
    'largest jump across the border ' + worst.toFixed(3) + ' vs peak ' + frame.peak.toFixed(2));
}

/* ============================== the halo ================================= */

check('the halo constants are readable and sane',
  Number.isFinite(IC_GLOW_TIGHT) && Number.isFinite(IC_GLOW_MID) && Number.isFinite(IC_GLOW_WIDE) &&
  Number.isFinite(IC_GLOW_TIGHT_BIAS) && Number.isFinite(IC_GLOW_MID_LOD) && Number.isFinite(IC_GLOW_WIDE_LOD) &&
  Number.isFinite(IC_HALO_REACH) && Number.isFinite(IC_HALO_SOFT[0]) && Number.isFinite(IC_HALO_SOFT[1]) &&
  IC_GLOW_TIGHT > 0 && IC_GLOW_MID > 0 && IC_GLOW_WIDE > 0 &&
  IC_GLOW_MID_LOD > IC_GLOW_TIGHT_BIAS && IC_GLOW_WIDE_LOD > IC_GLOW_MID_LOD && IC_HALO_REACH > 0.5,
  `tight ${IC_GLOW_TIGHT} mid ${IC_GLOW_MID} wide ${IC_GLOW_WIDE}, ` +
  `lods +${IC_GLOW_TIGHT_BIAS}/${IC_GLOW_MID_LOD}/${IC_GLOW_WIDE_LOD}, reach ${IC_HALO_REACH}, fade ${IC_HALO_SOFT.join('..')}`);

check('the halo is cold light, not white paint',
  IC_GLOW_COL !== null && IC_GLOW_COL[2] > IC_GLOW_COL[1] && IC_GLOW_COL[1] >= IC_GLOW_COL[0] && IC_GLOW_COL[2] <= 1,
  'icGlowCol = ' + (IC_GLOW_COL ? IC_GLOW_COL.join(', ') : 'missing'));

check('only the halo is tinted - the channel itself stays white',
  /vec3 light = vec3\(core\) \+ icGlowCol \* glow;/.test(shaderSource),
  'expected: vec3(core) + icGlowCol * glow');

{
  /*
   * The halo has to fill the space between the channels without filling the
   * sprite. "Gap" here means a pixel in the sprite where the artwork itself is
   * dark, i.e. one the channels do not cover.
   */
  const frame = renderFlash({ spritePx : DEFAULT_SPRITE, time : 1.0, intensity : 20, cloud : true, tileSeed : 3.7 });
  let gaps = 0, gapsLit = 0, gapSum = 0, gapHot = 0, corePeak = 0;
  for (let py = 0; py < frame.height; py++)
    for (let px = 0; px < frame.width; px++) {
      const lx = frame.localX(px), ly = frame.localY(py);
      if (Math.abs(lx) > 0.5 || Math.abs(ly) > 0.5) continue;
      const coreOnly = icPixel(frame.layer, frame.look, lx, ly, 1.0, 20, frame.artPerPixel, { glow : false }).core
                     * frame.cloudGain;
      corePeak = Math.max(corePeak, coreOnly);
      if (coreOnly > 0.02) continue;
      const total = frame.at(px, py);
      gaps++;
      gapSum += total;
      if (total > 0.05) gapsLit++;
      if (total > 0.6) gapHot++;
    }
  const gapMean = gapSum / Math.max(1, gaps);
  check('the halo lights the gaps between the channels',
    gapsLit / Math.max(1, gaps) > 0.35 && gapMean > 0.03,
    `${(gapsLit / Math.max(1, gaps) * 100).toFixed(0)}% of ${gaps} gap pixels lit, mean light ${gapMean.toFixed(3)} HDR`);
  check('the halo does not turn the sprite into a slab',
    gapHot / Math.max(1, gaps) < 0.25,
    `${(gapHot / Math.max(1, gaps) * 100).toFixed(1)}% of the gaps are near-white`);
  check('the halo never outshines the channel it came from',
    frame.glowPeak < corePeak,
    'halo peak ' + frame.glowPeak.toFixed(3) + ' vs channel peak ' + corePeak.toFixed(2));
}

{
  /* The halo is a blur of the artwork, so it has to fall off with distance from
   * the ink that produced it. Distance is measured in artwork pixels, on the
   * layer this strike uses, with a flood fill outward from the bright ink. */
  const frame = renderFlash({ spritePx : DEFAULT_SPRITE, time : 1.0, intensity : 20, cloud : true, tileSeed : 3.7 });
  const tile = tiles[frame.layer];
  const dist = new Int32Array(TILE_W * TILE_H).fill(-1);
  const queue = [];
  for (let i = 0; i < dist.length; i++)
    if (tile.data[i] > 76) { dist[i] = 0; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % TILE_W, y = (i / TILE_W) | 0;
    for (const [ dx, dy ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= TILE_W || ny >= TILE_H) continue;
      const j = ny * TILE_W + nx;
      if (dist[j] !== -1) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  const bins = [[0, 2], [2, 4], [4, 8], [8, 16], [16, 40]];
  const sums = bins.map(() => 0), counts = bins.map(() => 0);
  for (let py = 0; py < frame.height; py++)
    for (let px = 0; px < frame.width; px++) {
      const lx = frame.localX(px), ly = frame.localY(py);
      if (Math.abs(lx) > 0.45 || Math.abs(ly) > 0.45) continue;
      const ax = (frame.look % 2 === 0) ? lx : -lx;
      const ay = (frame.look < 2) ? ly : -ly;
      const tx = Math.round((ax + 0.5) * (TILE_W - 1)), ty = Math.round((0.5 - ay) * (TILE_H - 1));
      const d = dist[Math.min(dist.length - 1, Math.max(0, ty * TILE_W + tx))];
      if (d < 0) continue;
      for (let b = 0; b < bins.length; b++)
        if (d >= bins[b][0] && d < bins[b][1]) { sums[b] += frame.at(px, py); counts[b]++; break; }
    }
  const means = sums.map((v, i) => (counts[i] ? v / counts[i] : NaN));
  const falling = means.every((v, i) => i === 0 || !Number.isFinite(v) || v <= means[i - 1] * 1.05);
  check('the halo falls off with distance from the ink',
    falling && means[0] > means[means.length - 1] * 2,
    bins.map((b, i) => `${b[0]}-${b[1]}px ${Number.isFinite(means[i]) ? means[i].toFixed(3) : 'n/a'}`).join(' > '));
}

{
  const at = (time, intensity, extra) => renderFlash(Object.assign(
    { spritePx : DEFAULT_SPRITE, time : time, intensity : intensity, cloud : true, tileSeed : 3.7 }, extra || {}));
  const early = at(0.10, 20), mid = at(0.60, 20), none = at(0.60, 0);
  const radiusOf = (frame, field) => {
    let r = 0;
    for (let py = 0; py < frame.height; py++)
      for (let px = 0; px < frame.width; px++) {
        const reach = Math.max(Math.abs(frame.localX(px)), Math.abs(frame.localY(py)));
        if (reach > 0.5) continue;
        const glowHere = frame.glowOnly[py * frame.width + px];
        const v = field === 'glow' ? glowHere : frame.at(px, py) - glowHere;
        if (v > 0.05) r = Math.max(r, reach);
      }
    return r;
  };
  /*
 * The glare on the channels.
 *
 * A cloud-to-ground bolt gets its halo from the bloom's bright pass, which only
 * sees light above its knee (32 HDR units). An intra-cloud flash used to be
 * squeezed under 1.0 by its own soft knee, so it could never bloom at all. The two
 * rings that hug a channel now go through a second, much higher ceiling instead,
 * so a channel carries a glow the way a bolt does - without lifting the wide ring,
 * the cloud glow or the tiers of the network, which is what would turn the flash
 * into a slab.
 */
{
  const frame = renderFlash({ spritePx : DEFAULT_SPRITE, time : 1.0, intensity : 20, cloud : true, tileSeed : 3.7 });
  check('an intra-cloud channel carries a glare that reaches the bloom pass',
    Number.isFinite(IC_FLARE_BOOST) && Number.isFinite(BLOOM_KNEE) &&
    frame.glarePeak > BLOOM_KNEE + 2,
    'glare peak ' + frame.glarePeak.toFixed(1) + ' vs bloom knee ' + BLOOM_KNEE +
    ' (boost ' + IC_FLARE_BOOST + ', ceiling ' + IC_FLARE_CEILING + ')');
  check('the glare hangs on the channels instead of flooding the sprite',
    frame.glareAboveKnee > 0.0 && frame.glareAboveKnee < 0.10,
    (frame.glareAboveKnee * 100).toFixed(1) + '% of the frame is above the bloom knee');
  check('the glare is whiter than the halo it sits in',
    IC_FLARE_COL && IC_GLOW_COL &&
    IC_FLARE_COL[0] / IC_FLARE_COL[2] > IC_GLOW_COL[0] / IC_GLOW_COL[2],
    'flare ' + JSON.stringify(IC_FLARE_COL) + ' vs halo ' + JSON.stringify(IC_GLOW_COL));
  check('a flash with no intensity has no glare either',
    renderFlash({ spritePx : DEFAULT_SPRITE, time : 1.0, intensity : 0, cloud : true, tileSeed : 3.7 }).glarePeak === 0);
}

check('the halo runs ahead of the channels as the flash spreads',
    radiusOf(mid, 'glow') > radiusOf(mid, 'core') * 1.05,
    'halo reaches ' + radiusOf(mid, 'glow').toFixed(3) + ', channels ' + radiusOf(mid, 'core').toFixed(3) + ' (sprite halves)');
  check('the halo grows with the flash instead of appearing whole',
    radiusOf(early, 'glow') < radiusOf(mid, 'glow') * 0.8,
    'halo radius ' + radiusOf(early, 'glow').toFixed(3) + ' at t=0.10 vs ' + radiusOf(mid, 'glow').toFixed(3) + ' at t=0.60');
  check('a strike with no intensity has no halo either',
    none.glowPeak === 0, 'halo peak ' + none.glowPeak.toFixed(3));
}

check('the halo comes out of the artwork, not out of a painted layer',
  /float wide = textureLod\(icLightningTex, vec3\(uv, layer\), icGlowWideLod\)\.r;/.test(shaderSource) &&
  /textureLod\(icLightningTex, vec3\(uv, layer\), icGlowMidLod\)\.r/.test(shaderSource) &&
  /textureLod\(icLightningTex, vec3\(uv, layer\), artLod \+ icGlowTightBias\)\.r/.test(shaderSource),
  'expected three textureLod() taps of the IC array, at the wide, mid and screen LODs');
check('the far rings are only fetched when there is light to fetch',
  /if \(wide > 0\.0 \|\| channel > 0\.0\) \{/.test(shaderSource),
  'the wide tap is the gate for the two expensive ones');

/* every zoom: the flash has to be visible at the sizes a camera actually uses */
{
  const zooms = [
    { sprite : 55, name : 'zoomed out' },
    { sprite : 100, name : 'default' },
    { sprite : 200, name : 'zoomed in 2x' },
    { sprite : 400, name : 'zoomed in 4x' }
  ];
  let ok = true;
  const notes = [];
  for (const zoom of zooms) {
    const frame = renderFlash({ spritePx : zoom.sprite, time : 0.5, intensity : 20, cloud : true, tileSeed : 3.7 });
    const visible = frame.peak >= 1.0 && frame.coverage >= 0.03;
    ok = ok && visible && frame.nan === 0;
    notes.push(`${zoom.name} (${zoom.sprite}px, ${frame.artPerPixel.toFixed(1)} art px/screen px): peak ${frame.peak.toFixed(2)} lit ${(frame.coverage * 100).toFixed(1)}%`);
  }
  check('a flash stays visible at every camera zoom', ok, notes.join('\n     '));
}

/* the reveal: the flash grows outwards and then goes away */
{
  const coverageAt = (time) =>
    renderFlash({ spritePx : DEFAULT_SPRITE, time : time, intensity : 20, cloud : true, tileSeed : 3.7 }).coverage;
  const early = coverageAt(0.05);
  const middle = coverageAt(0.30);
  const late = coverageAt(0.95);
  check('a flash spreads outwards as it grows',
    early < middle * 0.5 && late >= middle * 0.95,
    `cover ${(early * 100).toFixed(1)}% at t=0.05 -> ${(middle * 100).toFixed(1)}% at t=0.3 -> ${(late * 100).toFixed(1)}% at t=0.95`);
  const dark = renderFlash({ spritePx : DEFAULT_SPRITE, time : 0.5, intensity : 0, cloud : true, tileSeed : 3.7 });
  check('a strike with no intensity emits no light',
    dark.peak === 0, 'peak ' + dark.peak.toFixed(3));
  const peakOfCurve = 20 / (1 + 20 * IC_POWER_KNEE);
  check('the strike curve is compressed, not clipped to the slot peak',
    peakOfCurve > 1.0 && peakOfCurve < 1.5,
    'peak of the compressed curve ' + peakOfCurve.toFixed(3));
}

/* variety: consecutive strikes must not repeat themselves */
{
  const looks = new Set();
  const layers = new Set();
  const mirrors = new Set();
  for (let i = 0; i < 60; i++) {
    const look = strikeLook(1.3 + i * 2.7);
    looks.add(look.layer + ':' + look.look);
    layers.add(look.layer);
    mirrors.add(look.look);
  }
  check('different strikes show different patterns',
    looks.size >= 16,
    looks.size + ' distinct layer/mirroring looks out of 60 strikes');
  check('every artwork layer is reachable by the strike hash',
    layers.size === IC_TILE_COUNT,
    layers.size + ' of ' + IC_TILE_COUNT + ' layers used');
  check('all four mirrorings are used', mirrors.size === 4, mirrors.size + ' of 4');

  // the same strike must not change its look from frame to frame
  const a = strikeLook(42.5), b = strikeLook(42.5);
  check('a strike keeps its pattern for its whole life', a.layer === b.layer && a.look === b.look);
}


/* =========================== 4. consistency ============================== */

const appTileWidth = Number((appSource.match(/const icLightningTileWidth = (\d+);/) || [])[1]);
const appTileHeight = Number((appSource.match(/const icLightningTileHeight = (\d+);/) || [])[1]);
const appTileCount = Number((appSource.match(/const numICLightningTiles = (\d+);/) || [])[1]);

check('app.js and the shader agree on the tile width',
  appTileWidth === IC_TILE_WIDTH,
  'app.js ' + appTileWidth + ' vs shader ' + IC_TILE_WIDTH);
check('app.js and the shader agree on how many patterns there are',
  appTileCount === IC_TILE_COUNT,
  'app.js ' + appTileCount + ' vs shader ' + IC_TILE_COUNT);
check('the generator draws the tile size the app uploads',
  appTileWidth === TILE_W && appTileHeight === TILE_H,
  'app.js ' + appTileWidth + 'x' + appTileHeight + ', test renders ' + TILE_W + 'x' + TILE_H);

check('the artwork lives in a mipmapped 2D array texture',
  /gl\.createTexture\(\)/.test(appSource) &&
  /gl\.texImage3D\(gl\.TEXTURE_2D_ARRAY/.test(appSource) &&
  /gl\.texSubImage3D\(gl\.TEXTURE_2D_ARRAY/.test(appSource) &&
  /gl\.generateMipmap\(gl\.TEXTURE_2D_ARRAY\)/.test(appSource) &&
  /gl\.TEXTURE_MIN_FILTER, gl\.LINEAR_MIPMAP_LINEAR/.test(appSource) &&
  /uniform sampler2DArray icLightningTex/.test(shaderSource));
check('the atlas zoom factor is gone (one tile is the whole flash)',
  !/icArtZoom/.test(appSource) && !/icArtZoom/.test(shaderSource));
check('the shader picks the layer from the strike, not from the slot',
  /float layer = min\(floor\(tileHash \* icTileCount\), icTileCount - 1\.0\);/.test(shaderSource) &&
  /textureLod\(icLightningTex, vec3\(uv, layer\), artLod\)/.test(shaderSource));
check('the IC light is added by its own pass and never blended over the scene',
  /uniform float icLightPass/.test(shaderSource) &&
  /if \(icLightPass > 0\.5\)/.test(shaderSource) &&
  /gl\.blendFunc\(gl\.ONE, gl\.ONE\);/.test(appSource));
check('intra-cloud flashes are still told apart from cloud-to-ground strikes',
  /lightningData\[INTENSITY\] > LIGHTNING_IC_MAX_INTENSITY/.test(shaderSource));
check('the light is not dimmed by the cloud it is born in',
  /1\.0 \+ icCloudScatter \* cloudOpacity/.test(shaderSource) &&
  !/icLight \/ \(1\.0 \+ cloudOpacity/.test(shaderSource));

restoreCanvas();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
