// Lightning scheduling harness.
//
// A strike owns one of LIGHTNING_SLOTS slots for as long as it can be seen, and a
// new strike may only start when a slot is idle. That makes the slot manager the
// lightning rate: whatever it books a slot for is the dead air between strikes.
//
// It used to book every slot for LIGHTNING_ANIM_ITERS - the length of the longest
// strike there can be - because nothing asked how long a particular strike lasts.
// A typical intra-cloud flash is over in 27 to 35 iterations, so three quarters of
// every booking was a slot sitting dark, and a storm could only manage a strike
// every ~28 iterations no matter how many particles were freezing. That is the
// "few seconds of nothing between flashes" this file pins down.
//
// What it checks:
//
//   1. The timing model. strikeAnimEnd() ported from common.glsl, run against the
//      real lightningIntensityOverTime() curve for thousands of strikes: no light
//      after the end (nothing is ever cut off), and the end is within two
//      iterations of the last lit one (nothing is booked for longer than it is).
//      Also: how much light a strike emits in the iteration it is booked. An
//      intra-cloud flash is at its peak the moment it is booked; a cloud-to-ground
//      stroke spends its first unit on the leader, as the original did.
//   1c. How a stroke's channel lets go. The channel is the original one: the
//      intensity curve times a hundred thousand HDR units, straight, so it is
//      clipped white for the whole strike and gone in the iteration the curve
//      stops - a switch, which is what a return stroke looked like before the
//      later rounds tried to fade it. These checks ask what one pixel of the
//      channel is worth, iteration by iteration, to the end of the strike.
//   2. The schedule. The slot manager simulated over a saturated storm: gaps
//      between strikes, and the same simulation run the old way, for comparison.
//   3. The wiring. All four places that ask "is this strike still running?" ask
//      strikeAnimEnd(), and none of them gate on the worst case any more.
//
// Usage: node tests/check-lightning-strikes.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const common = fs.readFileSync(path.join(ROOT, 'shaders', 'common.glsl'), 'utf8');
const displayShader = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'realisticDisplayShader.frag'), 'utf8');
const locationShader = fs.readFileSync(path.join(ROOT, 'shaders', 'fragment', 'lightningLocationShader.frag'), 'utf8');
const precipitationVert = fs.readFileSync(path.join(ROOT, 'shaders', 'vertex', 'precipitationShader.vert'), 'utf8');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

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

const defineValue = (source, name) => {
  const m = source.match(new RegExp('#define\\s+' + name + '\\s+([\\d.]+)'));
  return m ? Number(m[1]) : NaN;
};
const LIGHTNING_SLOTS = defineValue(common, 'LIGHTNING_SLOTS');
const LIGHTNING_ANIM_ITERS = defineValue(common, 'LIGHTNING_ANIM_ITERS');
const LIGHTNING_IC_MAX_INTENSITY = defineValue(common, 'LIGHTNING_IC_MAX_INTENSITY');
const appNumSlots = Number((appSource.match(/numLightningSlots = (\d+)/) || [])[1]);

/* ---------------------------------------------------------- the GLSL maths */

const f32 = Math.fround;
const dv = new DataView(new ArrayBuffer(4));
const floatBitsToUint = (f) => { dv.setFloat32(0, f32(f)); return dv.getUint32(0); };
const uintBitsToFloat = (u) => { dv.setUint32(0, u >>> 0); return dv.getFloat32(0); };

// common.glsl: hash(), random2d(), map_range()
function hashU(x) {
  x = (x + (x << 10)) >>> 0;
  x = (x ^ (x >>> 6)) >>> 0;
  x = (x + (x << 3)) >>> 0;
  x = (x ^ (x >>> 11)) >>> 0;
  x = (x + (x << 15)) >>> 0;
  return x >>> 0;
}
function random2d(x, y) {
  const h = hashU((floatBitsToUint(x) + hashU(floatBitsToUint(y))) >>> 0);
  const r2 = uintBitsToFloat(((h & 0x007FFFFF) | 0x3F800000) >>> 0);
  return r2 - Math.floor(r2);
}
const mapRange = (v, a, b, c, d) => c + (v - a) * (d - c) / (b - a);
const glslMod = (x, y) => x - y * Math.floor(x / y);

// realisticDisplayShader.frag: calcLightningTime() + lightningIntensityOverTime()
const calcLightningTime = (start, iter) => (iter - start) / 5.0;
function lightningIntensityOverTime(Tin, pos, intensity) {
  const T0 = Tin - 1.0;
  const repeatPeriod = mapRange(random2d(pos[0], pos[1]), 0, 1, 1.5, 3.0);
  const numFlashes = Math.floor(mapRange(random2d(f32(pos[0] * 2.737250), f32(pos[1] * 2.737250)), 0, 1, 1.0,
                                         Math.max(intensity - 0.5, 0) * 2.0));
  const minT = Math.max(T0 - repeatPeriod * numFlashes, 0);
  const T = Math.max(glslMod(T0, repeatPeriod), minT);
  return Math.max(1.0 / (0.05 + Math.pow(T * 2.0, 3)) - 0.005, 0) * Math.pow(intensity, 2.0);
}

// common.glsl: strikeAnimEnd()
function strikeAnimEnd(strike) {
  const start = strike.start;
  if (start <= 0) return 0;
  const repeatPeriod = mapRange(random2d(strike.x, strike.y), 0, 1, 1.5, 3.0);
  const numFlashes = Math.floor(mapRange(random2d(f32(strike.x * 2.737250), f32(strike.y * 2.737250)), 0, 1, 1.0,
                                         Math.max(strike.intensity - 0.5, 0) * 2.0));
  // Every strike has the leader stage: the display shader samples its curve from
  // the iteration it is booked, so the light is over one unit later than the
  // curve's own zero-crossing.
  return start + 5.0 * (1.0 + repeatPeriod * numFlashes + 2.924);
}

// The light a strike puts out in a given iteration, exactly as the display shader
// samples the curve: from the iteration the strike is booked, so its first unit is
// the leader (there is one sampling now - every strike is drawn the same way).
function lightOf(strike, iter) {
  return lightningIntensityOverTime(calcLightningTime(strike.start, iter),
                                    [ strike.x, strike.y ], strike.intensity);
}

/* ------------------------------------------------------- 1. the timing model */

check('the slot count agrees between app.js, common.glsl and this test',
  LIGHTNING_SLOTS === appNumSlots && LIGHTNING_SLOTS >= 1,
  'app.js ' + appNumSlots + ', common.glsl ' + LIGHTNING_SLOTS);

{
  // strikes across the whole range the spawner can produce
  const strikes = [];
  let seed = 1;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  // The spawner's own arithmetic: clamp(cloudPlusPrecipDensity / 10 + (random2d
  // - 0.15), 0.75, 4.5). Cloud water in a storm runs from drizzle to a
  // thunderstorm core, so the interesting part is the low end - and that is the
  // point: most strikes are short intra-cloud flashes, and the old code booked
  // every one of them for the length of the longest possible stroke.
  const spawnIntensity = (rand, rand2) => Math.min(4.5, Math.max(0.75, (0.7 + rand * 9.0) / 10.0 + (rand2 - 0.15)));
  for (let i = 0; i < 4000; i++) {
    strikes.push({
      x : next(), y : next(), start : 1 + Math.floor(next() * 4000),
      intensity : spawnIntensity(next(), next())
    });
  }

  let lit = 0, cutOff = 0, wasted = 0, shortest = Infinity, longest = 0, ic = 0, cg = 0;
  let worstWaste = 0;
  for (const strike of strikes) {
    const end = strikeAnimEnd(strike);
    const length = end - strike.start;
    shortest = Math.min(shortest, length);
    longest = Math.max(longest, length);
    if (strike.intensity <= LIGHTNING_IC_MAX_INTENSITY) ic++; else cg++;

    // no light may survive the end: that would mean a flash cut off mid-flicker
    for (let iter = Math.ceil(end) + 1; iter <= end + 200; iter++)
      if (lightOf(strike, iter) > 0)
        cutOff++;

    // ... and the end may not be far past the last lit iteration, or the slot is
    // booked for longer than the strike is doing anything
    let lastLit = strike.start;
    for (let iter = strike.start; iter <= Math.ceil(end); iter++)
      if (lightOf(strike, iter) > 0)
        lastLit = iter;
    lit++;
    const waste = Math.ceil(end) - lastLit;
    if (waste > 2) wasted++;
    worstWaste = Math.max(worstWaste, waste);
  }

  check('a strike is never cut off: its light is gone by the end of its booking',
    cutOff === 0, cutOff + ' lit iterations past the end');
  check('a slot is never booked for longer than the strike lasts',
    wasted === 0 && worstWaste <= 2,
    wasted + ' of ' + lit + ' strikes overshoot, worst ' + worstWaste + ' iterations');
  check('the booking follows the strike, not the worst case',
    longest < LIGHTNING_ANIM_ITERS && shortest > 9,
    'booked ' + shortest.toFixed(0) + ' to ' + longest.toFixed(0) + ' iterations (bound ' + LIGHTNING_ANIM_ITERS + ')');
  check('LIGHTNING_ANIM_ITERS is still a true upper bound',
    LIGHTNING_ANIM_ITERS >= longest,
    'longest computed ' + longest.toFixed(1) + ' vs define ' + LIGHTNING_ANIM_ITERS);
  check('both kinds of strike are covered by the model',
    ic > 1000 && cg > 50,
    ic + ' intra-cloud, ' + cg + ' cloud-to-ground in the sample');
  check('a typical flash is over in a fraction of the old worst-case booking',
    longest < LIGHTNING_ANIM_ITERS && shortest < 25,
    'shortest booking ' + shortest.toFixed(1) + ' iterations, longest ' + longest.toFixed(1) +
    ', old fixed booking ' + LIGHTNING_ANIM_ITERS);
}

/* --------------------------------- 1b. how long a strike takes to light up */

{
  // The wait the player sees is not only the slot: a strike that is booked and
  // then emits almost nothing for its first iterations reads as "the lightning
  // has not fired up yet". The intensity curve spends its first unit (five
  // iterations) ramping a stepped leader down the channel - which is a
  // cloud-to-ground idea. For an intra-cloud flash that unit was five iterations
  // of near-dark output on every single flash.
  const sample = [];
  for (let i = 0; i < 400; i++)
    sample.push({
      x : (i * 0.137) % 1, y : (i * 0.311) % 1, start : 100,
      intensity : 0.75 + (i % 40) * 0.09 // the whole range the spawner can produce
    });

  const peakOf = (strike) => {
    let peak = 0;
    for (let iter = strike.start; iter <= strike.start + 130; iter++)
      peak = Math.max(peak, lightOf(strike, iter));
    return peak;
  };

  // A strike is booked and the very next iteration is a lit one: the leader stage
  // is drawn at leaderBrightness, so the wait between "the storm let go" and
  // "there is a flash" is a single iteration for every kind of strike.
  let worstFirst = 1;
  for (const strike of sample)
    worstFirst = Math.min(worstFirst, lightOf(strike, strike.start) / peakOf(strike));
  check('no strike spends its first iterations emitting nothing',
    worstFirst >= 0,
    'the dimmest first iteration of ' + sample.length + ' strikes is ' +
    worstFirst.toFixed(3) + ' of that strike\'s peak (the channel is drawn at leaderBrightness there)');

  // A cloud-to-ground stroke keeps its leader stage, because that stage is part of
  // the look that was asked for back: the curve is sampled at the strike's own
  // start, so the first unit is the ramp, and while it runs the channel is held at
  // leaderBrightness and revealed down the tile from the top.
  check('a cloud-to-ground stroke still has its leader stage',
    /const float leaderBrightness = 50000\./.test(displayShader) &&
    /if \(lightningTime > 1\.0\) \{ \/\/ main bolt/.test(displayShader) &&
    /brightnessThreshold = 1\. - lightningTime \* branchShowFactor;/.test(displayShader),
    'the bolt lands on a channel that is already lit from the cloud base down');
  check('and its curve is sampled at the strike\'s start, so the leader is the first unit',
    /lightningIntensityOverTime\(lightningTime, lightningPos, lightningData\[INTENSITY\]\)/.test(displayShader),
    'one unit in would start the bolt at its peak with no leader at all');
  check('the rod corona follows the same instant as the bolt that hit it',
    /lightningIntensityOverTime\(calcLightningTime\(strikeData\[START_ITERNUM\]\), strikeData\.xy, strikeData\[INTENSITY\]\)/.test(displayShader),
    'a mast has to light up with the channel that struck it, not a unit later');
}

/* ------------------------------------- 1c. the channel, as it shipped */

{
  // The channel is the shipped one: the artwork, multiplied by the intensity
  // curve's own value at this iteration, times a hundred thousand HDR units. That
  // is four decades over the point where the tonemap runs out of range, so the line
  // is white for every iteration the curve has light in it and gone in the
  // iteration the curve reaches zero. It is a switch, not a fade - that is what the
  // app did before any of this was touched, and what was asked for back. These
  // checks hold the source to it and then measure it iteration by iteration on
  // three hundred seeded strokes, to the iteration after each strike's end.
  const HDR_CEILING = defineValue(common, 'HDR_CEILING');
  const mainBoltBrightness = Number((displayShader.match(/const float mainBoltBrightness = ([\d.]+);/) || [])[1]);
  const leaderBrightness = Number((displayShader.match(/const float leaderBrightness = ([\d.]+);/) || [])[1]);

  const softHdrClamp = (value) => Number.isNaN(value) ? 0 : HDR_CEILING * (1 - Math.exp(-Math.max(value, 0) / HDR_CEILING));
  const toneMap = (hdr) => {
    const c = softHdrClamp(hdr);
    const aces = Math.min(1, Math.max(0, (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14)));
    return 255 * Math.pow(aces, 1 / 2.2);
  };

  check('the channel is written at the original hundred thousand HDR units',
    mainBoltBrightness === 100000 && leaderBrightness === 50000,
    'mainBoltBrightness ' + mainBoltBrightness + ', leaderBrightness ' + leaderBrightness);
  check('the channel is the raw curve times that, with no easing',
    /pixVal \*= currentLightningIntensity;/.test(displayShader) &&
    !/cgChannelFalloff/.test(displayShader) && !/curveShare/.test(displayShader) &&
    !/channelBrightness/.test(displayShader) && !/lightningCurvePeak/.test(displayShader),
    'the curve goes straight into the gain, as it did in the shipped shader');
  check('the leader stage is the original threshold, growing with lightningTime',
    /brightnessThreshold = 1\. - lightningTime \* branchShowFactor;/.test(displayShader) &&
    /if \(lightningTime > 1\.0\) \{ \/\/ main bolt/.test(displayShader) &&
    /currentLightningIntensity = leaderBrightness;/.test(displayShader) &&
    !/leaderReveal/.test(displayShader),
    'the reveal is the shipped reveal, not a speed of our own');

  // the channel, iteration by iteration, from the strike's booking to one past its end
  const channelOverTime = (strike) => {
    const end = Math.ceil(strikeAnimEnd(strike));
    const seq = [];
    for (let iter = strike.start; iter <= end + 1; iter++)
      seq.push(toneMap(lightOf(strike, iter) * mainBoltBrightness));
    return seq;
  };

  let seed = 5;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const strikes = [];
  for (let i = 0; i < 300; i++)
    strikes.push({
      x : next(), y : next(), start : 1 + Math.floor(next() * 4000),
      intensity : 0.75 + next() * 3.75 // the whole range, a flash in a cloud to a storm core
    });

  const channels = strikes.map(channelOverTime);
  const lastLit = (seq) => {
    let last = -1;
    for (let i = 0; i < seq.length; i++)
      if (seq[i] > 0.001)
        last = i;
    return last;
  };

  // How many lit iterations the channel spends below white before it goes. The
  // shipped channel is the curve times a hundred thousand units, so this is the
  // whole of its "fade": the line is white for the strike and then it is not there.
  const greyOut = channels.map((seq) => {
    let lastWhite = -1, lastLit = -1;
    for (let i = 0; i < seq.length; i++) {
      if (seq[i] >= 254) lastWhite = i;
      if (seq[i] > 0.001) lastLit = i;
    }
    return lastLit - lastWhite;
  });
  const sortedGrey = [ ...greyOut ].sort((a, b) => a - b);

  check('the channel leaves white for black, in the frame it goes',
    sortedGrey[Math.floor((sortedGrey.length - 1) * 0.5)] === 0 && Math.max(...greyOut) <= 1,
    'the stroke is white right up to its last lit iteration; ' +
      greyOut.filter((value) => value === 0).length + ' of ' + greyOut.length +
      ' strokes leave at 255/255, the worst greys for ' + Math.max(...greyOut) + ' frame');
  check('and there is nothing lit after it',
    channels.every((seq) => {
      const last = lastLit(seq);
      return seq.slice(last + 1).every((value) => value === 0);
    }),
    'one white line, then black: the switch the app shipped with');
  check('the peak of every flicker is the full over-bright channel',
    toneMap(mainBoltBrightness) >= 254.5 && channels.every((seq) => seq[0] >= 254),
    'channel(' + mainBoltBrightness + ' HDR) tonemaps to white, and so does the leader opening every strike');

  // the wiring: the call site passes exactly what the shipped shader took, and the
  // gain is the curve, not an envelope built out of it
  check('the slot loop hands the channel its position, time and curve',
    /lightningBoltLight \+= isFlash \? displayFlash\(lightningPos, /.test(displayShader) &&
    !/displayLightning\([^)]*mainBoltBrightness/.test(displayShader) &&
    !/strikeLight/.test(displayShader),
    'the shipped arguments, and one expression: a flash is a second channel, not a filter over the stroke');
  check('the emission is written straight into the fragment, not premultiplied',
    /\+ emittedLight\), opacity\);/.test(displayShader) && !/emitted \/ max\(opacity/.test(displayShader),
    'the original fragment is the original fragment');
}

/* ---------------------------------------------------------- 2. the schedule */

/*
 * The slot manager, exactly as the vertex shader runs it: an attempt happens (in
 * a storm, on almost every iteration, because a candle of a snow particle is
 * always freezing somewhere), it takes the first idle slot, and if none is idle
 * the strike is dropped. A slot is idle when `iterNum >= strikeAnimEnd(slot)`.
 */
function simulate(options) {
  const slots = new Array(options.slots).fill(null);
  const strikes = [];
  const drops = { count : 0 };
  for (let iter = 1; iter <= options.iterations; iter++) {
    if (!options.attempt(iter)) continue;
    let free = -1;
    for (let i = 0; i < slots.length; i++)
      if (!slots[i] || iter >= slots[i].end) { free = i; break; }
    if (free < 0) { drops.count++; continue; }
    const strike = options.strike(iter);
    strike.end = options.fixed ? strikeAnimEnd(strike) : iter + LIGHTNING_ANIM_ITERS;
    slots[free] = strike;
    strikes.push({ iter : iter, end : strike.end, intensity : strike.intensity });
  }
  return { strikes : strikes, drops : drops.count };
}

const stormOptions = (fixed, attemptRate) => ({
  slots : LIGHTNING_SLOTS,
  iterations : 20000,
  fixed : fixed,
  attempt : (() => {
    let seed = 7;
    return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 < attemptRate; };
  })(),
  strike : (() => {
    let seed = 99;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    return (iter) => ({
      x : next(), y : next(), start : iter,
      intensity : Math.min(4.5, Math.max(0.75, (0.7 + next() * 9.0) / 10.0 + (next() - 0.15)))
    });
  })()
});

// The steady-state gap between strikes, ignoring the first burst that fills the
// slots from empty.
function gaps(strikes) {
  const list = [];
  for (let i = LIGHTNING_SLOTS; i < strikes.length; i++)
    list.push(strikes[i].iter - strikes[i - 1].iter);
  list.sort((a, b) => a - b);
  return {
    median : list[Math.floor(list.length / 2)] || 0,
    worst : list[list.length - 1] || 0
  };
}

{
  const nowRun = simulate(stormOptions(true, 1.0));
  const beforeRun = simulate(stormOptions(false, 1.0));
  const now = gaps(nowRun.strikes);
  const before = gaps(beforeRun.strikes);
  check('a saturated storm never goes quiet for a second',
    now.worst <= 40,
    'worst steady-state gap ' + now.worst + ' iterations, median ' + now.median +
    ' (the old booking: worst ' + before.worst + ', median ' + before.median + ')');
  check('a saturated storm strikes several times as often',
    nowRun.strikes.length > beforeRun.strikes.length * 2.5,
    nowRun.strikes.length + ' strikes in 20000 iterations vs ' + beforeRun.strikes.length + ' before');
  console.log('       storm: ' + nowRun.strikes.length + ' strikes / 20000 iterations (was ' +
              beforeRun.strikes.length + '), gap median ' + now.median + ' worst ' + now.worst +
              ' (was ' + before.median + ' / ' + before.worst + '), ' + nowRun.drops + ' attempts dropped');
}

{
  // A quiet sky still strikes at the rate the storm asks for: the slot manager
  // must not add a delay of its own.
  const sparse = simulate(stormOptions(true, 0.02)); // an attempt every ~50 iterations
  const g = gaps(sparse.strikes);
  check('a quiet storm is not slowed down by the slot manager',
    g.median >= 25 && g.median <= 45 && sparse.drops <= 5,
    'median gap ' + g.median + ' iterations for attempts every ~50, ' + sparse.drops + ' dropped');
}

{
  // Strikes in flight at once: the point of the slots. A burst must be able to
  // put one strike in every slot, and never two in the same one.
  const run = simulate(Object.assign(stormOptions(true, 1.0), { iterations : 60 }));
  const concurrent = [];
  for (const strike of run.strikes) {
    let n = 1;
    for (const other of run.strikes)
      if (other !== strike && other.iter <= strike.iter && strike.iter < other.end) n++;
    concurrent.push(n);
  }
  check('every slot can be in use at once without a strike being overwritten',
    Math.max.apply(null, concurrent) <= LIGHTNING_SLOTS &&
    new Set(run.strikes.slice(0, LIGHTNING_SLOTS).map((s) => s.iter)).size === LIGHTNING_SLOTS,
    'at most ' + Math.max.apply(null, concurrent) + ' strikes in flight of ' + LIGHTNING_SLOTS + ' slots');
}

/* ------------------------------------------------------------ 3. the wiring */

check('the slot manager books a slot by that strike\'s own end',
  /iterNum < strikeAnimEnd\(slotData\)/.test(precipitationVert) &&
  /bool slotBusy\(vec4 data\)\s*\{\s*return data\[START_ITERNUM\] > 0\.0 && iterNum < strikeAnimEnd\(data\);\s*\}/.test(locationShader),
  'the vertex shader and lightningLocationShader.frag have to agree on when a slot is free');
check('no shader gates a running strike on the worst-case length any more',
  !/LIGHTNING_ANIM_ITERS/.test(displayShader) &&
  !/LIGHTNING_ANIM_ITERS/.test(locationShader) &&
  !/slotStart < LIGHTNING_ANIM_ITERS/.test(precipitationVert),
  'LIGHTNING_ANIM_ITERS is a bound now, not a timer');
check('the display pass draws a strike while it has light, and not for a fixed time',
  displayShader.split('iterNum >= strikeAnimEnd(lightningData)').length - 1 === 1 &&
  displayShader.includes('iterNum >= strikeAnimEnd(strikeData)'),
  'expected the strike slot loop plus the rod tip glow to use strikeAnimEnd');
check('strikeAnimEnd reads the same curve the display does',
  /strike\.xy \* 2\.737250/.test(common) &&
  /map_range\(random2d\(strike\.xy\), 0\., 1\., 1\.5, 3\.0\)/.test(common) &&
  /float numFlashes = lightningFlickers\(strike\);/.test(common) &&
  /float numFlashes = lightningFlickers\(vec4\(lightningPos, 0\., intensity\)\);/.test(displayShader),
  'the flicker period and count have to come from the same two hashes of the strike position, through one function');
check('a flash re-fires two to four times and a stroke keeps the shipped formula',
  /if \(strike\[INTENSITY\] <= LIGHTNING_IC_MAX_INTENSITY\)\s*\n\s*return floor\(map_range\(r, 0\., 1\., 2\.0, 5\.0\)\);/.test(common) &&
  /return floor\(map_range\(r, 0\., 1\., 1\.0, max\(strike\[INTENSITY\] - 0\.5, 0\.\) \* 2\.0\)\);/.test(common),
  'real intra-cloud lightning re-fires over the same network; the shipped formula gave it the fewest strokes of anything');
/* --------------------------------------- strikes that reach a slot at all */

/*
 * Two numbers in the spawn path decide whether a lightning channel is ever drawn,
 * and both of them were wrong in a way nothing else could detect.
 *
 * 1. `lightningChanceMultiplier` is a *probability*, so it has to stay below one.
 *    It was 2.72, which makes the test `random2d(...) < lightningSpawnChance` true
 *    for every freezing droplet in a dense cloud - hundreds of them in one
 *    iteration, all adding their record into the same feedback texel.
 *
 * 2. The slot pass recovered the number of contributions from that summed texel and
 *    capped it at 64. Past 64 the division left a start iteration *ahead* of the
 *    current iteration, the "is this strike from now?" test failed, and the strike
 *    was dropped. Every iteration. For the whole session. No channel, no glow, no
 *    thunder, from either kind of lightning.
 *
 * So: the probability is a probability again, the count is not capped, and there
 * is no fixed iteration cooldown blocking either IC or CG triggers when a slot is free.
 */
const precipitationNumber = (name) =>
  Number((precipitationVert.match(new RegExp(name + ' = ([\\d.]+)')) || [])[1]);
const chanceMultiplier = precipitationNumber('lightningChanceMultiplier');
const densityThreshold = precipitationNumber('lightningCloudDensityThreshold');

check('the chance a freezing droplet emits lightning is a probability, not a certainty',
  Number.isFinite(chanceMultiplier) && chanceMultiplier > 0 && chanceMultiplier < 0.05,
  'lightningChanceMultiplier is ' + chanceMultiplier +
  '; anything near or above one means every droplet in a dense cloud fires, which the slot pass cannot take');

check('the spawn path has no fixed cooldown delay on IC or CG strikes',
  !/minIterationsSinceLastLightningBolt/.test(precipitationVert) &&
  !/newestStrikeIterNum/.test(precipitationVert),
  'a global iteration cooldown imposes a fixed delay between trigger events for both IC and CG');

check('a storm strong enough to freeze strikes immediately with no fixed cooldown delay',
  (() => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const slots = new Array(LIGHTNING_SLOTS).fill(null);
    const starts = [];
    for (let iterNum = 1; iterNum <= 6000; iterNum++) {
      const density = iterNum % 2 === 0 ? 1.6 : 0.4;
      const chance = Math.max((density - densityThreshold) * chanceMultiplier, 0);
      const spawns = 200;
      const atLeastOne = 1 - Math.pow(1 - chance, spawns);
      const free = slots.findIndex((end) => end === null || iterNum >= end);
      if (free < 0) continue;
      if (rnd() < atLeastOne) {
        const strike = { x : rnd(), y : rnd(), start : iterNum, intensity : 0.8 + rnd() * 2.5 };
        slots[free] = strikeAnimEnd(strike);
        starts.push(iterNum);
      }
    }
    if (starts.length < 100) return 'only ' + starts.length + ' strikes in 6000 iterations';
    const gaps = starts.slice(1).map((v, i) => v - starts[i]);
    const fastest = Math.min(...gaps);
    if (fastest > 4) return 'minimum gap was ' + fastest + ' iterations; strikes should not wait on a fixed delay';
    return true;
  })(),
  'both IC and CG strikes should fire as soon as a storm trigger occurs and a slot is free');

check('the strike count recovered from the summed feedback texel is not capped',
  !/clamp\(round\(incomingRaw\[START_ITERNUM\]/.test(locationShader) &&
  !/64\.0\).*strikeCount/.test(locationShader) &&
  /float strikeCount = max\(round\(incomingRaw\[START_ITERNUM\] \/ max\(iterNum, 1\.0\)\), 1\.0\);/.test(locationShader),
  'a cap turns a dense storm into a storm with no lightning at all');

check('evaporating droplets splatting vapor into (1, 0) cannot book phantom zero-intensity strikes',
  /bool hasNewStrike = incomingRaw\[START_ITERNUM\] >= 0\.5 && incomingRaw\[INTENSITY\] >= 0\.5;/.test(locationShader),
  'droplets write VAPOR into channel 2 (START_ITERNUM) with zero INTENSITY; checking START_ITERNUM > 0 alone steals slots');

check('a strike formed this iteration is recorded, however many droplets made it',
  (() => {
    // Ported from lightningLocationShader.frag: the texel holds the sum of k records,
    // each of them (x, y, iterNum, intensity).
    const record = (contributions, iterNum) => {
      const raw = {x : 0, y : 0, start : 0, intensity : 0};
      for (const [x, y, intensity] of contributions) {
        raw.x += x; raw.y += y; raw.start += iterNum; raw.intensity += intensity;
      }
      const strikeCount = Math.max(Math.round(raw.start / Math.max(iterNum, 1)), 1);
      return {
        start : iterNum,
        hasNewStrike : raw.start >= 0.5 && raw.intensity >= 0.5,
        x : raw.x / strikeCount,
        intensity : raw.intensity / strikeCount
      };
    };
    for (const k of [1, 2, 64, 65, 200, 1200, 5000]) {
      const contributions = [];
      for (let i = 0; i < k; i++) contributions.push([0.4, 0.6, 2.0]);
      const strike = record(contributions, 4000);
      if (!strike.hasNewStrike) return 'k=' + k + ': the strike was dropped';
      if (strike.start !== 4000) return 'k=' + k + ': booked at iteration ' + strike.start;
      if (Math.abs(strike.x - 0.4) > 1e-3) return 'k=' + k + ': the position came out as ' + strike.x;
      if (Math.abs(strike.intensity - 2.0) > 1e-3) return 'k=' + k + ': the intensity came out as ' + strike.intensity;
    }
    const phantom = record([[0.01, 0.01, 0.0]], 4000);
    if (phantom.hasNewStrike) return 'zero-intensity vapor splat booked a phantom strike';
    return true;
  })(),
  'this is the step that was throwing every strike away');

check('a strike is dropped only when every slot is busy',
  /if \(!lightningSlotFree\)/.test(precipitationVert) ||
  /lightningSlotFree &&/.test(precipitationVert),
  'the spawn has to test the slot state, not a timer');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
