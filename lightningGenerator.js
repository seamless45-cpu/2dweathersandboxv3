/*
 * lightningGenerator.js — procedural lightning artwork, generated off the main
 * thread and transferred as an ImageBitmap.
 *
 * There is one kind of artwork: a cloud-to-ground bolt. One dominant fractal
 * channel grows downward with dendritic forks - midpoint displacement, not a
 * one-pixel heading walk - and a 9 pixel trunk on a 2500 x 5000 tile (see
 * CG_SHAPE and ARTWORK_SIZE).
 *
 * CG strikes draw it. Intra-cloud flashes draw the second shape further down -
 * the curved-leader network in IC_SHAPE (see displayFlash in
 * realisticDisplayShader.frag) - not the bolt rotated.
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
 * The shape of a cloud-to-ground channel: a fractal, not a one-pixel walk.
 *
 * A real return stroke is broad sweeping arcs with fine tortuosity folded into
 * them, which is what midpoint displacement produces: anchor two ends of the
 * channel, displace the midpoint perpendicular to the segment, and subdivide
 * until the segments are about two artwork pixels long. Each level keeps
 * `roughness` of the previous level's displacement, so the path carries energy
 * at every scale - long arcs, knees, and the hair-fine kinks a stepped leader
 * shows when it attaches. A gentle mean reversion toward the vertical axis
 * keeps the fractal from ever walking out of the sprite.
 *
 * This replaces a walk that kicked the heading by up to +-40 degrees every
 * single artwork pixel: statistically white-noise, so the channel buzzed down
 * the picture with no arc to it at any scale - which is what read as "jagged".
 *
 * Forks leave the trunk at 25..52 degrees off vertical (the original opening of
 * roughly this range) with the same displacement at a smaller scale, taper as
 * they run, and either fade into the air or run to the ground and fork again.
 *
 * The tile is the original one: 2500 by 5000. The fork this repo started from
 * halved both and doubled the brightness gain (1250 x 2500 at 4.5 px); that
 * keeps the relative width but loses half the texels, so the channel is
 * softer and breaks up sooner when the camera pulls back. The radiance is
 * unchanged by the rescale: pow(lineWidth, 2) is 81 for the trunk either way.
 *
 * Numbers are fractions of the tile (displacement) or artwork pixels (width).
 */
const ARTWORK_SIZE = { width : 2500, height : 5000 }; // the original tile, in pixels

const CG_SHAPE = {
  startAngle : Math.PI / 6., // the channel leaves the cloud leaning
  leanRange : 0.34,          // overall end drift, as a fraction of tile height at most
  roughness : 0.58,          // fraction of the previous level's displacement kept per subdivision
  initialAmplitude : 0.075,  // first displaced octave, fraction of tile height
  minSegment : 2.1,          // subdivision stops once segments are this small, in artwork pixels
  centerPull : 0.025,        // mean reversion toward the vertical axis, per level
  branchAngle : 0.38,        // base fork opening off the parent channel, rad (scaled per fork)
  branchAmplitude : 0.10,    // a fork's first octave, fraction of its own span
  lineWidth : 9.0,           // artwork pixels - the original trunk width
  branchWidthRatio : 0.5,    // the original fork width: up to half the trunk
  taper : 0.2                // artwork pixels a fork sheds each time it narrows
};

/*
 * Midpoint displacement between two anchors. Returns the full polyline.
 * `amplitude` is the first level's displacement; it is scaled by
 * `roughness` at every level, and each level also pulls every new point a
 * little back toward `centerX` so the fractal stays inside the sprite.
 * Uses Math.random() throughout: the test harness seeds Math.random to make
 * a stable artwork, and so can any caller.
 */
function fractalPath(x0, y0, x1, y1, amplitude, centerX)
{
  let points = [[x0, y0], [x1, y1]];
  let amp = amplitude;
  for (let level = 0; level < 14; level++) {
    let maxLen = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const dx = points[i + 1][0] - points[i][0];
      const dy = points[i + 1][1] - points[i][1];
      const len = Math.hypot(dx, dy);
      if (len > maxLen) maxLen = len;
    }
    if (maxLen <= CG_SHAPE.minSegment)
      break;
    const next = new Array(points.length * 2 - 1);
    next[0] = points[0];
    let w = 1;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      // Gaussian-ish kick: the sum of three uniforms is bell-shaped, which
      // gives the channel its mix of long quiet reaches and hard kicks.
      const kick = (Math.random() + Math.random() + Math.random() - 1.5) * 0.95;
      let mx = (a[0] + b[0]) * 0.5 + nx * kick * amp;
      let my = (a[1] + b[1]) * 0.5 + ny * kick * amp;
      // Mean reversion belongs to the coarse octaves: scale it by the level's
      // share of the first-octave amplitude, or deep levels never converge.
      mx += (centerX - mx) * CG_SHAPE.centerPull * (amp / amplitude);
      next[w++] = [mx, my];
      next[w++] = b;
    }
    points = next;
    amp *= CG_SHAPE.roughness;
  }
  return points;
}

function generateLightningBolt(width, height)
{
  const lightningCanvas = new OffscreenCanvas(width, height);
  // willReadFrequently keeps the canvas in system memory instead of asking the GPU
  // for a 2500 x 5000 RGBA backing store - fifty megabytes, for artwork that is
  // drawn once and then handed over as an R8 texture. On a machine whose graphics
  // memory is already tight, that allocation is as much of a problem as the texture.
  const ctx = lightningCanvas.getContext('2d', {willReadFrequently : true});

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';


  function genLightningColor(lineWidth)
  {
    const colR = 12;
    const colG = 12;
    const colB = 12;
    const brightness = Math.pow(lineWidth, 2.0);
    return `rgb(${colR * brightness}, ${colG * brightness}, ${colB * brightness})`;
  }

  function tracePoints(points)
  {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++)
      ctx.lineTo(points[i][0], points[i][1]);
  }

  const tileW = width;
  const startX = width / 2.0;
  const startY = -30.0;
  // A return stroke is not a plumb line: the anchor at ground wanders a fifth or
  // so of the tile sideways of the cloud base, and the whole channel arcs after
  // it. The lean keeps one dominant direction (no symmetric fuzzball) while the
  // fractal supplies the tortuosity.
  const leanDirection = Math.random() < 0.78 ? 1. : -1.;
  const lean = leanDirection * Math.tan(CG_SHAPE.startAngle) * height *
               (0.08 + Math.random() * CG_SHAPE.leanRange);
  const endX = startX + lean;

  const trunk = fractalPath(startX, startY, endX, height + 40.0,
                            height * CG_SHAPE.initialAmplitude, startX);

  // Forks leave the established channel, mostly in its upper half, with the
  // same fractal character at a smaller scale.
  const trunkColor = genLightningColor(CG_SHAPE.lineWidth);

  function drawBranch(bx, by, parentAngle, lineWidth, depth)
  {
    const remaining = height - by;
    if (remaining < 60 || lineWidth < 0.4 || depth > 2)
      return;
    // A fork often dies in the air; one that runs long reaches the deck below.
    const span = remaining * (0.22 + Math.random() * 0.35);
    const side = Math.random() < 0.5 ? -1. : 1.;
    const open = CG_SHAPE.branchAngle * (0.55 + Math.random() * 0.85); // forks open 0.21..0.53 rad
    let tipX = bx + Math.sin(side * open + parentAngle * 0.55) * span;
    tipX = Math.max(tileW * 0.035, Math.min(tileW * 0.965, tipX));
    const tipY = by + Math.cos(side * open * 0.72) * span;

    const pts = fractalPath(bx, by, tipX, tipY,
                            span * CG_SHAPE.branchAmplitude, bx + side * span * 0.5);

    // Stroke the parent fork in tapering chunks, occasionally leaving its own
    // daughter behind at a chunk boundary (depth-limited).
    let width = lineWidth;
    let acc = 0;
    let runStart = 0;
    const shedLength = 55 + Math.random() * 35;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      acc += Math.hypot(dx, dy);
      if (acc >= shedLength || i === pts.length - 1) {
        ctx.beginPath();
        ctx.moveTo(pts[runStart][0], pts[runStart][1]);
        for (let k = runStart + 1; k <= i; k++)
          ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.lineWidth = Math.max(width, 0.28);
        ctx.strokeStyle = genLightningColor(width);
        ctx.stroke();

        if (depth < 2 && Math.random() < 0.16 && width > 1.1) {
          const forkAngle = Math.atan2(pts[i][0] - pts[runStart][0], pts[i][1] - pts[runStart][1]);
          drawBranch(pts[i][0], pts[i][1], forkAngle,
                     Math.max(0.35, width * 0.62), depth + 1);
        }

        if (width <= 0.38)
          return;
        width = Math.max(0.28, width - CG_SHAPE.taper);
        runStart = i;
        acc = 0;
      }
    }
  }

  // The branches first, then the trunk over them, so the trunk's hot core
  // always wins where they overlap (the stub canvas uses 'lighten' semantics
  // per stroke order only within one stroke; source-over would dim, so the
  // trunk is drawn last with its full-gain colour).
  for (let i = 0; i < trunk.length; i++) {
    const [tx, ty] = trunk[i];
    const yFrac = Math.max(0, Math.min(1, ty / height));
    // Fork density falls off with depth: leaders branch hardest near cloud base.
    const chance = 0.0045 * (1.50 - yFrac * 1.30);
    if (Math.random() < chance) {
      const chord = 12; // ~25-30 artwork px of chord: the local tangent, minus the fine zigzag
      const next = trunk[Math.min(i + chord, trunk.length - 1)];
      const prev = trunk[Math.max(i - chord, 0)];
      const parentAngle = Math.atan2(next[0] - prev[0], next[1] - prev[1]);
      const entry = CG_SHAPE.lineWidth * CG_SHAPE.branchWidthRatio *
                     (0.35 + Math.random() * 0.50);
      if (entry >= 0.5)
        drawBranch(tx, ty, parentAngle, entry, 0);
    }
  }

  tracePoints(trunk);
  ctx.lineWidth = CG_SHAPE.lineWidth;
  ctx.strokeStyle = trunkColor;
  ctx.stroke();

  return readRedChannel(ctx, width, height);
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

  function genNetworkColor(level, falloff)
  {
    // A leader burns brightest at the strike point and fades along its own
    // length - the stub of a real IC flash is a white-hot kernel with dim,
    // branch-starved tips, not a uniform-tone comb.
    const scale = falloff === undefined ? 1.0 : falloff;
    const v = Math.round(255 * IC_LEVELS[Math.min(level, IC_LEVELS.length - 1)] * scale);
    return `rgb(${v}, ${v}, ${v})`;
  }

  const startX = width * 0.5;
  const startY = height * 0.5;
  const heightAspect = height / width;

  // Brightness along one strand: full at the root, about a quarter at the tip.
  const falloffAt = (t) => 0.50 + 0.50 * Math.pow(1.0 - Math.min(Math.max(t, 0.0), 1.0), 0.85);

  /*
   * One curved strand: opens cleanly along its outward axis, sweeps along a broad
   * C-arc or S-bend with electrical crackle, and forks into finer curved tendrils.
   * `inherited` is how much light the parent handed down - a fork that leaves a
   * dim mother channel cannot be brighter than its parent at that point.
   */
  function drawStrand(sx, sy, axis, curveSign, steps, lineWidth, level, inherited)
  {
    if (inherited === undefined)
      inherited = 1.0;
    let x = sx, y = sy;
    const strand = makeIcStrand(axis, curveSign, steps, Math.random);

    const strokeRun = (uptoX, uptoY, t) => {
      ctx.lineTo(uptoX, uptoY);
      ctx.strokeStyle = genNetworkColor(level, inherited * falloffAt(t));
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(uptoX, uptoY);
    };

    ctx.beginPath();
    ctx.moveTo(x, y);
    let acc = 0;

    for (let i = 0; i < steps; i++) {
      const angle = icHeadingStep(strand, Math.random, x / width, y / height, heightAspect);

      const nextX = x + Math.cos(angle) * IC_SHAPE.stepLength;
      const nextY = y + Math.sin(angle) * IC_SHAPE.stepLength;
      const t = (i + 1) / steps;

      if (nextX < 2. || nextX > width - 2. || nextY < 2. || nextY > height - 2.) {
        strokeRun(clamp(nextX, 2., width - 2.), clamp(nextY, 2., height - 2.), t);
        return;
      }

      x = nextX;
      y = nextY;
      ctx.lineTo(x, y);
      acc += IC_SHAPE.stepLength;

      if (acc >= 26.0) {
        strokeRun(x, y, t);
        acc = 0;
      }

      if (level < IC_SHAPE.maxLevel && i > 6 && Math.random() < IC_SHAPE.forkChance) {
        // Commit the run so far, then the fork inherits our current brightness.
        if (acc > 0) {
          strokeRun(x, y, t);
          acc = 0;
        }
        const side = Math.random() < 0.5 ? -1. : 1.;
        const forkAxis = strand.angle + side * (0.45 + Math.random() * 0.45);
        drawStrand(x, y, forkAxis, side,
                   Math.max(16, Math.round(steps * (0.42 + Math.random() * 0.35))),
                   Math.max(IC_SHAPE.minWidth, lineWidth * IC_SHAPE.branchRatio), level + 1,
                   inherited * falloffAt(t));
        ctx.beginPath();
        ctx.moveTo(x, y);
      }
    }
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = genNetworkColor(level, inherited * falloffAt(1.0));
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

  // White-hot kernel at the strike point where the leaders leave. The stub
  // canvas treats this as a junction spark: one disc of full-gain light.
  ctx.beginPath();
  ctx.arc(startX, startY, 3.4, 0.0, Math.PI * 2.0);
  ctx.fillStyle = 'rgb(255, 255, 255)';
  ctx.fill();

  return readRedChannel(ctx, width, height);
}


if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    makeRng : makeRng,
    fractalPath : fractalPath,
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
