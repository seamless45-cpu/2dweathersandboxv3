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
 * The tile is wide and short (2048 x 512, four to one) because the volume a flash
 * occupies is wide and short: the display maps it onto 0.45 of the simulation's
 * width and 0.225 of its height, which is about ten kilometres by three, and at
 * that mapping one artwork pixel is about one screen pixel.
 *
 * Brightness is a ladder rather than a taper: pow(width, 2) would put a tendril at
 * 1.2 pixels under the display's 0.15 threshold and it would simply not be drawn,
 * and a flash whose tendrils are invisible is a bolt again.
 */
const IC_ARTWORK_SIZE = { width : 1024, height : 256 };

const IC_SHAPE = {
  leaders      : 7,      // strands fanning out from the strike point
  trunkWidth   : 2.6,    // artwork pixels - the brightest channel
  trunkRatio   : 0.92,   // every leader starts at this share of the trunk width
  branchRatio  : 0.66,   // ... and a fork at this share of its parent's
  minWidth     : 1.0,
  stepLength   : 1.4,    // artwork pixels per step
  jitter       : 0.5,    // heading noise per step, rad - the buzz of a channel
  straighten   : 0.05,   // pull back toward the strand's own heading
  forkChance   : 0.0045, // per step, per strand - a fork, not a thicket
  maxLevel     : 2,      // trunk, fork, and one round of sub-forks
  fanSpread    : 0.22,   // rad - how far the leaders leave the horizontal

  // The course a strand follows, not just the buzz around it.
  //
  // A leader is not on rails: it propagates through a charge layer that is itself
  // lumpy, so its heading turns steadily for tens of pixels, bends back when it
  // reaches the edge of the layer, and turns again. Without that, the strand was a
  // straight line with noise on it - `straighten` pulled the heading back toward one
  // fixed target forever - which is what made every flash read as a rake of straight
  // lines lying on their side instead of a network curling inside the cloud.
  //
  // So the target the heading is pulled toward now drifts at `turn` radians a step,
  // reverses when it has wandered `turnRange` away from where the strand started,
  // and reverses at random now and then (`turnFlip`) so the arcs are not all the
  // same length. The buzz (`jitter`) rides on top of it, unchanged: the channel
  // still crackles, it just no longer runs in a straight line while it does.
  waveAmp      : 0.50,   // rad - how far the course swings either side of the heading
                         // the strand opened on. This is the curve: a leader that
                         // keeps one heading is a straight line, whatever the buzz on
                         // it, and a flash made of straight lines is a rake.
  waveAmpSpread : 0.24,  // per strand, +/-: some channels arc wider than others
  waveLength   : 320.,   // artwork pixels per full S - one bend up and one back down
  waveLengthSpread : 140.,// per strand, +/- so the bends do not line up across the tile
  waveKink     : 0.0016, // per step - the chance the course is knocked, so the S's are
                         // not a clean sinusoid
  layerEdge    : 0.30    // of the tile's height either side of the middle: the layer
                         // the charge lives in, beyond which a channel is turned back
                         // into it rather than out of the tile
};

const IC_LEVELS = [1.0, 0.70, 0.46]; // channel radiance by fork depth, 0..1


/*
 * The heading of one strand of the network, as a thing that can be watched.
 *
 * `makeIcStrand` opens a leader on a heading and a course; `icHeadingStep` advances
 * one artwork step and returns the heading to draw with. They are separate from
 * drawing so `tests/check-lightning-bolt.js` can run the real arithmetic and measure
 * how far a channel turns and how far it bows away from the straight line between its
 * ends - the two numbers that say "curving" rather than "straight with noise".
 *
 * `rand` is passed in rather than closed over, so a test can drive it.
 */
function makeIcStrand(heading, target, rand)
{
  return {
    angle : heading,
    target : target,
    opening : target,                                            // the heading it opened on
    phase : rand() * Math.PI * 2.,                               // where in its S it starts
    amplitude : (IC_SHAPE.waveAmp + (rand() - 0.5) * IC_SHAPE.waveAmpSpread) *
                (rand() < 0.5 ? -1. : 1.),
    wavelength : Math.max(120., IC_SHAPE.waveLength + (rand() - 0.5) * IC_SHAPE.waveLengthSpread)
  };
}

function icHeadingStep(strand, rand, heightFraction)
{
  strand.phase += (Math.PI * 2.) / strand.wavelength;   // one full S every `wavelength` pixels
  strand.target = strand.opening + Math.sin(strand.phase) * strand.amplitude;

  if (rand() < IC_SHAPE.waveKink)
    strand.phase += (rand() - 0.5) * 1.4;               // the course is knocked: not a sine

  // The charge sits in the middle of the slab, not on its lid: a channel that has
  // climbed into the top fifth of the tile is turned back down into it, and one that
  // has sunk into the bottom fifth back up. Without this the arcs simply run out of
  // tile, and a network of half-length strands is thinner than a straight one.
  if (heightFraction !== undefined) {
    const fromCentre = heightFraction - 0.5;
    if (Math.abs(fromCentre) > IC_SHAPE.layerEdge) {
      const inward = fromCentre > 0 ? -1. : 1.;
      if (strand.target * inward < 0.)
        strand.target = inward * Math.abs(strand.target);
    }
  }

  strand.angle += (rand() - 0.5) * IC_SHAPE.jitter;
  strand.angle -= (strand.angle - strand.target) * IC_SHAPE.straighten;

  return strand.angle;
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

  const startX = 2.0;
  const startY = height * 0.5;

  /*
   * One strand: a heading that buzzes, pulled back toward its own target, forking
   * as it goes. A fork is drawn first and the parent resumes from the same point,
   * so the network stays connected whatever order the browser rasterises it in.
   */
  function drawStrand(startX, startY, heading, target, steps, lineWidth, level)
  {
    let x = startX, y = startY;
    const strand = makeIcStrand(heading, target, Math.random);

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = genNetworkColor(level);
    ctx.lineWidth = lineWidth;

    for (let i = 0; i < steps; i++) {
      const angle = icHeadingStep(strand, Math.random, y / height);

      const nextX = x + Math.cos(angle) * IC_SHAPE.stepLength;
      const nextY = y + Math.sin(angle) * IC_SHAPE.stepLength;

      if (nextX < 1. || nextX > width - 1. || nextY < 1. || nextY > height - 1.) {
        ctx.lineTo(clamp(nextX, 1., width - 1.), clamp(nextY, 1., height - 1.));
        break;
      }

      x = nextX;
      y = nextY;
      ctx.lineTo(x, y);

      if (level < IC_SHAPE.maxLevel && i > 6 && Math.random() < IC_SHAPE.forkChance) {
        ctx.stroke(); // commit the parent so far

        const side = Math.random() < 0.5 ? -1. : 1.;
        const childTarget = clamp(target + side * (0.30 + Math.random() * 0.55), -1.15, 1.15);
        drawStrand(x, y, childTarget + (Math.random() - 0.5) * 0.5, childTarget,
                   Math.max(8, Math.round(steps * (0.30 + Math.random() * 0.45))),
                   Math.max(IC_SHAPE.minWidth, lineWidth * IC_SHAPE.branchRatio), level + 1);

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.strokeStyle = genNetworkColor(level);
        ctx.lineWidth = lineWidth;
      }
    }
    ctx.stroke();
  }

  // The trunk: one long, nearly horizontal channel, the spine of the network.
  drawStrand(startX, startY, 0., 0., Math.round(width / IC_SHAPE.stepLength),
             IC_SHAPE.trunkWidth, 0);

  // The leaders: a fan that leaves the strike point and fills the tile above and
  // below it. Half of them are long enough to cross the whole tile, half die out
  // partway, which is what stops the network looking like a comb.
  for (let i = 0; i < IC_SHAPE.leaders; i++) {
    const fraction = (i + 0.5) / IC_SHAPE.leaders;                       // 0..1 across the fan
    const side = i % 2 === 0 ? -1. : 1.;
    const target = side * IC_SHAPE.fanSpread * (0.25 + Math.random() * 0.75);
    const reach = fraction < 0.5 ? (0.35 + Math.random() * 0.35) : (0.7 + Math.random() * 0.3);
    const steps = Math.round(width * reach / IC_SHAPE.stepLength);

    drawStrand(startX + Math.random() * 4., startY + (Math.random() - 0.5) * 24.,
               target * (0.4 + Math.random() * 0.6), target, steps,
               IC_SHAPE.trunkWidth * IC_SHAPE.trunkRatio * (0.75 + Math.random() * 0.25), 1);
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
