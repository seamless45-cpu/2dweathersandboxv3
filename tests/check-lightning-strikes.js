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
//      Also: how much light a strike emits in the iteration it is booked. That is
//      the wait the player sees between "the storm let go" and "there is a
//      flash" - a strike has to be at its peak in the iteration it is booked.
//   1c. How a stroke's channel lets go. The channel is written four decades over
//      the white point, so the intensity curve used straight made it pure white
//      for the whole strike and gone in one iteration: a switch, not a fade. The
//      share of the strike's peak light is compressed now, and these checks ask
//      what one pixel of the channel is worth, iteration by iteration, to the end
//      of the strike.
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
  // No leader stage: the display shader starts the intensity curve one unit in for
  // every strike, so the light is over at T0 = period * flickers + 2.924.
  return start + 5.0 * (repeatPeriod * numFlashes + 2.924);
}

// The light a strike puts out in a given iteration, exactly as the display shader
// samples the curve - one unit in, for both kinds of strike.
function lightOf(strike, iter) {
  return lightningIntensityOverTime(calcLightningTime(strike.start, iter) + 1.0,
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

  // Every strike, cloud-to-ground included, is at its peak the moment it is
  // booked. The leader stage used to be five iterations of a bolt held at one
  // fixed brightness - it could not follow the curve, because the curve is still
  // near zero while a leader would be crawling - and that fixed glow was the
  // "frozen" flash: a static bright shape before the strike it was announcing.
  let worstFirstFraction = 1;
  let cgChecked = 0;
  for (const strike of sample) {
    const peak = peakOf(strike);
    if (peak <= 0) continue;
    if (strike.intensity > LIGHTNING_IC_MAX_INTENSITY) cgChecked++;
    worstFirstFraction = Math.min(worstFirstFraction, lightOf(strike, strike.start) / peak);
  }
  check('a strike is at full brightness in the iteration it is booked',
    worstFirstFraction > 0.99,
    'the dimmest first iteration of ' + sample.length + ' strikes is ' +
    (worstFirstFraction * 100).toFixed(1) + '% of that strike\'s peak');
  check('the sample covers both kinds of strike', cgChecked > 40,
    cgChecked + ' cloud-to-ground strikes in ' + sample.length);

  // ... so no strike may carry a stage that is drawn at a brightness of its own
  check('the display shader has no leader stage left',
    !/leaderBrightness/.test(displayShader) && !/leaderRevealSpeed/.test(displayShader) &&
    !/brightnessThreshold = 1\. - /.test(displayShader),
    'a leader stage is a fixed brightness the curve cannot reach, i.e. a frozen glow');
  check('every call site samples the curve at the same one-unit offset',
    (displayShader.match(/lightningIntensityOverTime\(lightningTime \+ 1\.0,/g) || []).length ===
      (displayShader.match(/lightningIntensityOverTime\(lightningTime/g) || []).length &&
    (displayShader.match(/lightningIntensityOverTime\(lightningTime/g) || []).length >= 2,
    'the cloud-to-ground slot loop and the intra-cloud pass have to agree, or a ' +
    'stroke is drawn dark for its first iterations');
  check('the rod too, so a mast lights up with the bolt that hit it',
    /lightningIntensityOverTime\(calcLightningTime\(strikeData\[START_ITERNUM\]\) \+ 1\.0,/.test(displayShader),
    'the rod corona has to follow the same curve the bolt is drawn with');
}

/* ------------------------------- 1c. how a stroke's channel lets go */

{
  // The channel - the line of the bolt itself - is the one part of a strike that
  // is written four decades over the point where the tonemap runs out of range.
  // Fed the intensity curve straight, as curve * mainBoltBrightness, it is white
  // for every iteration of the strike and then gone in the iteration the curve
  // reaches zero: the last lit iteration of a storm-core stroke still carries 355
  // HDR units against a white point of 6.3, and the next one carries nothing. A
  // switch, not a fade - which is what it looked like on screen, the halo fading
  // while the channel itself vanished.
  //
  // The display shader now raises the share of the strike's peak light to
  // cgChannelFalloff before multiplying by mainBoltBrightness, which pulls the tail
  // of the curve down into the band the display can actually show. These checks run
  // the real curve through the real constants and ask what one pixel of the channel
  // is worth, iteration by iteration, to the iteration after the strike's end.
  const HDR_CEILING = defineValue(common, 'HDR_CEILING');
  const mainBoltBrightness = Number((displayShader.match(/const float mainBoltBrightness = ([\d.]+);/) || [])[1]);
  const cgChannelFalloff = Number((displayShader.match(/const float cgChannelFalloff = ([\d.]+);/) || [])[1]);
  const lightningCurvePeak = Number((displayShader.match(/const float lightningCurvePeak = ([\d.]+);/) || [])[1]);

  const softHdrClamp = (value) => Number.isNaN(value) ? 0 : HDR_CEILING * (1 - Math.exp(-Math.max(value, 0) / HDR_CEILING));
  const toneMap = (hdr) => {
    const c = softHdrClamp(hdr);
    const aces = Math.min(1, Math.max(0, (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14)));
    return 255 * Math.pow(aces, 1 / 2.2);
  };
  // what a pixel of the channel is written at, for a share of the strike's peak
  const channelBrightness = (share) => mainBoltBrightness * Math.pow(Math.min(Math.max(share, 0), 1), cgChannelFalloff);
  const oldChannelBrightness = (share) => mainBoltBrightness * share; // what it was before

  check('the channel normalizes by the curve\'s own peak, at every intensity',
    [ 0.95, 1.4, 2.5, 4.5 ].every((i) => Math.abs(lightningIntensityOverTime(1.0, [ 0.5, 0.5 ], i) /
                                                (lightningCurvePeak * i * i) - 1) < 1e-3),
    'lightningCurvePeak ' + lightningCurvePeak + ' vs the curve at T = 0: ' +
      lightningIntensityOverTime(1.0, [ 0.5, 0.5 ], 2.5).toFixed(3) + ' at intensity 2.5');

  // the channel, iteration by iteration, to the end of the strike and one past it
  const channelOverTime = (strike, brightness) => {
    const end = Math.ceil(strikeAnimEnd(strike));
    const peak = lightningCurvePeak * strike.intensity * strike.intensity;
    const seq = [];
    for (let iter = strike.start; iter <= end + 1; iter++)
      seq.push(toneMap(brightness(lightOf(strike, iter) / peak)));
    return seq;
  };
  // The fade: the last unbroken run of *lit* iterations once the channel has left
  // white for good. The iterations after the light is gone are not part of it -
  // that the light is gone is the previous section's business.
  const fadeOf = (seq) => {
    let last = seq.length - 1;
    while (last > 0 && seq[last] <= 0.001)
      last--;
    let first = last;
    while (first > 0 && seq[first - 1] < 255)
      first--;
    return seq.slice(first, last + 1);
  };
  const biggestStep = (seq) => {
    let step = 0;
    for (let i = 1; i < seq.length; i++)
      step = Math.max(step, Math.abs(seq[i] - seq[i - 1]));
    return step;
  };

  let seed = 5;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const strikes = [];
  for (let i = 0; i < 300; i++)
    strikes.push({
      x : next(), y : next(), start : 1 + Math.floor(next() * 4000),
      intensity : 0.95 + next() * 3.5 // the whole cloud-to-ground range
    });

  const shipped = strikes.map((strike) => fadeOf(channelOverTime(strike, channelBrightness)));
  const old = strikes.map((strike) => fadeOf(channelOverTime(strike, oldChannelBrightness)));
  const sorted = (values) => [ ...values ].sort((a, b) => a - b);
  const median = (values) => sorted(values)[Math.floor((values.length - 1) * 0.5)];
  const shippedLengths = shipped.map((fade) => fade.length);
  const oldLengths = old.map((fade) => fade.length);
  const fadeSeconds = (median(shippedLengths) / 60).toFixed(2);

  check('a cloud-to-ground channel fades out over several iterations instead of switching off',
    median(shippedLengths) >= 5,
    'median fade ' + median(shippedLengths) + ' iterations (' + fadeSeconds + ' s at 60 iterations/s), ' +
      'shortest ' + Math.min(...shippedLengths));
  check('the straight-curve form it replaced did switch off in a single iteration',
    median(oldLengths) <= 1 && Math.max(...oldLengths) <= 3,
    'median fade ' + median(oldLengths) + ' iterations before, longest ' + Math.max(...oldLengths) +
      ', against ' + median(shippedLengths) + ' now');
  // the step out of the last lit iteration counts: that one is the switch
  const withTheEnd = (fade) => [ ...fade, 0 ];
  const shippedSteps = shipped.map((fade) => biggestStep(withTheEnd(fade)));
  const oldSteps = old.map((fade) => biggestStep(withTheEnd(fade)));
  check('no iteration of the fade gives away most of the range at once',
    Math.max(...shippedSteps) <= 128,
    'biggest jump between two iterations ' + Math.max(...shippedSteps).toFixed(0) + '/255, was ' +
      Math.max(...oldSteps).toFixed(0) + '/255');
  check('the channel lands near black before it goes, instead of leaving from white',
    Math.max(...shipped.map((fade) => fade[fade.length - 1])) <= 48,
    'darkest lit iteration of the worst strike ' +
      Math.max(...shipped.map((fade) => fade[fade.length - 1])).toFixed(0) + '/255, was ' +
      Math.max(...old.map((fade) => fade[fade.length - 1])).toFixed(0) + '/255');
  check('the peak of every flicker is still the full over-bright channel',
    Math.abs(channelBrightness(1.0) - mainBoltBrightness) < 1e-6 && toneMap(mainBoltBrightness) >= 254.5,
    'channel(' + mainBoltBrightness + ' HDR) still tonemaps to white');
  check('the crescent before the fade is still white, not dimmed',
    shipped.every((fade) => fade[0] >= 250),
    'all ' + shipped.length + ' fades start at ' + Math.min(...shipped.map((fade) => fade[0])).toFixed(0) + '/255 or above');

  // A weak stroke has a fifth of a storm core's peak light, so an envelope that
  // was not taken as a share of the peak would fade a weak stroke out almost at
  // once and a strong one over a second.
  const weak = fadeOf(channelOverTime({ x : 0.31, y : 0.72, start : 100, intensity : 0.95 }, channelBrightness));
  const strong = fadeOf(channelOverTime({ x : 0.88, y : 0.55, start : 100, intensity : 4.45 }, channelBrightness));
  check('a weak stroke and a storm core fade over the same part of their lives',
    Math.abs(weak.length - strong.length) <= 1,
    'weak ' + weak.length + ' iterations, strong ' + strong.length);

  // ... and the envelope is still an envelope: monotone in the curve, zero when
  // the light is gone, never above the stroke's own peak.
  let monotone = true, overshoot = 0;
  let previous = -1;
  for (let share = 0; share <= 1.0001; share += 0.001) {
    const value = channelBrightness(share);
    if (!(value >= previous)) monotone = false;
    previous = value;
    overshoot = Math.max(overshoot, value);
  }
  check('the envelope is monotone in the curve and cannot overshoot the peak',
    monotone && Math.abs(channelBrightness(0)) < 1e-9 && overshoot <= mainBoltBrightness,
    'channel(0) = ' + channelBrightness(0) + ', largest ' + overshoot.toFixed(0));
  check('the falloff is a compression of the channel, not a cutoff',
    Number.isFinite(cgChannelFalloff) && cgChannelFalloff > 1 && cgChannelFalloff < 3,
    'cgChannelFalloff ' + cgChannelFalloff);

  // the wiring: the artwork is multiplied by the envelope, and the envelope gets
  // the strike's intensity from the slot it was booked in
  check('the channel is drawn with the envelope, not with the raw curve',
    /pixVal \*= channelBrightness;/.test(displayShader) && !/pixVal \*= currentLightningIntensity;/.test(displayShader),
    'the raw curve in the gain is what made the channel white for the whole strike');
  check('the slot loop hands the stroke its own intensity',
    /displayLightning\(lightningPos, lightningTime, currentLightningIntensity, lightningGroundHeight\(lightningPos\),\s*lightningData\[INTENSITY\]\)/
      .test(displayShader),
    'without it the envelope cannot normalize by the stroke\'s peak');
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
  displayShader.split('iterNum >= strikeAnimEnd(lightningData)').length - 1 === 2 &&
  displayShader.includes('iterNum >= strikeAnimEnd(strikeData)'),
  'expected the two slot loops plus the rod tip glow to use strikeAnimEnd');
check('strikeAnimEnd reads the same curve the display does',
  /strike\.xy \* 2\.737250/.test(common) && /2\.737250/.test(displayShader) &&
  /map_range\(random2d\(strike\.xy\), 0\., 1\., 1\.5, 3\.0\)/.test(common) &&
  /1\.5, 3\.0/.test(displayShader),
  'the flicker period and count have to come from the same two hashes of the strike position');
check('a strike is dropped only when every slot is busy',
  /if \(!lightningSlotFree\)/.test(precipitationVert) ||
  /lightningSlotFree &&/.test(precipitationVert),
  'the spawn has to test the slot state, not a timer');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
