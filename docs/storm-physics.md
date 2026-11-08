# Storm Physics & Electricity (stormsim.js / stormview.js)

A physically based atmospheric microphysics, charge-separation and lightning
engine layered onto the fluid weather sandbox. Everything visible — cloud,
precipitation, electrification, lightning — **emerges** from underlying
physics. There are no scripted lightning shapes, no flash timers detached
from the simulated fields, and no hardcoded charge regions.

## Architecture

| File | Role |
| --- | --- |
| `stormsim.js` | Physics core (plain JS, no GL). Hydrometeor super-particles, microphysics kernels, Poisson field solver, leader/stroke channel model, strict signed-charge ledger. |
| `stormview.js` | Live integration: strided GPU-column sampling of the fluid state into the storm environment, real-time stepping, WebGL2 overlay rendering, thunder sound hooks, dat.GUI folder, adaptive quality. |
| `lightningGenerator.js` | Procedural lightning artwork in a Worker. `mode:'CG'` produces the classic downward bolt used by the legacy cloud-density lightning; `mode:'IC'` produces a wide, flat, heavily forked intra-cloud flash confined to a horizontal band. |
| `shaders/storm/*` | GLSL overlay programs: `points.vert/.frag` (hydrometeor sprites), `field.frag`+`quad.vert` (charge density / E magnitude / potential), `lines.vert/.frag` (lightning channels), `ic.vert/.frag` (additive intra-cloud flash billboards), `arrows.vert/.frag` (E vectors). |
| `tests/stormsim.test.js` | 37-assertion regression suite (synthetic storm + calm control + strided-update integration + adaptive-budget conservation). Run: `node tests/stormsim.test.js`. |
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

6. **Emergent lightning.** Lightning has two initiation paths, both driven
   by simulated fields:

   **Cloud-density IC initiation (primary path).** An intra-cloud flash is
   born from the *cloud*, not from the charge pattern. A strided scan of the
   environment (bounded at ≈2000 texels per call, so cost is independent of
   the environment resolution) collects mixed-phase texels (0 … −40 °C)
   whose **cloud + precipitation water exceeds `cloudTriggerThreshold`**
   (default **0.8** model units ≈ ordinary cloudy air; the legacy shader
   threshold was 1.6), and one site is chosen with a density-weighted random
   draw so consecutive flashes scatter through the dense core. Initiation is
   then a Poisson streamer process with rate **`icSpawnRate` = 2.2 s⁻¹**,
   scaled by how far the local density exceeds the threshold, with a short
   refractory period (0.4 s) and a ceiling of 8 concurrent channels. No
   charge density and no |E| is consulted: a dense electrified cloud
   initiates on its own, which is why IC flashes appear as soon as a storm is
   deep enough — and why a charge-free control run still flashes (asserted in
   the tests). Each flash then drains the charge it passes through.

   **Field/charge initiation (CG and clear air).** The classic breakdown rule
   is retained for ground strikes and clear-air flashes: strongest
   solved-field cells are ranked, an opposite-charge pocket (or ground/space)
   must be reachable along the field (`topFieldCells` + `_oppositeChargeReach`),
   the humidity- and cloud-corrected breakdown level must be exceeded, and a
   stochastic streamer gate decides. In dense cloud the breakdown level is
   reduced by up to 34 %.

   **IC leaders propagate by cloud density.** A tip keeps extending while it
   stays inside cloud denser than 45 % of the trigger threshold; it steers up
   the horizontal density gradient with an outward (space-charge) drive,
   damps vertical motion ×0.22 and is confined to a ±750 m sheet around its
   birth level. Forking probability rises with density (up to 16 % per step),
   and a channel completes when it leaves the dense cloud, spans ≥1.6 km and
   enters an opposite-charge pocket, or hits its extent cap (55 % of the domain
   width, ≤16 km) / 640-node budget.
   Measured geometry: **91–100 % of flashes wider than tall, median ≈7.6 km
   wide × ≈0.8 km thick**, always airborne. Counting is not charge-driven
   either: a flash is a flash whether or not it happens to catch charge.

   Flash types are discriminated by their attachment:
   * **CG** — low, strong-field sites; leaders descend to the ground and
     deliver 1–3 bright return strokes with continuing current.
   * **IC** — inside the cloud, triggered by cloud density (above) and grown
     through the densest air. They discharge as 2–4 dim sub-strokes
     (K-changes), spread the transported charge across the far end of the
     channel, and never become ground strikes.
   * **CA** — clear-air flash when breakdown occurs outside cloud.

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
- The IC trigger's cloud scan is bounded to ≈2000 texels per physics call
  (stride scales with the environment resolution) and IC leaders are capped
  at 640 nodes / 2400 steps, so a storm flashing on every physics step still
  costs ~1.5 ms of the frame (measured: 1.1 ms leader growth, 0.2 ms end
  stroke, 0.05 ms cloud scan).
- Density flashes actually *lower* the average frame cost (20–23 ms vs
  28–29 ms with the trigger disabled at equal settings) because they keep the
  storm's charge and particle population from ballooning.
- GPU column sampling spread across frames (3 columns/frame steady-state).
- Auto quality scaling lowers the particle budget if overlay CPU is high.
- URL override: `?storm=0` disables the system entirely; `Reset storm engine`
  in the GUI folder re-initializes.

## Hard rules honored

1. Lightning emerges from simulated fields — cloud density for the
   intra-cloud trigger, separated charge and the solved field for
   ground-strike breakdown — never from a scripted timer or a hardcoded
   flash. Thin cloud and the calm-atmosphere control produce no flashes.
2. Charge is assigned only by physical collision/field processes.
3. Charge regions form only from sedimentation/transport of charged
   particles — never hardcoded zones, and separated charge is always carried
   by real hydrometeor cohorts rather than vanishing into a bookkeeping
   ledger.
4. Every discharge measurably changes the storm's electrical state and
   conserves total charge (ground transfer ledgered).
5. Rendering derives from hydrometeor populations and solved fields — the
   lightning you see is the consequence of the storm's electrical physics.
