/*
 * lightningGenerator.js — procedural lightning artwork, generated off the main
 * thread and transferred as an ImageBitmap.
 *
 * Two kinds of artwork come out of the same single-channel (luminance) canvas:
 *
 *   mode: 'CG'  Cloud-to-ground bolt. One dominant channel grows downward with
 *               the classic dendritic forks. Its shape is two scales - a slow aim
 *               that bends it into arcs and a fast jag that keeps it electric (see
 *               CG_SHAPE) - rather than the one jittered heading it used to have.
 *               This is the artwork used by the legacy (cloud-density triggered)
 *               lightning in app.js.
 *
 *   mode: 'IC'  Intra-cloud flash. A network of thin filaments that spreads
 *               through a charge layer and never reaches the ground: a trunk
 *               throws arms, arms throw hairs, hairs throw wisps, and each tier
 *               is thinner in tone and in width (see generateIntraCloudBolt).
 *               The heading of a channel is a run of visible kinks around an aim
 *               that is steered only when the channel leaves its layer, with two
 *               bounded smooth octaves on top - jagged like a real channel, but
 *               unable to wind itself into a loop. There is no halo around a
 *               stroke (a CG stroke has none either; its glow is the
 *               post-processing bloom).
 *
 *               app.js draws eight tiles, one per layer of a mipmapped 2D array
 *               texture, and realisticDisplayShader.frag shows them for every
 *               strike whose intensity is at or below LIGHTNING_IC_MAX_INTENSITY,
 *               i.e. every intra-cloud flash. Which layer a strike uses - and
 *               which way round it is mirrored - is chosen per strike from its
 *               own start iteration and position, so two flashes rarely look
 *               alike. tests/check-ic-lightning.js renders and measures all of
 *               this without a GPU.
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


/* ===================== cloud-to-ground bolt ============================== */

/*
 * The shape of a cloud-to-ground channel.
 *
 * What the old model did, and why the bolt was straight
 * -----------------------------------------------------
 * One heading, turned every step by its own noise (`(rand - 0.5) * 1.4`, i.e. up
 * to +-40 degrees a pixel) and pulled back toward straight down by 8% a step.
 * The pull is what decided the shape: a 40-degree kick that decays in a dozen
 * steps only ever moves the channel a couple of pixels before the next kick
 * cancels it, so the bolt came out as a *vertical wire with a buzz on it* - all
 * edge, no arc. Measured along one channel of the old artwork: it changed which
 * way it was going 17 times over the height of the tile, at 0.33 rad of heading
 * per artwork pixel. That is a saw, not a bend.
 *
 * Two scales, not one
 * -------------------
 * A channel is crooked because the path of least resistance curves: it takes a
 * long arc one way, a longer one back, and only then steps. So the heading is the
 * sum of two things, exactly as icStepHeading() does it for a filament:
 *
 *   `aim`  the slow heading. It wanders, it is pulled back toward straight down
 *          *weakly* (a time constant of ~800 artwork pixels, so one turn survives
 *          a third of the picture), and it is what gives the bolt its arcs.
 *   `jag`  the electrical zigzag on top: a fast random walk pulled back hard, so
 *          it adds the ragged edge a real channel has without deciding its shape.
 *
 * The aim is also what steers the channel back inside the sprite when it nears
 * the edge - a bend applied over tens of pixels, so the artwork still looks like
 * lightning instead of being clipped, which is what a bolt that ran off the tile
 * did (the display shader drops those fragments, so half a bolt disappeared).
 *
 * Numbers are in artwork pixels per step; a step is one pixel.
 */
const CG_SHAPE = {
  bend : 0.028,          // slow wander of the aim, rad per step
  bendPull : 0.0013,     // ... and how weakly the aim is pulled back to straight down
  jag : 0.80,            // the electrical zigzag, rad per step
  jagPull : 0.18,        // ... pulled back hard, so it stays a zigzag and not a bend
  stepKinkChance : 0.004, // an occasional hard break in the channel
  stepKinkAngle : 0.45,
  margin : 0.22,         // fraction of the tile kept clear of the channel on each side
  confine : 0.045        // how hard the aim is turned back when it nears that margin
};

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

  /* One step of a channel's heading.
   *
   * `state.aimTarget` is the heading the slow part is pulled toward - straight
   * down for the trunk, the angle a fork left its parent at for a branch - and
   * `state.confined` says whether this channel has to stay inside the sprite.
   * A branch does not: it is allowed to run out of the tile, because that is
   * what a fork does, and clipping it costs nothing (the display shader's window
   * fades the outer edge of the artwork anyway).
   */
  function stepHeading(state) {
    // the slow part: a wandering aim, pulled weakly toward its own target
    state.aim += (Math.random() - 0.5) * CG_SHAPE.bend;
    state.aim -= (state.aim - state.aimTarget) * CG_SHAPE.bendPull;

    // confined to the sprite: turn the aim back toward the middle, over tens of
    // pixels rather than in one step
    if (state.confined) {
      const lo = width * CG_SHAPE.margin;
      const hi = width * (1.0 - CG_SHAPE.margin);
      if (state.x < lo || state.x > hi) {
        const inward = state.x < lo ? 1.0 : -1.0;                    // which way is back
        state.aim += (inward * 1.1 - state.aim) * CG_SHAPE.confine;  // how far it may lean while turning
      }
    }

    // the fast part: the electrical zigzag
    state.jag += (Math.random() - 0.5) * CG_SHAPE.jag;
    state.jag -= state.jag * CG_SHAPE.jagPull;

    let angle = state.aim + state.jag;

    // ... and now and then the channel simply breaks
    if (Math.random() < CG_SHAPE.stepKinkChance)
      angle += (Math.random() < 0.5 ? -1 : 1) * CG_SHAPE.stepKinkAngle;

    state.angle = angle;
    return angle;
  }


  ctx.beginPath();

  let startX = width / 2.0;
  let startY = 0;
  const state = {
    x : startX, aim : Math.PI / 6., aimTarget : 0.0, jag : 0, angle : Math.PI / 6., confined : true
  };

  let lineWidth = 4.5;

  ctx.moveTo(startX, startY);

  ctx.lineWidth = lineWidth;

  while (startY < height) {

    const angle = stepHeading(state);
    const nextX = startX + Math.sin(angle);
    const nextY = startY + Math.cos(angle);

    ctx.lineTo(nextX, nextY);

    startX = nextX;
    startY = nextY;
    state.x = startX;

    if (Math.random() < 0.015 * (1. - nextY / height)) { // branch
      ctx.strokeStyle = genLightningColor(lineWidth);
      ctx.stroke();
      drawBranch(nextX, nextY, state.aim + (Math.random() - 0.5) * 2.5, lineWidth * 0.5 * Math.random());
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
    let state = { x : startX, aim : targetAngle, aimTarget : targetAngle, jag : 0, angle : targetAngle, confined : false };

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineWidth = line_width;

    while (startY < height) {

      // a branch is a channel too: same two scales, a tighter aim
      const angle = stepHeading(state);
      const nextX = startX + Math.sin(angle);
      const nextY = startY + Math.cos(angle);

      ctx.lineTo(nextX, nextY);

      startX = nextX;
      startY = nextY;
      state.x = startX;

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
 * IC artwork: a network of thin filaments, drawn over a whole tile that the
 * display shader reads as light.
 *
 * What went wrong before
 * ----------------------
 * Three separate mistakes made the earlier versions read as bad:
 *
 *  1. The heading model. A channel that holds one heading for a dozen steps and
 *     then kinks is a fair model of a CG return stroke, but a flash that spreads
 *     sideways became a stack of horizontal noodles. Replacing it with a random
 *     walk of the curvature over-corrected into balls of wool, and driving it
 *     with a sine put a visible wavelength into every channel. Both extremes are
 *     gone here: the heading is a run of short random steps around a slowly
 *     moving aim (see icStepHeading).
 *  2. The stroke width. A hair drawn 0.45 px wide has half of its energy thrown
 *     away by the canvas' own antialiasing, so it arrives in the tile as an
 *     almost-black line - and this tile *is* the light. "Thin" therefore has to
 *     come from the tone, not from the geometry: every stroke here is at least
 *     one artwork pixel wide (at the size a flash is drawn on screen one artwork
 *     pixel is about one screen pixel, so one pixel is a hair) and the tiers of
 *     channel are separated by how much light they carry.
 *  3. The shape families. Eight hand-written shapes are eight pictures, so a
 *     flash that has to pick one of eight looks the same every time it picks the
 *     same one. A family here fixes only the layout; every other number in the
 *     drawing comes from the tile's own seed, so the eight tiles are eight
 *     different networks rather than eight drawings - and the shader mirrors
 *     each of them per strike as well.
 *
 * The channel model
 * -----------------
 * A channel is grown step by step. Its heading is
 *
 *     aim + smooth(s) + jitter
 *
 *   - `aim` is the course of the channel: where the channel is going at the
 *     scale of the whole flash. It is steered (never snapped) when the channel
 *     leaves its charge layer, so the fine structure survives every turn.
 *   - `smooth(s)` is two smooth value-noise octaves along the arc length, at 20
 *     and 60 artwork pixels. It is a *bounded* function, so the channel cannot
 *     wind itself into a loop, and the two scales share no common period, so the
 *     bend never repeats.
 *   - `jitter` is the electric part: a damped random step of +-0.22 rad per
 *     artwork pixel. This is what a real channel has and a drawn curve does not
 *     - short, sharp, uncorrelated direction changes - and it is aperiodic by
 *     construction.
 *
 * Structure comes from the branch tree, which is grown like a root system: every
 * channel throws children that are shorter, thinner and dimmer by a fixed ratio
 * (0.5 of the length, 0.72 of the width, 0.72 of the tone, 25-40 degrees off the
 * parent). Four tiers are allowed - trunk, arm, hair, wisp - and the budget per
 * tier is capped so one branch cannot starve the tree.
 */

/* Layout families. A family fixes only where the leaders are and which way they
 * aim; everything else about a tile is drawn from its own seed. */
const IC_VARIANTS = ['burst', 'crawler', 'multi', 'fan'];

/* Fraction of the tile kept clear of strokes, so a channel never runs off the
 * edge of the sprite (the shader fades the outer part of the flash as well). */
const IC_TILE_MARGIN = 0.035;

/* Stroke widths in artwork pixels, for a 256 px wide tile.
 *
 * One artwork pixel is about 0.4 screen pixels at the default camera (a flash of
 * 2400 m is a hundred pixels across while the tile is 256), so every tier here is
 * sub-pixel on screen: a trunk is half a screen pixel, an arm a third of one, and
 * a hair a fifth. That is deliberate. A discharge is not a tube - a trunk carries
 * more current than a hair, but neither is a band, and a channel drawn a whole
 * screen pixel wide (it used to be 2.2 artwork pixels, a little over one screen
 * pixel, for the trunk alone) reads as a white wire laid over the cloud instead of
 * as a filament inside it. What makes the trunk the trunk is not its width any
 * more: it is its tone and its hot centreline (IC_CORE_*), which is the part that
 * survives the mip chain when the sprite is minified. */
const IC_WIDTH = { trunk : 1.3, arm : 1.0, hair : 0.75, wisp : 0.6 };

/* Tone per tier. This - not the width - is what makes a hair a hair.
 *
 * The tones went up when the widths came down: a sub-pixel line loses ink to
 * coverage, and the hierarchy has to survive that, so the tiers below the trunk
 * are drawn brighter than they were rather than fading out with their width. */
const IC_TONE = { trunk : 1.0, arm : 0.70, hair : 0.44, wisp : 0.28 };

/* How much of its light a channel still carries at its far tip, as a fraction of
 * what it leaves the parent with.
 *
 * A channel does not glow evenly along its length. Charge is what feeds it, and
 * charge is at the trunk: a branch leaves a hot junction and fades as it runs out
 * into the cloud, so its last centimetres are a whisper. Drawing every stroke at
 * one tone made the network read as a set of white wires - the single biggest
 * difference between the artwork and a photograph of a flash.
 *
 * The fade is applied per drawn chunk (CHUNK steps), so it follows the channel
 * along its length instead of being one tone per branch, and it is separate from
 * the per-tier tone: the tier says how much light a branch of that size carries,
 * the taper says how it is spread along that branch. */
const IC_TIP_TONE = 0.62;

/* The branch tree, coarsest first. `budget` is how many children one channel of
 * that tier may create, so a single trunk cannot take over the tile. */
const IC_TIERS = [
  { name : 'trunk', width : IC_WIDTH.trunk, tone : IC_TONE.trunk, budget : 12 },
  { name : 'arm', width : IC_WIDTH.arm, tone : IC_TONE.arm, budget : 11 },
  { name : 'hair', width : IC_WIDTH.hair, tone : IC_TONE.hair, budget : 8 },
  { name : 'wisp', width : IC_WIDTH.wisp, tone : IC_TONE.wisp, budget : 3 }
];

/* Heading: the smooth part, as two octaves of value noise along the arc length. */
const IC_SMOOTH_SCALE = { mid : 20.0, long : 60.0 };
const IC_SMOOTH_AMP = { mid : 0.08, long : 0.10 };

/* The jitter part: a random step every IC_JITTER_PERIOD artwork pixels, pulled
 * back toward the aim so the process is stationary instead of diffusing.
 *
 * The period matters more than the amplitude. A step per artwork pixel is
 * invisible once the tile is shown at roughly one artwork pixel per screen
 * pixel: it averages out into a smooth line, which is exactly how the first
 * attempts at this ended up as airbrushed noodles. A step every five pixels is a
 * visible kink, which is what a channel actually looks like. */
const IC_STEP_NOISE = 0.55;
const IC_JITTER_PERIOD = 4.5;
const IC_RESTORE = 0.12;
const IC_JITTER_CLAMP = 1.05;

/* Occasional real kinks, on top of the jitter. */
const IC_KINK = 0.17;
const IC_KINK_CHANCE = 0.006;

/* How far a heading may stray from its aim, whatever the noise does. This is the
 * number that rules out loops: a loop needs a full turn (pi). */
const IC_MAX_DEVIATION = IC_SMOOTH_AMP.mid + IC_SMOOTH_AMP.long + IC_JITTER_CLAMP + IC_KINK;


/*
 * Smooth 1D value noise from a seeded table.
 *
 * `size` random values interpolated with a smoothstep weight: continuous,
 * deterministic, and with no period shorter than `size` lattice cells. Two
 * octaves read the same table at different offsets and rates, which decorrelates
 * them without needing two tables.
 */
function makeNoise1D(rand, size) {
  const n = size === undefined ? 256 : size;
  const table = new Float64Array(n);
  for (let i = 0; i < n; i++)
    table[i] = rand() * 2 - 1;
  return function noise(x) {
    const xi = Math.floor(x);
    const f = x - xi;
    const u = f * f * (3 - 2 * f);
    const a = table[((xi % n) + n) % n];
    const b = table[(((xi + 1) % n) + n) % n];
    return a + (b - a) * u;
  };
}


/*
 * One step of a channel's heading.
 *
 * `state` carries { aim, jitter, travelled }. The aim is steered by the caller
 * (it is the only part that knows about the charge layer); this function adds
 * the smooth bend and one jitter step to it.
 *
 * `rand` is passed in rather than closed over so a test can drive a channel
 * deterministically, and so the same sequence can be replayed.
 */
function icStepHeading(state, params, rand, noise, offset, curl) {
  const s = state.travelled;
  const smooth = curl * (IC_SMOOTH_AMP.mid * noise(offset + s / IC_SMOOTH_SCALE.mid)
                       + IC_SMOOTH_AMP.long * noise(offset + 131.0 + s / IC_SMOOTH_SCALE.long));

  /* The jitter is re-drawn once every IC_JITTER_PERIOD pixels and held in
   * between, which is what turns it into kinks instead of fuzz. */
  if (state.untilKink <= 0) {
    state.jitter += (rand() - 0.5) * IC_STEP_NOISE;
    state.jitter -= state.jitter * IC_RESTORE;
    if (rand() < IC_KINK_CHANCE)
      state.jitter += (rand() < 0.5 ? -1 : 1) * IC_KINK;
    if (state.jitter > IC_JITTER_CLAMP) state.jitter = IC_JITTER_CLAMP;
    else if (state.jitter < -IC_JITTER_CLAMP) state.jitter = -IC_JITTER_CLAMP;
    state.untilKink = IC_JITTER_PERIOD / Math.max(0.5, state.stepLen || 1);
  } else {
    state.untilKink -= 1;
  }

  return state.aim + smooth + state.jitter;
}


/*
 * The parameters of one tile.
 *
 * The family decides the layout; every number below it is drawn from the tile's
 * own seed, so two tiles of the same family are still two different flashes.
 */
function drawICParams(rand, variant) {
  const family = IC_VARIANTS[(variant === undefined || variant === null)
    ? Math.floor(rand() * IC_VARIANTS.length)
    : Math.abs(Math.round(variant)) % IC_VARIANTS.length];
  return {
    family : family,
    leaders : 2 + Math.floor(rand() * 3),          // leader points
    aimBase : (rand() - 0.5) * 1.0,                // preferred direction, radians
    branchRate : 0.10 + rand() * 0.08,             // forks per step, per channel
    hairRate : 0.06 + rand() * 0.06,               // fine hairs per step
    maxDepth : 2 + Math.floor(rand() * 2),         // trunk, arm, hair, wisp
    curl : 0.75 + rand() * 0.5,                    // smooth-bend multiplier
    trunkSpan : 0.26 + rand() * 0.20,              // fraction of the stage
    layer : 0.70 + rand() * 0.25,                  // half height of the layer
    spread : 0.52 + rand() * 0.40,                 // fork angle, radians
    width : 0.85 + rand() * 0.3,                   // width multiplier
    taper : 0.9985 + rand() * 0.0008
  };
}


function generateIntraCloudBolt(width, height, seed, variant)
{
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const rand = makeRng(seed === undefined ? ((Math.random() * 4294967296) >>> 0) : seed);
  const noise = makeNoise1D(rand);
  const params = drawICParams(rand, variant);

  const stepLen = Math.max(0.9, width / 900);
  const cx = width * 0.5;
  const cy = height * 0.5;

  /* Where a stroke may go: the tile less its margin. */
  const m = Math.min(width, height) * IC_TILE_MARGIN;
  const minX = m, maxX = width - m, minY = m, maxY = height - m;

  /* The charge layer a channel is steered back into. A crawler or a multi-core
   * flash keeps to one; a burst or a fan uses the whole tile. */
  const inLayer = params.family === 'crawler' || params.family === 'multi';
  const layerHalf = inLayer ? height * params.layer * 0.5 : height * 0.5 - m;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function grey(v) {
    const c = Math.max(0, Math.min(255, Math.round(255 * v)));
    return 'rgb(' + c + ',' + c + ',' + c + ')';
  }

  /* The hot core of a channel.
   *
   * A channel is not a tube of one tone: the current runs in a filament a
   * fraction of the width of the glow around it, so a stroke reads as a white
   * centreline inside a slightly dimmer sheath. Drawing each chunk a second time,
   * narrower and brighter, is what gives the line that structure - and it is the
   * difference between a stroke that looks drawn and one that looks hot, at every
   * camera zoom: when the artwork is magnified the core is a crisp centre, and
   * when it is minified the core is what survives the mip chain while the sheath
   * becomes the glow around it.
   *
   * Only worth doing on a stroke wide enough to hold a core: a hair is one pixel
   * and brighter-and-thinner would only be thinner. */
  const IC_CORE_WIDTH = 0.45;
  const IC_CORE_GAIN = 1.45;

  /* A fork is hot.
   *
   * Where a channel throws a branch the current crowds into the junction, and on
   * film that is the brightest point of the whole network - a small, hard spark
   * with the child leaving it. Without one a fork is just two lines that touch,
   * which is how a drawing looks and not how a discharge looks. The spark is
   * drawn as a short filled dot under the child, so it stays inside the ink the
   * network already has: it sharpens a junction, it does not add a field of dots.
   */
  function junction(x, y, w, tone) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.7, w * 0.55), 0, Math.PI * 2);
    ctx.globalCompositeOperation = 'lighten';
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = grey(Math.min(1, tone * 1.2));
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* One stroke, brightest-wins. 'lighten' is what stops crossing channels from
   * churning the tile into a mesh of dark troughs: a stroke can only ever leave
   * a pixel brighter than it found it. */
  function stroke(pts, w, tone) {
    if (pts.length < 4) return;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2)
      ctx.lineTo(pts[i], pts[i + 1]);
    ctx.globalCompositeOperation = 'lighten';
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = w;
    ctx.strokeStyle = grey(tone);
    ctx.stroke();
    if (w >= 1.05) { // wide enough to hold a hot centreline
      ctx.lineWidth = w * IC_CORE_WIDTH;
      ctx.strokeStyle = grey(tone * IC_CORE_GAIN);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* Strokes are flushed in short runs so the taper follows the channel along its
   * length instead of one width for the whole strand. */
  const CHUNK = 5;

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /* Forks are budgeted per tier so one branch cannot starve the tree. */
  const spent = [0, 0, 0, 0];

  /*
   * Grow one channel and everything it throws off.
   *
   * Children are queued rather than recursed: a very branchy flash must not be
   * able to blow the stack of the worker.
   */
  function grow(x0, y0, aim0, lengthPx, tierIndex, toneScale, queue) {
    const tier = IC_TIERS[tierIndex];
    const steps = Math.max(4, Math.round(lengthPx / stepLen));
    const offset = rand() * 1024;
    const curl = Math.min(1.25, params.curl * (1.0 + tierIndex * 0.06));
    const w0 = tier.width * (tierIndex === 0 ? params.width : 1.0);
    const minW = Math.max(IC_WIDTH.wisp * 0.9, w0 * 0.55);

    let x = x0, y = y0, w = w0;
    let tone = tier.tone * toneScale;
    let pts = [x, y];
    let inChunk = 0;
    const state = { aim : aim0, jitter : 0, travelled : 0, untilKink : 0, stepLen : stepLen };

    for (let i = 0; i < steps; i++) {
      /* Steering acts on the aim, never on the heading, so the jitter - the part
       * that makes a channel look electrical - survives every turn. */
      let heading = icStepHeading(state, params, rand, noise, offset, curl);

      /* Confinement. Outside its charge layer a channel is flattened back toward
       * horizontal by damping the vertical part of its heading - never by aiming
       * it at a fixed direction and never at the middle of the layer.
       *
       * Both of those were tried and both are wrong: aiming at the middle makes
       * the channel dive, leave the layer on the far side and dive back, which
       * draws a row of identical arcs, and aiming every channel at one direction
       * pulls them all parallel, so the whole flash reads as a set of nested
       * curves. Damping only the vertical component keeps each channel going its
       * own way, keeps the jitter alive, and cannot oscillate. */
      if (inLayer) {
        const beyond = Math.abs(y - cy) - layerHalf;
        if (beyond > 0) {
          const off = Math.min(2.0, beyond / Math.max(layerHalf, 1));
          heading -= Math.sin(heading) * 0.20 * (0.4 + off);
        }
      }
      const nx = x + Math.cos(heading) * stepLen;
      const ny = y + Math.sin(heading) * stepLen;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY)
        break; // the channel leaves the sprite: stop rather than run along its edge

      x = nx; y = ny;
      state.travelled += stepLen;
      pts.push(x, y);
      w = Math.max(minW, w * params.taper);

      if (++inChunk >= CHUNK) {
        // how far along its own length this chunk has got, 0 at the parent ..
        // 1 at the tip
        const along = Math.min(1, state.travelled / Math.max(lengthPx, stepLen));
        stroke(pts, w, tone * (1 - (1 - IC_TIP_TONE) * along));
        pts = [x, y];
        inChunk = 0;
      }

      /* A fork: the next tier down, 25-40 degrees off this channel and only a
       * fraction of its length and light. That ratio is what makes a flash read
       * as a tree rather than as a pile of strands. */
      const canFork = tierIndex + 1 < IC_TIERS.length && tierIndex < params.maxDepth &&
                      spent[tierIndex] < IC_TIERS[tierIndex].budget &&
                      state.travelled > stepLen * 5;
      if (canFork && rand() < params.branchRate) {
        spent[tierIndex]++;
        // A fork is hot whatever the channel's width is now: the spark is the
        // junction, not a decoration on a wide stroke, and gating it on a width a
        // hair-thin trunk no longer reaches left most forks as two lines that
        // simply touch.
        if (tierIndex <= 1)
          junction(x, y, w, tone * (1 - (1 - IC_TIP_TONE) * Math.min(1, state.travelled / Math.max(lengthPx, stepLen))));
        queue.push({
          x : x, y : y,
          aim : heading + (rand() < 0.5 ? -1 : 1) * params.spread * (0.5 + rand() * 0.7),
          lengthPx : Math.max(5, (steps - i) * stepLen * (0.32 + rand() * 0.24)),
          tierIndex : tierIndex + 1,
          toneScale : toneScale * 0.78,
          queue : queue
        });
      }

      /* A hair: a short, near-perpendicular filament, which is what gives a
       * channel its furry edge. */
      const canHair = tierIndex <= 1 && tierIndex + 2 <= 3 && tierIndex < params.maxDepth &&
                      spent[3] < IC_TIERS[3].budget * 8 && state.travelled > stepLen * 4;
      if (canHair && rand() < params.hairRate) {
        spent[3]++;
        queue.push({
          x : x, y : y,
          aim : heading + (rand() < 0.5 ? -1 : 1) * (0.9 + rand() * 0.7),
          lengthPx : 8 + rand() * 30,
          tierIndex : tierIndex + 2,
          toneScale : toneScale * 0.8,
          queue : queue
        });
      }
    }
    stroke(pts, w, tone);
  }

  const queue = [];
  const push = (item) => queue.push(item);

  /* A small bright knot where a leader starts: short spokes through one point, so
   * the core stays a point rather than becoming a worm. */
  function drawCore(x, y, size) {
    for (let i = 0; i < 4; i++) {
      const a = rand() * Math.PI * 2;
      const len = size * (0.5 + rand() * 0.7);
      stroke([x - Math.cos(a) * len, y - Math.sin(a) * len,
              x + Math.cos(a) * len, y + Math.sin(a) * len],
             IC_TIERS[0].width * params.width * (0.6 + rand() * 0.25), 0.8);
    }
  }

  /* One leader point: a core and `count` channels fanning out of it. */
  function leader(x, y, dir, fan, count, span, withCore) {
    if (withCore) drawCore(x, y, Math.min(width, height) * 0.012);
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const aim = dir + (t - 0.5) * fan + (rand() - 0.5) * 0.12;
      grow(x, y, aim, span * (0.7 + rand() * 0.5), 0, 1.0, queue);
    }
  }

  const stage = Math.min(width, height);
  const spanX = maxX - minX;

  if (params.family === 'burst') {
    /* one core, channels radiating in every direction */
    const ox = cx + (rand() - 0.5) * width * 0.08;
    const oy = cy + (rand() - 0.5) * height * 0.12;
    leader(ox, oy, rand() * Math.PI * 2, Math.PI * 2,
           4 + Math.floor(rand() * 3), stage * (0.80 + params.trunkSpan * 0.55), true);
  } else if (params.family === 'crawler') {
    /* channels crawling through the layer, trailing fine hairs */
    const trunks = params.leaders;
    for (let i = 0; i < trunks; i++) {
      const fromLeft = i % 2 === 0;
      /* spread the trunks over the whole layer instead of stacking them */
      const y = cy + (trunks === 1 ? 0 : ((i / (trunks - 1)) - 0.5)) * layerHalf * 1.4;
      leader(fromLeft ? minX + stepLen : maxX - stepLen, y,
             (fromLeft ? 0 : Math.PI) + (rand() - 0.5) * 0.4,
             Math.PI * 0.6, 2 + Math.floor(rand() * 2), spanX * (0.55 + params.trunkSpan * 0.6), i === 0);
    }
  } else if (params.family === 'multi') {
    /* several small cores, each throwing out a short fan */
    const cores = 2 + Math.floor(rand() * 2);
    for (let c = 0; c < cores; c++) {
      const ox = minX + (0.10 + rand() * 0.80) * spanX;
      const oy = cy + (rand() - 0.5) * layerHalf * 1.5;
      leader(ox, oy, rand() * Math.PI * 2, Math.PI * 1.5,
             4 + Math.floor(rand() * 3), stage * (0.45 + params.trunkSpan * 0.5), true);
    }
  } else {
    /* one core low in the layer with a fan of channels going up */
    const ox = cx + (rand() - 0.5) * width * 0.16;
    const oy = cy + layerHalf * (0.25 + rand() * 0.25);
    leader(ox, oy, -Math.PI * 0.5, Math.PI * 1.6,
           4 + Math.floor(rand() * 3), stage * (0.85 + params.trunkSpan * 0.6), true);
  }

  /* Breadth first, so every trunk is laid down before its branches. */
  let guard = 0;
  while (queue.length && guard++ < 1200) {
    const strand = queue.shift();
    grow(strand.x, strand.y, strand.aim, strand.lengthPx,
         strand.tierIndex, strand.toneScale, queue);
  }

  ctx.globalAlpha = 1.0;
  return canvas.transferToImageBitmap();
}


/*
 * Node entry point, for tests only.
 *
 * In the browser this file is loaded with `new Worker(...)` and `module` does not
 * exist, so the guard leaves the worker path untouched; under node the pure model
 * (noise, heading, parameters) can be driven directly instead of being checked by
 * pattern-matching the source.
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    makeRng : makeRng,
    generateLightningBolt : generateLightningBolt,
    CG_SHAPE : CG_SHAPE,
    makeNoise1D : makeNoise1D,
    icStepHeading : icStepHeading,
    drawICParams : drawICParams,
    generateIntraCloudBolt : generateIntraCloudBolt,
    IC_VARIANTS : IC_VARIANTS,
    IC_WIDTH : IC_WIDTH,
    IC_TONE : IC_TONE,
    IC_TIERS : IC_TIERS,
    IC_SMOOTH_SCALE : IC_SMOOTH_SCALE,
    IC_SMOOTH_AMP : IC_SMOOTH_AMP,
    IC_STEP_NOISE : IC_STEP_NOISE,
    IC_RESTORE : IC_RESTORE,
    IC_JITTER_CLAMP : IC_JITTER_CLAMP,
    IC_KINK : IC_KINK,
    IC_KINK_CHANCE : IC_KINK_CHANCE,
    IC_MAX_DEVIATION : IC_MAX_DEVIATION,
    IC_TIP_TONE : IC_TIP_TONE
  };
}
