/*
 * lightningGenerator.js — procedural lightning artwork, generated off the main
 * thread and transferred as an ImageBitmap.
 *
 * There is one kind of artwork: a cloud-to-ground bolt. One dominant channel
 * grows downward with the classic dendritic forks, drawn the way the original app
 * drew it - one heading, step, kick, pull back toward vertical, and a 9 pixel
 * channel on a 2500 x 5000 tile (see CG_SHAPE and ARTWORK_SIZE).
 *
 * Every strike uses it. Intra-cloud flashes used to be a separate network of
 * hair-thin filaments, drawn from eight artwork tiles through their own additive
 * light pass; they are drawn with this bolt now, at this bright, and the filament
 * artwork is gone with the pass that used it (see realisticDisplayShader.frag).
 *
 * Protocol:
 *   worker.postMessage({width, height})                  -> bolt artwork
 *   worker.postMessage({kind: 'network', width, height})  -> intra-cloud network
 * The worker posts back {width, height, data} with data a Uint8Array of one byte
 * per texel, transferred - not an ImageBitmap. See readRedChannel below for why.
 *
 * What crosses is built here, field by field, and it is *only* data: a number, a
 * number, a typed array. Anything else the generator hangs off its return value -
 * the counters the test harness counts segments with, a method, whatever gets added
 * next - stays in the worker. Posting such an object directly throws
 * `DataCloneError` inside the worker, the artwork never arrives, and the display
 * has nothing to draw with: no lightning at all, of either kind, with a single line
 * in the console to say so.
 */
onmessage = (event) => {
  const msg = event.data || {};
  const network = msg.kind === 'network';
  const fallback = network ? IC_ARTWORK_SIZE : ARTWORK_SIZE;
  const width = Math.max(32, Math.round(msg.width || fallback.width));
  const height = Math.max(32, Math.round(msg.height || fallback.height));
  const artwork = network ? generateLightningNetwork(width, height) : generateLightningBolt(width, height);
  postMessage({width : artwork.width, height : artwork.height, data : artwork.data},
              [artwork.data.buffer]);
};


/*
 * The artwork leaves as one byte per texel, not as an ImageBitmap.
 *
 * A canvas is RGBA whatever is drawn on it, so handing a bitmap to texImage2D asks
 * the driver to take a 50 MB four-channel picture and make a 12.5 MB single-channel
 * texture out of it. On a machine that is already short of graphics memory that
 * temporary is the difference between a texture and a lost context. Reading the red
 * channel out here costs one pass over the pixels, in the worker, and then exactly
 * the 12.5 MB the texture needs crosses to the main thread. Every channel of the
 * artwork holds the same value, so the red channel is the picture.
 *
 * The counters are the stub canvas's (see tests/ic-canvas-stub.js), which is how
 * the harness counts segments; in a browser they are simply undefined.
 *
 * This object is *not* what the worker posts - see the protocol above. It carries
 * the counters, and a method used to live here too, which is exactly what cannot be
 * sent through postMessage.
 */
function readRedChannel(ctx, width, height)
{
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4)
    data[i] = rgba[j];

  return {
    width : width,
    height : height,
    data : data,
    strokeCount : ctx.strokeCount,
    segmentCount : ctx.segmentCount,
    fillCount : ctx.fillCount
  };
}


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


/* ===================== cloud-to-ground bolt ============================== */

/*
 * The shape of a cloud-to-ground channel: the original one, unchanged.
 *
 * One heading, turned every step by its own noise (`(rand - 0.5) * 1.4`, up to
 * +-40 degrees a pixel) and pulled back toward straight down by 8% a step. The
 * result is a channel that buzzes down the picture: high-frequency kinks with no
 * long arc to them, which is what makes it read as a return stroke rather than as
 * a filament.
 *
 * This is the artwork the app shipped with, and it is where it stays: the shapes
 * and widths tried on top of it (a two-scale heading, a hair-thin channel) were
 * taken back out when the look was restored. The numbers are the original ones -
 * 9 artwork pixels for the trunk, half of that at most for a fork, and a fork that
 * sheds a fifth of a pixel every time it narrows - and they are named here only so
 * tests/check-lightning-bolt.js can hold them.
 *
 * The tile is the original one too: 2500 by 5000. This repo's fork of the app had
 * halved both the tile and the channel (1250 x 2500, 4.5 pixels) and doubled the
 * brightness gain to compensate, which keeps the relative width but throws away
 * half the texels - the channel is softer and breaks up sooner when the camera
 * pulls back. The radiance is unchanged by the rescale: pow(lineWidth, 2) is 81
 * for the trunk either way.
 *
 * Numbers are in artwork pixels per step; a step is one pixel.
 */
const ARTWORK_SIZE = { width : 2500, height : 5000 }; // the original tile, in pixels

const CG_SHAPE = {
  startAngle : Math.PI / 6., // the channel leaves the cloud leaning
  jitter : 1.4,              // the kick it takes every step, rad
  straighten : 0.08,         // ... and the pull back toward straight down
  branchJitter : 0.7,        // the same, for a fork
  lineWidth : 9.0,           // artwork pixels - the original trunk width
  branchWidthRatio : 0.5,    // the original fork width: up to half the trunk
  taper : 0.2                // artwork pixels a fork sheds each time it narrows
};

function generateLightningBolt(width, height)
{
  const lightningCanvas = new OffscreenCanvas(width, height);
  // willReadFrequently keeps the canvas in system memory instead of asking the GPU
  // for a 2500 x 5000 RGBA backing store - fifty megabytes, for artwork that is
  // drawn once and then handed over as an R8 texture. On a machine whose graphics
  // memory is already tight, that allocation is as much of a problem as the texture.
  const ctx = lightningCanvas.getContext('2d', {willReadFrequently : true});

  ctx.clearRect(0, 0, width, height);


  function genLightningColor(lineWidth)
  {
    const colR = 12;
    const colG = 12;
    const colB = 12;
    const brightness = Math.pow(lineWidth, 2.0);
    return `rgb(${colR * brightness}, ${colG * brightness}, ${colB * brightness})`;
  }


  ctx.beginPath();

  let startX = width / 2.0;
  let startY = 0;
  let angle = CG_SHAPE.startAngle;
  let lineWidth = CG_SHAPE.lineWidth;
  const targetAngle = 0.0;

  ctx.moveTo(startX, startY);

  ctx.lineWidth = lineWidth;

  while (startY < height) {

    const nextX = startX + Math.sin(angle);
    const nextY = startY + Math.cos(angle);

    angle += (Math.random() - 0.5) * CG_SHAPE.jitter;
    angle -= (angle - targetAngle) * CG_SHAPE.straighten; // keep it going in a general direction

    ctx.lineTo(nextX, nextY);

    startX = nextX;
    startY = nextY;


    if (Math.random() < 0.015 * (1. - nextY / height)) { // branch
      ctx.strokeStyle = genLightningColor(lineWidth);
      ctx.stroke();
      drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 2.5, lineWidth * CG_SHAPE.branchWidthRatio * Math.random());
      ctx.beginPath();
      ctx.moveTo(nextX, nextY); // move back to last position after drawing branch
      ctx.lineWidth = lineWidth;
    }
  }
  ctx.strokeStyle = genLightningColor(lineWidth);
  ctx.stroke();


  return readRedChannel(ctx, width, height);


  function drawBranch(startX, startY, targetAngle, line_width)
  {
    let angle = targetAngle;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineWidth = line_width;

    while (startY < height) {

      const nextX = startX + Math.sin(angle);
      const nextY = startY + Math.cos(angle);

      angle += (Math.random() - 0.5) * CG_SHAPE.branchJitter;

      angle -= (angle - targetAngle) * CG_SHAPE.straighten; // keep it going in a general direction

      ctx.lineTo(nextX, nextY);

      startX = nextX;
      startY = nextY;

      if (Math.random() < 0.018) { // reduce width

        ctx.strokeStyle = genLightningColor(line_width);
        ctx.stroke();
        line_width -= CG_SHAPE.taper;

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


/* ===================== intra-cloud network ============================== */

/*
 * The shape of an intra-cloud channel network, which is a different animal from a
 * cloud-to-ground bolt and always was.
 *
 * A stroke is one channel going one way: down. A flash is a *network*: leaders
 * that leave the strike point and run outward through the charge layer, forking
 * into finer and finer channels until what is left is a haze of tendrils. The
 * channels are thin - a few artwork pixels, against nine for the bolt trunk -
 * there are hundreds of them, they spread over a wide, flat volume rather than a
 * line, and none of them goes anywhere near the ground.
 *
 * So this is not the bolt generator with different numbers. It is a set of leaders
 * fanning out from one origin, each with its own heading, each forking as it goes,
 * drawn with the same antialiased strokes and the same square-of-width radiance as
 * the bolt so the two read as the same phenomenon.
 *
 * And each leader *curves*. A leader that keeps one heading is a straight line
 * whatever noise is laid on it, and a flash made of straight lines is a rake lying
 * on its side - which is what this was. The heading a strand is pulled toward swings
 * smoothly either side of the direction it opened on (see `waveAmp`/`waveLength` in
 * IC_SHAPE), so a channel sweeps up through the charge layer, bends back and sweeps
 * down again, while the buzz rides on top of the sweep. The curves are what make it
 * read as channels curling inside a cloud rather than as a bundle of filaments shot
 * out of one point.
 *
 * The tile is compact (512 x 256, 2:1) and centered on the strike point so
 * thin curved leaders fan outward in sweeping arcs and dendritic forks across
 * the cloud layer without overlapping into thick flat horizontal bands.
 */
const IC_ARTWORK_SIZE = { width : 512, height : 256 };

const IC_SHAPE = {
  leaders      : 6,      // curved leaders radiating outward from the strike point
  trunkWidth   : 1.25,   // artwork pixels - fine intra-cloud main channel
  trunkRatio   : 0.84,   // secondary leaders start slightly finer than the main trunk
  branchRatio  : 0.74,   // forks taper delicately without vanishing under mipmapping
  minWidth     : 0.75,
  stepLength   : 1.25,   // artwork pixels per step
  jitter       : 0.32,   // electrical crackle riding on top of the curving spine
  straighten   : 0.28,   // pull drawAngle gently toward the curving spine
  forkChance   : 0.018,  // per step, per strand - curved dendritic forks
  maxLevel     : 2,      // trunk, fork, and sub-forks

  // Continuous sweeping curvature along each channel: every leader and fork bends
  // steadily across a C-arc or S-curve from start to tip rather than vibrating
  // back and forth around a fixed straight line.
  sweepAmp     : 1.35,   // rad - continuous sweep across each channel's reach
  sweepSpread  : 0.50,   // per-strand variation in sweep angle
  waveAmp      : 0.65,   // rad - secondary bend amplitude for organic S-curves
  waveAmpSpread : 0.30,  // per-strand variation in wave amplitude
  margin       : 0.16    // edge margin where channels curve gently inward
};

const IC_LEVELS = [1.0, 0.78, 0.58]; // channel radiance by fork depth, 0..1


/*
 * The heading of one strand of the network, as a thing that can be watched.
 *
 * `makeIcStrand` opens a leader on an outward axis and continuous arc sweep;
 * `icHeadingStep` advances one artwork step and returns the heading to draw with.
 * They are separate from drawing so `tests/check-lightning-bolt.js` can run the
 * real arithmetic and measure how far a channel bows away from the straight line
 * between its ends.
 */
function makeIcStrand(axis, curveSign, steps, rand)
{
  const r = rand || Math.random;
  const nSteps = Math.max(steps || 120, 18);
  const sign = curveSign || (r() < 0.5 ? 1 : -1);
  const sweepMag = Math.max(0, IC_SHAPE.sweepAmp + (r() - 0.5) * IC_SHAPE.sweepSpread);
  const waveMag = Math.max(0, IC_SHAPE.waveAmp + (r() - 0.5) * IC_SHAPE.waveAmpSpread);
  return {
    axis : axis,
    angle : axis,
    drawAngle : axis,
    curveSign : sign,
    stepIndex : 0,
    steps : nSteps,
    sweepTotal : sign * sweepMag,
    waveFreq : (Math.PI * (0.9 + r() * 0.8)) / nSteps,
    waveAmp : sign * waveMag
  };
}

function icHeadingStep(strand, rand, posXFraction, posYFraction, heightAspect)
{
  const r = rand || Math.random;
  const t = strand.stepIndex / Math.max(strand.steps, 1);
  strand.stepIndex++;

  const rawBend = strand.sweepTotal * t + strand.waveAmp * Math.sin(strand.stepIndex * strand.waveFreq);
  const clampedBend = Math.max(-1.45, Math.min(1.45, rawBend));
  let spineAngle = strand.axis + clampedBend;

  // Smoothly curve tangentially inward away from tile margins so channels stay
  // curved inside the cloud slab instead of terminating abruptly on a border.
  if (posXFraction !== undefined && posYFraction !== undefined) {
    const mx = Math.max(0, Math.abs(posXFraction - 0.5) - (0.5 - IC_SHAPE.margin)) / IC_SHAPE.margin;
    const my = Math.max(0, Math.abs(posYFraction - 0.5) - (0.5 - IC_SHAPE.margin)) / IC_SHAPE.margin;
    if (mx > 0 || my > 0) {
      const aspect = heightAspect || 0.5;
      const toCenter = Math.atan2((0.5 - posYFraction) * aspect, 0.5 - posXFraction);
      const tangent = toCenter + strand.curveSign * 0.95;
      const diff = Math.atan2(Math.sin(tangent - spineAngle), Math.cos(tangent - spineAngle));
      spineAngle += diff * Math.min(0.45, (mx * mx + my * my) * 0.25);
    }
  }

  strand.angle = spineAngle;
  strand.drawAngle += (r() - 0.5) * IC_SHAPE.jitter;
  const delta = Math.atan2(Math.sin(spineAngle - strand.drawAngle), Math.cos(spineAngle - strand.drawAngle));
  strand.drawAngle += delta * IC_SHAPE.straighten;

  return strand.drawAngle;
}


function generateLightningNetwork(width, height)
{
  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d', {willReadFrequently : true}); // see generateLightningBolt

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighten'; // strands cross; the brighter one wins

  const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

  function genNetworkColor(level)
  {
    const v = Math.round(255 * IC_LEVELS[Math.min(level, IC_LEVELS.length - 1)]);
    return `rgb(${v}, ${v}, ${v})`;
  }

  const startX = width * 0.5;
  const startY = height * 0.5;
  const heightAspect = height / width;

  /*
   * One curved strand: opens cleanly along its outward axis, sweeps along a broad
   * C-arc or S-bend with electrical crackle, and forks into finer curved tendrils.
   */
  function drawStrand(sx, sy, axis, curveSign, steps, lineWidth, level)
  {
    let x = sx, y = sy;
    const strand = makeIcStrand(axis, curveSign, steps, Math.random);

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = genNetworkColor(level);
    ctx.lineWidth = lineWidth;

    for (let i = 0; i < steps; i++) {
      const angle = icHeadingStep(strand, Math.random, x / width, y / height, heightAspect);

      const nextX = x + Math.cos(angle) * IC_SHAPE.stepLength;
      const nextY = y + Math.sin(angle) * IC_SHAPE.stepLength;

      if (nextX < 2. || nextX > width - 2. || nextY < 2. || nextY > height - 2.) {
        ctx.lineTo(clamp(nextX, 2., width - 2.), clamp(nextY, 2., height - 2.));
        break;
      }

      x = nextX;
      y = nextY;
      ctx.lineTo(x, y);

      if (level < IC_SHAPE.maxLevel && i > 6 && Math.random() < IC_SHAPE.forkChance) {
        ctx.stroke(); // commit the parent so far

        const side = Math.random() < 0.5 ? -1. : 1.;
        const forkAxis = strand.angle + side * (0.45 + Math.random() * 0.45);
        drawStrand(x, y, forkAxis, side,
                   Math.max(16, Math.round(steps * (0.42 + Math.random() * 0.35))),
                   Math.max(IC_SHAPE.minWidth, lineWidth * IC_SHAPE.branchRatio), level + 1);

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.strokeStyle = genNetworkColor(level);
        ctx.lineWidth = lineWidth;
      }
    }
    ctx.stroke();
  }

  // Curved leaders fanning outward from the strike center in an organic cluster.
  const rot = Math.random() * Math.PI * 2.;
  const globalHand = Math.random() < 0.5 ? 1. : -1.;
  for (let i = 0; i < IC_SHAPE.leaders; i++) {
    const axis = rot + (i / IC_SHAPE.leaders) * Math.PI * 2. + (Math.random() - 0.5) * 0.18;
    const curveSign = (i % 3 === 0 ? -globalHand : globalHand);
    const dirWeight = Math.hypot(Math.cos(axis) * 0.42 * width, Math.sin(axis) * 0.38 * height);
    const reach = dirWeight * (0.72 + Math.random() * 0.26);
    const steps = Math.round(reach / IC_SHAPE.stepLength);
    const lineWidth = i === 0 ? IC_SHAPE.trunkWidth : IC_SHAPE.trunkWidth * IC_SHAPE.trunkRatio;

    drawStrand(startX, startY, axis, curveSign, steps, lineWidth, i === 0 ? 0 : 1);
  }

  return readRedChannel(ctx, width, height);
}


if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    makeRng : makeRng,
    generateLightningBolt : generateLightningBolt,
    generateLightningNetwork : generateLightningNetwork,
    makeIcStrand : makeIcStrand,
    icHeadingStep : icHeadingStep,
    CG_SHAPE : CG_SHAPE,
    IC_SHAPE : IC_SHAPE,
    ARTWORK_SIZE : ARTWORK_SIZE,
    IC_ARTWORK_SIZE : IC_ARTWORK_SIZE
  };
}
