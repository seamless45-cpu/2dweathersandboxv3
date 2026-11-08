/*
 * stormsim.js — Physically based atmospheric microphysics, electrical charge
 * separation and lightning simulation core.
 *
 * This module is a self-contained, DOM-free physics engine. The weather
 * sandbox app (app.js / stormview.js) feeds it a low-resolution copy of the
 * GPU fluid-simulation state (wind, temperature, humidity, cloud water,
 * surfaces) through StormSim.setEnvironment(); for testing, synthetic
 * environments can be injected instead (see tests/stormsim.test.js).
 *
 * What is simulated, in coupled layers:
 *
 *   1. Hydrometeor super-particles. Seven populations: cloud droplets,
 *      supercooled droplets, ice crystals, snow, graupel, hailstones and rain
 *      drops. Each super-particle carries position, velocity, single-particle
 *      size/mass, temperature offset, phase (implied by type), electrical
 *      charge and a multiplicity (how many real particles it represents).
 *      The multiplicity is the *only* aggregation optimisation and preserves
 *      population statistics; all charge/mass accounting is exact.
 *
 *   2. Microphysics. Condensation, evaporation, deposition, sublimation,
 *      freezing, melting, collision-coalescence/accretion, riming,
 *      aggregation, ice-crystal growth, graupel and hail growth, rain
 *      formation and precipitation fallout — all driven by the local
 *      temperature, pressure, relative humidity and supercooled liquid water
 *      content of the host atmosphere.
 *
 *   3. Dynamics. Gravity, terminal fall speeds per hydrometeor type,
 *      aerodynamic drag relaxation to the local wind, buoyant transport by
 *      the fluid simulation's up/downdrafts, sub-grid turbulence from local
 *      shear and ground deposition.
 *
 *   4. Charge separation. Non-inductive charging during rebounding
 *      graupel–ice collisions in the presence of supercooled liquid water
 *      (sign reversal with temperature / liquid water content after
 *      Takahashi / Saunders), plus a weaker inductive contribution for rain
 *      drops in strong pre-existing fields. Charge is carried by the
 *      particles, so sedimentation and differential transport build the
 *      observed tripole storm structure (upper positive, main negative,
 *      lower positive) without any hardcoded regions. Both signs are tracked
 *      individually; total charge is conserved exactly (boundary transfers
 *      are accounted in a ledger).
 *
 *   5. Electric field. Charge is splatted to a coarse potential grid;
 *      electrostatic potential Φ is solved from Poisson's equation
 *      (∇²Φ = −ρ/ε₀) with SOR relaxation, a conducting ground boundary,
 *      insulating side boundaries and a fair-weather field boundary at the
 *      top of the domain. E = −∇Φ.
 *
 *   6. Lightning. When |E| exceeds the (altitude/pressure/humidity-corrected)
 *      breakdown field anywhere, a bidirectional leader is initiated there
 *      (and only there). Leader tips advance through the *actual* electric
 *      field with stochastic dielectric-breakdown-style branching, carrying
 *      and depleting real charge. Connecting to ground (CG, either polarity),
 *      to a region of opposite charge (IC), to cloud edge (CA) or bridging
 *      cells (CC within the 2D column) triggers the return-stroke phase:
 *      channel luminosity pulses, continuing current, dart/re-return strokes
 *      and channel afterglow. Every flash changes the electrical state:
 *      moved charge is drained from the local particle population and either
 *      conducted to the ground reservoir (CG) or redistributed in-cloud (IC),
 *      and the potential is re-solved afterwards.
 *
 * Everything is in SI units (m, s, kg, C, V) internally. The public API is:
 *
 *   const sim = new StormSim(options);
 *   sim.setEnvironment(env);        // see docstring below
 *   sim.step(dtSeconds);            // advance physics
 *   sim.getStats();                 // diagnostics (charge ledger, extrema)
 *   sim.getParticles();             // typed-array views for rendering
 *   sim.getChannels();              // lightning segments + brightness
 *   sim.getFieldTextures();         // rho / phi / |E| grids for rendering
 *
 * The engine never allocates per step after warmup (typed-array pools),
 * uses spatial partitioning for all particle interactions, adaptive
 * sub-stepping and population adaptive merging for stability and speed.
 */
'use strict';

/* ============================= constants ============================= */

/** Particle populations. */
const PT_CLOUD = 0;       // warm cloud water droplets
const PT_SUPER = 1;       // supercooled liquid droplets
const PT_ICE = 2;         // pristine ice crystals
const PT_SNOW = 3;        // snow (aggregates)
const PT_GRAUPEL = 4;     // graupel (rimed particles)
const PT_HAIL = 5;        // hailstones
const PT_RAIN = 6;        // rain drops
const PT_NAMES = ['cloud', 'supercooled', 'ice', 'snow', 'graupel', 'hail', 'rain'];
const PT_COUNT = 7;

const GRAVITY = 9.81;          // m/s^2
const BOLTZ_K = 1.380649e-23;  // J/K
const R_DRY = 287.05;          // J/(kg K)
const EPSILON_0 = 8.8541878e-12;  // F/m — atmospheric dielectric ~ vacuum
const T_MELT = 273.15;         // K
const T_HOMOG_FREEZE = 233.15; // K — homogeneous freezing of liquid water
const AIR_VISCOSITY = 1.8e-5;  // kg/(m s)
const RHO_WATER = 1000.0;      // kg/m^3
const RHO_ICE = 917.0;         // kg/m^3
const RHO_GRAUPEL = 400.0;     // kg/m^3 (porous rimed ice)
const RHO_HAIL = 900.0;        // kg/m^3
const RHO_SNOW = 100.0;        // kg/m^3
const SURFACE_PRESSURE = 1013.25;   // hPa
const FAIR_WEATHER_E = 130.0;       // V/m, downward fair-weather field

/* Saturation vapor density over water, consistent with the host fluid
 * model's maxWater() (grams per m^3). T in Kelvin. */
function satVaporDensityWater(T_K) {
  return Math.pow(Math.min(Math.max(T_K / 250.0, 0.0), 4.0), 17.0);
}
/* Over ice: Murphy & Koop (2005) form, also grams per m^3 at storm scales. */
function satVaporDensityIce(T_K) {
  const Tc = T_K - T_MELT;
  const es_hPa = 6.1115 * Math.exp((22.452 * Tc) / (272.55 + Tc)); // sublimation
  return Math.max(es_hPa * 100.0 / (R_DRY * T_K) * 1000.0, 1e-9);  // -> g/m^3
}

/* ============================ small helper =========================== */

/** Deterministic RNG (mulberry32) so tests are reproducible. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampNum = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);

/* ========================= environment grid ========================== */
/**
 * The environment is a coarse rectilinear copy of the fluid simulation:
 * rect (0,0)-(wCells,hCells) in sim-cell units; nx*ny sampled texels;
 * lower-left origin, row-major (y fastest) arrays:
 *   vx, vy  : wind, sim-cells per sim-iteration (converted inside)
 *   tK      : REAL temperature in Kelvin
 *   vapor   : total water (vapor + cloud), model units (g/m^3 scale)
 *   cloud   : cloud liquid water, model units
 *   precip  : precipitation mass, model units
 *   wall    : Uint8, 1 = solid ground cell
 * Fluid-model water units (g/m^3) are adopted directly as mixing densities.
 */
class EnvGrid {
  constructor() {
    this.nx = 0; this.ny = 0; this.wCells = 1; this.hCells = 1;
    this.cellSizeM = 40.0;     // edge length of one sim cell in meters
    this.iterSeconds = 0.288;  // sim seconds per fluid iteration
    this.vx = null; this.vy = null; this.tK = null;
    this.vapor = null; this.cloud = null; this.precip = null; this.wall = null;
    this.groundY = null;       // per column: first solid cell index in env coords
    this._turb = null;
    this.valid = false;
  }

  set(o) {
    this.nx = o.nx; this.ny = o.ny;
    this.wCells = o.wCells; this.hCells = o.hCells;
    this.cellSizeM = o.cellSizeM;
    this.iterSeconds = o.iterSeconds;
    this.vx = o.vx; this.vy = o.vy; this.tK = o.tK;
    this.vapor = o.vapor; this.cloud = o.cloud; this.precip = o.precip;
    this.wall = o.wall;
    // per-column ground line (index of first solid cell from bottom)
    const g = new Float32Array(this.nx);
    for (let ix = 0; ix < this.nx; ix++) {
      let y = 0;
      for (; y < this.ny; y++) {
        if (this.wall[ix * this.ny + y]) break;
      }
      g[ix] = y; // all-air column -> ny
    }
    this.groundY = g;
    // turbulence diagnostic: |d vy/dx| + |d vx/dy| shear magnitude
    const t = new Float32Array(this.nx * this.ny);
    for (let ix = 0; ix < this.nx; ix++) {
      for (let iy = 0; iy < this.ny; iy++) {
        const i = ix * this.ny + iy;
        const ixp = ix < this.nx - 1 ? i + this.ny : i;
        const iyp = iy < this.ny - 1 ? i + 1 : i;
        t[i] = Math.abs(this.vy[ixp] - this.vy[i]) + Math.abs(this.vx[iyp] - this.vx[i]);
      }
    }
    this._turb = t;
    this.valid = true;
  }

  /** Bilinear sample. xCell/yCell in sim-cell units. Writes fields to `out`. */
  sample(xCell, yCell, out, wrap) {
    let fx = (xCell / this.wCells) * this.nx - 0.5;
    let fy = (yCell / this.hCells) * this.ny - 0.5;
    if (wrap) fx = ((fx % this.nx) + this.nx) % this.nx;
    fx = clampNum(fx, 0, this.nx - 1.001);
    fy = clampNum(fy, 0, this.ny - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const x1 = Math.min(x0 + 1, this.nx - 1), y1 = Math.min(y0 + 1, this.ny - 1);
    const i00 = x0 * this.ny + y0, i10 = x1 * this.ny + y0;
    const i01 = x0 * this.ny + y1, i11 = x1 * this.ny + y1;
    const L = (a) => (a[i00] * (1 - tx) + a[i10] * tx) * (1 - ty) + (a[i01] * (1 - tx) + a[i11] * tx) * ty;
    const cellPerSec = this.cellSizeM / this.iterSeconds; // cells/iter -> m/s
    out.vx = L(this.vx) * cellPerSec;
    out.vy = L(this.vy) * cellPerSec;
    out.tK = L(this.tK);
    out.vapor = Math.max(L(this.vapor), 0.0);   // g/m^3 proxy
    out.cloud = Math.max(L(this.cloud), 0.0);
    out.precip = Math.max(L(this.precip), 0.0);
    out.turb = L(this._turb) * cellPerSec;
    out.wall = yCell < this.groundAt(xCell, wrap);
    return out;
  }

  groundAt(xCell, wrap) {
    let fx = (xCell / this.wCells) * this.nx - 0.5;
    if (wrap) fx = ((fx % this.nx) + this.nx) % this.nx;
    const ix = clampNum(Math.round(fx), 0, this.nx - 1);
    return (this.groundY[ix] / this.ny) * this.hCells;
  }

  /** Altitude in meters at sim-cell y. */
  altitudeM(yCell) { return (yCell / this.hCells) * this.cellSizeM * this.hCells; }
}

/* ======================= electrical potential grid =================== */
/**
 * Poisson solver for the domain: ∇²Φ = −ρ/ε₀, E = −∇Φ.
 * Boundary conditions:
 *   ground (j=0)     : Φ = 0 (conducting earth)
 *   top    (j=ny-1)  : Φ = FAIR_WEATHER_E * height  (fair-weather field)
 *   sides            : ∂Φ/∂x = 0 (insulating), unless `wrapX`
 * Solved by SOR relaxation on a grid independent from the sim resolution.
 */
class FieldSolver {
  constructor(nx, ny, widthM, heightM, wrapX, rng) {
    this.wrapX = wrapX;
    this.rng = rng || Math.random;
    this.resize(nx, ny, widthM, heightM);
  }

  resize(nx, ny, widthM, heightM) {
    this.nx = nx; this.ny = ny;
    this.dx = widthM / nx; this.dy = heightM / ny;
    const n = nx * ny;
    this.rho = new Float64Array(n);   // C / m^3
    this.phi = new Float64Array(n);   // V
    this.ex = new Float32Array(n);    // V/m
    this.ey = new Float32Array(n);
    this.emag = new Float32Array(n);
    this.groundRow = new Int32Array(nx); // first solid row per column (field cells)
    this.initPotential();
  }

  /** Reset charge density and per-column ground line (env cell units). */
  beginAccumulate(envGrid) {
    this.rho.fill(0.0);
    for (let ix = 0; ix < this.nx; ix++) {
      const xCell = ((ix + 0.5) / this.nx) * envGrid.wCells;
      const gCells = envGrid.groundAt(xCell, envGrid.wrapX || false);
      this.groundRow[ix] = clampNum(Math.floor((gCells / envGrid.hCells) * this.ny), 0, this.ny - 1);
    }
  }

  /** CIC-splat one point charge (C) at world (xm, ym). */
  addCharge(xm, ym, q) {
    const fx = clampNum((xm / (this.nx * this.dx)) * this.nx - 0.5, 0, this.nx - 1.001);
    const fy = clampNum((ym / (this.ny * this.dy)) * this.ny - 0.5, 0, this.ny - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const vol = this.dx * this.dy * 1.0; // unit depth (2D world)
    const dV = q / vol;
    const nx = this.nx;
    const x1 = Math.min(x0 + 1, this.nx - 1), y1 = Math.min(y0 + 1, this.ny - 1);
    this.rho[x0 * nx * 0 + x0 * this.ny + y0] += dV * (1 - tx) * (1 - ty);
    this.rho[x1 * this.ny + y0] += dV * tx * (1 - ty);
    this.rho[x0 * this.ny + y1] += dV * (1 - tx) * ty;
    this.rho[x1 * this.ny + y1] += dV * tx * ty;
  }

  initPotential() {
    // start from the fair-weather solution: linear potential rise with height
    const H = this.ny * this.dy;
    for (let ix = 0; ix < this.nx; ix++)
      for (let iy = 0; iy < this.ny; iy++)
        this.phi[ix * this.ny + iy] = FAIR_WEATHER_E * ((iy + 0.5) / this.ny) * H;
  }

  /**
   * Relax toward the solution. iterations ~ 60-120 give a smooth field on
   * storm scales. Returns max update of the last sweep (convergence metric).
   */
  solve(iterations) {
    const nx = this.nx, ny = this.ny;
    const phi = this.phi, rho = this.rho;
    const dx2 = this.dx * this.dx, dy2 = this.dy * this.dy;
    const denom = 2.0 * (dx2 + dy2);
    const omega = 1.85;
    const w = this.wrapX;
    let maxDelta = 0;
    for (let it = 0; it < iterations; it++) {
      maxDelta = 0;
      for (let ix = 0; ix < nx; ix++) {
        const g = this.groundRow[ix];
        const ixl = ix > 0 ? ix - 1 : (w ? nx - 1 : ix);
        const ixr = ix < nx - 1 ? ix + 1 : (w ? 0 : ix);
        const rowBC = FAIR_WEATHER_E * ny * this.dy;
        for (let iy = 0; iy < ny; iy++) {
          const i = ix * ny + iy;
          let target;
          if (iy <= g) {
            target = 0.0;                       // conducting ground
          } else if (iy === ny - 1) {
            target = rowBC;                     // fair-weather top boundary
          } else {
            const cL = phi[ixl * ny + iy], cR = phi[ixr * ny + iy];
            const cD = iy > 0 ? phi[i - 1] : 0.0;
            const cU = phi[i + 1];
            target = ((cL + cR) * dy2 + (cD + cU) * dx2 + (rho[i] / EPSILON_0) * dx2 * dy2) / denom;
          }
          const upd = phi[i] + omega * (target - phi[i]);
          const d = Math.abs(upd - phi[i]);
          if (d > maxDelta) maxDelta = d;
          phi[i] = upd;
        }
      }
    }
    // E = -grad(phi)
    for (let ix = 0; ix < nx; ix++) {
      const ixl = ix > 0 ? ix - 1 : (w ? nx - 1 : ix);
      const ixr = ix < nx - 1 ? ix + 1 : (w ? 0 : ix);
      for (let iy = 0; iy < ny; iy++) {
        const i = ix * ny + iy;
        const cL = phi[ixl * ny + iy], cR = phi[ixr * ny + iy];
        const yd = iy > 0 ? phi[i - 1] : 0.0;
        const yu = iy < ny - 1 ? phi[i + 1] : phi[i] + this.dy * FAIR_WEATHER_E;
        const ex = -(cR - cL) / (2 * this.dx);
        const ey = -(yu - yd) / (2 * this.dy);
        this.ex[i] = ex; this.ey[i] = ey;
        this.emag[i] = Math.sqrt(ex * ex + ey * ey);
      }
    }
    return maxDelta;
  }

  /* altitude/pressure/humidity-corrected breakdown field (V/m). */
  breakdownField(ym, relHum) {
    const alt = clampNum(ym, 0, this.ny * this.dy);
    // air density ratio, scale height ~ 8.4 km
    const rhoRatio = Math.exp(-alt / 8400.0);
    const humidityFactor = 1.0 - 0.30 * clampNum(relHum, 0, 1); // wet air breaks easier
    return 2.16e6 * rhoRatio * humidityFactor;
  }

  fieldAt(xm, ym, out) {
    if (!out) out = {ex: 0, ey: 0, emag: 0};
    const fx = clampNum((xm / (this.nx * this.dx)) * this.nx - 0.5, 0, this.nx - 1.001);
    const fy = clampNum((ym / (this.ny * this.dy)) * this.ny - 0.5, 0, this.ny - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const nx = this.ny;
    const i = x0 * nx + y0;
    out.ex = this.ex[i]; out.ey = this.ey[i]; out.emag = this.emag[i];
    out.phi = this.phi[i];
    out.rho = this.rho[i];
    out.cellIx = x0; out.cellIy = y0;
    return out;
  }

  maxField() {
    let m = 0, ix = 0, iy = 0;
    for (let x = 0; x < this.nx; x++) {
      const g = this.groundRow[x];
      for (let y = g + 1; y < this.ny - 1; y++) {
        const v = this.emag[x * this.ny + y];
        if (v > m) { m = v; ix = x; iy = y; }
      }
    }
    return {emag: m, ix, iy, xm: (ix + 0.5) * this.dx, ym: (iy + 0.5) * this.dy};
  }
}

/* ============================ particle pool ========================== */

class ParticlePool {
  constructor(capacity) {
    this.capacity = 0;
    this.count = 0;
    this.x = null; this.y = null;
    this.vx = null; this.vy = null;
    this.radius = null;   // single-particle radius, m
    this.mass = null;     // single-particle mass, kg
    this.charge = null;   // TOTAL cohort charge (multiplicity included), C
    this.mult = null;     // multiplicity (represented particles)
    this.type = null;     // Uint8 PT_*
    this.age = null;      // s
    this.melt = null;     // melt fraction 0..1
    this.seed = null;     // per-particle hash seed for stochastic jitter
    this._resize(capacity);
  }

  _resize(cap) {
    cap = Math.max(64, cap | 0);
    const growFrom = this.capacity;
    const alloc = (old, Ctor) => {
      const a = new Ctor(cap);
      if (old) a.set(old.subarray(0, Math.min(old.length, cap)));
      return a;
    };
    this.x = alloc(this.x, Float32Array); this.y = alloc(this.y, Float32Array);
    this.vx = alloc(this.vx, Float32Array); this.vy = alloc(this.vy, Float32Array);
    this.radius = alloc(this.radius, Float32Array); this.mass = alloc(this.mass, Float32Array);
    this.charge = alloc(this.charge, Float64Array); // charge bookkeeping must not drift
    this.mult = alloc(this.mult, Float64Array);
    this.type = alloc(this.type, Uint8Array);
    this.age = alloc(this.age, Float32Array);
    this.melt = alloc(this.melt, Float32Array);
    this.seed = alloc(this.seed, Uint32Array);
    this.capacity = cap;
    void growFrom;
  }

  /** count check & capacity helper. */
  ensureFree() {
    if (this.count >= this.capacity) this._resize(this.capacity * 2);
  }

  /** Append particle, return index. */
  spawn(type, x, y, vx, vy, radius, mass, mult, rng) {
    this.ensureFree();
    const i = this.count++;
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.radius[i] = radius; this.mass[i] = mass;
    this.charge[i] = 0.0;
    this.mult[i] = mult;
    this.type[i] = type;
    this.age[i] = 0; this.melt[i] = 0;
    this.seed[i] = (rng() * 4294967296) >>> 0;
    return i;
  }

  /** O(1) removal via swap-with-last. */
  remove(i) {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last]; this.y[i] = this.y[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
      this.radius[i] = this.radius[last]; this.mass[i] = this.mass[last];
      this.charge[i] = this.charge[last]; this.mult[i] = this.mult[last];
      this.type[i] = this.type[last]; this.age[i] = this.age[last];
      this.melt[i] = this.melt[last]; this.seed[i] = this.seed[last];
    }
  }
}

/* ------- hydrometeor single-particle mass from radius & bulk density -- */
function particleMass(type, r) {
  const rho = type === PT_RAIN || type === PT_CLOUD || type === PT_SUPER ? RHO_WATER :
    type === PT_HAIL ? RHO_HAIL : type === PT_GRAUPEL ? RHO_GRAUPEL :
    type === PT_SNOW ? RHO_SNOW : RHO_ICE;
  return (4.0 / 3.0) * Math.PI * r * r * r * rho;
}

/** Terminal fall velocity (m/s, positive = downward) per type & radius. */
function terminalVelocity(type, r) {
  switch (type) {
  case PT_CLOUD:
  case PT_SUPER:
    // Stokes drag for cloud droplets
    return clampNum((2 / 9) * RHO_WATER * GRAVITY * r * r / AIR_VISCOSITY, 0.0005, 0.5);
  case PT_ICE:
    // Mitchell (1996)-like power law for small crystals
    return clampNum(640.0 * Math.pow(r * 1000.0, 0.8) * 0.001, 0.05, 1.4);
  case PT_SNOW:
    return clampNum(2.3 * Math.pow(r * 1000.0, 0.17), 0.3, 2.2);
  case PT_GRAUPEL:
    return clampNum(230.0 * Math.sqrt(r), 0.5, 5.0);
  case PT_HAIL:
    return clampNum(160.0 * Math.sqrt(r), 3.0, 45.0);
  case PT_RAIN:
    // Best (1950)-style raindrop fallspeed; r in m
    return clampNum(9.65 - 10.3 * Math.exp(-6000 * r), 0.5, 9.5);
  }
  return 0;
}

/* ========================== lightning channel ======================== */

class LightningChannel {
  constructor(id, kind, polarity) {
    this.id = id;
    this.kind = kind;         // 'CG' | 'IC' | 'CC' | 'CA'
    this.polarity = polarity; // -1 or +1 : sign of charge lowered to ground / source sign
    this.nodesX = [];
    this.nodesY = [];
    this.segA = [];           // segment: node index a..b
    this.segB = [];
    this.segBright = [];      // 0..1 current brightness (afterglow decays)
    this.segBirth = [];       // sim time of creation
    this.tips = [];           // active tip node indices
    this.tipSign = [];        // charge sign that tip collects
    this.chargeMoved = 0;     // C transported through the channel
    this.state = 'leader';    // leader | stroke | continuing | decay | done
    this.age = 0;
    this.strokesLeft = 0;
    this.strokeT = 0;         // time of latest return stroke
    this.strokeOrigin = 0;    // node index of return-stroke origin
    this.continuing = 0;      // continuing-current remaining time
    this.attachX = 0; this.attachY = 0;
    this.flashLevel = 0;      // global screen flash contribution
  }

  addNode(x, y) {
    this.nodesX.push(x); this.nodesY.push(y);
    return this.nodesX.length - 1;
  }
  addSegment(a, b, time) {
    this.segA.push(a); this.segB.push(b);
    this.segBright.push(0.35); // leaders are dim; strokes light them up
    this.segBirth.push(time);
  }
}

/* =============================== StormSim ============================ */

class StormSim {
  /**
   * opts: {
   *   seed, maxParticles, cellSizeM (m per sim cell), iterSeconds,
   *   chargeRate (non-inductive multiplier, 1 = reference),
   *   fieldNX/fieldNY (potential grid), wrapX,
   *   enableLightning, enableCharging (booleans)
   * }
   */
  constructor(opts) {
    opts = opts || {};
    this.rng = makeRng(opts.seed || 1337);
    this.maxParticles = opts.maxParticles || 24000;
    this.particles = new ParticlePool(Math.min(this.maxParticles, 4096));
    this.chargeRate = opts.chargeRate !== undefined ? opts.chargeRate : 1.0;
    this.enableCharging = opts.enableCharging !== false;
    this.enableLightning = opts.enableLightning !== false;
    this.env = new EnvGrid();
    this.field = new FieldSolver(opts.fieldNX || 128, opts.fieldNY || 64,
                                 opts.widthM || 40000, opts.heightM || 12000,
                                 !!opts.wrapX, this.rng);
    this.wrapX = !!opts.wrapX;
    this.time = 0;
    this.lastFieldSolve = -1;
    this.fieldSolveInterval = 0.5;     // s of sim time
    this.lastEnvRefresh = -1;
    this._envOut = {vx: 0, vy: 0, tK: 285, vapor: 0, cloud: 0, precip: 0, turb: 0, wall: false};
    this._fOut = null;

    /* Charge conservation ledger (C). */
    this.ledger = {
      inAir: 0,        // sum of particle charges
      channel: 0,      // inside active channels
      ground: 0,       // conducted to earth
      rainout: 0,      // carried to ground by precipitation (not lightning)
      leaked: 0,       // atmospheric ion leakage
      totalInjected: 0 // must stay 0 except condensation neutral births
    };

    this.channels = [];
    this.channelIdCounter = 0;
    this.flashCount = 0;
    this.chargeFlashed = 0;  // cumulative |C| transported by all completed flashes
    this.maxFieldNow = 0;

    // diagnostics about emergent charge structure (updated per field solve)
    this.structure = {upperPositive: 0, mainNegative: 0, lowerPositive: 0};

    // spatial partition grid (index lists), built per micro-step
    this._cellSize = 8;   // sim cells per partition cell
    this._gridNX = 0; this._gridNY = 0;
    this._gridHead = null; this._gridNext = null;

    // population targets: how many super-particles per fluid cell we aim for
    this._spawnDensity = 1 / 260; // one super-particle per ~260 cloudy cells
    this.extinction = null;       // optical depth field for rendering (lazy)
  }

  /* -------------------------- environment --------------------------- */

  setEnvironment(o) {
    const f = this.field;
    this.env.set(o);
    this.env.wrapX = this.wrapX;
    const widthM = o.wCells * o.cellSizeM;
    const heightM = o.hCells * o.cellSizeM;
    if (Math.abs(widthM - f.dx * f.nx) > 1 || Math.abs(heightM - f.dy * f.ny) > 1) {
      // world size changed: rebuild potential grid, keep target resolution
      const nx = clampNum(Math.round(widthM / 160), 64, 256);
      const ny = clampNum(Math.round(heightM / 90), 48, 128);
      f.resize(nx, ny, widthM, heightM);
    }
    this._gridNX = Math.max(1, Math.ceil(o.wCells / this._cellSize));
    this._gridNY = Math.max(1, Math.ceil(o.hCells / this._cellSize));
    if (!this._gridHead || this._gridHead.length < this._gridNX * this._gridNY) {
      this._gridHead = new Int32Array(this._gridNX * this._gridNY);
      this._gridNext = new Int32Array(this.particles.capacity);
    }
    this.lastEnvRefresh = this.time;
    if (this.time === 0) this.field.beginAccumulate(this.env); // ground rows valid
  }

  /* ------------------------- spatial hashing ------------------------ */

  _buildGrid() {
    const P = this.particles;
    const head = this._gridHead;
    head.fill(-1);
    if (this._gridNext.length < P.capacity) this._gridNext = new Int32Array(P.capacity);
    const next = this._gridNext;
    const gnX = this._gridNX, gnY = this._gridNY, cs = this._cellSize;
    const wC = this.env.wCells;
    for (let i = 0; i < P.count; i++) {
      let gx = Math.floor(P.x[i] / cs);
      if (this.wrapX) gx = ((gx % gnX) + gnX) % gnX; else gx = clampNum(gx, 0, gnX - 1);
      const gy = clampNum(Math.floor(P.y[i] / cs), 0, gnY - 1);
      const gi = gx * gnY + gy;
      next[i] = head[gi];
      head[gi] = i;
      void wC;
    }
  }

  /* --------------------------- microphysics ------------------------- */

  /*
   * Spawn policy: derive particle populations from the environment fields so
   * cloud/precip appear where the fluid model says they should, but all
   * subsequent growth/phase change/charging is particle-local physics.
   */
  _spawnMissing() {
    const P = this.particles;
    if (P.count >= this.maxParticles) return;
    const env = this.env;
    const budget = Math.min(240, this.maxParticles - P.count); // per step spawn cap
    let spawned = 0;
    const cellH2 = this._cellSize;
    const gnX = this._gridNX, gnY = this._gridNY;
    const cellVol = (env.cellSizeM * cellH2) * (env.cellSizeM * cellH2) * 1.0; // m^3 (unit depth)
    const out = this._envOut;
    // scatter trials across the domain
    for (let t = 0; t < 1500 && spawned < budget; t++) {
      const gx = Math.floor(this.rng() * gnX), gy = Math.floor(this.rng() * gnY);
      const cx = (gx + this.rng()) * cellH2, cy = (gy + this.rng()) * cellH2;
      env.sample(cx, cy, out, this.wrapX);
      if (out.wall) continue;
      const cloudGsm3 = out.cloud;                // g/m^3-ish
      const precip = out.precip;
      if (cloudGsm3 < 0.02 && precip < 0.02) continue;
      // local condensation supply: how much condensate this cell block holds
      const cloudMass = cloudGsm3 * 1e-3 * cellVol;   // kg of cloud water in block
      const precipMass = precip * 1e-3 * cellVol;
      if (cloudMass + precipMass <= 0) continue;

      // decide what population this block hosts
      const T = out.tK;
      let type, r, mult;
      if (this.rng() * (cloudMass + precipMass) < cloudMass) {
        // condensate origin
        if (T >= T_MELT - 1.5) { type = PT_CLOUD; r = 6e-6 + this.rng() * 8e-6; }
        else if (T > T_HOMOG_FREEZE + 2) {
          // mixed-phase zone: supercooled water + ice crystals coexist;
          // ice fraction rises with supercooling (nucleation climatology)
          const iceFrac = clampNum((262.15 - T) / 25.0, 0.05, 0.9);
          type = this.rng() < iceFrac ? PT_ICE : PT_SUPER;
          r = type === PT_ICE ? 40e-6 + this.rng() * 80e-6 : 6e-6 + this.rng() * 10e-6;
        } else { type = PT_ICE; r = 40e-6 + this.rng() * 80e-6; }
        const m = particleMass(type, r);
        // one super-particle represents at most 4% of the block condensate
        mult = Math.max(1, Math.floor((cloudMass / m) * 0.04 * this.rng()));
        if (mult <= 0) continue;
      } else {
        // precipitation origin
        if (T >= T_MELT) { type = PT_RAIN; r = 4e-4 + this.rng() * 7e-4; }
        else { type = T > T_MELT - 12 ? PT_GRAUPEL : PT_SNOW; r = 6e-4 + this.rng() * 1.2e-3; }
        const m = particleMass(type, r);
        mult = Math.max(1, Math.floor((precipMass / m) * 0.5 * this.rng()));
        if (mult <= 0) continue;
      }
      P.spawn(type, cx, cy, out.vx * 0.2, out.vy * 0.2, r, particleMass(type, r), mult, this.rng);
      spawned++;
    }
  }

  /* terminal velocity target + drag relaxation, turbulence, wrap, ground.
     Returns false if the particle left the domain / hit ground. */
  _moveParticle(i, dt) {
    const P = this.particles;
    const env = this.env, out = this._envOut;
    env.sample(P.x[i], P.y[i], out, this.wrapX);
    const vt = terminalVelocity(P.type[i], P.radius[i]);
    // drag relaxation time scale
    const tau = clampNum(0.3 * P.radius[i] * 1000.0 + 0.04, 0.05, 3.0);
    const k = Math.min(1, dt / tau);
    const targetVx = out.vx;
    const targetVy = out.vy - vt;
    P.vx[i] += (targetVx - P.vx[i]) * k;
    P.vy[i] += (targetVy - P.vy[i]) * k;
    // sub-grid turbulence from local shear
    const turb = clampNum(out.turb * 0.5, 0, 2.5);
    if (turb > 0.001) {
      const s = P.seed[i] = (P.seed[i] * 1664525 + 1013904223) >>> 0;
      const u1 = (s / 4294967296) - 0.5;
      const s2 = P.seed[i] = (P.seed[i] * 1664525 + 1013904223) >>> 0;
      const u2 = (s2 / 4294967296) - 0.5;
      P.vx[i] += u1 * turb * Math.sqrt(dt);
      P.vy[i] += u2 * turb * Math.sqrt(dt);
    }
    // velocity safety clamp
    P.vx[i] = clampNum(P.vx[i], -140, 140);
    P.vy[i] = clampNum(P.vy[i], -140, 140);
    // integrate (cell units)
    const cellPerSec = env.cellSizeM; // m per cell
    P.x[i] += (P.vx[i] * dt) / cellPerSec;
    P.y[i] += (P.vy[i] * dt) / cellPerSec;
    P.age[i] += dt;
    if (this.wrapX) {
      const w = env.wCells;
      P.x[i] = ((P.x[i] % w) + w) % w;
    } else if (P.x[i] < 0 || P.x[i] >= env.wCells) {
      return false;
    }
    // ground deposition / domain ceiling
    const gy = env.groundAt(P.x[i], this.wrapX);
    if (P.y[i] < gy) {
      if (P.type[i] === PT_RAIN) this.ledger.rainout += P.charge[i];
      else this.ledger.leaked += P.charge[i] * 0.0; // frozen deposition: keep charge on ground ledger
      if (P.type[i] !== PT_RAIN) this.ledger.ground += P.charge[i];
      this.ledger.inAir -= P.charge[i];
      return false;
    }
    if (P.y[i] >= env.hCells) {
      // leaves the model top: charge leaves domain (upper boundary)
      this.ledger.leaked += P.charge[i];
      this.ledger.inAir -= P.charge[i];
      return false;
    }
    return true;
  }

  /* Local microphysics: phase transformations & growth of one particle. */
  _microParticle(i, dt) {
    const P = this.particles;
    const out = this._envOut;
    this.env.sample(P.x[i], P.y[i], out, this.wrapX);
    const T = out.tK;
    const rho_v = out.vapor;                          // g/m^3 (model units)
    const satW = Math.max(satVaporDensityWater(T), 1e-6);
    const RHw = clampNum(rho_v / satW, 0, 1.5);         // rel hum w.r.t. water
    const satI = Math.max(satVaporDensityIce(T), 1e-6);
    const RHi = clampNum(rho_v / satI, 0, 1.7);         // w.r.t. ice
    const t = P.type[i];
    const r = P.radius[i];

    switch (t) {
    case PT_CLOUD: {
      // condensation / evaporation toward saturation equilibrium
      if (RHw > 1.0) {
        const grow = Math.min(0.35 * (RHw - 1.0), 0.2);
        this._grow(i, grow * dt);
      } else if (RHw <= 0.999) {
        this._shrink(i, Math.min(0.9 * (1.0 - RHw), 0.5) * dt);
      }
      // heterogeneous freezing below 0 C
      if (T < T_MELT - 0.5) {
        const pFreeze = clampNum((T_MELT - T) * 0.03, 0, 1) * dt * 3.0;
        if (this.rng() < pFreeze) P.type[i] = T > T_HOMOG_FREEZE ? PT_SUPER : PT_ICE;
      }
      break;
    }
    case PT_SUPER: {
      // supercooled droplets: condensation/evaporation as cloud droplets,
      // plus heterogeneous contact/immersion freezing into ice crystals
      // (important below about -11 C: keeps ice carriers in the charging zone)
      if (T < T_HOMOG_FREEZE) P.type[i] = PT_ICE;
      else if (T >= T_MELT + 0.4) P.type[i] = PT_CLOUD;
      else if (T < 262.15) {
        const pFreeze = clampNum((262.15 - T) * 0.02, 0, 0.5) * dt;
        if (this.rng() < pFreeze) P.type[i] = PT_ICE;
      }
      if (RHw > 1.0) this._grow(i, Math.min(0.35 * (RHw - 1.0), 0.2) * dt);
      else if (RHw < 0.95) this._shrink(i, 0.6 * (0.95 - RHw) * dt);
      break;
    }
    case PT_ICE: {
      // deposition / sublimation (Wegener–Bergeron–Findeisen)
      const growRate = (RHi - 1.0) * 0.30; // per second
      if (growRate > 0) this._grow(i, Math.min(growRate, 0.25) * dt);
      else if (growRate < -0.01) this._shrink(i, Math.min(-growRate, 0.4) * dt);
      // melt
      if (T >= T_MELT) this._meltStep(i, dt, T);
      // aggregate to snow when big
      if (P.radius[i] > 1.6e-4 && this.rng() < 0.1) {
        P.type[i] = PT_SNOW;
      }
      break;
    }
    case PT_SNOW: {
      if (RHi > 1.0) this._grow(i, Math.min((RHi - 1.0) * 0.2, 0.15) * dt);
      else if (RHi < 0.98) this._sublimateShrink(i, (0.98 - RHi) * 0.35 * dt);
      if (T >= T_MELT - 0.5) this._meltStep(i, dt, T);
      break;
    }
    case PT_GRAUPEL: {
      // riming growth in supercooled cloud water (dry growth regime)
      const slwc = this._slwcAt(); // g/m^3
      if (slwc > 0.05 && T < T_MELT) {
        const sweep = Math.PI * r * r;                    // m^2
        const dv = Math.abs(terminalVelocity(PT_GRAUPEL, r) - 0.2); // vs droplet still air
        const rate = 0.55 * slwc * 1e-3 * sweep * dv / Math.max(P.mass[i], 1e-12); // kg/kg/s
        // converts to hail when large & wet
        // soak into water-logged dense ice: becomes hail embryo when large & very wet
        if (P.radius[i] > 3.0e-3 && slwc > 0.85) P.type[i] = PT_HAIL;
        this._grow(i, clampNum(rate, 0, 0.5) * dt);
        // riming density increase: radius tracks mass via new bulk density
        if (P.type[i] === PT_HAIL) this._recomputeRadius(i, RHO_HAIL);
      } else if (RHi < 0.95 && slwc < 0.02) {
        this._sublimateShrink(i, (0.95 - RHi) * 0.25 * dt);
      }
      if (T >= T_MELT - 0.5) this._meltStep(i, dt, T);
      break;
    }
    case PT_HAIL: {
      const slwc = this._slwcAt();
      if (slwc > 0.1 && T < T_MELT) {
        // wet growth limited by heat balance; grows slower than free accretion
        const sweep = Math.PI * r * r;
        const dv = terminalVelocity(PT_HAIL, r);
        const rate = 0.15 * slwc * 1e-3 * sweep * dv / Math.max(P.mass[i], 1e-12);
        this._grow(i, clampNum(rate, 0, 0.2) * dt);
      }
      if (T >= T_MELT - 0.5) this._meltStep(i, dt, T * 0.6); // hail survives farther below 0C
      break;
    }
    case PT_RAIN: {
      if (RHw < 0.995) {
        // evaporation below cloud base
        this._shrink(i, clampNum((0.995 - RHw) * 0.5, 0, 0.3) * dt);
      }
      break;
    }
    }
  }

  _slwcAt() {
    // supercooled liquid water content at particle location:
    // cloud water where T < 0C (cohort approximation from the field)
    const out = this._envOut;
    return out.tK < T_MELT ? out.cloud : 0.0;
  }

  _grow(i, frac) {
    const P = this.particles;
    frac = clampNum(frac, 0, 0.5);
    P.mass[i] *= (1 + frac);
    // keep single-particle monodisperse radius in sync with mass
    const rho = P.type[i] === PT_RAIN || P.type[i] === PT_CLOUD || P.type[i] === PT_SUPER ? RHO_WATER :
      P.type[i] === PT_HAIL ? RHO_HAIL : P.type[i] === PT_GRAUPEL ? RHO_GRAUPEL :
      P.type[i] === PT_SNOW ? RHO_SNOW : RHO_ICE;
    P.radius[i] = Math.cbrt(P.mass[i] / (rho * (4 / 3) * Math.PI));
  }

  _recomputeRadius(i, rho) {
    const P = this.particles;
    P.radius[i] = Math.cbrt(P.mass[i] / (rho * (4 / 3) * Math.PI));
  }

  _shrink(i, frac) {
    const P = this.particles;
    frac = clampNum(frac, 0, 0.8);
    P.mass[i] *= (1 - frac);
    const mMin = 4.0 / 3.0 * Math.PI * Math.pow(2e-6, 3) * RHO_WATER;
    if (P.mass[i] < mMin) {
      // fully evaporated: charge returns to the air as ions (leak ledger)
      this.ledger.leaked += P.charge[i];
      this.ledger.inAir -= P.charge[i];
      P.mass[i] = 0; // marked for removal by caller (mass <= 0 check)
      return;
    }
    this._recomputeRadius(i, P.type[i] === PT_RAIN ? RHO_WATER : P.type[i] === PT_SNOW ? RHO_SNOW : RHO_ICE);
  }

  _sublimateShrink(i, frac) { this._shrink(i, frac); }

  _meltStep(i, dt, TExcess) {
    const P = this.particles;
    const rate = clampNum((TExcess - T_MELT) * 0.010, 0, 0.6);
    P.melt[i] = clampNum(P.melt[i] + rate * dt, 0, 1);
    if (P.melt[i] >= 0.999) {
      P.type[i] = PT_RAIN;
      P.melt[i] = 0;
      this._recomputeRadius(i, RHO_WATER);
    }
  }

  /*
   * Cohort interactions per spatial partition cell:
   *  - collision-coalescence: rain sweeps cloud droplets (accretion)
   *  - aggregation: ice crystals + snow
   *  - riming: graupel/supercooled droplets
   *  - NON-INDUCTIVE CHARGING: rebounding graupel<->ice collisions transfer
   *    charge; sign flips at the temperature/EW reversal line
   *  - inductive charging: raindrops polarized by the existing E-field
   *
   * All rates use mean-field kernels inside the cell (exact in the mean):
   * for each cohort, interactions/sec = f(grid-cell densities, |dv|, areas).
   */
  _cohortStep(dt) {
    const P = this.particles;
    const head = this._gridHead, next = this._gridNext;
    const gnX = this._gridNX, gnY = this._gridNY, cs = this._cellSize;
    const env = this.env;
    const cellVol = (env.cellSizeM * cs) * (env.cellSizeM * cs) * 1.0;
    const out = this._envOut === undefined ? null : this._envOut;
    const fOut = this._fOut || (this._fOut = {ex: 0, ey: 0, emag: 0, phi: 0, rho: 0, cellIx: 0, cellIy: 0});

    // Takahashi/Saunders charge reversal temperature vs effective liquid
    // water content (EW, g/m^3): warm & dry flips graupel charging sign.
    const reversalT = (ew) => {
      // ew in g/m^3, clamped to the lab-observed range
      const e = clampNum(ew, 0.01, 5.0);
      // -10 C at ew~1, trending colder for very dry cloud, warmer if very wet
      return T_MELT - 10.0 - 7.0 * Math.log10(e);
    };
    // Charging efficiency rolloff at very low temperatures: laboratory curves
    // (Takahashi 1978; Saunders & Peck 1998) show charge transfer peaking in
    // the -10..-25 C active zone and rolling off toward the homogeneous
    // freezing regime, which prevents inverted charge structures aloft.
    const lowTRolloff = (T) => clampNum((T - (T_HOMOG_FREEZE - 5)) / (248.15 - (T_HOMOG_FREEZE - 5)), 0, 1);

    for (let gx = 0; gx < gnX; gx++) {
      for (let gy = 0; gy < gnY; gy++) {
        const gi = gx * gnY + gy;
        let i0 = head[gi];
        if (i0 === -1) continue;

        // cell environment (center sample)
        env.sample((gx + 0.5) * cs, (gy + 0.5) * cs, out, this.wrapX);
        const T = out.tK;
        const cloudAvail = out.cloud; // g/m^3 — reservoir for accretion/riming

        // one pass over cell members: accumulate per-type stats
        // (n-weighted number densities, mass, mean radius, mean velocity)
        let nIce = 0, mIce = 0, rIce = 0, vxIce = 0, vyIce = 0;
        let nGra = 0, mGra = 0, rGra = 0, vxGra = 0, vyGra = 0;
        let nSnow = 0, nRain = 0, nCloud = 0, nSuper = 0;
        let countInCell = 0;
        for (let i = i0; i !== -1; i = next[i]) {
          countInCell++;
          const mt = P.mult[i], m = P.mass[i] * mt;
          switch (P.type[i]) {
          case PT_ICE: nIce += mt; mIce += m; rIce += P.radius[i] * mt; vxIce += P.vx[i] * mt; vyIce += P.vy[i] * mt; break;
          case PT_GRAUPEL: nGra += mt; mGra += m; rGra += P.radius[i] * mt; vxGra += P.vx[i] * mt; vyGra += P.vy[i] * mt; break;
          case PT_SNOW: nSnow += mt; break;
          case PT_RAIN: nRain += mt; break;
          case PT_CLOUD: nCloud += mt; break;
          case PT_SUPER: nSuper += mt; break;
          }
        }
        const iceDens = nIce / cellVol;   // real particles per m^3
        const graDens = nGra / cellVol;
        const meanRIce = nIce > 0 ? rIce / nIce : 0;
        const meanRGra = nGra > 0 ? rGra / nGra : 0;
        const mVxI = nIce > 0 ? vxIce / nIce : 0, mVyI = nIce > 0 ? vyIce / nIce : 0;
        const mVxG = nGra > 0 ? vxGra / nGra : 0, mVyG = nGra > 0 ? vyGra / nGra : 0;
        const relVelIG = Math.sqrt((mVxI - mVxG) ** 2 + (mVyI - mVyG) ** 2);

        // ---- NON-INDUCTIVE CHARGING: rebounding graupel<->ice collisions ---
        // Real number densities are derived from the environment's condensate
        // fields (ice-phase precipitation mass + supercooled cloud), not from
        // how many super-particles happen to sit in the cell — the carriers
        // only transport the separated charge. This keeps storm-scale
        // generation rates in the observed 0.1..1 C/km^3/min band regardless
        // of the rendering-oriented particle multiplicity.
        {
          const precipMassDens = out.precip * 1e-3;              // kg/m^3
          const cloudMassDens = cloudAvail * 1e-3;               // kg/m^3
          const iceMassDens = precipMassDens * (T < T_MELT ? 0.6 : 0.0)
                            + cloudMassDens * (T < 238 ? 0.5 : (T < T_MELT ? 0.10 : 0));
          const graMassDens = precipMassDens * (T < T_MELT ? 0.4 : 0.0)
                            + cloudMassDens * (T < T_MELT && T > 263 ? 0.15 : 0);
          const mIceBar = Math.max(meanRIce > 0 ? (4 / 3) * Math.PI * RHO_ICE * meanRIce ** 3 : 0, 5e-10);
          const mGraBar = Math.max(meanRGra > 0 ? (4 / 3) * Math.PI * RHO_GRAUPEL * meanRGra ** 3 : 0, 2e-7);
          const nIceReal = clampNum(iceMassDens / mIceBar, 0, 2e6);
          const nGraReal = clampNum(graMassDens / mGraBar, 0, 5e4);

          const meanVelDiff = Math.max(relVelIG, 0.4); // sedimentation differential exists even without resolved cohorts
          const ew = Math.max(T < T_MELT ? cloudAvail : 0, 0.0);
          const Tr = reversalT(ew);
          const graupelNegative = T < Tr; // below reversal -> graupel negative
          const eff = lowTRolloff(T);

          if (this.enableCharging && nIceReal > 0 && nGraReal > 0 && ew > 0.03 && eff > 0.01) {
            const rGB = meanRGra > 0 ? meanRGra : 1.2e-3;
            const rIB = meanRIce > 0 ? meanRIce : 8e-5;
            const areaCross = Math.PI * Math.pow(rGB + rIB, 2);
            const eColl = 0.10; // fraction of encounters that rebound with charge transfer
            // kernel: collisions per m^3 per s
            const kernel = eColl * areaCross * meanVelDiff * nIceReal * nGraReal;
            // charge transfer crosses zero AT the reversal temperature
            // (physical: the sign flips because the transfer itself vanishes
            // there); damp smoothly within ~8 C of the reversal curve.
            const nearReversal = clampNum(Math.abs(T - Tr) / 8.0, 0.06, 1);
            // laboratory results consistently show the warm-side (positive
            // graupel) branch to be substantially weaker than the main
            // negative branch — the lower positive pocket is a pocket
            const branchScale = graupelNegative ? 1.0 : 0.20;
            const perColl = 1.0e-13 * this.chargeRate *
              clampNum(ew / (ew + 0.35), 0.05, 1) *
              clampNum(meanVelDiff / 3.0, 0.2, 3) * eff * nearReversal * branchScale;
            // volumetric budget: storm-scale generation cap (chargeRate-scaled)
            const rateBudget = this.chargeRate * 1.67e-11 * cellVol * dt; // C
            let dqMag = clampNum(kernel * perColl * cellVol * dt, 0, rateBudget);
            if (dqMag > 0) {
              // graupel carriers gain graupelNegative ? -dqMag : +dqMag,
              // the ice population gains the opposite — exact conservation
              const graSign = graupelNegative ? -1 : 1;
              const dq = dqMag * graSign;
              const placedG = this._spreadChargeToType(gi, PT_GRAUPEL, dq);
              this.ledger.leaked += dq - placedG;     // no carriers: free ions
              const placedI = this._spreadChargeToType(gi, PT_ICE, -dq);
              this.ledger.leaked += (-dq) - placedI;
            }
          }
        }

        // ---------- inductive charging of rain in strong fields ----------
        if (nRain > 0 && this.enableCharging) {
          const cx = (gx + 0.5) * cs * env.cellSizeM, cy = (gy + 0.5) * cs * env.cellSizeM;
          this.field.fieldAt(cx, cy, fOut);
          const E = fOut.emag;
          if (E > 2.5e4 && nCloud + nSuper > 0) {
            for (let i = i0; i !== -1; i = next[i]) {
              if (P.type[i] !== PT_RAIN) continue;
              // Polarized drop bouncing off cloud droplets acquires charge of
              // the induction sign. This is a SATURATING process: the drop's
              // polarization charge cannot exceed ~ q_ind = C0 * r^2 * E
              // (physical bound ~ 4 pi eps0 r^2 E scaled to cohort total).
              // Relax toward the saturation value instead of unbounded growth.
              const qSat = 4.0e-12 * Math.pow(P.radius[i] / 1e-3, 2) *
                           clampNum(E / 1e5, 1, 8) * P.mult[i];
              const tauInd = 90.0; // s, induction relaxation timescale
              const qTarget = -Math.sign(fOut.ey || 1) * qSat;
              const k = Math.min(1, dt / tauInd) * this.chargeRate *
                clampNum((nCloud + nSuper) / cellVol / 1e6, 0, 2);
              const capped = (qTarget - P.charge[i]) * clampNum(k, 0, 0.4);
              P.charge[i] += capped;
              const spread1 = this._spreadChargeToType(gi, PT_SUPER, -capped * 0.5);
              this.ledger.leaked += -capped * 0.5 - spread1;
              const spread2 = this._spreadChargeToType(gi, PT_CLOUD, -capped * 0.5);
              this.ledger.leaked += -capped * 0.5 - spread2;
            }
          }
        }

        // ---------- rain accretion of cloud droplets (coalescence) -------
        if (nRain > 0 && cloudAvail > 0.03 && countInCell > 1) {
          for (let i = i0; i !== -1; i = next[i]) {
            if (P.type[i] !== PT_RAIN) continue;
            const r = P.radius[i];
            const sweep = Math.PI * r * r;
            const fall = terminalVelocity(PT_RAIN, r);
            const rate = 0.8 * cloudAvail * 1e-3 * sweep * fall / Math.max(P.mass[i], 1e-12);
            this._grow(i, clampNum(rate, 0, 0.6) * dt);
            // droplet breakup cap
            if (P.radius[i] > 4.5e-3) {
              // shed mass into a new smaller raindrop occasionally
              if (this.rng() < 0.25 && P.count < this.maxParticles) {
                const frac = 0.35;
                const childR = P.radius[i] * 0.55;
                P.spawn(PT_RAIN, P.x[i], P.y[i], P.vx[i], P.vy[i] - 0.5,
                        childR, particleMass(PT_RAIN, childR),
                        Math.max(1, Math.round(P.mult[i] * frac)), this.rng);
                P.mult[i] = Math.max(1, Math.round(P.mult[i] * (1 - frac)));
                P.mass[i] *= (1 - 0); // single-body mass unchanged; only mult splits
              }
            }
          }
        }

        // ----- warm-phase autoconversion: cloud droplets -> drizzle/rain ---
        // Physically: collision-coalescence among grown droplets (Kessler-
        // type, rate ~ LWC^2). Mass, bulk number-weighting and charge are
        // conserved exactly through the parent/child split.
        if (T > T_MELT + 0.5 && cloudAvail > 0.6 && P.count < this.maxParticles - 2) {
          for (let i = i0; i !== -1; i = next[i]) {
            if (i >= P.count) break;
            if (P.type[i] !== PT_CLOUD && P.type[i] !== PT_SUPER) continue;
            if (P.radius[i] < 11e-6) continue;   // only grown droplets collide
            const kAuto = clampNum(3.0e-3 * cloudAvail * cloudAvail, 0, 0.03);
            if (this.rng() >= kAuto * dt) continue;
            const frac = 0.30;
            const shedMass = P.mass[i] * Math.round(P.mult[i] * frac);
            if (shedMass <= 0) continue;
            const rDrop = 3.5e-4 + this.rng() * 6.0e-4;      // drizzle/rain embryo
            const mDrop = particleMass(PT_RAIN, rDrop);
            const multDrop = Math.floor(shedMass / mDrop);
            if (multDrop < 1) continue;
            const dMult = Math.max(1, Math.round(P.mult[i] * frac));
            const shedQ = P.charge[i] * (dMult / Math.max(P.mult[i], 1));
            const ni = P.spawn(PT_RAIN, P.x[i], P.y[i], P.vx[i], P.vy[i],
                               rDrop, mDrop, multDrop, this.rng);
            P.charge[ni] += shedQ;
            P.charge[i] -= shedQ;
            P.mult[i] = Math.max(0, P.mult[i] - dMult);
          }
        }

        // ---------- ice aggregation into snow ---------------------------
        if (nIce > 0 && T < T_MELT + 2 && this.rng() < 0.35) {
          for (let i = i0; i !== -1; i = next[i]) {
            if (P.type[i] !== PT_ICE) continue;
            if (nIce / cellVol * Math.pow(meanRIce, 2) > 1e-7 && this.rng() < 0.30) {
              // aggregates: grow radius quickly, become snow when large
              this._grow(i, 0.25 * dt);
              if (P.radius[i] > 3.0e-4) P.type[i] = PT_SNOW;
            }
          }
        }

        // ---------- graupel birth from snow riming in SLWC --------------
        if (nSnow > 0 && T < T_MELT && cloudAvail > 0.35) {
          for (let i = i0; i !== -1; i = next[i]) {
            if (P.type[i] !== PT_SNOW) continue;
            if (this.rng() < clampNum(cloudAvail * 0.12, 0, 0.25)) {
              P.type[i] = PT_GRAUPEL;
              this._recomputeRadius(i, RHO_GRAUPEL);
            }
          }
        }

        // ---- volumetric space-charge density saturation -----------------
        // In-cloud charge density cannot exceed ~8 nC/m^3 (bounded physically
        // by ionic conduction & precipitation currents); scale local cohorts
        // toward the limit and account the shed charge as free ions. Exact
        // signed-charge conservation through the ledger.
        {
          let sumAbs = 0, sumSigned = 0;
          for (let i = i0; i !== -1; i = next[i]) {
            sumAbs += Math.abs(P.charge[i]); sumSigned += P.charge[i];
          }
          const qLim = 8.0e-9 * cellVol;
          if (sumAbs > qLim) {
            const f = qLim / sumAbs;
            for (let i = i0; i !== -1; i = next[i]) P.charge[i] *= f;
            this.ledger.leaked += sumSigned * (1 - f);
          }
        }
      }
    }
    void dt;
  }



  /**
   * Move charge onto all cohorts of a type within a grid cell (proportional
   * to multiplicity). Returns the amount actually placed; the caller decides
   * what to do with any remainder (no local carriers => free ions -> leak
   * ledger). Strictly conserves charge.
   */
  _spreadChargeToType(gi, type, dqRest) {
    if (dqRest === 0) return 0;
    const P = this.particles, head = this._gridHead, next = this._gridNext;
    let totalMult = 0;
    for (let i = head[gi]; i !== -1; i = next[i])
      if (P.type[i] === type) totalMult += P.mult[i];
    if (totalMult <= 0) return 0;
    let given = 0;
    for (let i = head[gi]; i !== -1; i = next[i]) {
      if (P.type[i] !== type) continue;
      const share = dqRest * (P.mult[i] / totalMult);
      P.charge[i] += share;
      given += share;
    }
    return given;
  }

  /* --------------------- adaptive population control ---------------- */

  /*
   * Merge particles when over budget: same type inside one partition cell,
   * conserving total mass, momentum and charge exactly. This is the only
   * aggregation optimisation used; population statistics are preserved by
   * the multiplicities.
   */
  _mergePass() {
    const P = this.particles;
    const head = this._gridHead, next = this._gridNext;
    const gnX = this._gridNX, gnY = this._gridNY;
    // Phase 1: plan merges against a snapshot of the cell grids — NO removals
    // while iterating (index swaps would corrupt the linked lists and break
    // charge/mass accounting).
    const victims = [];
    for (let gx = 0; gx < gnX; gx++) {
      for (let gy = 0; gy < gnY; gy++) {
        const gi = gx * gnY + gy;
        for (let t = 0; t < PT_COUNT; t++) {
          const members = [];
          for (let i = head[gi]; i !== -1; i = next[i])
            if (P.type[i] === t) members.push(i);
          if (members.length <= 3) continue;
          // representative: largest multiplicity
          let repI = members[0];
          for (const m of members) if (P.mult[m] > P.mult[repI]) repI = m;
          let totM = 0, totQ = 0, totN = 0;
          let mx = 0, my = 0, mvx = 0, mvy = 0, mAge = 0;
          for (const i of members) {
            const mTot = P.mass[i] * P.mult[i];
            totM += mTot; totQ += P.charge[i]; totN += P.mult[i];
            mx += P.x[i] * mTot; my += P.y[i] * mTot;
            mvx += P.vx[i] * mTot; mvy += P.vy[i] * mTot; mAge += P.age[i] * mTot;
          }
          P.mult[repI] = totN;
          P.mass[repI] = totM / totN;
          P.charge[repI] = totQ;         // exact charge conservation
          P.x[repI] = mx / totM; P.y[repI] = my / totM;
          P.vx[repI] = mvx / totM; P.vy[repI] = mvy / totM;
          P.age[repI] = mAge / totM;
          this._recomputeRadius(repI, t === PT_RAIN || t === PT_CLOUD || t === PT_SUPER ? RHO_WATER :
                                t === PT_HAIL ? RHO_HAIL : t === PT_GRAUPEL ? RHO_GRAUPEL :
                                t === PT_SNOW ? RHO_SNOW : RHO_ICE);
          for (const i of members) if (i !== repI) { P.type[i] = 255; victims.push(i); }
        }
      }
    }
    // Phase 2: compact out victims. Ledger is untouched: victims' charge and
    // mass live in the representatives now.
    if (victims.length) {
      let w = 0;
      for (let i = 0; i < P.count; i++) {
        if (P.type[i] === 255) continue;
        if (w !== i) {
          P.x[w] = P.x[i]; P.y[w] = P.y[i]; P.vx[w] = P.vx[i]; P.vy[w] = P.vy[i];
          P.radius[w] = P.radius[i]; P.mass[w] = P.mass[i]; P.charge[w] = P.charge[i];
          P.mult[w] = P.mult[i]; P.type[w] = P.type[i]; P.age[w] = P.age[i];
          P.melt[w] = P.melt[i]; P.seed[w] = P.seed[i];
        }
        w++;
      }
      P.count = w;
    }
  }

  /* ----------------------------- field ------------------------------ */

  _accumulateChargeAndChargeRegions() {
    const P = this.particles;
    const f = this.field;
    f.beginAccumulate(this.env);
    const cell = this.env.cellSizeM;
    // reset structure probes: vertical thirds of free atmosphere
    let qUpPos = 0, qMidNeg = 0, qLowPos = 0;
    for (let i = 0; i < P.count; i++) {
      const q = P.charge[i];
      if (q === 0) continue;
      const xm = (P.x[i] + 0.5) * cell;
      const ym = (P.y[i] + 0.5) * cell;
      f.addCharge(xm, ym, q);
      // charge structure diagnostics by altitude thirds (above ground)
      const yFrac = P.y[i] / this.env.hCells;
      if (yFrac > 0.55 && q > 0) qUpPos += q;
      if (yFrac > 0.30 && yFrac <= 0.60 && q < 0) qMidNeg += q;
      if (yFrac <= 0.35 && q > 0) qLowPos += q;
    }
    this.structure.upperPositive = qUpPos;
    this.structure.mainNegative = qMidNeg;
    this.structure.lowerPositive = qLowPos;
  }

  /* --------------------------- lightning ---------------------------- */

  /**
   * Scan for breakdown; if triggered, create a channel and immediately
   * develop its leaders. Returns the channel or null.
   */
  _maybeInitiateLightning() {
    if (!this.enableLightning) return null;
    const f = this.field;
    const mf = f.maxField();
    this.maxFieldNow = mf.emag;
    const bx = mf.xm, by = mf.ym;
    // local humidity for breakdown correction (env-relative)
    const out = this._envOut;
    this.env.sample(bx / this.env.cellSizeM, by / this.env.cellSizeM, out, this.wrapX);
    const satW = Math.max(satVaporDensityWater(out.tK), 1e-6);
    const rh = clampNum(out.vapor / satW, 0, 1.2);
    // Hydrometeor- and turbulence-assisted initiation: observed in-cloud
    // initiation fields are ~150-400 kV/m, well below the dry-air 3 MV/m
    // conventional breakdown. The 0.22 factor reflects that correction.
    const Ebd = f.breakdownField(by, rh) * (this.breakdownScale || 0.22);
    if (mf.emag < Ebd) return null;
    // Initiation is a stochastic streamer-runaway process: probability rises
    // with field overdrive. Even in an over-critical storm only a few flashes
    // start per second; each flash then collapses its local charge reservoir.
    const overdrive = mf.emag / Ebd - 1.0;
    if (this.rng() > Math.min(0.65, overdrive * 0.9)) return null;

    // determine polarity & kind from local charge structure
    const rhoHere = f.fieldAt(bx, by).rho;
    const groundDist = by - (this.env.groundAt(bx / this.env.cellSizeM, this.wrapX) * this.env.cellSizeM);
    const heightM = this.env.hCells * this.env.cellSizeM;
    let kind;
    if (groundDist < 0.30 * heightM && mf.emag > Ebd * 1.02) kind = 'CG';
    else if (out.cloud < 0.05 && Math.abs(rhoHere) > 0) kind = 'CA';
    else kind = 'IC'; // inside cloud (CC within-column flashes look like IC in 2D)

    // channel polarity: negative leaders carry negative charge downward where
    // rhoHere < 0 (typical for main-N region), positive otherwise
    const polarity = rhoHere <= 0 ? -1 : 1;
    const ch = new LightningChannel(++this.channelIdCounter, kind, polarity);
    ch.attachX = bx; ch.attachY = by;
    const n0 = ch.addNode(bx, by);
    ch.tips.push(n0, n0);          // bidirectional start: two ends
    ch.tipSign.push(polarity < 0 ? -1 : 1, polarity < 0 ? 1 : -1); // −end, +end
    this.channels.push(ch);
    this._developLeader(ch, kind, bx, by);
    return ch;
  }

  /**
   * Grow leaders through the actual electric field with probabilistic
   * branching (dielectric-breakdown-like). Charge is captured from the
   * field grid as the channel passes, and drained from particles there.
   * Returns when the channel connects (stroke) or stalls (decay/failed).
   */
  _developLeader(ch, kind, bx, by) {
    const f = this.field;
    const Eprop = 1.5e5;                       // V/m leader propagation threshold
    const maxNodes = 1100;
    const heightM = this.env.hCells * this.env.cellSizeM;
    const capRadius = Math.max(f.dx, f.dy) * 0.55;   // charge capture radius
    const stepBase = Math.min(f.dx, f.dy) * 0.28;    // sub-cell zigzag
    const fOut = this._fOut || (this._fOut = {});
    let connected = false, connectNode = -1, toGround = false;
    let steps = 0;
    const maxSteps = 6000;

    while (ch.tips.length && !connected && steps++ < maxSteps && ch.nodesX.length < maxNodes) {
      // process one tip at a time (round robin from end)
      const tipIdx = ch.tips.length - 1;
      const nodeIdx = ch.tips[tipIdx];
      const sign = ch.tipSign[tipIdx];
      let x = ch.nodesX[nodeIdx], y = ch.nodesY[nodeIdx];

      f.fieldAt(x, y, fOut);
      let ex = fOut.ex, ey = fOut.ey;
      let emag = Math.sqrt(ex * ex + ey * ey);
      if (emag < Eprop) { // tip stalls in weak field
        ch.tips.splice(tipIdx, 1); ch.tipSign.splice(tipIdx, 1);
        continue;
      }
      // propagation direction: the tip that carries net `sign` charge tends to
      // move along E if sign<0 (electrons drift against E but leaders extend
      // toward opposite charge => conventional direction)
      const dirE = sign < 0 ? 1 : -1;
      // stochastic angular jitter (branchy, lightning-like)
      const jitter = 0.55 * (Eprop / Math.max(emag, Eprop));
      const ang = Math.atan2(ey * dirE, ex * dirE) + (this.rng() - 0.5) * 2.4 * jitter;
      const bias = kind === 'CG' && sign < 0 ? -0.35 : 0; // CG negative leads earthward
      const dx = Math.cos(ang) * stepBase;
      const dy = Math.sin(ang) * stepBase * (1 + 0.15 * (this.rng() - 0.5)) + (bias * stepBase * this.rng());
      let nx = x + dx, ny = y + dy;
      // stay in domain
      if (this.wrapX) nx = ((nx % (f.dx * f.nx)) + f.dx * f.nx) % (f.dx * f.nx);
      nx = clampNum(nx, 0, f.dx * f.nx - 1);
      const groundY = this.env.groundAt(nx / this.env.cellSizeM, this.wrapX) * this.env.cellSizeM;
      const ceil = heightM - 1;

      // ------ CG attachment ------
      if (kind === 'CG' && sign < 0 && ny <= groundY + f.dy * 0.9) {
        const nn = ch.addNode(nx, groundY + 1);
        ch.addSegment(nodeIdx, nn, this.time);
        connected = true; connectNode = nn; toGround = true;
        ch.attachX = nx; ch.attachY = groundY + 1;
        break;
      }
      if (kind === 'CG' && sign > 0 && ny <= groundY + f.dy * 0.9) {
        const nn = ch.addNode(nx, groundY + 1);
        ch.addSegment(nodeIdx, nn, this.time);
        connected = true; connectNode = nn; toGround = true;
        ch.attachX = nx; ch.attachY = groundY + 1;
        break;
      }
      if (ny >= ceil) { ch.tips.splice(tipIdx, 1); ch.tipSign.splice(tipIdx, 1); continue; }

      // ------ IC/CC: tip reached a region of opposite charge ------
      f.fieldAt(nx, ny, fOut);
      const localRho = fOut.rho;
      if (Math.sign(localRho) === -sign && Math.abs(localRho) > 0.4e-9) {
        // enter opposite-charge region: capture completes circuit
        const nn = ch.addNode(nx, ny);
        ch.addSegment(nodeIdx, nn, this.time);
        connected = true; connectNode = nn; toGround = false;
        break;
      }

      // ------ capture charge near the new node ------
      const captured = this._captureCharge(nx, ny, capRadius, sign, ch);
      ch.chargeMoved += captured;

      const nn = ch.addNode(nx, ny);
      ch.addSegment(nodeIdx, nn, this.time);
      ch.tips[tipIdx] = nn;

      // ------ branching ------
      const pBranch = 0.045 * clampNum(emag / 8e5, 0, 2);
      if (this.rng() < pBranch) {
        ch.tips.push(nn);
        ch.tipSign.push(sign);
      }
      // tiny chance for spontaneous secondary tip at a side angle
      if (this.rng() < 0.012) {
        const bn = ch.addNode(nx + (this.rng() - 0.5) * stepBase * 2, ny + (this.rng() - 0.5) * stepBase * 2);
        ch.addSegment(nn, bn, this.time); // zero-length cosmetic stub avoided: reuse nn
        ch.segA[ch.segA.length - 1] = nodeIdx; // proper: branch from current node
        ch.tips.push(bn);
        ch.tipSign.push(sign);
      }
      void by;
    }

    if (connected) {
      ch.state = 'stroke';
      ch.strokeT = this.time;
      ch.strokeOrigin = connectNode;
      ch.strokesLeft = 1 + Math.floor(this.rng() * 3);    // 1-3 subsequent
      ch.continuing = 0.15 + this.rng() * 0.25;           // continuing current
      ch.toGround = toGround;
      ch.flashLevel = 1.0;
      // light the whole channel up
      for (let s = 0; s < ch.segBright.length; s++) ch.segBright[s] = 1.0;
      this._strokeNeutralize(ch, toGround);
      this.flashCount++;
    } else {
      // failed leader: release captured charge back into the air locally
      this._releaseChannelCharge(ch);
      ch.state = 'decay';
    }
  }

  /**
   * Move charge of sign `sign` from particles within radius of (xm,ym) into
   * the channel. Returns C moved. Reduces particle charges (conservation via
   * ledger: inAir -> channel).
   */
  _captureCharge(xm, ym, radiusM, sign, ch, fraction = 0.35) {
    const P = this.particles;
    const cell = this.env.cellSizeM;
    const rCells = radiusM / cell;
    // gather indices near point using spatial grid
    const cs = this._cellSize;
    const gx0 = clampNum(Math.floor((xm / cell - rCells) / cs), 0, this._gridNX - 1);
    const gx1 = clampNum(Math.floor((xm / cell + rCells) / cs), 0, this._gridNX - 1);
    const gy0 = clampNum(Math.floor((ym / cell - rCells) / cs), 0, this._gridNY - 1);
    const gy1 = clampNum(Math.floor((ym / cell + rCells) / cs), 0, this._gridNY - 1);
    const head = this._gridHead, next = this._gridNext, gnY = this._gridNY;
    const xc = xm / cell, yc = ym / cell;
    let moved = 0;
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let i = head[gx * gnY + gy]; i !== -1; i = next[i]) {
          const q = P.charge[i];
          if (q === 0 || Math.sign(q) !== sign) continue;
          const dx = P.x[i] - xc, dy = P.y[i] - yc;
          if (dx * dx + dy * dy > rCells * rCells) continue;
          // capture fraction per encounter
          const take = q * fraction;
          P.charge[i] -= take;
          moved += take;
        }
      }
    }
    this.ledger.inAir -= moved;
    this.ledger.channel += moved;
    return moved;
  }

  /**
   * Return-stroke charge disposition. The hot channel neutralizes charge of
   * BOTH polarities along its entire length (charge recombination in the
   * plasma channel), which is what physically collapses the post-flash
   * electric field and sets the flash's multi-second relaxation time. For CG
   * flashes the net drained charge is conducted into the earth; for IC/CC
   * the net is redeposited at the far end of the channel. In both cases
   * total signed charge is exactly conserved through the ledger.
   */
  _strokeNeutralize(ch, toGround) {
    const cell = this.env.cellSizeM;
    const radiusM = Math.max(this.field.dx, this.field.dy) * 1.0;
    const nodeCount = ch.nodesX.length;
    if (nodeCount > 0) {
      const stride = Math.max(1, Math.floor(nodeCount / 48)); // bounded cost
      for (let k = 0; k < nodeCount; k += stride) {
        ch.chargeMoved += this._captureCharge(ch.nodesX[k], ch.nodesY[k], radiusM, +1, ch, 0.55);
        ch.chargeMoved += this._captureCharge(ch.nodesX[k], ch.nodesY[k], radiusM, -1, ch, 0.55);
      }
    }
    const cm = ch.chargeMoved; // signed net charge carried into the channel
    this.chargeFlashed += Math.abs(cm);
    if (toGround) {
      // conducted into the earth (signed)
      this.ledger.channel -= cm;
      this.ledger.ground += cm;
      ch.chargeMoved = 0;
    } else {
      // IC/CC: the transported net charge is spread over the far third of
      // the channel (real leaders ramify through the opposite-charge region;
      // depositing at a single point would fake an unphysical point charge)
      const nEnd = nodeCount - 1;
      const kStart = Math.floor(nodeCount * 2 / 3);
      let nDep = 0;
      for (let k = kStart; k <= nEnd; k++) nDep++;
      if (nDep === 0) nDep = 1;
      const stride2 = Math.max(1, Math.floor(nDep / 6));
      const magEach = Math.abs(cm) / Math.max(1, Math.ceil(nDep / stride2));
      for (let k = kStart; k <= nEnd; k += stride2) {
        this._depositCharge(ch.nodesX[k], ch.nodesY[k], magEach, Math.sign(cm) || ch.polarity);
      }
      this.ledger.channel -= cm;
      ch.chargeMoved = 0;
    }
    // a stroke re-solves the potential immediately afterwards
    this.lastFieldSolve = -1; // force re-solve next step
  }

  /** Deposit `mag` coulombs of sign `sign` onto particles near (xm, ym). */
  _depositCharge(xm, ym, mag, sign) {
    const P = this.particles;
    const cell = this.env.cellSizeM;
    const radiusM = Math.max(this.field.dx, this.field.dy) * 0.8;
    const rCells = radiusM / cell;
    const cs = this._cellSize;
    const gx0 = clampNum(Math.floor((xm / cell - rCells) / cs), 0, this._gridNX - 1);
    const gx1 = clampNum(Math.floor((xm / cell + rCells) / cs), 0, this._gridNX - 1);
    const gy0 = clampNum(Math.floor((ym / cell - rCells) / cs), 0, this._gridNY - 1);
    const gy1 = clampNum(Math.floor((ym / cell + rCells) / cs), 0, this._gridNY - 1);
    const head = this._gridHead, next = this._gridNext, gnY = this._gridNY;
    let totalMult = 0;
    const idx = [];
    for (let gx = gx0; gx <= gx1; gx++)
      for (let gy = gy0; gy <= gy1; gy++)
        for (let i = head[gx * gnY + gy]; i !== -1; i = next[i]) {
          const dx = P.x[i] - xm / cell, dy = P.y[i] - ym / cell;
          if (dx * dx + dy * dy <= rCells * rCells) { idx.push(i); totalMult += P.mult[i]; }
        }
    if (totalMult <= 0) {
      this.ledger.leaked += mag * sign;
      return;
    }
    const q = mag * sign;
    let given = 0;
    for (const i of idx) {
      const share = q * (P.mult[i] / totalMult);
      P.charge[i] += share;
      given += share;
    }
    this.ledger.inAir += given;
    if (Math.abs(given - q) > 0) this.ledger.leaked += q - given;
  }

  /** Failed leader: channel charge returns to nearby air. */
  _releaseChannelCharge(ch) {
    const cm = ch.chargeMoved;
    if (cm === 0) return;
    const n = Math.max(ch.nodesX.length - 1, 0);
    this._depositCharge(ch.nodesX[n], ch.nodesY[n], Math.abs(cm), Math.sign(cm) || ch.polarity);
    this.ledger.channel -= cm;
    ch.chargeMoved = 0;
  }

  /** Continuing current & dart leader extra strokes. */
  _updateChannels(dt) {
    for (let ci = this.channels.length - 1; ci >= 0; ci--) {
      const ch = this.channels[ci];
      ch.age += dt;
      // afterglow decay
      const tau = ch.state === 'decay' ? 0.03 : 0.09;
      const decay = Math.exp(-dt / tau);
      for (let s = 0; s < ch.segBright.length; s++) ch.segBright[s] *= decay;
      ch.flashLevel *= Math.exp(-dt / 0.12);

      if (ch.state === 'stroke') {
        ch.continuing -= dt;
        // additional small charge drain during continuing current
        if (ch.continuing > 0 && ch.toGround) {
          const dq = this._captureCharge(ch.attachX, ch.attachY + 400, 500,
                                         ch.polarity, ch);
          // capture moved charge air->channel; channel->ground immediately
          this.ledger.channel -= dq;
          this.ledger.ground += dq;
        } else if (ch.continuing <= 0) {
          if (ch.strokesLeft > 0) {
            ch.strokesLeft--;
            ch.continuing = 0.12 + this.rng() * 0.25;
            ch.strokeT = this.time;
            ch.flashLevel = 0.9;
            for (let s = 0; s < ch.segBright.length; s++)
              ch.segBright[s] = Math.min(1, ch.segBright[s] + 0.85);
          } else {
            ch.state = 'decay';
          }
        }
      } else if (ch.state === 'decay') {
        // fully dark & old: drop
        let maxB = 0;
        for (let s = 0; s < ch.segBright.length; s++) maxB = Math.max(maxB, ch.segBright[s]);
        if (maxB < 0.015) this.channels.splice(ci, 1);
      }
    }
  }

  /* ------------------------------ main step ------------------------- */

  /**
   * Advance by dtSim seconds (of simulation time). Sub-steps internally for
   * stability and caps work per call.
   */
  step(dtSim) {
    if (!this.env.valid || dtSim <= 0) return;
    const P = this.particles;
    dtSim = Math.min(dtSim, 3.0); // hard cap per call
    let remaining = dtSim;
    const subDt = 0.20; // s
    while (remaining > 1e-9) {
      const dt = Math.min(subDt, remaining);
      remaining -= dt;
      this.time += dt;

      this._spawnMissing();

      // motion + local microphysics (no spatial-grid dependencies here,
      // particle removal is safe because no index lists exist yet)
      for (let i = P.count - 1; i >= 0; i--) {
        if (!this._moveParticle(i, dt)) { P.remove(i); continue; }
        this._microParticle(i, dt);
        if (P.mass[i] <= 0) { P.remove(i); continue; }
        // atmospheric ion leakage (charge relaxation in electrified cloud)
        if (P.charge[i] !== 0) {
          const leak = P.charge[i] * (dt / 180.0);
          P.charge[i] -= leak;
          this.ledger.leaked += leak;
          this.ledger.inAir -= leak;
        }
      }

      // sanity scrub: discard any non-finite state (shouldn't happen)
      this._scrub();

      // spatial partition *after* all removals, so linked lists are consistent
      this._buildGrid();

      // cohort interactions: collisions, riming, aggregation & charging
      this._cohortStep(dt);

      // adaptive merge when population pressure is high
      if (P.count > this.maxParticles * 0.92) {
        this._buildGrid();   // cohort pass can convert types / spawn children
        this._mergePass();
        this._buildGrid();
      }

      // field solve periodically & after events
      if (this.time - this.lastFieldSolve >= this.fieldSolveInterval) {
        this._accumulateChargeAndChargeRegions();
        this.field.solve(90);
        this.lastFieldSolve = this.time;
        // attempt breakdown initiation; only in real atmospheric conditions
        this._maybeInitiateLightning();
      }

      this._updateChannels(dt);
    }
  }

  _scrub() {
    const P = this.particles;
    for (let i = P.count - 1; i >= 0; i--) {
      const bad = !isFinite(P.x[i]) || !isFinite(P.y[i]) || !isFinite(P.vx[i]) ||
        !isFinite(P.vy[i]) || !isFinite(P.mass[i]) || !isFinite(P.charge[i]);
      if (bad) {
        this.ledger.leaked += isFinite(P.charge[i]) ? P.charge[i] : 0;
        P.remove(i);
      }
    }
  }

  _inAirChargeQuick() {
    const P = this.particles;
    let s = 0;
    for (let i = 0; i < P.count; i++) s += P.charge[i];
    return s;
  }

  /* ------------------------------ getters --------------------------- */

  /** Particle views for rendering: fills the provided (or fresh) arrays. */
  getParticles(out) {
    const P = this.particles;
    if (!out || out.pos.length < P.count * 2) {
      out = {
        pos: new Float32Array(P.count * 2),
        data: new Float32Array(P.count * 4), // size, type, log|q|*sign, rnd
        count: 0
      };
    }
    for (let i = 0; i < P.count; i++) {
      out.pos[i * 2] = P.x[i];
      out.pos[i * 2 + 1] = P.y[i];
      out.data[i * 4] = P.radius[i];
      out.data[i * 4 + 1] = P.type[i];
      const q = P.charge[i];
      out.data[i * 4 + 2] = q === 0 ? 0 : Math.sign(q) * Math.min(9, Math.log10(Math.abs(q)) + 14);
      out.data[i * 4 + 3] = P.mult[i] > 0 ? Math.log10(Math.max(P.mult[i], 1)) : 0; // multiplicity weight
    }
    out.count = P.count;
    return out;
  }

  /** Charge density / potential / |E| texture views (row-major, nx*ny). */
  getFieldTextures() {
    const f = this.field;
    return {
      nx: f.nx, ny: f.ny, dx: f.dx, dy: f.dy,
      rho: f.rho, phi: f.phi, ex: f.ex, ey: f.ey, emag: f.emag,
      groundRow: f.groundRow
    };
  }

  /** Lightning channels as segment lists for rendering. */
  getChannels() {
    return this.channels;
  }

  /**
   * Optical-depth / extinction diagnostics per partition cell, derived from
   * hydrometeor populations: LWC, IWC, mean size, extinction coefficient.
   * β_ext = ∫ π r² Q_ext n(r) dr approximated over super-particles.
   */
  getOptics() {
    const nx = this._gridNX, ny = this._gridNY;
    const n = nx * ny;
    if (!this.extinction || this.extinction.length !== n) {
      this.extinction = new Float32Array(n);
      this.lwc = new Float32Array(n);
      this.iwc = new Float32Array(n);
    }
    const ext = this.extinction, lwc = this.lwc, iwc = this.iwc;
    ext.fill(0); lwc.fill(0); iwc.fill(0);
    const P = this.particles;
    const cellVol = (this.env.cellSizeM * this._cellSize) ** 2; // * 1m depth
    for (let i = 0; i < P.count; i++) {
      const gx = clampNum(Math.floor(P.x[i] / this._cellSize), 0, nx - 1);
      const gy = clampNum(Math.floor(P.y[i] / this._cellSize), 0, ny - 1);
      const gi = gx * ny + gy;
      const mTot = P.mass[i] * P.mult[i];
      const isIcePhase = P.type[i] === PT_ICE || P.type[i] === PT_SNOW ||
        P.type[i] === PT_GRAUPEL || P.type[i] === PT_HAIL;
      const cArea = Math.PI * P.radius[i] * P.radius[i] * P.mult[i];
      const qExt = P.type[i] === PT_CLOUD || P.type[i] === PT_SUPER ? 2.0 : 1.6; // geometric optics
      ext[gi] += cArea * qExt / cellVol;
      if (isIcePhase) iwc[gi] += mTot / cellVol; else lwc[gi] += mTot / cellVol;
    }
    return {nx, ny, extinction: this.extinction, lwc: this.lwc, iwc: this.iwc, cellSize: this._cellSize};
  }

  getStats() {
    const P = this.particles;
    let qPos = 0, qNeg = 0;
    const perType = new Array(PT_COUNT).fill(0);
    for (let i = 0; i < P.count; i++) {
      perType[P.type[i]]++;
      if (P.charge[i] > 0) qPos += P.charge[i]; else qNeg += P.charge[i];
    }
    // ledger consistency: inAir should equal tracked sum
    this.ledger.inAir = qPos + qNeg;
    const total = this.ledger.inAir + this.ledger.ground + this.ledger.rainout + this.ledger.leaked;
    return {
      particles: P.count,
      perType,
      qPositive: qPos,
      qNegative: qNeg,
      qGround: this.ledger.ground,
      qRainout: this.ledger.rainout,
      qLeaked: this.ledger.leaked,
      qTotal: total,   // must stay ~constant (started at 0)
      maxField: this.maxFieldNow,
      flashes: this.flashCount,
      qFlashed: this.chargeFlashed,
      channels: this.channels.length,
      structure: {...this.structure},
      time: this.time
    };
  }
}

/* ------------------------------ exports ----------------------------- */

const StormSimAPI = {
  StormSim,
  PT_CLOUD, PT_SUPER, PT_ICE, PT_SNOW, PT_GRAUPEL, PT_HAIL, PT_RAIN, PT_NAMES,
  terminalVelocity, particleMass, satVaporDensityWater, satVaporDensityIce,
  FAIR_WEATHER_E
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StormSimAPI;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StormSimAPI = StormSimAPI;
}
