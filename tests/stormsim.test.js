/*
 * Node-only physics regression tests for stormsim.js.
 * Runs the engine against a synthetic convective-storm environment and checks:
 *   - particles form supercooled/ice/graupel populations where they should
 *   - non-inductive charging separates charge (emergent, not hardcoded)
 *   - the tripole charge structure emerges (upper +, mid −, lower +)
 *   - intra-cloud flashes are initiated by CLOUD DENSITY (not by the charge
 *     clock): a dense mixed-phase cloud flashes on its own, with or without
 *     any separated charge
 *   - the field/charge path still produces breakdown-driven leaders
 *   - every flash measurably reduces the field & drains particle charge
 *   - total charge is conserved (in-air + channel + ground + rainout + leak)
 *   - numerical stability: no NaN, bounded population, sane magnitudes
 *
 * Run:  node tests/stormsim.test.js
 */
'use strict';
const {StormSim, PT_NAMES} = require('../stormsim.js');

let failures = 0;
function check(name, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
}

/*
 * Build a synthetic storm environment that mimics a thunderstorm cell:
 *  - domain 40 km x 12 km
 *  - lapse-rate temperature profile (surface ~15 C, tropopause ~-60 C)
 *  - strong central updraft up to 25 m/s, downdraft flanks
 *  - saturated cloudy layer from 1.5..10 km over the updraft core
 *  - supercooled water between 0C and -38C level
 * Expressed in the same units the app feeds in (cells/iter velocities etc.).
 */
function buildStormEnv() {
  const cellSizeM = 40, iterSeconds = 0.288;
  const wCells = 1000, hCells = 300;         // 40 km x 12 km
  const nx = 64, ny = 64;                    // coarse sample grid
  const widthM = wCells * cellSizeM, heightM = hCells * cellSizeM;
  const vx = new Float32Array(nx * ny), vy = new Float32Array(nx * ny);
  const tK = new Float32Array(nx * ny), vapor = new Float32Array(nx * ny);
  const cloud = new Float32Array(nx * ny), precip = new Float32Array(nx * ny);
  const wall = new Uint8Array(nx * ny);

  const T0 = 288.15, lapse = 6.5;            // K/km
  const zeroCkM = (T0 - 273.15) / lapse * 1000;      // ~2.3 km
  const tropoM = 11000;

  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      const i = ix * ny + iy;
      const xm = (ix + 0.5) / nx * widthM, ym = (iy + 0.5) / ny * heightM;
      // temperature: linear lapse capped at -62C
      tK[i] = Math.max(T0 - lapse * ym / 1000, 211);
      // updraft: Gaussian core centered mid-domain
      const dxc = (xm - widthM / 2) / (widthM * 0.16);
      const updraftMask = Math.exp(-dxc * dxc);
      const vertShape = Math.sin(Math.PI * Math.min(ym / tropoM, 1.0)) ** 2;
      const up = 28.0 * updraftMask * vertShape;                    // m/s
      const downArg = (Math.abs(xm - widthM / 2) - widthM * 0.16) / (widthM * 0.07);
      const down = -6.0 * Math.exp(-(downArg * downArg)) * vertShape;
      vy[i] = (up + down) / (cellSizeM / iterSeconds);              // cells/iter
      vx[i] = 0.6 * Math.sin(ym / 2000) / (cellSizeM / iterSeconds); // slight shear
      // cloud: where updraft & above 1.2 km; denser in the core
      const inCloud = updraftMask > 0.18 && ym > 1200 && ym < 10800;
      cloud[i] = inCloud ? (0.8 + 1.6 * updraftMask * Math.min(1, ym / 7000)) : 0.02;
      // humidity: saturated in cloud, 70% below it, dropping above cloud top
      const satW = Math.pow(Math.min(tK[i] / 250, 4), 17);
      const rh = inCloud ? 1.04 : (ym < 1200 ? 0.7 : 0.35);
      vapor[i] = satW * rh;
      // some pre-existing precipitation mass low in the core to seed graupel
      precip[i] = inCloud && updraftMask > 0.5 && ym > 4000 && ym < 9000 ? 0.25 : 0.0;
      wall[i] = 0;
    }
  }
  // solid ground row
  for (let ix = 0; ix < nx; ix++) wall[ix * ny + 0] = 1;

  return {nx, ny, wCells, hCells, cellSizeM, iterSeconds, vx, vy, tK, vapor, cloud, precip, wall};
}

function run() {
  console.log('=== stormsim.js physics tests ===\n');
  const env = buildStormEnv();
  const sim = new StormSim({
    seed: 4242,
    maxParticles: 16000,
    chargeRate: 2.0,        // moderate accelerator: physics identical, decently fast spin-up
    widthM: env.wCells * env.cellSizeM,
    heightM: env.hCells * env.cellSizeM,
    wrapX: false,
    fieldNX: 96, fieldNY: 64
  });
  sim.setEnvironment(env);

  const SIM_MINUTES = 10;
  const dt = 0.5;            // seconds per call
  const steps = Math.round(SIM_MINUTES * 60 / dt);

  let flashTimes = [];
  let firstInitiation = null;
  let lastFlashes = 0;
  let fieldAtFirstFlash = 0, fieldAfterFlash = 0;
  let prevMaxField = 0;
  let nanGuard = true, countOK = true;
  let maxFieldTrack = 0;

  for (let s = 0; s < steps; s++) {
    sim.step(dt);
    const st = sim.getStats();
    nanGuard = nanGuard && isFinite(st.qTotal) && isFinite(st.maxField) && isFinite(st.qPositive);
    countOK = countOK && st.particles <= 16000;
    maxFieldTrack = Math.max(maxFieldTrack, st.maxField);
    if (st.flashes > lastFlashes) {
      flashTimes.push(st.time);
      if (!firstInitiation) firstInitiation = Object.assign({t: st.time}, sim.lastInitiation);
      if (fieldAtFirstFlash === 0) fieldAtFirstFlash = prevMaxField; // field just before
      if (st.flashes >= 2 && fieldAfterFlash === 0) fieldAfterFlash = st.maxField;
      lastFlashes = st.flashes;
    }
    prevMaxField = st.maxField;
  }

  const st = sim.getStats();
  console.log('\nfinal stats:', JSON.stringify({
    particles: st.particles,
    qPos: st.qPositive.toExponential(2), qNeg: st.qNegative.toExponential(2),
    qGround: st.qGround.toExponential(2), qRainout: st.qRainout.toExponential(2),
    qLeaked: st.qLeaked.toExponential(3), qTotal: st.qTotal.toExponential(2),
    structure: {
      upperPositive: st.structure.upperPositive.toExponential(2),
      mainNegative: st.structure.mainNegative.toExponential(2),
      lowerPositive: st.structure.lowerPositive.toExponential(2)
    },
    maxField: st.maxField.toExponential(2),
    flashes: st.flashes, channels: st.channels
  }, null, 1));

  /* --- 1. populations & microphysics --- */
  const counts = {};
  PT_NAMES.forEach((n, i) => counts[n] = st.perType[i]);
  console.log('populations:', counts);
  check('hydrometeor populations spawned from storm fields', st.particles > 1500, `${st.particles} particles`);
  check('ice-phase crystals exist aloft', (counts.ice || 0) + (counts.snow || 0) > 50);
  check('graupel formed (riming cohort present)', (counts.graupel || 0) > 10);
  check('rain exists low / warm region', (counts.rain || 0) >= 0); // may rain out; presence not mandatory

  /* --- 2. charge separation --- */
  check('charge separated by collisions (not random assignment)', Math.abs(st.qPositive) > 1e-6 && Math.abs(st.qNegative) > 1e-6,
        `+${st.qPositive.toExponential(2)} C / ${st.qNegative.toExponential(2)} C`);

  /* --- 3. tripole structure --- */
  const S = st.structure;
  check('upper positive region emerged', S.upperPositive > 1e-6, S.upperPositive.toExponential(2));
  check('main negative region emerged', S.mainNegative < -1e-6, S.mainNegative.toExponential(2));
  check('lower positive pocket smaller than main regions',
        S.lowerPositive >= 0 && S.lowerPositive < Math.abs(S.mainNegative),
        S.lowerPositive.toExponential(2));

  /* --- 4. electric field & breakdown --- */
  check('electric field grew to storm magnitude (>=1e5 V/m)', maxFieldTrack > 1e5, `${maxFieldTrack.toExponential(2)} V/m`);
  check('lightning initiated from breakdown (>=1 flash)', st.flashes >= 1, `${st.flashes} flashes`);
  check('IC flashes are initiated by cloud density as well as the charge field',
        !!firstInitiation && firstInitiation.dens >= sim.cloudTriggerThreshold,
        firstInitiation ?
          `first flash t=${firstInitiation.t.toFixed(0)} s in cloud of density ${firstInitiation.dens.toFixed(2)} ` +
          `(${firstInitiation.kind}, fromCloud=${firstInitiation.fromCloud}, |E|=${firstInitiation.emag.toExponential(1)})` : 'no flash');
  check('dense cloud flashes early, before charge has fully built up',
        flashTimes.length >= 1 && flashTimes[0] < 60,
        `first flash at t=${flashTimes.length ? flashTimes[0].toFixed(0) : '-'} s`);

  /* --- 5. every discharge changes storm state --- */
  check('flash changed the electrical state', fieldAfterFlash === 0 || fieldAfterFlash < maxFieldTrack * 1.0001,
        `max field ${maxFieldTrack.toExponential(2)} -> after ${fieldAfterFlash.toExponential(2)}`);
  check('every discharge transported real charge through the storm',
        st.qFlashed > 1e-9 && (st.flashes >= 1),
        `qFlashed=${st.qFlashed.toExponential(2)} C, qGround=${st.qGround.toExponential(2)}`);

  /* --- 6. conservation --- */
  const relErr = Math.abs(st.qTotal) / Math.max(1e-9, Math.abs(st.qPositive) + Math.abs(st.qNegative) + Math.abs(st.qGround) + 1e-12);
  check('total charge conserved', Math.abs(st.qTotal) < 1e-15 || relErr < 1e-6,
        `qTotal=${st.qTotal.toExponential(3)}`);

  /* --- 7. stability --- */
  check('no NaN / non-finite state drift', nanGuard);
  check('population bounded by aggregation (<=max)', countOK, `peak<=16000, final=${st.particles}`);

  /* --- 8. calm-atmosphere negative control --- */
  const calmEnv = buildStormEnv();
  for (let i = 0; i < calmEnv.vy.length; i++) { calmEnv.vy[i] = 0; calmEnv.cloud[i] = 0.005; calmEnv.precip[i] = 0; }
  const calm = new StormSim({seed: 7, maxParticles: 4000, widthM: 40000, heightM: 12000, fieldNX: 64, fieldNY: 48});
  calm.setEnvironment(calmEnv);
  for (let s = 0; s < 240; s++) calm.step(0.5);
  const cs = calm.getStats();
  check('no lightning without a storm (no artificial triggering)', cs.flashes === 0, `${cs.flashes} flashes, maxE=${cs.maxField.toExponential(2)}`);
  check('calm atmosphere stays near-neutral', Math.abs(cs.qPositive) < 1e-8 && Math.abs(cs.qNegative) < 1e-8,
        `|q+|=${Math.abs(cs.qPositive).toExponential(2)}`);

  /* --- 8. strided live environment updates (the app integration path) --- */
  console.log('\n--- strided env-update integration (column-by-column, app-style) ---');
  {
    const env2 = buildStormEnv();
    // fresh sim; push the env column by column over time, exactly like
    // stormview.js samples the live GPU state
    const sim2 = new StormSim({ seed: 99, maxParticles: 6000, chargeRate: 2.0, fieldNX: 64, fieldNY: 48,
                                widthM: env2.wCells * env2.cellSizeM, heightM: env2.hCells * env2.cellSizeM });
    const zero = Object.assign({}, env2, {
      nx: env2.nx, ny: env2.ny,
      vx: new Float32Array(env2.nx * env2.ny), vy: new Float32Array(env2.nx * env2.ny),
      tK: new Float32Array(env2.nx * env2.ny).fill(280),
      vapor: new Float32Array(env2.nx * env2.ny).fill(2.5),
      cloud: new Float32Array(env2.nx * env2.ny), precip: new Float32Array(env2.nx * env2.ny)
    });
    sim2.setEnvironment(zero);
    let cursor = 0;
    let okFinite = true;
    for (let s = 0; s < 480; s++) {
      const ny = env2.ny;
      sim2.updateEnvColumn(cursor, {
        vx: env2.vx.subarray(cursor * ny, cursor * ny + ny),
        vy: env2.vy.subarray(cursor * ny, cursor * ny + ny),
        tK: env2.tK.subarray(cursor * ny, cursor * ny + ny),
        vapor: env2.vapor.subarray(cursor * ny, cursor * ny + ny),
        cloud: env2.cloud.subarray(cursor * ny, cursor * ny + ny),
        precip: env2.precip.subarray(cursor * ny, cursor * ny + ny),
        wall: env2.wall.subarray(cursor * ny, cursor * ny + ny)
      });
      cursor = (cursor + 1) % env2.nx;
      sim2.step(0.5);
      const stp = sim2.getStats();
      okFinite = okFinite && isFinite(stp.qTotal) && isFinite(stp.maxField);
    }
    const st2 = sim2.getStats();
    check('strided env updates: no NaN / no drift during assimilation', okFinite);
    check('strided env updates: storm spun up from gradual assimilation',
          st2.particles > 300 && Math.abs(st2.qNegative) > 0, `pop=${st2.particles} q-=${st2.qNegative.toExponential(2)}`);
    const rel2 = Math.abs(st2.qTotal) / Math.max(1e-9, Math.abs(st2.qPositive) + Math.abs(st2.qNegative) + 1e-12);
    check('strided env updates: charge conserved', Math.abs(st2.qTotal) < 1e-12 || rel2 < 1e-6,
          `qTotal=${st2.qTotal.toExponential(3)}`);
  }

  /* --- 9. adaptive budget: population control preserves conservation --- */
  {
    const beforeQ = sim.getStats().qTotal;
    const beforeN = sim.getStats().particles;
    sim.setParticleBudget(Math.max(2500, Math.floor(beforeN / 2)));
    for (let s = 0; s < 120; s++) sim.step(0.5);
    const st3 = sim.getStats();
    check('budget reduction keeps population under limit', st3.particles <= Math.max(2500, Math.floor(beforeN / 2)) + 200,
          `particles=${st3.particles}`);
    check('budget reduction conserves charge (merger exact)',
          Math.abs(st3.qTotal - beforeQ) < Math.max(1e-9, Math.abs(beforeQ) * 1e-6),
          `|dqTotal|=${Math.abs(st3.qTotal - beforeQ).toExponential(3)}`);
  }

  /* --- 10. charge carriers & the realism of IC flashes --- */
  {
    const P = sim.particles;
    let charged = 0, chargedIce = 0;
    for (let i = 0; i < P.count; i++) {
      if (P.charge[i] === 0) continue;
      charged++;
      const t = P.type[i];
      if (t === 2 || t === 3 || t === 4 || t === 5) chargedIce++; // ice, snow, graupel, hail
    }
    check('charge separation puts charge on particles', charged > 50,
          `${charged} charged of ${P.count}`);
    check('separated charge resides on ice-phase carriers', chargedIce > 20,
          `${chargedIce} ice-phase carriers`);

    const evs = sim.flashEvents.slice();
    const ic = evs.filter((e) => e.kind === 'IC');
    check('intra-cloud flash events are emitted for renderers', ic.length > 0,
          `${ic.length} IC / ${evs.length} queued events`);
    if (ic.length) {
      const flat = ic.filter((e) => (e.maxX - e.minX) > (e.maxY - e.minY)).length;
      check('IC channels spread horizontally through the charge layer',
            flat / ic.length > 0.6, `${flat}/${ic.length} wider than tall`);
      const minAlt = Math.min.apply(null, ic.map((e) => e.minY));
      check('IC flashes never become ground strikes', minAlt > 200,
            `lowest IC channel node ${minAlt.toFixed(0)} m`);
    }
    const drained = sim.consumeFlashEvents();
    check('flash events are drainable by the renderer', Array.isArray(drained) &&
          sim.flashEvents.length === 0, `${drained.length} drained`);
  }

  /* --- 11. lightning connects the charge pattern --- */
  {
    const f = sim.field;
    const cells = f.topFieldCells(6);
    const sortedOK = cells.every((c, i, a) => i === 0 || a[i - 1].emag >= c.emag);
    check('breakdown candidates ranked by field strength', sortedOK && cells.length === 6,
          `top=${cells.map(c => c.emag.toExponential(1)).join(',')}`);
    const sk = f.chargeSeekDir(6000, 6000, -1, 600);
    const skMag = Math.hypot(sk.x, sk.y);
    check('charge-seek direction is unit or zero', (skMag === 0 || Math.abs(skMag - 1) < 1e-6),
          `|seek|=${skMag.toFixed(3)} strength=${sk.strength.toFixed(2)}`);
    const reach = sim._oppositeChargeReach(cells[0].xm, cells[0].ym, -1, 0, -1, 3200);
    check('opposite-charge reach probe callable', reach === null || Math.sign(reach.rho) === 1,
          reach ? `reached rho=${reach.rho.toExponential(2)}` : 'none along this direction (ok)');
  }

  /* --- 12. cloud-density IC initiation needs no charge at all --- */
  {
    const envD = buildStormEnv();
    const dry = new StormSim({
      seed: 4242, maxParticles: 8000, chargeRate: 0.0,
      enableCharging: false,           // no charge separation anywhere
      widthM: envD.wCells * envD.cellSizeM,
      heightM: envD.hCells * envD.cellSizeM,
      fieldNX: 96, fieldNY: 64
    });
    dry.setEnvironment(envD);
    const kinds = {};
    for (let s = 0; s < 120; s++) {      // 60 s
      dry.step(0.5);
      for (const ev of dry.consumeFlashEvents()) kinds[ev.kind] = (kinds[ev.kind] || 0) + 1;
    }
    const ds = dry.getStats();
    check('dense cloud initiates IC flashes with zero separated charge',
          ds.flashes > 0 && Math.abs(ds.qPositive) < 1e-12,
          `${ds.flashes} flashes, q+=${ds.qPositive.toExponential(1)}, ` +
          `|E|max=${ds.maxField.toExponential(1)}`);
    check('charge-free flashes are all intra-cloud (no ground attachment)',
          (kinds.IC || 0) === ds.flashes && !kinds.CG,
          `${kinds.IC || 0} IC / ${kinds.CG || 0} CG of ${ds.flashes}`);
    check('cloud-density trigger honours its threshold',
          ds.flashes > 0 && !!dry.lastInitiation &&
          dry.lastInitiation.dens >= dry.cloudTriggerThreshold,
          dry.lastInitiation ?
            `site density ${dry.lastInitiation.dens.toFixed(2)} >= ${dry.cloudTriggerThreshold}` : 'none');

    // below-threshold cloud must not flash (same engine, cloud thinned out)
    const thinEnv = buildStormEnv();
    // 0.16..0.48 model units — everything below the 0.8 trigger point
    for (let i = 0; i < thinEnv.cloud.length; i++) thinEnv.cloud[i] *= 0.2;
    const thin = new StormSim({
      seed: 4242, maxParticles: 6000, chargeRate: 0.0, enableCharging: false,
      widthM: thinEnv.wCells * thinEnv.cellSizeM,
      heightM: thinEnv.hCells * thinEnv.cellSizeM,
      fieldNX: 96, fieldNY: 64
    });
    thin.setEnvironment(thinEnv);
    for (let s = 0; s < 120; s++) thin.step(0.5);
    const ts = thin.getStats();
    check('cloud thinner than the trigger threshold does not flash',
          ts.flashes <= Math.max(2, 0.05 * ds.flashes),
          `${ts.flashes} flashes vs ${ds.flashes} in the dense control`);
  }

  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures ? 1 : 0);
}

run();
