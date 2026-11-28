# Physics

Modules that give the 2D weather sandbox its storm physics.

## Complex charge separation (`chargeSeparationShader.frag` + `chargeSeparation.js`)

A reduced model of thunderstorm electrification based on **non-inductive
graupel–ice charging** (Takahashi 1978; Saunders & Peck 1998). It replaces the
legacy "a freezing droplet spawned in a dense cloud, roll the dice" lightning
trigger with a physical one.

**Enable it:** Physics folder → **Complex Charge Separation** (default **off**).
When off, nothing in this module runs and the simulation behaves exactly as it
did before; the legacy trigger stays in charge. When on, the legacy gate in the
precipitation shader is closed and only charge-initiated strikes fire.

### What it does, per simulation iteration

1. Finds the **mixed-phase populations**: supercooled cloud water (small ice
   crystals, peaking near −15 °C) and riming precipitation (graupel), each
   weighted by temperature.
2. Computes **collision charging**: rebounding crystal–graupel collisions
   transfer charge (`crystal × graupel × relative velocity`).
3. Picks the **sign regime** from the Takahashi reversal temperature. More
   liquid water shifts the reversal warmer (−20 °C dry … −8 °C saturated):
   below it graupel charges negative (the classic tripole), above it the
   regime inverts.
4. **Separates** the carriers semi-Lagrangian: crystals are lofted by the
   updraft toward the anvil, graupel sediments toward the base. Only an
   updraft stronger than ~0.2 m/s does electrical work, so charge separation
   shuts off in the downdraft flanks — like a real storm.
5. Accumulates a per-cell **breakdown reservoir** (the separation work). At
   the threshold the cell **flashes**: ~88 % of its separated charge
   recombines, it enters a cooldown (~35 s), and it writes a flash sentinel
   (negative reservoir, magnitude = intensity).
6. A tiny point-scan pass re-emits the flashing cells into a 1×1 feedback
   texel with additive blending — the same encoding the precipitation pass
   uses — and the lightning slot manager consumes it like any other strike.

Strike intensity scales with collision power at breakdown: weak cells fire
intra-cloud flashes (intensity ≤ 1.0), violent cores fire cloud-to-ground
return strokes (up to ~4.4). Tall cold clouds keep their existing
positive-stroke/external-bolt odds inside the slot manager.

### Files

| File | Role |
| --- | --- |
| `chargeSeparationShader.frag` | Per-cell model pass (runs every iteration when enabled) |
| `chargeSeparation.js` | GPU driver: state ping-pong, 1×1 strike feedback, tuning + pure model helpers |
| `README.md` | This file |

### Not modelled (deliberately)

* A Poisson solve for the actual field geometry — the reservoir stands in for
  the dipole strength; strike *location* fidelity is cell-local.
* Radar reflectivity/polarimetry of the charging zone.
* Tripole *layering* is implicit in the carrier transport, not resolved per
  layer.

These keep the system at one fullscreen pass plus a cheap point scan per
iteration, which is the performance envelope the rest of the simulation lives in.
