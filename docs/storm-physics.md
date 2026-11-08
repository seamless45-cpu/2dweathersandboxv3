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
| `lightningGenerator.js` | Procedural lightning artwork in a Worker. `mode:'CG'` produces the classic downward bolt used by the legacy cloud-density lightning; `mode:'IC'` produces a wide, flat, heavily forked intra-cloud flash confined to a horizontal band. |
| `shaders/storm/*` | GLSL overlay programs: `points.vert/.frag` (hydrometeor sprites), `field.frag`+`quad.vert` (charge density / E magnitude / potential), `lines.vert/.frag` (lightning channels), `ic.vert/.frag` (additive intra-cloud flash billboards), `arrows.vert/.frag` (E vectors). |
| `tests/stormsim.test.js` | 32-assertion regression suite (synthetic storm + calm control + strided-update integration + adaptive-budget conservation). Run: `node tests/stormsim.test.js`. |
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
   of ≈2.4 C/km³/min at rate 1 for vigorous mixed-phase convection; plus
   saturating inductive charging of rain in strong fields. Charge magnitudes
   saturate near the observed in-cloud space-charge density limit
   (~8 nC/m³).
   Separated charge is written onto **actual hydrometeor cohorts**: the
   graupel side prefers graupel → hail → snow, the ice side prefers
   ice → snow, and a cell is only charged when two distinct ice-phase carrier
   populations are present. This guarantees that charge separation always
   produces charged particles (no more "free ion" bookkeeping swallowing the
   charge) while still conserving signed charge exactly. In-cloud charge
   relaxation uses a multi-minute (600 s) ion-leakage time constant, so
   separated charge accumulates instead of draining as fast as it forms.

5. **Field solution.** Roughly every 0.5 s of simulated time — and at most
   once per `step()` call, however much simulated time that call represents —
   the Coulomb problem ∇²Φ = −ρ/ε₀ is solved on a potential grid from the
   actual particle charge distribution
   (grounded lower boundary, fair-weather top flux, open/neumann sides); E is
   taken from the field gradient.

6. **Emergent lightning.** Initiation picks from the strongest solved-field
   cells, preferring sites from which an **opposite-charge pocket is
   reachable along the field** (`topFieldCells` + `_oppositeChargeReach` —
   flashes connect the charge pattern rather than a scalar maximum), with
   stochastic streamer gating. **Cloud density participates in the
   trigger**: the local breakdown field is reduced by up to 34 % in dense
   cloud and the streamer-runaway probability gains a cloud-density term, so
   well-developed mixed-phase cloud flashes more readily than clear air.
   Bidirectional stepped leaders follow the solved E-field **plus an explicit
   seek gradient toward opposite-charge regions** (`chargeSeekDir`) so
   channels visibly thread through charge pockets.

   Flash types are discriminated by their attachment:
   * **CG** — low, strong-field sites; leaders descend to the ground and
     deliver 1–3 bright return strokes with continuing current.
   * **IC** — inside the cloud. Leaders propagate at a much lower field
     threshold (25 kV/m versus 150 kV/m for CG), have their vertical motion
     damped and are confined to the sampled cloud-charge band, fork heavily,
     and must spread at least 1.6 km before bridging an opposite pocket.
     They discharge as 2–4 dim sub-strokes (K-changes), spread the
     transported charge across the far end of the channel, and never become
     ground strikes. Leaders that spread ≥0.8 km without bridging still
     produce a partial IC flare rather than being discarded.
   * **CA** — clear-air breakdown near cloud edge.

   Each stroke performs a channel-wide neutralization sweep. Signed charge is
   tracked through in-air → channel → ground/deposit with machine-exact
   conservation; the calm-atmosphere control shows no flashes. Completed
   flashes are published as events (`sim.consumeFlashEvents()`), which the
   overlay and thunder hook consume.

7. **Tripole structure** (upper positive / main negative / small lower
   positive) emerges from differential sedimentation of charged species —
   it is asserted in tests, never imposed.

## Rendering modes (GUI → "Storm Physics & Electricity")

- **Show Charges (default)** — + red / − blue polarity particles, brightness
  ~ log |q|; master **Show Charges** checkbox toggles every charge overlay
  instantly (species view remains when toggled off).
- **Combined** — charge-tinted particles over charge-density/E blend.
- **Particles by species** — 7-way hydrometeor colouring.
- **Charge density** — bipolar fluid of the solver's ρ field.
- **Electric field magnitude / potential** — solved-field heat map /
  iso-contour shading (+ optional vector arrows).
- **Realistic** — only lightning channels over the normal storm display.

IC flashes are rendered twice: their real channel geometry as additive lines,
and as an additive billboard using a procedurally generated IC artwork bank
(`lightningGenerator.js`, mode `IC`, pre-generated at boot by two workers).
The artwork supplies the wide, soft, multiply-forked "spider" that IC flashes
show inside cloud; the billboard size follows the observed channel extent and
flickers through the flash's multi-stroke cadence. Charged super-particles in
the charge views are sized and brightened by |q| so electrification is
visible at any zoom level. The **IC flash artwork** toggle in the storm
folder turns the billboards off (channels remain).

The app also shows a storm-themed loading screen (percent, task, animated
bolt and progress bar) while shaders compile and buffers warm up.

Thunder reuses the existing `soundSystem.soundThunder(x, y, intensity)`
with flash position/intensity derived from completed strokes. While the
engine is enabled it owns lightning: the legacy random bolt spawner in
`precipitationShader.vert` is gated to zero via the `legacyLightningGate`
uniform.

## Performance

- ~5,000–40,000 super-particles (adaptive budget, exact-conserving merger).
- Field solve ~96×64 SOR. The engine is fed several simulated seconds per
  rendered frame, so the expensive global work runs at most once per call:
  particle integration uses ≤3 sub-steps (≈1 s each, stable because drag is
  integrated implicitly and every microphysical rate is clamped), the
  mean-field cohort pass and the SOR solve + lightning scan run once per
  call. This replaced a fixed 0.2 s sub-step cadence that made a 2.9 s frame
  pay for 15 full particle sweeps and five field solves — the main cause of
  frame hitching ("lag") during charge separation — and cut the per-frame
  cost of the physics core by roughly 5× at equal particle counts.
- Environment bilinear sampling is inlined (no per-call closure) and each
  particle is sampled once per sub-step; saturation densities come from a
  0.5 K lookup table.
- GPU column sampling spread across frames (3 columns/frame steady-state).
- Auto quality scaling lowers the particle budget if overlay CPU is high.
- URL override: `?storm=0` disables the system entirely; `Reset storm engine`
  in the GUI folder re-initializes.

## Hard rules honored

1. Lightning emerges from simulated charge separation — never random/timed.
2. Charge is assigned only by physical collision/field processes.
3. Charge regions form only from sedimentation/transport of charged
   particles — never hardcoded zones, and separated charge is always carried
   by real hydrometeor cohorts rather than vanishing into a bookkeeping
   ledger.
4. Every discharge measurably changes the storm's electrical state and
   conserves total charge (ground transfer ledgered).
5. Rendering derives from hydrometeor populations and solved fields — the
   lightning you see is the consequence of the storm's electrical physics.
