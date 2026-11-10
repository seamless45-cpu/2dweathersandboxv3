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
 *               'crawler', 'canopy' and 'web' (see generateIntraCloudBolt).
 *               Every shape is confined to a horizontal band of the image, on
 *               top of a soft elliptical halo.
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
   * per-shape behaviour: how much the channel wanders, how strongly it is
   * pulled back along its own axis (horizontal, or vertical for 'canopy') and
   * how eagerly it forks.
   */
  function growFilament(x0, y0, ang, len, w0, gain, depth, queue, st) {
    let x = x0, y = y0, a = ang, w = w0;
    const pts = [x, y];
    let travelled = 0;
    const minW = Math.max(0.22, w0 * 0.12);
    const forkChance = depth === 0 ? st.fork0 : st.forkN;

    /*
     * Real IC channels are tortuous: they bend smoothly over tens of pixels and
     * then kink. Per-step white noise cannot do that (it produces a straight
     * line with fuzz on it), so the heading carries a velocity that is damped
     * every step: the channel draws a long, smooth meander, and an occasional
     * geniculate kink adds the sharp corner that lightning actually has.
     *
     * All of it comes from the seeded PRNG, so the curve is baked into the
     * artwork: it is identical every time this tile is used and can never
     * change while a flash is on screen.
     */
    const kinkChance = st.kink === undefined ? 0.012 : st.kink;
    let wanderVel = (rand() - 0.5) * (st.maxCurve === undefined ? 0.09 : st.maxCurve) * 1.5;

    // The heading is a damped random walk, clamped so it can bend the channel
    // but never let it coil up on itself: a few gentle S-bends per channel, the
    // way a real IC channel runs, with the kinks below for the sharp corners.
    const maxCurve = st.maxCurve === undefined ? 0.09 : st.maxCurve;
    const damping = st.damping === undefined ? 0.90 : st.damping;

    /*
     * The visible curl is a bounded meander, not the random walk above.
     *
     * A random walk on the heading has no memory of where it came from, so
     * turning it up does not produce a wavier channel - it produces a channel
     * that doubles back on itself and coils into a knot a few pixels wide,
     * which on screen is a bright smudge instead of a curved filament. The
     * curl therefore comes from a heading term that oscillates along the path,
     * `axis + meanderAmp * k * cos(phase)` with the phase advancing at a fixed
     * rate: the channel snakes sideways with a lateral amplitude of meanderAmp
     * pixels and a wavelength of meanderWave pixels, forever, and the random
     * walk only adds a little irregularity on top of it.
     *
     * Both numbers are in artwork pixels, which is the scale the shape has to
     * be judged at: the flash is roughly a hundred pixels wide on screen, so
     * the wavelength has to be a good fraction of that in artwork pixels to
     * read as a curve once the tile is shrunk down.
     */
    const meanderAmp = st.meanderAmp === undefined ? 0 : st.meanderAmp;
    const meanderWave = st.meanderWave === undefined ? 0 : st.meanderWave;
    const meanderK = meanderWave > 0 ? (Math.PI * 2) / meanderWave : 0;  // rad per pixel
    const meanderStep = meanderK * stepLen;                              // rad per step
    const meanderAngle = meanderAmp * meanderK;                          // heading swing, rad
    let meanderPhase = rand() * Math.PI * 2;
    let meanderSign = 1;

    // The heading the channel would follow without the curl (and the one the
    // random walk and the pull act on), plus the curl around it. `a += ...`
    // would integrate the wave into a full rotation - a channel that coils
    // into a knot - so the wave is an offset from `axis`, not a step in `a`.
    let axis = a;

    for (let i = 0; i < len; i++) {
      wanderVel += (rand() - 0.5) * st.wander * 0.30;
      wanderVel *= damping;
      wanderVel = clamp(wanderVel, -maxCurve, maxCurve);
      meanderPhase += meanderStep;
      axis += wanderVel;
      if (rand() < kinkChance)
        axis += (rand() < 0.5 ? -1 : 1) * (0.30 + rand() * 0.55);
      // Pull back toward the axis this filament is already travelling along
      // (NOT toward 0, which used to turn every left-going branch around and
      // pile the whole flash onto one side of the image).
      const target = st.vertical
        ? (Math.sin(axis) >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5)
        : (Math.cos(axis) >= 0 ? 0 : Math.PI);
      let da = target - axis;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      axis += da * st.pull;
      // the curl: a sine wave that runs along the channel, in and out of the
      // direction the channel is heading
      a = axis + meanderSign * meanderAngle * Math.cos(meanderPhase);
      // Stay inside the charge layer by reflecting the heading instead of
      // nudging it: a nudge lets a channel run flat along the boundary, and a
      // flat run is exactly the "straight line" that looks wrong.
      if ((y <= bandLo && Math.sin(a) < 0) || (y >= bandHi && Math.sin(a) > 0)) {
        axis = -axis;
        meanderSign = -meanderSign;
        a = axis + meanderSign * meanderAngle * Math.cos(meanderPhase);
        y = clamp(y, bandLo + stepLen, bandHi - stepLen);
      }

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

    // same heading-momentum meander as growFilament: a trunk is a curve too
    const trunkKink = opts.kink === undefined ? 0.010 : opts.kink;
    let wanderVel = (rand() - 0.5) * (opts.maxCurve === undefined ? 0.075 : opts.maxCurve) * 1.5;

    const maxCurve = opts.maxCurve === undefined ? 0.075 : opts.maxCurve;

    // same bounded meander as growFilament (see the comment there): the trunk
    // snakes along with meanderWave pixels between bends instead of coiling.
    const meanderAmp = opts.meanderAmp === undefined ? 0 : opts.meanderAmp;
    const meanderWave = opts.meanderWave === undefined ? 0 : opts.meanderWave;
    const meanderK = meanderWave > 0 ? (Math.PI * 2) / meanderWave : 0;
    const meanderStep = meanderK * stepLen;
    const meanderAngle = meanderAmp * meanderK;
    let meanderPhase = rand() * Math.PI * 2;
    let meanderSign = 1;
    let axis = a;

    for (let i = 0; i < steps; i++) {
      wanderVel += (rand() - 0.5) * (opts.wander || 0.60) * 0.30;
      wanderVel *= opts.damping === undefined ? 0.90 : opts.damping;
      wanderVel = clamp(wanderVel, -maxCurve, maxCurve);
      meanderPhase += meanderStep;
      axis += wanderVel;
      if (rand() < trunkKink)
        axis += (rand() < 0.5 ? -1 : 1) * (0.25 + rand() * 0.40);
      let da = -axis;                              // pull back to horizontal
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      axis += da * (opts.pull || 0.10);
      a = axis + meanderSign * meanderAngle * Math.cos(meanderPhase);

      let ny = y + Math.sin(a) * stepLen;
      if ((ny <= bandLo && Math.sin(a) < 0) || (ny >= bandHi && Math.sin(a) > 0)) {
        axis = -axis;                            // bounce, do not run flat
        meanderSign = -meanderSign;
        a = axis + meanderSign * meanderAngle * Math.cos(meanderPhase);
        ny = y + Math.sin(a) * stepLen;
      }
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

  const spiderStyle = { wander : 1.00, pull : 0.022, maxCurve : 0.140, damping : 0.950, fork0 : 0.016, forkN : 0.028, spread : 0.50, kink : 0.014, meanderAmp : 12, meanderWave : 165, vertical : false };
  const branchStyle = { wander : 1.10, pull : 0.022, maxCurve : 0.160, damping : 0.950, fork0 : 0.018, forkN : 0.026, spread : 0.60, kink : 0.018, meanderAmp : 9, meanderWave : 95, vertical : true };
  const webStyle = { wander : 1.10, pull : 0.022, maxCurve : 0.160, damping : 0.950, fork0 : 0.024, forkN : 0.032, spread : 0.55, kink : 0.020, meanderAmp : 10, meanderWave : 130, vertical : false };

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
                    { fromFrac : 0.22, toFrac : 0.78, wander : 1.00, pull : 0.024, maxCurve : 0.140, damping : 0.950, kink : 0.012, meanderAmp : 11, meanderWave : 170,
                      branchEvery : 11 + Math.floor(rand() * 6),
                      branchLen : (band * 0.34) / stepLen, branchUp : 0 });
    if (rand() < 0.5)
      horizontalTrunk(cy + (rand() - 0.5) * band * 0.75, 2.0 + rand() * 0.6, 0.75,
                      { fromFrac : 0.26, toFrac : 0.74, wander : 1.00, pull : 0.024, maxCurve : 0.140, damping : 0.950, kink : 0.012, meanderAmp : 10, meanderWave : 130,
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
    const trunkOpts = { fromFrac : 0.20, toFrac : 0.80, wander : 1.00, pull : 0.024, maxCurve : 0.140, damping : 0.950, kink : 0.012, meanderAmp : 11, meanderWave : 170 }; // undulating, not a ruler
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
