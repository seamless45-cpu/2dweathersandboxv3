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
//      flash", and it is the reason the leader stage is only kept for
//      cloud-to-ground strokes.
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
  // An intra-cloud flash has no leader stage, so its curve starts one unit in and
  // its light is over one unit earlier (see the IC pass in the display shader).
  const leader = strike.intensity > LIGHTNING_IC_MAX_INTENSITY ? 1.0 : 0.0;
  return start + 5.0 * (leader + repeatPeriod * numFlashes + 2.924);
}

// The light a strike puts out in a given iteration, exactly as the display
// shader samples the curve: an IC flash skips the leader unit.
function lightOf(strike, iter) {
  const time = calcLightningTime(strike.start, iter) +
               (strike.intensity > LIGHTNING_IC_MAX_INTENSITY ? 0.0 : 1.0);
  return lightningIntensityOverTime(time, [ strike.x, strike.y ], strike.intensity);
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
    sample.push({ x : (i * 0.137) % 1, y : (i * 0.311) % 1, start : 100, intensity : 0.9 });

  const peakOf = (strike) => {
    let peak = 0;
    for (let iter = strike.start; iter <= strike.start + 40; iter++)
      peak = Math.max(peak, lightOf(strike, iter));
    return peak;
  };

  let worstFirstFraction = 1;
  for (const strike of sample) {
    const peak = strikeAnimEnd(strike) && peakOf(strike);
    worstFirstFraction = Math.min(worstFirstFraction, peak > 0 ? lightOf(strike, strike.start) / peak : 1);
  }
  check('an intra-cloud flash is at full brightness in the iteration it is booked',
    worstFirstFraction > 0.99,
    'the dimmest first iteration of ' + sample.length + ' flashes is ' +
    (worstFirstFraction * 100).toFixed(1) + '% of that flash\'s peak');

  // ... and the cloud-to-ground leader, which is wanted, is over in one iteration
  // instead of five.
  const speed = Number((displayShader.match(/leaderRevealSpeed\s*=\s*([\d.]+)/) || [])[1]);
  check('a cloud-to-ground leader runs down its whole channel within one iteration',
    speed >= 5.0 && 1.0 / speed <= 0.2,
    'leaderRevealSpeed ' + speed + ' -> the channel is complete at lightningTime ' +
    (1.0 / speed).toFixed(2) + ' = iteration +' + (5 * (1.0 / speed)).toFixed(1));

  check('the intra-cloud pass starts the curve one unit in, matching strikeAnimEnd',
    /lightningIntensityOverTime\(lightningTime \+ 1\.0, lightningPos/.test(displayShader),
    'the IC pass has to skip the leader unit the slot manager no longer books for it');
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
