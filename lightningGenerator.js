/*
 * lightningGenerator.js — procedural lightning artwork, generated off the main
 * thread and transferred as an ImageBitmap.
 *
 * Two shapes are produced from the same single-channel (luminance) canvas:
 *
 *   mode: 'CG'  Cloud-to-ground bolt. One dominant channel grows downward with
 *               the classic dendritic forks. This is the original artwork used
 *               by the legacy (cloud-density triggered) lightning in app.js.
 *
 *   mode: 'IC'  Intra-cloud flash. Real IC lightning never reaches the ground,
 *               has dimmer channels than a CG return stroke, and its channels
 *               are round filaments that curl like hair rather than the kinked
 *               run of a ground stroke. The generator draws eight different
 *               shapes ('spider', 'crawler', 'lattice', 'web', 'veil', 'braid',
 *               'crown', 'fork' - see generateIntraCloudBolt): the heading of
 *               every strand is driven by noise-driven curvature, strokes are
 *               hair-thin, and there is no halo around them (a CG stroke has
 *               none either; its glow comes from the post-processing bloom).
 *
 *               app.js renders all eight into a 4x2 atlas and
 *               realisticDisplayShader.frag draws them for every strike whose
 *               intensity is at or below LIGHTNING_IC_MAX_INTENSITY, i.e. every
 *               intra-cloud flash. Which tile a strike uses is chosen per
 *               strike from its own start iteration and position, so two
 *               flashes almost never show the same pattern.
 *
 * Protocol (unchanged for the legacy caller):
 *   worker.postMessage({width, height})             -> CG bolt bitmap
 *   worker.postMessage({width, height, mode:'IC',
 *                       variant, seed})             -> IC flash bitmap
 * The worker always posts back the ImageBitmap itself.
 */
onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(32, Math.round(msg.width || 1250));
  const height = Math.max(32, Math.round(msg.height || 2500));
  const bitmap = (msg.mode === 'IC')
    ? generateIntraCloudBolt(width, height, msg.seed, msg.variant)
    : generateLightningBolt(width, height);
  postMessage(bitmap, [bitmap]);
};


/* Deterministic little PRNG (mulberry32) so a seed gives a stable bolt. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/*
 * One step of a channel's heading.
 *
 * The heading is turned by a *curvature*, and the curvature drifts slowly
 * toward a target that itself wanders. Two levels of noise, not one, is what
 * makes a strand look like a hair instead of either a straight line or a
 * spring: over the length of a strand the target gives it a handful of arcs of
 * different radius, while the fast response keeps the path smooth between them.
 * A single random walk of the curvature - the obvious first attempt - has the
 * heading wander so far over a long strand that every channel coils into a
 * loop and the flash turns into a ball of wool.
 *
 * Every now and then a real kink is applied straight to the heading, which is
 * the one thing a channel of ionised air does that a hair does not.
 *
 * A strand that leaves its charge layer is turned back by bending its target
 * curvature (never by snapping its heading), so the fine curl survives the turn
 * instead of being flattened into a run along the edge.
 *
 * `s` is the per-filament state ({axis, curv, curvTarget}); `rand` is passed in
 * rather than closed over so a test can drive the heading deterministically.
 */
function stepHeading(s, st, y, bandLo, bandHi, rand) {
  // Slow level: where the curvature wants to be. It wanders, relaxes, and is
  // clamped, so a strand is a chain of arcs with radii from wide to tight.
  s.curvTarget += (rand() - 0.5) * st.curlDrift;
  s.curvTarget *= 0.9992;
  if (s.curvTarget > st.maxCurv) s.curvTarget = st.maxCurv;
  else if (s.curvTarget < -st.maxCurv) s.curvTarget = -st.maxCurv;

  // Confinement to the charge layer, applied to the target and only while the
  // strand is actually outside it.
  const mid = (bandLo + bandHi) * 0.5;
  const half = Math.max(1, (bandHi - bandLo) * 0.5);
  const off = (y - mid) / half; // -1 .. 1 inside the layer
  if (off < -1 || off > 1) {
    const target = off > 0 ? -Math.PI * 0.5 : Math.PI * 0.5; // up / down again
    let da = target - s.axis;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    s.curvTarget += da * st.bend * Math.min(2.5, 0.5 + Math.abs(off));
  }

  // Fast level: the heading follows the target smoothly.
  s.curv += (s.curvTarget - s.curv) * st.curlResponse;
  s.axis += s.curv;

  // ... and occasionally the channel simply kinks.
  if (rand() < st.kinkChance) s.axis += (rand() < 0.5 ? -1 : 1) * st.kink;

  return s.axis;
}


/* ===================== cloud-to-ground bolt (original) ==================== */

function generateLightningBolt(width, height)
{
  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);


  function genLightningColor(lineWidth)
  {
    const colR = 12;
    const colG = 12;
    const colB = 12;
    const brightness = Math.pow(lineWidth * 2.0, 2.0);
    return `rgb(${colR * brightness}, ${colG * brightness}, ${colB * brightness})`;
  }


  ctx.beginPath();

  let startX = width / 2.0;
  let startY = 0;
  let angle = Math.PI / 6.;
  let lineWidth = 4.5;
  const targetAngle = 0.0;

  ctx.moveTo(startX, startY);

  ctx.lineWidth = lineWidth;

  while (startY < height) {

    const nextX = startX + Math.sin(angle);
    const nextY = startY + Math.cos(angle);

    angle += (Math.random() - 0.5) * 1.4;  // 0.7

    angle -= (angle - targetAngle) * 0.08; // keep it going in a general direction

    ctx.lineTo(nextX, nextY);

    startX = nextX;
    startY = nextY;


    if (Math.random() < 0.015 * (1. - nextY / height)) { // branch
      ctx.strokeStyle = genLightningColor(lineWidth);
      ctx.stroke();
      drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 2.5, lineWidth * 0.5 * Math.random());
      ctx.beginPath();
      ctx.moveTo(nextX, nextY); // move back to last position after drawing branch
      ctx.lineWidth = lineWidth;
    }
  }
  ctx.strokeStyle = genLightningColor(lineWidth);
  ctx.stroke();


  return lightningCanvas.transferToImageBitmap();


  function drawBranch(startX, startY, targetAngle, line_width)
  {
    let angle = targetAngle;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineWidth = line_width;

    while (startY < height) {

      const nextX = startX + Math.sin(angle);
      const nextY = startY + Math.cos(angle);

      angle += (Math.random() - 0.5) * 0.7;

      angle -= (angle - targetAngle) * 0.08; // keep it going in a general direction

      ctx.lineTo(nextX, nextY);

      startX = nextX;
      startY = nextY;

      if (Math.random() < 0.018) { // reduce width

        ctx.strokeStyle = genLightningColor(line_width);
        ctx.stroke();
        line_width -= 0.1;

        if (line_width < 0.1)
          return;

        if (Math.random() < 0.1) { // branch 0.005

          drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 1.5, line_width);
        }

        ctx.beginPath();
        ctx.moveTo(nextX, nextY); // move back to last position after drawing branch
        ctx.lineWidth = line_width;
      }
    }
    ctx.strokeStyle = genLightningColor(line_width);
    ctx.stroke();
  }
}


/* ========================= intra-cloud flash (IC) ======================= */

/*
 * IC artwork is drawn as hair.
 *
 * A lightning channel is round, so on screen it is a thread of light: thin, and
 * curving in a way nothing man-made is. Earlier versions drew it as a polyline
 * that held one heading for a dozen steps and then kinked, steered back toward
 * horizontal every single step. That is a fair model for a CG return stroke,
 * which really is a run of kinks, but on a flash that spreads sideways it
 * collapsed every channel into a horizontal noodle - dozens of them stacked in
 * one band read as a single texture, which is why every pattern looked like the
 * same pattern, whatever shape it had been asked for.
 *
 * The channel model here is curvature (see stepHeading): the heading is turned
 * by a curvature that drifts toward a slowly wandering target, which gives a
 * strand a chain of arcs of different radius - hooks, S-bends and the
 * occasional loop, with no wavelength and no preferred direction, the way a
 * hair lies on a table. Strokes are hair-thin; what keeps them visible after
 * the tile is minified is their tone, not their width.
 *
 * Eight different shapes are drawn, and app.js packs all eight into one atlas
 * and lets every individual strike pick a tile (see displayICLightning in
 * realisticDisplayShader.frag), so consecutive flashes differ instead of the
 * same four pictures taking turns:
 *
 *   'spider'   a bright core with long curling arms radiating in every direction
 *   'crawler'  one long strand crawling through the layer, hairs trailing off it
 *   'lattice'  trunks at several heights tied together by steep cross strands
 *   'web'      several small cores joined by short curling rays
 *   'veil'     a curtain of long, differently curling strands, no strong core
 *   'braid'    two or three strands twisting around each other
 *   'crown'    a core low in the layer, a fan of arms curling upward
 *   'fork'     one trunk that keeps splitting, a proper branching tree
 *
 * Everything is drawn inside the central STAGE of the tile. The shader samples
 * only that (icArtZoom in app.js), so artwork outside it is never seen - which
 * is why the old generator's edge-to-edge strokes looked like a crop of
 * something rather than a flash.
 */
const IC_VARIANTS = ['spider', 'crawler', 'lattice', 'web', 'veil', 'braid', 'crown', 'fork'];

/* Fraction of the tile the shader samples. Keep in step with icArtZoom in
 * app.js; the artwork is laid out inside this window so nothing is wasted. */
const IC_STAGE_FRACTION = 0.5;


function generateIntraCloudBolt(width, height, seed, variant)
{
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const rand = makeRng(seed === undefined ? (Math.random() * 4294967296) >>> 0 : seed);
  const style = IC_VARIANTS[(variant === undefined || variant === null
    ? Math.floor(rand() * IC_VARIANTS.length)
    : variant) % IC_VARIANTS.length];

  const cx = width * 0.5;
  const cy = height * 0.5;
  const stepLen = Math.max(0.9, width / 900);

  /* The window the shader samples, inset a little so a stroke that stops at the
   * boundary stops where the shader already fades out. */
  const stageW = width * IC_STAGE_FRACTION;
  const stageH = height * IC_STAGE_FRACTION;
  const inset = Math.max(6, width * 0.012);
  const sx0 = cx - stageW * 0.5 + inset;
  const sx1 = cx + stageW * 0.5 - inset;
  const sy0 = cy - stageH * 0.5 + inset;
  const sy1 = cy + stageH * 0.5 - inset;

  /* The charge layer: strands are turned back by it, so it is the stage with a
   * little headroom. */
  const bandLo = sy0 + stageH * 0.04;
  const bandHi = sy1 - stageH * 0.04;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /*
   * Single-channel tone: wider channels are brighter, IC stays soft.
   *
   * The floor matters as much as the curve. A hair-thin filament works out to a
   * value of one or two out of 255, i.e. an almost black stroke, and the shader
   * shows this texture as light: a black stroke is a channel that emits nothing.
   * The floor keeps every hair above 'barely emitting'; the power curve above
   * it still makes a trunk several times brighter than a hair.
   */
  const TONE_FLOOR = 52;
  function tone(w, gain) {
    const v = Math.pow(Math.max(w, 0.05), 1.7) * 60.0 * gain;
    const c = Math.max(TONE_FLOOR, Math.min(255, Math.round(v)));
    return 'rgb(' + c + ',' + c + ',' + c + ')';
  }

  /*
   * A channel is one narrow stroke and nothing else - no glow pass around it.
   *
   * The display shader shows this texture as light and has to give that light an
   * alpha to blend it in, so the dim parts of the artwork are the expensive
   * ones: a faint skirt of light around every channel is drawn over the sky with
   * an alpha it cannot pay for, which leaves a dark rim and, while a flash
   * fades, a dark silhouette along its segments.
   *
   * Strokes are painted with 'lighten', i.e. a stroke only ever replaces what is
   * underneath it with something brighter, so crossing hairs cannot churn the
   * tile into a mesh of dark troughs.
   */
  function strokePath(pts, w, gain) {
    if (pts.length < 4) return;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.globalCompositeOperation = 'lighten';
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = Math.max(0.35, w);
    ctx.strokeStyle = tone(w, gain);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  /*
   * Grow one strand. Forks are queued (never recursed) so a very branchy flash
   * cannot blow the stack inside a worker. `st` carries the behaviour of this
   * class of strand (see the style presets below), `forks` how many times it may
   * still split.
   *
   * The width tapers along the strand, which is what makes a channel look like a
   * filament instead of a line of constant thickness.
   */
  function growFilament(x0, y0, ang, len, w0, gain, depth, queue, st, forks) {
    let x = x0, y = y0, w = w0;
    const pts = [x, y];
    let travelled = 0;
    const minW = Math.max(0.14, w0 * 0.20);
    const taper = st.taper === undefined ? 0.9990 : st.taper;
    let forksLeft = forks === undefined ? (st.forks === undefined ? 1 : st.forks) : forks;
    const s = { axis : ang, curv : 0, curvTarget : (rand() - 0.5) * st.maxCurv * 0.7 };
    // A strand may keep to its own thin layer inside the stage (a trunk running
    // through one charge layer) instead of bouncing off the visible edge, which
    // is what turned a trunk into a row of 'D' shapes.
    const lo = st.band === undefined ? bandLo : Math.max(bandLo, y0 - st.band * 0.5);
    const hi = st.band === undefined ? bandHi : Math.min(bandHi, y0 + st.band * 0.5);

    for (let i = 0; i < len; i++) {
      const a = stepHeading(s, st, y, lo, hi, rand);

      const nx = x + Math.cos(a) * stepLen;
      let ny = y + Math.sin(a) * stepLen;
      if (nx < sx0 || nx > sx1) break;
      // Bounce off the floor and the ceiling of the charge layer instead of
      // running along it: a strand held at the boundary piles up with every
      // other strand held there and paints a bright bar across the flash.
      if (ny < lo) { ny = lo + (lo - ny) * 0.6; s.axis = -s.axis; s.curvTarget = -s.curvTarget; }
      else if (ny > hi) { ny = hi - (ny - hi) * 0.6; s.axis = -s.axis; s.curvTarget = -s.curvTarget; }
      if (ny < sy0 || ny > sy1) break;

      x = nx; y = ny;
      travelled += stepLen;
      pts.push(x, y);
      w = Math.max(minW, w * taper);

      if (forksLeft > 0 && depth < 3 && travelled > stepLen * 10 && rand() < st.fork) {
        forksLeft--;
        queue.push({
          x, y,
          ang : a + (rand() < 0.5 ? -1 : 1) * st.spread * (0.5 + rand()),
          len : Math.max(8, Math.round(len * (0.30 + rand() * 0.35))),
          w : Math.max(0.32, w * (0.55 + rand() * 0.30)),
          gain : gain * 0.88,
          depth : depth + 1,
          st : st.hair,
          forks : forksLeft
        });
      }
    }
    strokePath(pts, w0, gain);
  }

  const queue = [];

  /* A small, bright knot where the leader starts, drawn as a few short spokes
   * through one point. A wandering stroke here turned into a white worm with a
   * tail; the core has to stay a point the strands leave from. */
  function drawCore(x, y, size, w) {
    for (let i = 0; i < 5; i++) {
      const a = rand() * Math.PI * 2;
      const len = size * (0.5 + rand() * 0.9);
      strokePath([x - Math.cos(a) * len, y - Math.sin(a) * len,
                  x + Math.cos(a) * len, y + Math.sin(a) * len],
                 w * (0.7 + rand() * 0.35), 1.3);
    }
  }

  /* A fan of strands leaving one point: `dir` is the centre of the fan and
   * `spread` the total angle it covers. `len` and `w0` are in artwork pixels. */
  function burst(x, y, count, dir, spread, len, w0, st, hair) {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const ang = dir + (t - 0.5) * spread + (rand() - 0.5) * (spread / count) * 1.4;
      const thisLen = Math.round(len * (0.62 + rand() * 0.75) / stepLen);
      growFilament(x, y, ang, thisLen, w0 * (0.8 + rand() * 0.4), 0.85 + rand() * 0.15,
                   0, queue, st);
      if (hair && rand() < 0.55) {
        queue.push({
          x, y,
          ang : ang + (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.5),
          len : Math.max(10, Math.round(thisLen * 0.45)),
          w : Math.max(0.3, w0 * 0.42),
          gain : 0.72,
          depth : 1,
          st : hairStyle,
          forks : 1
        });
      }
    }
  }

  /*
   * Per-class strand behaviour.
   *
   * `curlDrift` is how far the target curvature wanders each step, `curlResponse`
   * how quickly the real curvature follows it, `maxCurv` the tightest arc
   * allowed (stepLen/maxCurv is its radius, ~15 px and up), `kink`/`kinkChance`
   * the occasional real bend, `bend` how hard a strand is turned back at the
   * edge of the layer, `fork`/`forks` how often and how often-over it may split,
   * and `spread` how far a fork leaves its parent.
   */
  const trunkStyle = {
    curlDrift : 0.0060, curlResponse : 0.12, maxCurv : 0.062,
    kink : 0.080, kinkChance : 0.005, bend : 0.05,
    fork : 0.006, forks : 6, spread : 0.55
  };
  const armStyle = {
    curlDrift : 0.0085, curlResponse : 0.14, maxCurv : 0.080,
    kink : 0.105, kinkChance : 0.007, bend : 0.06,
    fork : 0.008, forks : 3, spread : 0.62
  };
  const hairStyle = {
    curlDrift : 0.0125, curlResponse : 0.17, maxCurv : 0.105,
    kink : 0.140, kinkChance : 0.010, bend : 0.07,
    fork : 0.012, forks : 1, spread : 0.70
  };
  armStyle.hair = hairStyle;
  trunkStyle.hair = hairStyle;

  /* Channel widths, in artwork pixels. A hair is about half a pixel - the tile
   * loses ~4:1 when it is minified down to the size a flash covers - and only a
   * trunk or a core gets near two. */
  const HAIR_W = 0.46;
  const ARM_W = 1.35;
  const TRUNK_W = 1.8;

  const stageCenterY = (sy0 + sy1) * 0.5;
  const spanX = sx1 - sx0;

  if (style === 'spider') {
    /* one bright core, long curling arms in every direction */
    const coreX = cx + (rand() - 0.5) * stageW * 0.16;
    const coreY = clamp(stageCenterY + (rand() - 0.5) * stageH * 0.20, bandLo, bandHi);
    drawCore(coreX, coreY, stageW * 0.018, 2.0 + rand() * 0.4);
    burst(coreX, coreY, 7 + Math.floor(rand() * 3), rand() * Math.PI * 2, Math.PI * 2,
          stageW * 0.42, ARM_W * (0.9 + rand() * 0.4), armStyle, true);
  } else if (style === 'crawler') {
    /* one long strand crawling through the layer, trailing hairs as it goes */
    const dir = (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.35;
    const rightward = Math.cos(dir) >= 0; // dir is ~0 or ~PI, so test the cosine
    const y0 = clamp(stageCenterY + (rand() - 0.5) * stageH * 0.30, bandLo, bandHi);
    const x0 = rightward ? sx0 + stepLen : sx1 - stepLen;
    drawCore(x0, y0, stageW * 0.016, 1.9 + rand() * 0.4);
    growFilament(x0, y0, dir, Math.round(spanX * 0.94 / stepLen),
                 TRUNK_W * (0.95 + rand() * 0.25), 1.0, 0, queue,
                 Object.assign({}, trunkStyle, { band : stageH * 0.30, hair : hairStyle }));
    const hairs = 10 + Math.floor(rand() * 5);
    for (let i = 0; i < hairs; i++) {
      const t = 0.08 + (i / hairs) * 0.84 + (rand() - 0.5) * 0.06;
      const x = rightward ? x0 + spanX * 0.9 * t : x0 - spanX * 0.9 * t;
      const up = rand() < 0.5 ? -1 : 1;
      queue.push({
        x : clamp(x, sx0 + spanX * 0.04, sx1 - spanX * 0.04),
        y : clamp(y0 + (rand() - 0.5) * stageH * 0.18, bandLo, bandHi),
        ang : up * (Math.PI * 0.5) + (rand() - 0.5) * 1.0,
        len : Math.round(stageH * (0.25 + rand() * 0.45) / stepLen),
        w : HAIR_W * (1.0 + rand() * 0.9),
        gain : 0.75 + rand() * 0.2,
        depth : 1,
        st : hairStyle,
        forks : 1
      });
    }
  } else if (style === 'lattice') {
    /* trunks at a few heights, tied together by steep cross strands */
    const rows = 2 + Math.floor(rand() * 2);
    const layerStyle = Object.assign({}, trunkStyle, { band : stageH * 0.26, hair : hairStyle });
    for (let r = 0; r < rows; r++) {
      const y = stageCenterY + (rows === 1 ? 0 : (r / (rows - 1) - 0.5)) * stageH * 0.62;
      const fromLeft = r % 2 === 0;
      growFilament(fromLeft ? sx0 + stepLen : sx1 - stepLen,
                   clamp(y, bandLo, bandHi),
                   (fromLeft ? 0 : Math.PI) + (rand() - 0.5) * 0.30,
                   Math.round(spanX * (0.80 + rand() * 0.15) / stepLen),
                   TRUNK_W * (0.85 + rand() * 0.35), 1.0, 0, queue, layerStyle);
    }
    const ties = 5 + Math.floor(rand() * 3);
    for (let i = 0; i < ties; i++) {
      const up = rand() < 0.5 ? -1 : 1;
      queue.push({
        x : sx0 + (0.12 + rand() * 0.76) * spanX,
        y : clamp(stageCenterY + up * stageH * 0.24, bandLo, bandHi),
        ang : -up * (Math.PI * 0.5) + (rand() - 0.5) * 0.55,
        len : Math.round(stageH * (0.35 + rand() * 0.40) / stepLen),
        w : HAIR_W * (1.1 + rand() * 1.1),
        gain : 0.8 + rand() * 0.2,
        depth : 1,
        st : hairStyle,
        forks : 1
      });
    }
  } else if (style === 'web') {
    /* several small cores, each throwing out short curling rays */
    const cores = 3;
    for (let c = 0; c < cores; c++) {
      const ox = clamp(cx + (rand() - 0.5) * stageW * 0.62, sx0, sx1);
      const oy = clamp(stageCenterY + (rand() - 0.5) * stageH * 0.62, bandLo, bandHi);
      drawCore(ox, oy, stageW * 0.012, 1.5 + rand() * 0.4);
      burst(ox, oy, 5 + Math.floor(rand() * 3), rand() * Math.PI * 2, Math.PI * 2,
            stageW * 0.26, ARM_W * (0.85 + rand() * 0.3), armStyle, true);
    }
  } else if (style === 'veil') {
    /* a curtain of long strands, each curling on its own phase */
    const strands = 9 + Math.floor(rand() * 4);
    for (let i = 0; i < strands; i++) {
      const fromLeft = rand() < 0.5;
      growFilament(fromLeft ? sx0 + stepLen : sx1 - stepLen,
                   clamp(bandLo + (bandHi - bandLo) * (0.10 + rand() * 0.80), bandLo, bandHi),
                   (fromLeft ? 0 : Math.PI) + (rand() - 0.5) * 0.45,
                   Math.round(spanX * (0.55 + rand() * 0.40) / stepLen),
                   HAIR_W * (1.2 + rand() * 1.4), 0.7 + rand() * 0.3, 0, queue,
                   rand() < 0.22 ? armStyle : hairStyle);
    }
  } else if (style === 'braid') {
    /* two or three strands twisting around each other */
    const n = 2 + Math.floor(rand() * 2);
    const dir = (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.25;
    const rightward = Math.cos(dir) >= 0;
    const y0 = clamp(stageCenterY + (rand() - 0.5) * stageH * 0.20, bandLo, bandHi);
    const x0 = rightward ? sx0 + stepLen : sx1 - stepLen;
    const phase = rand() * Math.PI * 2;
    drawCore(x0, y0, stageW * 0.014, 1.8 + rand() * 0.3);
    for (let i = 0; i < n; i++) {
      const st = {
        curlDrift : 0.0060, curlResponse : 0.13, maxCurv : 0.062,
        kink : 0.070, kinkChance : 0.004, bend : 0.05,
        fork : 0.006, forks : 3, spread : 0.55, hair : hairStyle
      };
      growFilament(x0, y0 + Math.sin(phase + i * (Math.PI * 2 / n)) * stageH * 0.18,
                   dir + Math.cos(phase + i * (Math.PI * 2 / n)) * 0.30,
                   Math.round(spanX * (0.70 + rand() * 0.25) / stepLen),
                   HAIR_W * (1.4 + rand() * 1.2), 0.95, 0, queue, st);
    }
    const hairs = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < hairs; i++) {
      queue.push({
        x : sx0 + (0.15 + rand() * 0.70) * spanX,
        y : clamp(y0 + (rand() - 0.5) * stageH * 0.55, bandLo, bandHi),
        ang : (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 1.2,
        len : Math.round(spanX * (0.10 + rand() * 0.14) / stepLen),
        w : HAIR_W * (0.9 + rand() * 0.7),
        gain : 0.72,
        depth : 1,
        st : hairStyle,
        forks : 1
      });
    }
  } else if (style === 'crown') {
    /* a core low in the layer with a fan of arms curling upward */
    const coreX = cx + (rand() - 0.5) * stageW * 0.30;
    const coreY = clamp(stageCenterY + stageH * (0.18 + rand() * 0.14), bandLo, bandHi);
    drawCore(coreX, coreY, stageW * 0.016, 1.8 + rand() * 0.4);
    burst(coreX, coreY, 7 + Math.floor(rand() * 3), -Math.PI * 0.5, Math.PI * 1.15,
          stageW * 0.34, ARM_W * (0.9 + rand() * 0.35), armStyle, true);
  } else if (style === 'fork') {
    /* one trunk that keeps splitting: a branching tree */
    const dir = (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.30;
    const rightward = Math.cos(dir) >= 0;
    const x0 = rightward ? sx0 + stepLen : sx1 - stepLen;
    const y0 = clamp(stageCenterY + (rand() - 0.5) * stageH * 0.30, bandLo, bandHi);
    drawCore(x0, y0, stageW * 0.015, 2.0 + rand() * 0.4);
    const treeStyle = {
      curlDrift : 0.0040, curlResponse : 0.11, maxCurv : 0.046,
      kink : 0.090, kinkChance : 0.006, bend : 0.05,
      fork : 0.035, forks : 9, spread : 0.72, hair : hairStyle
    };
    growFilament(x0, y0, dir, Math.round(spanX * 0.86 / stepLen),
                 TRUNK_W, 1.0, 0, queue, treeStyle);
    const extra = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < extra; i++) {
      queue.push({
        x : clamp(x0 + (rand() < 0.5 ? 1 : -1) * spanX * rand() * 0.25,
                  sx0 + spanX * 0.05, sx1 - spanX * 0.05),
        y : clamp(y0 + (rand() - 0.5) * stageH * 0.25, bandLo, bandHi),
        ang : dir + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.8),
        len : Math.round(spanX * (0.15 + rand() * 0.20) / stepLen),
        w : HAIR_W * (1.1 + rand() * 1.0),
        gain : 0.85,
        depth : 1,
        st : hairStyle,
        forks : 2
      });
    }
  }

  /* --- process forks (breadth first keeps all primary strokes first) --- */
  let guard = 0;
  while (queue.length && guard++ < 260) {
    const fork = queue.shift();
    growFilament(fork.x, fork.y, fork.ang, fork.len, fork.w, fork.gain, fork.depth, queue, fork.st || hairStyle, fork.forks);
  }

  ctx.globalAlpha = 1.0;
  return canvas.transferToImageBitmap();
}
