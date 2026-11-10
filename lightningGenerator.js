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
 *               has dimmer/softer channels than a CG return stroke and comes in
 *               several shapes, so the generator draws one of four: 'spider',
 *               'crawler', 'lattice' and 'web' (see generateIntraCloudBolt).
 *               Every shape is confined to a horizontal band of the image and
 *               consists of channels only - straight runs joined by sharp
 *               kinks, the same character as the CG bolt, with no halo around
 *               them (a CG stroke has none either; its glow comes from the
 *               post-processing bloom).
 *
 *               app.js renders all four into a 2x2 atlas (one tile per
 *               lightning slot) and realisticDisplayShader.frag draws them for
 *               every strike whose intensity is at or below
 *               LIGHTNING_IC_MAX_INTENSITY, i.e. every intra-cloud flash.
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
 * Heading of one step of a channel.
 *
 * A lightning channel is a series of straight runs joined by sharp kinks; it is
 * not a curve. The CG bolt has always looked like that, while the IC artwork
 * superimposed a sine wave on a smoothed heading - a channel that visibly
 * undulated, which is exactly what made an IC channel look wavy and wobbly next
 * to a CG stroke. So there is no wave and no heading momentum here: a run holds
 * its heading for `st.run` steps with a hair of noise, then turns by up to
 * `st.turn` radians, and the pull toward the layer bends the channel at those
 * kinks instead of rounding it off.
 *
 * `s` is the per-filament state ({axis, runLeft}), so a run survives across
 * steps. `rand` is passed in rather than closed over so a test can drive the
 * heading deterministically.
 */
function stepHeading(s, st, y, bandLo, bandHi, rand) {
  if (--s.runLeft <= 0) {
    s.axis += (rand() < 0.5 ? -1 : 1) * st.turn * (0.45 + rand() * 0.85);
    s.runLeft = Math.max(2, Math.round(st.run * (0.6 + rand() * 0.9)));
  }

  // Pull back toward the direction this channel belongs to - horizontal for a
  // spread through the charge layer, vertical for a cross-channel. It acts on
  // the run heading, so the channel bends at a kink and never along a run.
  const target = st.axisTarget !== undefined ? st.axisTarget
    : (st.vertical
      ? (Math.sin(s.axis) >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5)
      : (Math.cos(s.axis) >= 0 ? 0 : Math.PI));
  let da = target - s.axis;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  s.axis += da * st.pull;

  // Stay inside the charge layer by reflecting the run heading (and kinking on
  // the next step) instead of nudging it: a nudge lets a channel run flat along
  // the edge of the layer, and a flat run reads as a stretched wire.
  if ((y <= bandLo && Math.sin(s.axis) < 0) || (y >= bandHi && Math.sin(s.axis) > 0)) {
    s.axis = -s.axis;
    s.runLeft = 0;
  }

  return s.axis + (rand() - 0.5) * 0.08; // roughness, not a wave
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

/**
 * Intra-cloud flashes do not all look alike, so the generator draws four
 * different shapes and app.js puts one in each tile of the 2x2 atlas:
 *
 *   'spider'   layered bidirectional filaments running out from the flash
 *              origin: the classic wide, flat IC flash.
 *   'crawler'  one long horizontal channel with a comb of short,
 *              near-perpendicular branches: a fast horizontal crawl.
 *   'lattice'  two horizontal trunks stacked through the layer, tied together
 *              by steep cross-channels: the layered look of a large IC flash.
 *   'web'      several small centres joined by short radiating filaments, the
 *              mesh-like look of a dense charge layer.
 *
 * All of them stay inside the horizontal band that represents the charge layer,
 * keep clear of the tile margins (the four tiles share one atlas texture, so
 * artwork that touched the edge would bleed into its neighbour) and stay much
 * dimmer than a CG return stroke.
 */
const IC_VARIANTS = ['spider', 'crawler', 'lattice', 'web'];


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
  // Vertical thickness of the charge layer the flash spreads through. Kept
  // narrow on purpose: a flash that fills the whole tile reads as a scribble.
  const band = height * (0.24 + rand() * 0.06);
  const bandLo = cy - band * 0.5;
  const bandHi = cy + band * 0.5;
  const stepLen = Math.max(0.9, width / 640);
  const marginX = Math.max(10, width * 0.06); // keeps atlas tiles free of bleed

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /*
   * Single-channel tone: wider channels are brighter, IC stays soft.
   *
   * The floor matters as much as the curve. A thin filament works out to a
   * value of one or two out of 255, i.e. an almost black stroke, and the shader
   * shows this texture as light: a black stroke is a channel that emits nothing
   * while the halo around it does, so every thin channel came out as a dark
   * silhouette instead of a glowing filament. The floor keeps every channel
   * above 'barely emitting'; the power curve above it still makes a trunk far
   * brighter than a twig.
   */
  const TONE_FLOOR = 45;
  function tone(w, gain) {
    const v = Math.pow(Math.max(w, 0.05), 1.7) * 60.0 * gain;
    const c = Math.max(TONE_FLOOR, Math.min(255, Math.round(v)));
    return 'rgb(' + c + ',' + c + ',' + c + ')';
  }

  /*
   * A flash covers only ~60 pixels on screen while the artwork is 1024 pixels
   * wide (and only its middle half is sampled - see icArtZoom), so a channel
   * that is 2 pixels wide here lands on about a screen pixel. Strokes are drawn
   * STROKE_SCALE times thicker so a channel stays visible once the tile is
   * shrunk; tone() still works from the unscaled width, so the brightness of
   * every channel is unchanged.
   *
   * STROKE_SCALE has to stay small: the shader reads the premultiplied red of
   * this texture, so however wide a channel is here is how wide it is on
   * screen. What keeps a thin channel visible is the tone floor below, not
   * extra width.
   */
  const STROKE_SCALE = 1.15;

  /*
   * A channel is one narrow stroke and nothing else - no glow pass around it.
   *
   * The display shader shows this texture as light and has to give that light an
   * alpha to blend it in, so the dim parts of the artwork are the expensive
   * ones: a faint skirt of light around every channel is drawn over the sky with
   * an alpha it cannot pay for, which leaves the dark rim and, while a flash
   * fades, the dark silhouette along its segments. The CG bolt has no such
   * skirt either - it is just the stroke, plus bloom in post processing. Dropping
   * the glow passes here is what makes an IC channel look like a CG channel.
   *
   * Strokes are painted with 'lighten', i.e. a stroke only ever replaces what is
   * underneath it with something brighter, so crossing channels cannot churn the
   * tile into a mesh of dark troughs.
   */
  function strokePath(pts, w, gain) {
    if (pts.length < 4) return;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);

    ctx.globalCompositeOperation = 'lighten';
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = Math.max(0.4, w) * STROKE_SCALE;
    ctx.strokeStyle = tone(w, gain);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  /*
   * Grow one filament. Fork targets are queued (never recursed) so a very
   * branchy flash cannot blow the stack inside a worker. `st` carries the
   * per-shape behaviour: how long a straight run lasts, how sharply it kinks
   * (see stepHeading), how strongly it is pulled back along its own axis
   * (horizontal, or vertical for a cross-channel) and how eagerly it forks.
   */
  function growFilament(x0, y0, ang, len, w0, gain, depth, queue, st) {
    let x = x0, y = y0, a = ang, w = w0;
    const pts = [x, y];
    let travelled = 0;
    const minW = Math.max(0.22, w0 * 0.12);
    const forkChance = depth === 0 ? st.fork0 : st.forkN;

    /*
     * The heading is a straight run with a hair of noise, joined to the next run
     * by a sharp kink (see stepHeading above). That is the character a CG bolt
     * has, and it is the reason an IC channel no longer reads as a wobbling
     * sine wave. Everything comes from the seeded PRNG, so the shape is baked
     * into the artwork: identical every time this tile is used, and it can
     * never change while a flash is on screen.
     */
    const s = { axis : a, runLeft : 1 + Math.floor(rand() * Math.max(1, st.run)) };

    for (let i = 0; i < len; i++) {
      a = stepHeading(s, st, y, bandLo, bandHi, rand);

      const nx = x + Math.cos(a) * stepLen;
      const ny = y + Math.sin(a) * stepLen;
      if (nx < marginX || nx > width - marginX) break;
      if (ny < 3 || ny > height - 3) break;

      x = nx; y = ny;
      travelled += stepLen;
      pts.push(x, y);
      w = Math.max(minW, w * 0.9972);

      if (depth < 4 && travelled > stepLen * 6 && rand() < forkChance) {
        const forkAng = a + (rand() < 0.5 ? -1 : 1) * st.spread * (0.5 + rand());
        queue.push({
          x, y,
          ang: forkAng,
          len: Math.max(7, Math.min(80, Math.round(len * (0.22 + rand() * 0.30)))),
          w: Math.max(0.26, w * (0.42 + rand() * 0.28)),
          gain: gain * 0.82,
          depth: depth + 1,
          st: st
        });
      }
    }
    strokePath(pts, w0, gain);
  }

  const queue = [];

  /*
   * A channel that sweeps the whole width of the charge layer, optionally
   * dropping branches as it goes. Used by 'crawler' (one trunk, branches both
   * ways) and 'lattice' (two trunks tied together by cross-channels).
   */
  function horizontalTrunk(yStart, trunkWidth, gain, opts) {
    const branchEvery = Math.max(0, Math.round(opts.branchEvery || 0));
    const branchLen = opts.branchLen || 0;
    // A trunk covers the middle of the tile (opts.fromFrac .. opts.toFrac) and
    // not the full width: a channel running from edge to edge looks like a wire
    // stretched across the cloud instead of a flash inside it.
    const spanStart = marginX + (width - marginX * 2) * (opts.fromFrac === undefined ? 0.12 : opts.fromFrac);
    const spanEnd = marginX + (width - marginX * 2) * (opts.toFrac === undefined ? 0.88 : opts.toFrac);
    let x = spanStart;
    let y = clamp(yStart, bandLo, bandHi);
    let a = 0;                                     // travelling to the right
    const pts = [x, y];
    const steps = Math.ceil((spanEnd - spanStart) / stepLen);

    // A trunk is a channel like any other: straight runs joined by sharp kinks
    // (see stepHeading). It is given a fixed horizontal target, so the pull only
    // ever brings a run back toward the direction the trunk is travelling.
    const trunk = {
      run : opts.run === undefined ? 16 : opts.run,
      turn : opts.turn === undefined ? 0.34 : opts.turn,
      pull : opts.pull === undefined ? 0.06 : opts.pull,
      axisTarget : 0,
      vertical : false
    };
    const s = { axis : a, runLeft : 1 + Math.floor(rand() * trunk.run) };

    for (let i = 0; i < steps; i++) {
      a = stepHeading(s, trunk, y, bandLo, bandHi, rand);

      let ny = y + Math.sin(a) * stepLen;
      // Always move forward: a trunk that is momentarily pointing at the band
      // edge would otherwise churn in place and pile up as a blob at the start.
      x = Math.min(x + Math.max(Math.cos(a), 0.35) * stepLen, spanEnd);
      y = clamp(ny, bandLo + stepLen * 0.5, bandHi - stepLen * 0.5);
      pts.push(x, y);

      if (branchEvery && i > 4 && i % branchEvery === 0) {
        const dir = opts.branchUp === 0 || opts.branchUp === undefined
          ? (rand() < 0.5 ? 1 : -1)
          : opts.branchUp;
        queue.push({
          x, y,
          ang: dir * (Math.PI * 0.5 + (rand() - 0.5) * 0.9),
          len: Math.max(5, Math.round(branchLen * (0.55 + rand() * 0.9))),
          w: Math.max(0.4, trunkWidth * (0.26 + rand() * 0.22)),
          gain: gain * 0.80,
          depth: 1,
          st: branchStyle
        });
      }
    }
    strokePath(pts, trunkWidth, gain);
  }

  /*
   * There is deliberately no halo layer any more. A soft ellipse of light under
   * the channels was the last glow layer left, and it is exactly what read as a
   * dark silhouette while a flash faded: the halo is dim, the shader still has
   * to blend it over the sky, and a dim blend darkens. IC flashes now consist of
   * channels only, like a cloud-to-ground bolt.
   */

  /*
   * Per-shape channel behaviour, in steps of stepLen (~1.6 artwork pixels):
   * `run` is how many steps a straight run holds before it kinks, `turn` is the
   * size of that kink in radians, `pull` how strongly a run is bent back toward
   * the layer it belongs to. A run of 10-16 steps is 16-26 artwork pixels, i.e.
   * a couple of pixels on screen - long enough to read as a straight length of
   * channel, short enough that the flash still zigzags the way lightning does.
   */
  const spiderStyle = { run : 11, turn : 0.50, pull : 0.055, fork0 : 0.016, forkN : 0.028, spread : 0.50, vertical : false };
  const branchStyle = { run : 8, turn : 0.46, pull : 0.055, fork0 : 0.018, forkN : 0.026, spread : 0.60, vertical : true };
  const webStyle = { run : 10, turn : 0.52, pull : 0.055, fork0 : 0.024, forkN : 0.032, spread : 0.55, vertical : false };

  if (style === 'spider') {
    /* --- primary filaments: several layered spiders around the origin --- */
    const nPrimary = 5 + Math.floor(rand() * 2);          // 5..6
    for (let i = 0; i < nPrimary; i++) {
      const side = (i % 2 === 0) ? 1 : -1;                // spread both ways
      const yJitter = (rand() - 0.5) * band * 0.62;
      const startX = clamp(cx + (rand() - 0.5) * width * 0.05, marginX, width - marginX);
      const startY = clamp(cy + yJitter, bandLo, bandHi);
      const len = Math.round((width * (0.26 + rand() * 0.10)) / stepLen); // cross the visible middle of the tile
      const w = 1.7 + rand() * 0.8;
      growFilament(startX, startY, side > 0 ? 0 + (rand() - 0.5) * 0.40
                                            : Math.PI + (rand() - 0.5) * 0.40,
                   len, w, 1.0, 0, queue, spiderStyle);
    }

    /* --- dense core burst around the origin ---------------------------- */
    // Real IC flashes have a bright, chaotic core where the bidirectional
    // leader starts; without it the texture reads as a few loose strands.
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2 * 0.18 + (rand() - 0.5) * 0.9;
      const dir = i % 2 === 0 ? ang : Math.PI + ang;
      const len = Math.round((width * (0.10 + rand() * 0.08)) / stepLen);
      growFilament(cx + (rand() - 0.5) * width * 0.03,
                   clamp(cy + (rand() - 0.5) * band * 0.35, bandLo, bandHi),
                   dir, len, 1.1 + rand() * 0.9, 0.9, 1, queue, spiderStyle);
    }

    /* --- thin filaments offset above/below give the layered look --- */
    for (let i = 0; i < 2; i++) {
      const startY = clamp(cy + (rand() - 0.5) * band, bandLo, bandHi);
      const startX = cx + (rand() - 0.5) * width * 0.20;
      const len = Math.round((width * (0.22 + rand() * 0.10)) / stepLen);
      growFilament(startX, startY, (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.7,
                   len, 0.9 + rand() * 0.6, 0.70, 1, queue, spiderStyle);
    }
  } else if (style === 'crawler') {
    /* one long channel sweeps the whole layer, dropping a comb of short, steep
       branches as it goes: the "crawler" look */
    horizontalTrunk(cy + (rand() - 0.5) * band * 0.20, 3.6 + rand() * 0.8, 1.0,
                    { fromFrac : 0.22, toFrac : 0.78, run : 12, turn : 0.42, pull : 0.06,
                      branchEvery : 11 + Math.floor(rand() * 6),
                      branchLen : (band * 0.34) / stepLen, branchUp : 0 });
    if (rand() < 0.5)
      horizontalTrunk(cy + (rand() - 0.5) * band * 0.75, 2.0 + rand() * 0.6, 0.75,
                      { fromFrac : 0.26, toFrac : 0.74, run : 11, turn : 0.38, pull : 0.06,
                        branchEvery : 18 + Math.floor(rand() * 8),
                        branchLen : (band * 0.24) / stepLen, branchUp : 0 });
  } else if (style === 'lattice') {
    /*
     * Two trunks running through the layer at different heights, tied together
     * by steep cross-channels: a big IC flash lights up more than one layer of
     * charge, and the channels between the layers are what makes it look like a
     * lattice rather than a single stroke.
     */
    const upperY = cy - band * (0.18 + rand() * 0.14);
    const lowerY = cy + band * (0.18 + rand() * 0.14);
    const trunkOpts = { fromFrac : 0.20, toFrac : 0.80, run : 12, turn : 0.42, pull : 0.06 };
    horizontalTrunk(upperY, 2.8 + rand() * 0.7, 1.0, trunkOpts);
    horizontalTrunk(lowerY, 2.6 + rand() * 0.7, 0.95, trunkOpts);

    /* cross-channels between the two trunks, at assorted angles */
    for (let i = 0; i < 7; i++) {
      const fromTop = rand() < 0.5;
      const x = marginX + (0.12 + rand() * 0.76) * (width - marginX * 2);
      growFilament(x, (fromTop ? upperY : lowerY) + (rand() - 0.5) * band * 0.1,
                   fromTop ? (Math.PI * 0.5 + (rand() - 0.5) * 0.8) : (-Math.PI * 0.5 + (rand() - 0.5) * 0.8),
                   Math.round((band * (0.20 + rand() * 0.30)) / stepLen),
                   1.0 + rand() * 0.8, 0.85, 1, queue, branchStyle);
    }

    /* a few forks along the trunks so they do not read as clean lines */
    for (let i = 0; i < 3; i++) {
      const onLower = rand() < 0.5;
      growFilament(marginX + (0.15 + rand() * 0.70) * (width - marginX * 2), onLower ? lowerY : upperY,
                   (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.5,
                   Math.round((width * (0.06 + rand() * 0.08)) / stepLen),
                   1.0 + rand() * 0.6, 0.75, 1, queue, webStyle);
    }
  } else { // 'web'
    /*
     * Several small centres, each throwing out short rays: the mesh of a dense
     * charge layer rather than one flash with a single origin.
     */
    const centres = 4 + Math.floor(rand() * 2);           // 4..5
    for (let c = 0; c < centres; c++) {
      const ox = clamp(cx + (rand() - 0.5) * width * 0.42, marginX, width - marginX);
      const oy = clamp(cy + (rand() - 0.5) * band * 0.70, bandLo, bandHi);
      const rays = 4 + Math.floor(rand() * 2);            // 4..5
      for (let r = 0; r < rays; r++) {
        const ang = (r / rays) * Math.PI * 2 + (rand() - 0.5) * 0.60;
        const len = Math.round((width * (0.035 + rand() * 0.055)) / stepLen);
        growFilament(ox, oy, ang, len, 1.3 + rand() * 0.8, 0.85, 1, queue, webStyle);
      }
    }

    /* a couple of short filaments tie the mesh together */
    for (let i = 0; i < 2; i++) {
      growFilament(clamp(cx + (rand() - 0.5) * width * 0.30, marginX, width - marginX),
                   clamp(cy + (rand() - 0.5) * band * 0.45, bandLo, bandHi),
                   rand() < 0.5 ? 0 : Math.PI,
                   Math.round((width * (0.10 + rand() * 0.08)) / stepLen),
                   1.1 + rand() * 0.5, 0.70, 1, queue, webStyle);
    }
  }

  /* --- process forks (breadth first keeps all primary strokes first) --- */
  let guard = 0;
  while (queue.length && guard++ < 520) {
    const fork = queue.shift();
    growFilament(fork.x, fork.y, fork.ang, fork.len, fork.w, fork.gain, fork.depth, queue, fork.st || spiderStyle);
  }

  ctx.globalAlpha = 1.0;
  return canvas.transferToImageBitmap();
}
