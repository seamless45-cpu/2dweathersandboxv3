# Storm Physics & Electricity (stormsim.js / stormview.js)

A physically based atmospheric microphysics, charge-separation and lightning
engine layered onto the fluid weather sandbox. Everything visible — cloud,
precipitation, electrification, lightning — **emerges** from underlying
physics. There are no scripted lightning shapes, no random flash timers and
no hardcoded charge regions.

## Architecture

| File | Role |
| --- | --- |
| `stormsim.js` | Physics core (plain JS, no GL). Hydrometeor super-particles, microphysics kernels, Poisson field solver, leader/stroke channel model, strict signed-charge ledger. |
| `stormview.js` | Live integration: strided GPU-column sampling of the fluid state into the storm environment, real-time stepping, WebGL2 overlay rendering, thunder sound hooks, dat.GUI folder, adaptive quality. |
| `shaders/storm/*` | GLSL overlay programs: `points.vert/.frag` (hydrometeor sprites), `field.frag`+`quad.vert` (charge density / E magnitude / potential), `lines.vert/.frag` (lightning channels), `arrows.vert/.frag` (E vectors). |
| `tests/stormsim.test.js` | 22-assertion regression suite (synthetic storm + calm control + strided-update integration + adaptive-budget conservation). Run: `node tests/stormsim.test.js`. |
| `tests/check-shaders.js` | glslangValidator over every shader (inlining `common.glsl`). |
| `tests/stormEnv.js`, `tests/debug-run.js` | Synthetic storm builder and charge-ledger/debug driver. |

## Physics summary

1. **Hydrometeor populations.** Seven species — cloud droplets, supercooled
   droplets, ice crystals, snow aggregates, graupel, hail, rain — as
   *super-particles* carrying single-particle mass/radius plus an exact
   multiplicity. Merging (population control) conserves total mass, momentum
   and charge exactly.

2. **Microphysics.** Condensation/evaporation, deposition/sublimation,
   hetero-/homogeneous freezing, melting, collision-coalescence (warm
   autoconversion + rain accretion), aggregation, riming/dry growth and hail
   wet growth, raindrop breakup — all driven by local T / RH / liquid-water
   content sampled from the live fluid sim.

3. **Dynamics.** Per-species terminal fall speeds, drag relaxation onto the
   real simulated wind, shear-driven turbulence noise, ground deposition
   (rain-out is ledgered) and melting-layer phase change.

4. **Charge separation.** Non-inductive graupel↔ice rebound charging with
   the Takahashi/Saunders reversal temperature (a function of effective
   liquid-water content), a low-temperature efficiency rolloff, the weak
   warm-side (positive) charging branch, and a volumetric generation budget
   ≈1 C/km³/min at rate 1; plus saturating inductive charging of rain in
   strong fields. Charge magnitudes saturate near the observed in-cloud
   space-charge density limit (~8 nC/m³).

5. **Field solution.** Every ~0.5 s the Coulomb problem ∇²Φ = −ρ/ε₀ is
   solved on a potential grid from the actual particle charge distribution
   (grounded lower boundary, fair-weather top flux, open/neumann sides); E is
   taken from the field gradient.

6. **Emergent lightning.** Initiation where |E| exceeds the
   altitude/humidity-corrected breakdown threshold (in-cloud initiation
   ~150–400 kV/m), stochastic streamer gating, bidirectional stepped leaders
   that follow the solved field with probabilistic branching, IC/CG/CA
   discriminated by attachment, 1–3 restrikes with continuing current, and
   channel-wide charge neutralization along the stroke path. Signed charge
   is tracked through in-air → channel → ground/deposit with machine-exact
   conservation; the calm-atmosphere control shows no flashes.

7. **Tripole structure** (upper positive / main negative / small lower
   positive) emerges from differential sedimentation of charged species —
   it is asserted in tests, never imposed.

## Rendering modes (GUI → "Storm Physics & Electricity")

- **Realistic** — only lightning channels over the normal storm display.
- **Particles by species** — 7-way hydrometeor colouring.
- **Particles by charge** — red/blue polarity, brightness ~ log |q|.
- **Charge density** — bipolar fluid of the solver's ρ field.
- **Electric field magnitude / potential** — solved-field heat map /
  iso-contour shading (+ optional vector arrows).
- **Combined** — charge-tinted particles over charge-density/E blend.

Thunder reuses the existing `soundSystem.soundThunder(x, y, intensity)`
with flash position/intensity derived from completed strokes. While the
engine is enabled it owns lightning: the legacy random bolt spawner in
`precipitationShader.vert` is gated to zero via the `legacyLightningGate`
uniform.

## Performance

- ~5,000–40,000 super-particles (adaptive budget, exact-conserving merger).
- Field solve ~96×64 SOR every 0.5 sim-s; adaptive substeps (≤0.2 s).
- GPU column sampling spread across frames (3 columns/frame steady-state).
- Auto quality scaling lowers particle budget if overlay CPU > ~10 ms.
- URL override: `?storm=0` disables the system entirely; `Reset storm
  engine` in the GUI folder re-initializes.

## Hard rules honored

1. Lightning emerges from simulated charge separation — never random/timed.
2. Charge is assigned only by physical collision/field processes.
3. Charge regions form only from sedimentation/transport of charged
   particles — never hardcoded zones.
4. Every discharge measurably changes the storm's electrical state and
   conserves total charge (ground transfer ledgered).
5. Rendering derives from hydrometeor populations and solved fields — the
   lightning you see is the consequence of the storm's electrical physics.
