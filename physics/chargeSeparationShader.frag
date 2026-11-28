#version 300 es

// Complex charge separation system — non-inductive graupel–ice charging.
//
// This pass replaces the legacy cloud-density lightning trigger with a real
// (reduced) model of thunderstorm electrification. It runs once per
// simulation iteration and tracks, per cell, the charge carried by the two
// carrier populations in a mixed-phase cloud:
//
//   * small ice crystals — light, charged by rebounding collisions with
//     graupel, and lofted by the updraft toward the anvil (state channel R);
//   * graupel — dense riming hydrometeors that charge with the opposite
//     sign and settle toward the cloud base (state channel G).
//
// Because the two carriers move in opposite directions through the same
// parcel, the updraft does electrical work on the cloud: this is what
// "non-inductive" charging means — no pre-existing field is required. Once
// enough separation work has accumulated in a cell (the "breakdown reservoir",
// state channel B), the cell flashes: it dumps most of its separated charge,
// writes the flash marker into channel B (negative value; its magnitude is
// the discharge intensity) for the feedback emitter to pick up, and enters a
// cooldown (channel A) so one supercell cannot fire every single iteration.
//
// The sign regime follows the Takahashi (1978) result: graupel charges
// negatively below a liquid-water-dependent "reversal temperature" and
// positively above it. High liquid water content shifts the reversal to
// warmer temperatures, which is why the warmest, wettest core of a maritime
// storm can charge in the inverted regime while the colder anvil charges in
// the classic tripole regime: positive charge lofted to the top, negative
// settling in the middle, a weaker positive pocket near the base.
//
// This is a reduced model, not a full nonhydrostatic electrification scheme:
// it keeps the 2.5-dimensional structure of the simulation, uses column-local
// physics, and represents the electric field through the accumulated
// separation work instead of solving Poisson's equation every iteration. It
// produces the behaviours that matter here: lightning is initiated where
// strong updrafts, supercooled liquid water and ice coexist; the strike
// origin is the charged cell, not a random freezing droplet; and strong
// storms flash harder and more often than weak convection.

precision highp float;
precision highp sampler2D;

in vec2 texCoord; // normalized position in the grid

// base texture: .x horizontal velocity, .y vertical velocity (raw units of
// cells per iteration; positive y is upward), .z pressure, .w potential temperature
uniform sampler2D baseTex;
// water texture: .x total water vapor+cloud, .y cloud water, .z precipitation
// (or soil moisture at the surface), .w smoke / surface snow
uniform sampler2D waterTex;
// previous state, ping-ponged:
//   .r  charge carried by ice crystals (signed), normalized units
//   .g  charge carried by graupel (signed), normalized units
//   .b  breakdown reservoir; negative => "a flash was initiated this
//        iteration", magnitude = discharge intensity (consumed same-iteration)
//   .a  flash cooldown (1 = just discharged, decays toward 0)
uniform sampler2D chargeTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float dryLapse;              // K per full column (its y-fraction scales with height)
uniform float secondsPerIteration;   // simulation seconds per iteration (0.288)
uniform float velocityToMs;          // raw velocity -> m/s (cellHeight / (timePerIteration * 3600))
uniform float crystalFallRaw;        // ice-crystal terminal velocity in raw cells/iteration
uniform float graupelFallRaw;        // graupel terminal velocity in raw cells/iteration
uniform float wrapHorizontally;      // 1.0 => wrap x like the simulation, 0.0 => clamp
uniform float chargeEnergyCoefficient; // separation work produced per collision
uniform float breakdownReservoir;    // reservoir level at which a flash is initiated

out vec4 charge;

#define VY 1
#define TEMPERATURE 3
#define TOTAL 0
#define CLOUD 1
#define PRECIPITATION 2

float gaussianBand(float value, float centre, float width)
{
  float d = (value - centre) / width;
  return exp(-d * d);
}

// Linear ramp that never sees unordered edges (unlike smoothstep).
float ramp(float value, float zeroAt, float oneAt)
{
  return clamp((value - zeroAt) / (oneAt - zeroAt), 0.0, 1.0);
}

// Takahashi (1978) reversal temperature, °C: graupel charges negatively
// below this line and positively above it. More liquid water shifts the
// reversal warmer, so a saturated warm core charges in the normal
// (graupel-negative) regime even at temperatures where a dry cloud would
// charge inverted.
float reversalTemperatureC(float liquidWaterContent)
{
  return mix(-20.0, -8.0, clamp((liquidWaterContent - 0.5) / 3.5, 0.0, 1.0));
}

// Separation efficiency: only an updraft that can loft the light crystals
// against the graupel's fall speed does electrical work on the cell.
// 0 below 0.2 m/s, saturates at 1.25 near 4 m/s.
float separationEfficiency(float updraftMs)
{
  return clamp((updraftMs - 0.2) / 3.0, 0.0, 1.25);
}

void main()
{
  const float RESERVOIR_GAIN = 3.0;       // separation work -> reservoir units
  const float COOLDOWN_DECAY = 0.985;     // per iteration; back to ready in ~120 steps
  const float COOLDOWN_FLASH_MIN = 0.15;  // flash only when the cell has recovered
  const float FLASH_CHARGE_FRACTION = 0.12; // 88% of the separated charge neutralizes
  const float RESERVOIR_COOLDOWN_CAP = 1.6; // reservoir cap while the cell recovers

  vec4 previous = texelFetch(chargeTex, ivec2(gl_FragCoord.xy), 0);
  // The negative sentinel was the flash marker for the emitter; consume it.
  float reservoir = max(previous.b, 0.0);
  float cooldown = clamp(previous.a, 0.0, 1.0);

  vec4 base = texture(baseTex, texCoord);
  vec4 water = texture(waterTex, texCoord);

  // Walls carry no hydrometeors and cannot charge.
  if (base[TEMPERATURE] >= 500.0) {
    charge = vec4(0.0);
    return;
  }

  // Potential temperature -> real temperature.
  float realT = base[TEMPERATURE] - texCoord.y * dryLapse;
  float tC = realT - 273.15;

  float cloud = max(water[CLOUD], 0.0);
  float precip = max(water[PRECIPITATION], 0.0);

  // --- supercooled mixed-phase populations -------------------------------
  // Small ice crystals: nucleate in the mixed-phase layer and are the
  // lofted, fast-growing carrier. They exist between about 0 and -38 C.
  float mixedWeight = gaussianBand(tC, -15.0, 11.0) * ramp(-tC, 0.0, 4.0) * ramp(tC + 38.0, 0.0, 4.0);
  float crystalMass = cloud * mixedWeight;
  // Graupel: dense riming hydrometeors, loaded with supercooled water, most
  // efficient in the colder part of the mixed-phase layer.
  float graupelWeight = gaussianBand(tC, -10.0, 15.0) * ramp(-tC, 0.0, 2.0);
  float graupelMass = precip * graupelWeight;

  // --- reversal temperature (Takahashi) -----------------------------------
  float reversalC = reversalTemperatureC(cloud);
  float graupelSign = (tC < reversalC) ? -1.0 : 1.0; // graupel negative below reversal

  // --- non-inductive collision charging -----------------------------------
  float updraftMs = base[VY] * velocityToMs;         // positive = upward
  float approachSpeed = abs(updraftMs) + 4.0;        // graupel settles ~4 m/s through crystals
  float collisionPower = crystalMass * graupelMass * approachSpeed;
  float chargeTransfer = collisionPower * chargeEnergyCoefficient;

  // --- separation: the updraft lifts crystals, graupel falls out ---------
  float separation = separationEfficiency(updraftMs);

  // Semi-Lagrangian advection of each carrier population (crystals loft,
  // graupel sediments). The reservoir and cooldown stay with the cell.
  vec2 crystalBack = texCoord - vec2(base.x, base[VY] - crystalFallRaw) * texelSize;
  vec2 graupelBack = texCoord - vec2(base.x, base[VY] - graupelFallRaw) * texelSize;
  if (wrapHorizontally > 0.5) {
    crystalBack.x = fract(crystalBack.x);
    graupelBack.x = fract(graupelBack.x);
  } else {
    crystalBack.x = clamp(crystalBack.x, texelSize.x * 0.5, 1.0 - texelSize.x * 0.5);
    graupelBack.x = clamp(graupelBack.x, texelSize.x * 0.5, 1.0 - texelSize.x * 0.5);
  }
  crystalBack.y = clamp(crystalBack.y, texelSize.y * 0.5, 1.0 - texelSize.y * 0.5);
  graupelBack.y = clamp(graupelBack.y, texelSize.y * 0.5, 1.0 - texelSize.y * 0.5);

  float qCrystal = texture(chargeTex, crystalBack).r;
  float qGraupel = texture(chargeTex, graupelBack).g;

  // Local injection: crystals take the opposite sign of the graupel they
  // collided with.
  qCrystal -= graupelSign * chargeTransfer;
  qGraupel += graupelSign * chargeTransfer;

  // --- neutralization ------------------------------------------------------
  // Ions attach to whatever aerosol surface exists; clear air bleeds charge
  // fast, a dense cloud shields it.
  float hydrometeorFraction = clamp((cloud + precip) * 6.0, 0.0, 1.0);
  float tau = mix(8.0, 150.0, hydrometeorFraction); // seconds
  float decay = exp(-secondsPerIteration / tau);
  qCrystal *= decay;
  qGraupel *= decay;

  // --- breakdown reservoir -------------------------------------------------
  reservoir = reservoir * decay + collisionPower * separation * chargeEnergyCoefficient * RESERVOIR_GAIN;
  cooldown *= COOLDOWN_DECAY;

  // --- rate-limited breakdown ------------------------------------------------
  if (cooldown > COOLDOWN_FLASH_MIN) {
    // Still recovering: the cell cannot fire, and the reservoir is capped so
    // it cannot store up an unrealistic charge either.
    reservoir = min(reservoir, breakdownReservoir * RESERVOIR_COOLDOWN_CAP);
  } else if (reservoir >= breakdownReservoir) {
    // Flash! Intensity scales with the collision power at breakdown: a weakly
    // charged cell fires an intra-cloud flash, a violent core fires a
    // cloud-to-ground return stroke.
    float power = clamp(collisionPower / 3.0, 0.0, 1.0);
    float intensity = 0.78 + 3.6 * pow(power, 1.6);
    charge = vec4(qCrystal * FLASH_CHARGE_FRACTION, // 88% of the charge recombines
                  qGraupel * FLASH_CHARGE_FRACTION,
                  -intensity,                       // sentinel consumed by the emitter
                  1.0);                             // cooldown
    return;
  }

  charge = vec4(qCrystal, qGraupel, reservoir, cooldown);
}
