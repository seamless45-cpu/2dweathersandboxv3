#version 300 es
precision highp float;


layout(location = 0) in vec2 dropPosition;
layout(location = 1) in vec2 mass; //[0] water   [1] ice
layout(location = 2) in float density;

// transform feedback varyings:
out vec2 position_out;
out vec2 mass_out;
out float density_out;

// via fragmentshader to feedback framebuffers for feedback to fluid
out vec4 feedback;
out vec2 deposition; // for rain and snow accumulation on surface

vec2 texCoord;
vec4 water;
vec4 base;
float realTemp;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform sampler2D lightningDataTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float dryLapse;

uniform float iterNum;          // used as seed for random function
uniform float legacyLightningGate; // 1.0 = legacy random lightning on, 0.0 = storm physics engine owns lightning
uniform float numDroplets;      // total number of droplets
uniform bool compactFeedback; // half-float fallback uses a count rather than summed iteration numbers
uniform float precipPointSize; // limited by the GPU point-size range
uniform float inactiveDroplets; // used to maintain constant spawnrate

uniform float evapHeat;
uniform float meltingHeat;

// Precipitation tool brush: while the user is painting with the Precipitation
// tool, inactive droplets whose random spawn position lands inside the brush
// are released as rain or snow regardless of cloud cover. Position in
// normalized texture coordinates, radius in half-brush-size units of the
// circular brush used by the fluid pass, intensity is the brush intensity.
uniform vec4 precipBrush;     // xy = center, z = radius (brushSize * 0.5), w = intensity
uniform int precipBrushActive;
uniform bool precipBrushWrap;

// prcipitation settings:
uniform float aboveZeroThreshold; // 1.0
uniform float subZeroThreshold;   // 0.0
uniform float spawnChanceMult;    //
uniform float snowDensity;        // 0.2 - 0.5
uniform float fallSpeed;          // multiplier on drag-limited terminal velocity (1.0 = physical)
uniform float growthRate0C;       // 0.0005
uniform float growthRate_30C;     // 0.01
uniform float freezingRate;       // 0.0002
uniform float meltingRate;        // 0.0015
uniform float evapRate;           // 0.0005
uniform float simHeightM;           // simulation column height in meters
uniform float secondsPerIteration;  // 0.288 s per simulation iteration

#include "common.glsl"

vec2 newPos;
vec2 newMass;
float newDensity;

bool isActive = true;
bool spawned = false; // spawned in this iteration
bool lightningSpawned = false;

void disableDroplet()
{
  newMass[WATER] = -2. - dropPosition.x; // disable droplet by making it negative and save position as seed for respawning
  newMass[ICE] = dropPosition.y;         // save position as seed for random function when respawning later
}

void main()
{
  feedback = vec4(0.0);
  deposition = vec2(0.0);
  newPos = dropPosition;
  newMass = mass;         // amount of water and ice carried
  newDensity = density;   // determines fall speed

  if (mass[WATER] < 0.) { // inactive
                          /*
                          We have to generate a random position before we know if the droplet is actually gonna spawn, seems ineffcient but there is no way arround it.
                          This is because spawn chance depends on the conditions at the spawn position, we have to sample the textures for every inactive droplet. this is a huge performance bottleneck
                       */

                          // generate random spawn position: x and y from 0. to 1.
    // texCoord = vec2(random(mass[WATER] + iterNum), random(mass[ICE] + iterNum)); func2D
    // texCoord = vec2(func2D(vec2(mass[WATER], dropPosition.x), iterNum * 0.3754), func2D(vec2(mass[ICE], dropPosition.x), iterNum * 0.073162));

    texCoord = vec2(random2d(vec2(mass[WATER], dropPosition.x + iterNum * 0.3754)), random2d(vec2(mass[ICE], dropPosition.x + iterNum * 0.073162)));


    // In clear air below both spawn thresholds an inactive droplet cannot
    // spawn. Avoid the second random texture fetch and temperature work; the
    // brush can override cloud requirements, so it keeps the full path.
    water = texture(waterTex, texCoord);
    if (precipBrushActive != 1 && water[CLOUD] <= min(aboveZeroThreshold, subZeroThreshold)) {
      gl_PointSize = 1.0;
      feedback[MASS] = 1.0;
      gl_Position = compactFeedback ? vec4(2.0, 2.0, 0.0, 1.0) :
                    vec4(vec2(-1. + texelSize.x, -1. + texelSize.y), 0.0, 1.0);
      position_out = newPos;
      mass_out = newMass;
      density_out = max(newDensity, 0.0);
      return;
    }
    base = texture(baseTex, texCoord);

    // Precipitation tool: painting with the brush releases droplets directly
    // inside it, in any air, without needing cloud cover. A freezing paint
    // falls as snow, the rest as rain. Painted droplets never write the
    // lightning feedback, so the tool cannot stack strikes into dense clouds.
    bool painted = false;
    if (precipBrushActive == 1 && base[TEMPERATURE] < 500. && precipBrush.w > 0.0) {
      float brushDx = precipBrushWrap ? absHorizontalDist(precipBrush.x, texCoord.x) : abs(precipBrush.x - texCoord.x);
      vec2 brushVec = vec2(brushDx, precipBrush.y - texCoord.y);
      brushVec.x *= texelSize.y / texelSize.x; // aspect ratio correction, like the circular fluid brush
      float brushRadius = max(precipBrush.z * texelSize.y, 1e-5);
      if (length(brushVec) < brushRadius &&
          random2d(vec2(mass[WATER] * 1.71 + 3.3, mass[ICE] * 2.13 + iterNum * 0.77)) < clamp(precipBrush.w * 22.0, 0.2, 1.0))
        painted = true;
    }

    // check if position is okay to spawn
    realTemp = potentialToRealT(base[TEMPERATURE]); // in Kelvin

#define initalMass 0.15                             // 0.05 initial droplet mass
    float threshold;                                // minimal cloudwater before precipitation develops
    if (painted) {
      spawned = true;
      newPos = vec2((texCoord.x - 0.5) * 2., (texCoord.y - 0.5) * 2.); // convert texture coordinate (0 to 1) to position (-1 to 1)
      if (realTemp < CtoK(0.0)) {                  // below 0 C
        newMass[WATER] = 0.0;                      // enable
        newMass[ICE] = initalMass;                 // snow
        feedback[HEAT] += newMass[ICE] * meltingHeat;
        newDensity = snowDensity;
      } else {
        newMass[WATER] = initalMass;               // rain
        newMass[ICE] = 0.0;
        newDensity = 1.0;
      }
      feedback[VAPOR] -= initalMass;
    } else {
      if (realTemp > CtoK(0.0))
        threshold = aboveZeroThreshold;             // in above freezing conditions coalescence only happens in really dense clouds
      else                                          // the colder it gets, the faster ice starts to form
        //  treshHold = max(map_range(realTemp, CtoK(0.0), CtoK(-30.0), subZeroThreshold, initalMass), initalMass);
        threshold = subZeroThreshold;

    if (water[CLOUD] > threshold && base[TEMPERATURE] < 500.) { // if cloudwater above threshold and not wall
                                                                // float spawnChance = (water[1] - threshold) * 1000.0 / inactiveDroplets;
                                                                // if (spawnChance > rand2d(mass.xy)) {
                                                                //  float spawnChance = (water[CLOUD] - threshold) / inactiveDroplets * resolution.x * resolution.y * spawnChanceMult;

      float spawnChance = ((water[CLOUD] - threshold) / (inactiveDroplets + 10.0)) * resolution.x * resolution.y * spawnChanceMult; // 20.0  50.0

      //    float nrmRand = random2d(vec2(mass[WATER] * 0.98, iterNum * 0.98 + random(mass[ICE]))); // normalized random value

      float nrmRand = fract(pow(water[CLOUD] * 10.0, 2.0));

      if (spawnChance > nrmRand) {                                       // spawn precipitation particle
        spawned = true;
        newPos = vec2((texCoord.x - 0.5) * 2., (texCoord.y - 0.5) * 2.); // convert texture coordinate (0 to 1) to position (-1 to 1)

        if (realTemp < CtoK(0.0)) {                                      // below 0 C
          newMass[WATER] = 0.0;                                          // enable
          newMass[ICE] = initalMass;                                     // snow
          feedback[HEAT] += newMass[ICE] * meltingHeat;                  // add heat of freezing
          newDensity = snowDensity;

          const float lightningCloudDensityThreshold = 0.72;         // 3.0 -> 2.5 -> 1.6 -> 0.72
          // A *probability* per freezing droplet that spawns in a dense cloud, so it
          // has to stay well under one. It was 2.72 here, which is not a chance at
          // all: every spawning droplet in a dense cloud qualified, hundreds of them
          // wrote into the same feedback texel in one iteration, and the slot pass
          // threw the summed record away (see lightningLocationShader.frag). The
          // density of the cloud is what decides, and the cooldown below is what
          // paces it.
          const float lightningChanceMultiplier = 0.0075;            // 0.0011 -> 0.0033 -> 0.0075

          float cloudPlusPrecipDensity = water[CLOUD] + water[PRECIPITATION];

          float lightningSpawnChance = max((cloudPlusPrecipDensity - lightningCloudDensityThreshold) * lightningChanceMultiplier, 0.);
          lightningSpawnChance *= legacyLightningGate; // 0 when legacy cloud-density lightning is disabled

          // Lightning slots: every running strike owns one slot until its own
          // animation has finished (see lightningLocationShader.frag), so a new
          // strike may only start when a slot is idle. There is no fixed iteration
          // cooldown between strikes: whenever a freezing droplet triggers
          // lightning and any of the LIGHTNING_SLOTS slots is idle, either an
          // intra-cloud flash or a cloud-to-ground bolt spawns immediately.
          // The probability roll is independent of slot state. Most ice
          // spawns cannot trigger lightning, so only those that pass need to
          // fetch and inspect the slot textures.
          bool lightningSlotFree = false;
          if (random2d(vec2(base[TEMPERATURE] * 0.99, water[TOTAL] * 17.2)) < lightningSpawnChance) {
            for (int i = 0; i < LIGHTNING_SLOTS; i++) {
              vec4 slotData = texelFetch(lightningDataTex, ivec2(i, 0), 0);
              vec4 slotMeta = texelFetch(lightningDataTex, ivec2(i, 1), 0);
              if (!(slotData[START_ITERNUM] > 0. && iterNum < lightningSlotEnd(slotData, slotMeta))) {
                lightningSlotFree = true;
                break;
              }
            }
          }

          if (lightningSlotFree) { // Spawn lightning
            lightningSpawned = true;
            isActive = false;
            gl_PointSize = 1.0;
            feedback.xy = texCoord;
            feedback[START_ITERNUM] = compactFeedback ? 1.0 : iterNum;
            feedback[INTENSITY] = clamp(cloudPlusPrecipDensity / 10.0 + (random2d(texCoord) - 0.15), 0.75, 4.5);
            gl_Position = vec4(vec2(-1. + texelSize.x * 3., -1. + texelSize.y), 0.0, 1.0); // render to bottem left corner (1, 0)
          }
        } else {
          newMass[WATER] = initalMass; // rain
          newMass[ICE] = 0.0;
          newDensity = 1.0;
        }
        if (!lightningSpawned)
          feedback[VAPOR] -= initalMass;
      }
    }
    }

    if (spawned) {
      if (!lightningSpawned) {
        gl_PointSize = 1.0;
        gl_Position = vec4(newPos, 0.0, 1.0);
      }
    } else { // still inactive
      isActive = false;
      gl_PointSize = 1.0;
      feedback[MASS] = 1.0;                                                     // count 1 inactive droplet
      gl_Position = compactFeedback ? vec4(2.0, 2.0, 0.0, 1.0) :
                    vec4(vec2(-1. + texelSize.x, -1. + texelSize.y), 0.0, 1.0); // CPU counts compact-mode inactive droplets
                                                                                // return;
    }
  }

  if (isActive) {
    if (!spawned) {                               // these values are already set if the droplet just spawned
      texCoord = vec2(dropPosition.x / 2. + 0.5,
                      dropPosition.y / 2. + 0.5); // convert position (-1 to 1) to texture coordinate (0 to 1)
      water = texture(waterTex, texCoord);
      base = texture(baseTex, texCoord);
      realTemp = potentialToRealT(base[TEMPERATURE]); // in Kelvin
    }

    float relativeHumidity = relativeHumd(realTemp, water[TOTAL]);

    float totalMass = newMass[WATER] + newMass[ICE];

    if (totalMass < 0.04) { // to small
                            // evaporation of residual droplet
      feedback[HEAT] = -(totalMass * evapHeat);
      feedback[VAPOR] = totalMass;

      disableDroplet();

    } else if (newPos.y < -1.0 /* || base[TEMPERATURE] > 500. */ || water[TOTAL] > 1000.) { // water[TOTAL] > 1000.     base[TEMPERATURE] < 500.      to low or wall

      if (texture(baseTex, vec2(texCoord.x, texCoord.y + texelSize.y))[TEMPERATURE] > 500.) // if above cell was already wall. because of fast fall speed
        newPos.y += texelSize.y * 1.;                                                       // *2. ? move position up so that the water/snow is correcty added to the ground

      deposition[RAIN_DEPOSITION] = newMass[WATER];                                         // rain accumulation
      deposition[SNOW_DEPOSITION] = newMass[ICE];                                           // snow accumulation

      disableDroplet();

    } else { // update droplet

      // float surfaceArea = sqrt(totalMass); // As if droplet is a circle (2D)
      float surfaceArea = pow(totalMass, 1. / 3.); // As if droplet is a sphere (3D)

      // float growthRate = clamp(map_range(realTemp, CtoK(0.0), CtoK(-30.0), growthRate0C, growthRate_30C), growthRate0C, growthRate_30C); // the colder it gets the faster ice forms
      float growthRate = max(map_range(realTemp, CtoK(0.0), CtoK(-30.0), growthRate0C, growthRate_30C), growthRate0C); // the colder it gets the faster ice forms

      // growthRate = 0.0;                                                                                                                  // for debug

      float growth = water[CLOUD] * growthRate * surfaceArea;

      growth += max(relativeHumidity - 1.0, 0.) * max(-30.0 - KtoC(realTemp), 0.) * 0.0001; // increase growthrate below -30 C and above 100% relative humidity


      // Hail growth enhancement:
      if (realTemp < CtoK(0.0) && water[CLOUD] > 0.0 && density == 1.0) { // below freezing
        growth += surfaceArea * water[PRECIPITATION] * 0.0030;            // rain freezing onto hail
      }

      feedback[VAPOR] -= growth * 1.0; // takes water from the air


      if (realTemp < CtoK(0.0)) { // below freezing

        newMass[ICE] += growth;   // ice growth
        feedback[HEAT] += growth * meltingHeat;

        float freezing = min((CtoK(0.0) - realTemp) * freezingRate * surfaceArea, newMass[WATER]); // rain freezing
        newMass[WATER] -= freezing;
        newMass[ICE] += freezing;
        feedback[HEAT] += freezing * meltingHeat;

      } else {                                                                                                    // above freezing
        newMass[WATER] += growth;                                                                                 // water growth

        float melting = min((realTemp - CtoK(0.0)) * meltingRate * surfaceArea /* / newDensity */, newMass[ICE]); // 0.0002 snow / hail melting
        newMass[ICE] -= melting;
        newMass[WATER] += melting;
        feedback[HEAT] -= melting * meltingHeat;

        newDensity = min(newDensity + (melting / totalMass) * 1.00,
                         1.0); // density increases upto 1.0 as snow melts
      }

      float dropletTemp = potentialToRealT(base[TEMPERATURE]);                                       // should be wetbulb temperature...

      if (newMass[ICE] > 0.0)                                                                        // if any ice
        dropletTemp = min(dropletTemp, CtoK(0.0));                                                   // temp can not be more than 0 C

      float evapAndSubli = max((maxWater(dropletTemp) - water[TOTAL]) * surfaceArea * evapRate, 0.); // 0.0005 evaporation and sublimation only positive

      // evapAndSubli = 0.0000;                                                                         // remove quickly for DEBUG

      float evap = min(newMass[WATER], evapAndSubli);       // can only evaporate as much water as it contains
      float subli = min(newMass[ICE], evapAndSubli - evap); // the rest is ice sublimation, upto the amount of ice it contains

      newMass[WATER] -= evap;                               // water evaporation
      newMass[ICE] -= subli;                                // ice sublimation

      feedback[VAPOR] += evap;                              // added to water vapor in air
      feedback[VAPOR] += subli;
      feedback[HEAT] -= evap * evapHeat;                    // heat cost extracted from air
      feedback[HEAT] -= subli * evapHeat;
      feedback[HEAT] -= subli * meltingHeat;

      // Update position
      // move with air    * 2. because droplet position goes from -1. to 1
      newPos += base.xy / resolution * 2.;

      // Drag-limited terminal velocity. The chosen mass unit is 6.5e-5 kg, so a
      // 1.0-mass droplet is a ~5 mm drop. Equilibrium between gravity and the
      // quadratic (high-Reynolds, Clift-Gauvin) drag on the projected sphere
      // gives the fall speed; a low-density snowflake the same volume of air
      // has far more area relative to its mass and falls slowly, while a big
      // raindrop falls at ~6-9 m/s. Air density thins with altitude (exponential
      // atmosphere, scale height ~8.4 km) so drops accelerate slightly as they
      // fall through the column. Reynolds number is iterated three times from a
      // typical raindrop seed.
      const float pi = 3.141592653589793;
      float dropDensity = 1000.0 * clamp(newDensity, 0.05, 4.0);   // kg/m^3: rain/ice 1000, snow slider-scaled
      const float massUnitKg = 6.5e-5;                             // kg per mass unit
      float massKg = totalMass * massUnitKg;
      float diameter = pow(6.0 * massKg / (pi * dropDensity), 1.0 / 3.0);
      float altitudeM = clamp(newPos.y * 0.5 + 0.5, 0.0, 1.0) * simHeightM;
      float rhoAir = 1.225 * exp(-altitudeM / 8434.0);             // kg/m^3
      const float muAir = 1.81e-5;                                 // Pa s, dynamic viscosity
      const float gAccel = 9.81;
      float projectedArea = pi * 0.25 * diameter * diameter;
      float terminalVel = 6.0;                                     // m/s seed: typical raindrop
      for (int dragIter = 0; dragIter < 3; dragIter++) {
        float re = max(rhoAir * terminalVel * diameter / muAir, 1e-3);
        float cd = 24.0 / re * (1.0 + 0.15 * pow(re, 0.687)) + 0.42 / (1.0 + 42500.0 / pow(re, 1.16));
        terminalVel = sqrt(2.0 * massKg * gAccel / max(rhoAir * cd * projectedArea, 1e-12));
      }
      terminalVel = clamp(terminalVel * fallSpeed, 0.05, 40.0);
      // m/s to normalized clip units per iteration (full height = 2 * simHeightM)
      newPos.y -= terminalVel * secondsPerIteration / simHeightM * 2.0;

      newPos.x = mod(newPos.x + 1., 2.) - 1.; // wrap horizontal position around map edges

      // Particles leaving the open top join the exterior reservoir rather than
      // sampling a clamped top row indefinitely or depositing on the ground.
      if (newPos.y >= 1.0) {
        disableDroplet();
        feedback = vec4(0.0);
        newPos.y = 2.0;
      } else {
        feedback[MASS] = totalMass;
      }

    }               // update

    float pntSize = max(precipPointSize, 1.0);
    float pntSurface = pntSize * pntSize;
    // devide by suface area to keep total amount constant
    feedback[MASS] /= pntSurface;
    feedback[HEAT] /= pntSurface;
    feedback[VAPOR] /= pntSurface;

    deposition[RAIN_DEPOSITION] /= pntSize; // only width matters because it's only applied at surface layer
    deposition[SNOW_DEPOSITION] /= pntSize; // only width matters because it's only applied at surface layer

    gl_PointSize = pntSize;

    gl_Position = vec4(newPos, 0.0, 1.0);
  } // active

  position_out = newPos;
  mass_out = newMass;
  density_out = max(newDensity, 0.);
}
