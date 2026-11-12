precision highp int;
precision highp isampler2D;

#define PI 3.1415926535897932384626433832795
#define rad2deg 57.2958
#define deg2rad 0.0174533


#define lightHeatingConst 0.000002   // how much a unit of IR or sunlight (W/m2) changes the temperature per iteration

#define standardSunBrightness 1250.; // W/m2

#define maxWaterTemp 40.0

#define waterHeatExchangeRate 0.0002

#define waterHeatCapacity 50.0     // as multiple of airs heat capacity

#define fullGreenSoilMoisture 50.0 // level of soil moisture where vegetation reaches the greenest color
#define depositionMassToSoilWaterMm 0.1

#define fullWhiteSnowHeight 10.0   // snow height at witch full whiteness is displayed and max albedo is achieved
#define snowMassToHeight 0.05

#define snowMeltRate 0.000015


#define ALBEDO_SNOW 0.85        // above 10 cm of snow cover without vegetation
#define ALBEDO_SNOW_FOREST 0.30 // at max vegetation and above 10 cm of snow
#define ALBEDO_FOREST 0.10
#define ALBEDO_DRYSOIL 0.30     // desert sand
#define ALBEDO_WETSOIL 0.15     // above 20 mm of soil moisture
#define ALBEDO_URBAN 0.08
#define ALBEDO_INDUSTRIAL 0.08
#define ALBEDO_RUNWAY 0.04
#define ALBEDO_WATER 0.05

// TEXTURE DESCRIPTIONS AND DEFINES

// base texture: RGBA32F
// .x  Horizontal velocity                              -1.0 to 1.0
// .y  Vertical   velocity                              -1.0 to 1.0
#define VX 0
#define VY 1
#define PRESSURE 2    // Pressure                                          >= 0
#define TEMPERATURE 3 // Temperature in air and water, indicator in wall

// water texture: RGBA32F
#define TOTAL 0         // Vapor + cloud water             >= 0
#define CLOUD 1         // cloud water                     >= 0
#define PRECIPITATION 2 // precipitation in air            >= 0
#define SOIL_MOISTURE 2 // moisture in surface             >= 0
#define SMOKE 3         // smoke/dust in air               >= 0 for smoke/dust
#define SNOW 3          // snow at surface in cm           0 to 40000

// wall texture: RGBA8I
#define TYPE 0 //             walltype:

#define WALLTYPE_INERT 0
#define WALLTYPE_LAND 1
#define WALLTYPE_WATER 2 // lake / sea
#define WALLTYPE_FIRE 3
#define WALLTYPE_URBAN 4
#define WALLTYPE_RUNWAY 5
#define WALLTYPE_INDUSTRIAL 6

#define DISTANCE 1      // manhattan distance to nearest wall                   0 to 127
#define VERT_DISTANCE 2 // height above/below ground. Surface = 0               -127 to 127
#define VEGETATION 3    // vegetation 0 to 127     grass from 0 to 50, trees from 51 to 127


//  light texture: RGBA32F
#define SUNLIGHT 0    // sunlight                                             0 to 1.0
#define NET_HEATING 1 // net heating effect of IR + sun absorbed by smoke
#define IR_DOWN 2     // IR coming down                                       >= 0
#define IR_UP 3       // IR going  up                                         >= 0

// Precipitation mass:
#define WATER 0
#define ICE 1

// Precipitation feedback
#define MASS 0
#define HEAT 1
#define VAPOR 2
// 3 not used

// Lightning Location
// #define POSX 0
// #define POSY 1
#define START_ITERNUM 2
#define INTENSITY 3

// Lightning slot array. Every strike owns one slot for its entire animation,
// so a newer strike can never cut a running one short. Keep this in sync with
// numLightningSlots in app.js.
//
// How many: a storm in a cold cloud tries to start a strike on almost every
// iteration (a frozen particle forms somewhere constantly), so this is the
// lightning rate. With four slots a typical storm had every slot booked and
// most attempts dropped, which is why the flash that did happen arrived at a
// time nothing in the cloud asked for - the strike waited for whichever slot
// freed last. Six slots halves that wait: the last attempt to be turned away
// waits about a third as long (measured, tests/check-lightning-strikes.js).
// More than that buys little and costs a 2D texture fetch per slot per pixel
// in the display pass.
#define LIGHTNING_SLOTS 6
// Longest a strike can possibly animate, in iterations - a bound, not a timer.
// A strike is not held for this long: strikeAnimEnd() below works out how long
// that particular strike lasts, and a slot is released the moment its own light
// is over. lightningTime advances 5 iterations per unit (calcLightningTime), the
// flicker period is < 3 units, the flicker count is floor(< 2 * intensity - 1) <= 7
// for the maximum intensity of 4.5, and the brightness reaches zero at T = 2.924
// (lightningIntensityOverTime). So the longest flash is
// 5 * (3 * 7 + 2.924) = 119.6 iterations; 126 keeps a margin.
#define LIGHTNING_ANIM_ITERS 126.0

// Strikes at or below this intensity are intra-cloud flashes - born inside a
// cloud rather than at its base - and above it they are cloud-to-ground return
// strokes. Both are drawn with the same bolt artwork and the same light now, so
// this is a fact about the strike, not a choice of picture: it is what the
// lightning rod snaps to (only a stroke reaches the ground) and what the
// location and display passes use to tell the two kinds apart.
#define LIGHTNING_IC_MAX_INTENSITY 1.0

// Lightning rods. A rod is placed with the Lightning Rod tool; it is a mast
// standing on the terrain that pulls nearby CG strikes onto itself. Keep in
// sync with MAX_LIGHTNING_RODS in app.js.
#define MAX_LIGHTNING_RODS 6

// Precipitation deposition
#define RAIN_DEPOSITION 0
#define SNOW_DEPOSITION 1

float finiteClamp(float value, float fallback, float minValue, float maxValue)
{
  return (isnan(value) || isinf(value)) ? fallback : clamp(value, minValue, maxValue);
}

// The ceiling of the HDR scene, and the one function that may write to it.
//
// The scene is rendered into an RGBA16F framebuffer, whose largest finite value
// is 65504. A cloud-to-ground return stroke is written at a hundred thousand HDR
// units and up, so a plain clamp turns every bolt into exactly the same value -
// the ceiling - and there is no headroom left to tell a strong stroke from a weak
// one. softHdrClamp() compresses the top of the range instead: it is the identity
// below a few hundred HDR units (where clouds, the sky and an intra-cloud flash
// live), it is monotonic, and it approaches HDR_CEILING asymptotically, so light
// above the ceiling still arrives - a stronger bolt feeds a brighter, wider halo
// through the bloom pass, which is what "brighter than white" looks like on
// screen.
//
// It is also the guard. An infinity maps to the ceiling and a NaN to zero, so a
// single bad sample can never reach the buffers that the bloom, FXAA and temporal
// AA passes then smear across the whole frame.
#define HDR_CEILING 60000.0

float softHdrClamp(float value)
{
  if (isnan(value))
    return 0.0;
  return HDR_CEILING * (1.0 - exp(-max(value, 0.0) / HDR_CEILING));
}

vec3 softHdrClamp(vec3 value)
{
  return vec3(softHdrClamp(value.r), softHdrClamp(value.g), softHdrClamp(value.b));
}

void stabilizeBaseState(inout vec4 state)
{
  state[VX] = finiteClamp(state[VX], 0.0, -4.0, 4.0);
  state[VY] = finiteClamp(state[VY], 0.0, -4.0, 4.0);
  state[PRESSURE] = finiteClamp(state[PRESSURE], 0.0, -100.0, 100.0);
  state[TEMPERATURE] = finiteClamp(state[TEMPERATURE], 280.0, 100.0, 1000.0);
}

void stabilizeAirWaterState(inout vec4 state)
{
  state[TOTAL] = finiteClamp(state[TOTAL], 0.0, 0.0, 10000.0);
  state[CLOUD] = finiteClamp(state[CLOUD], 0.0, 0.0, 10000.0);
  state[PRECIPITATION] = finiteClamp(state[PRECIPITATION], 0.0, 0.0, 10000.0);
  state[SMOKE] = finiteClamp(state[SMOKE], 0.0, 0.0, 10000.0);
}


// Universal Functions
float map_range(float value, float min1, float max1, float min2, float max2) { return min2 + (value - min1) * (max2 - min2) / (max1 - min1); }

float map_rangeC(float value, float min1, float max1, float min2, float max2) { return clamp(map_range(value, min1, max1, min2, max2), min(min2, max2), max(min2, max2)); }

uint hash(uint x)
{
  x += (x << 10u);
  x ^= (x >> 6u);
  x += (x << 3u);
  x ^= (x >> 11u);
  x += (x << 15u);
  return x;
}
float random(float f)
{
  const uint mantissaMask = 0x007FFFFFu;
  const uint one = 0x3F800000u;

  uint h = hash(floatBitsToUint(f));
  h &= mantissaMask;
  h |= one;

  float r2 = uintBitsToFloat(h);
  // return mod(r2 - 1.0, 1.0);
  return fract(r2);
}

float random2d(vec2 s)
{
  const uint mantissaMask = 0x007FFFFFu;
  const uint one = 0x3F800000u;

  uint h = hash(floatBitsToUint(s.x) + hash(floatBitsToUint(s.y)));
  h &= mantissaMask;
  h |= one;

  float r2 = uintBitsToFloat(h);
  return mod(r2, 1.0);
}

// How many times a strike re-fires, from the strike's own slot data.
//
// A cloud-to-ground stroke is one return stroke plus whatever flicker its
// intensity buys it, which is the formula the app shipped with:
// map_range(hash, 1, max(intensity - 0.5, 0) * 2) - a weak stroke gets 1, a violent
// one up to 5.
//
// A flash is not one stroke. Real intra-cloud lightning re-fires three to five
// times over the same channel network in a fraction of a second, which is what
// makes it read as a flickering sheet of light rather than as a single bolt - and
// the shipped formula gave a flash (intensity at or below 1) the *fewest* strokes
// of anything: for intensity 0.85 it works out to 1.0..0.7, floors to zero, and the
// flash fires exactly once. A flash now gets 2 to 4 strokes. Both numbers come from
// the same hash of the strike's position, so the slot manager (strikeAnimEnd) and
// the display pass (lightningIntensityOverTime) still agree to the iteration.
float lightningFlickers(vec4 strike)
{
  float r = random2d(strike.xy * 2.737250);

  if (strike[INTENSITY] <= LIGHTNING_IC_MAX_INTENSITY)
    return floor(map_range(r, 0., 1., 2.0, 5.0)); // 2, 3 or 4 strokes

  // Positive cloud-to-cloud (+CC) often fires as a single strike with an
  // occasional single restroke.
  if (strike[INTENSITY] > 5.45)
    return r < 0.80 ? 0.0 : 1.0;

  // External positive CG ("bolt from the blue") almost always fires as a single
  // powerful stroke (0 restrikes), with only an occasional single restroke.
  if (strike[INTENSITY] > 4.5)
    return r < 0.85 ? 0.0 : 1.0;

  return floor(map_range(r, 0., 1., 1.0, max(strike[INTENSITY] - 0.5, 0.) * 2.0));
}

// When a strike's animation ends, in simulation iterations, worked out from the
// strike's own slot data.
//
// The slot array only ever held a strike for LIGHTNING_ANIM_ITERS - the length of
// the *longest* strike there can be - because the slot manager had no way to ask
// how long a particular strike lasts. A typical intra-cloud flash is over in 15
// to 35 iterations, so every strike sat on its slot for three or four times as
// long as it was doing anything, and that was the whole lightning rate: a storm
// produced a strike every ~28 iterations and most attempts were dropped on the
// floor, which the player saw as seconds of nothing between flashes.
//
// lightningIntensityOverTime() is what decides when the light is gone, and it is
// driven by two hashes of the strike's position, so the end can be worked out
// exactly from the data already in the slot. Both the slot manager and the
// display pass call this, so a strike is held for exactly as long as it can
// still be seen - no cut-off, and no dead time.
//
// Layout of the arithmetic: lightningTime = (iterNum - start) / 5 with zero
// fixed delay (T0 = Tin), so iteration = start + 5 * T0. The last flicker ends
// when T0 = period * flickers + 2.924 (the T where the intensity curve reaches
// zero), which is the same expression lightningIntensityOverTime() uses for minT.
float strikeAnimEnd(vec4 strike)
{
  float start = strike[START_ITERNUM];
  if (start <= 0.0)
    return 0.0; // an empty slot

  float repeatPeriod = map_range(random2d(strike.xy), 0., 1., 1.5, 3.0);
  float numFlashes = lightningFlickers(strike);

  return start + 5.0 * (repeatPeriod * numFlashes + 2.924);
}

float rand2d(vec2 co)
{
  const float a = 12.9898;
  const float b = 78.233;
  const float c = 43758.5453123;
  float dt = dot(co.xy, vec2(a, b));
  float sn = mod(dt, 3.14);
  return fract(sin(sn) * c);
}

// Temperature Functions

float potentialToRealT(float potential) { return potential - texCoord.y * dryLapse; }

float potentialToRealT(float potential, float texCoordY) { return potential - texCoordY * dryLapse; }

float realToPotentialT(float real) { return real + texCoord.y * dryLapse; }

float CtoK(float c) { return c + 273.15; }

float KtoC(float k) { return k - 273.15; }

float dT_saturated(float dTdry,
                   float dTl) // dTl = temperature difference because of latent heat
{
  if (dTl == 0.0)
    return dTdry;
  else {
    float multiplier = dTdry / (dTdry - dTl);

    return dTdry * multiplier;
  }
}
////////////// Water Functions ///////////////
#define wf_devider 250.0 // 250.0 Real water 	230 less steep curve
#define wf_pow 17.0      // 17.0						10
// https://www.geogebra.org/calculator/jc9hkfq4

float maxWater(float T)
{
  return pow(clamp(T / wf_devider, 0.0, 4.0), wf_pow); // T in Kelvin, w in grams per m^3
}

float dewpoint(float W)
{
  if (W < 0.00001)
    return 0.0;
  else
    return wf_devider * pow(W, 1.0 / wf_pow);
}

float relativeHumd(float T, float W) { return W / max(maxWater(T), 0.000001); }

// interpolation

vec4 bilerp(sampler2D tex, vec2 pos)
{
  vec2 st = pos - 0.5; // calc pixel coordinats

  vec2 ipos = vec2(floor(st));
  vec2 fpos = fract(st);

  ipos /= resolution;
  ipos += texelSize * 0.5;

  vec4 a = texture(tex, ipos);
  vec4 b = texture(tex, ipos + vec2(texelSize.x, 0));
  vec4 c = texture(tex, ipos + vec2(0, texelSize.y));
  vec4 d = texture(tex, ipos + vec2(texelSize.x, texelSize.y));

  float mixAB = fpos.x;
  float mixCD = fpos.x;
  float mixAB_CD = fpos.y;

  return mix(mix(a, b, mixAB), mix(c, d, mixCD), mixAB_CD);
}

vec4 bilerpWall(sampler2D tex, isampler2D wallTex,
                vec2 pos) // prevents sampeling from wall cell
{
  vec2 st = pos - 0.5;    // calc pixel coordinats

  vec2 ipos = vec2(floor(st));
  vec2 fpos = fract(st);

  vec4 a = texture(tex, (ipos + vec2(0.5, 0.5)) / resolution);
  vec4 b = texture(tex, (ipos + vec2(1.5, 0.5)) / resolution);
  vec4 c = texture(tex, (ipos + vec2(0.5, 1.5)) / resolution);
  vec4 d = texture(tex, (ipos + vec2(1.5, 1.5)) / resolution);

  ivec4 wa = texture(wallTex, (ipos + vec2(0.5, 0.5)) / resolution);
  ivec4 wb = texture(wallTex, (ipos + vec2(1.5, 0.5)) / resolution);
  ivec4 wc = texture(wallTex, (ipos + vec2(0.5, 1.5)) / resolution);
  ivec4 wd = texture(wallTex, (ipos + vec2(1.5, 1.5)) / resolution);

  float mixAB = fpos.x;
  float mixCD = fpos.x;
  float mixAB_CD = fpos.y;

  if (wa[DISTANCE] == 0)
    mixAB = 1.;
  else if (wb[DISTANCE] == 0)
    mixAB = 0.;

  if (wc[DISTANCE] == 0)
    mixCD = 1.;
  else if (wd[DISTANCE] == 0)
    mixCD = 0.;

  if (wa[DISTANCE] == 0 && wb[1] == 0)
    mixAB_CD = 1.;
  else if (wc[DISTANCE] == 0 && wd[DISTANCE] == 0)
    mixAB_CD = 0.;

  return mix(mix(a, b, mixAB), mix(c, d, mixCD), mixAB_CD);
}

#define IR_constant 5.670374419 // ×10−8

float IR_emitted(float T)
{
  return pow(max(T, 0.0) * 0.01, 4.) * IR_constant; // Stefan–Boltzmann law
}

float IR_temp(float IR) // inversed Stefan–Boltzmann law
{
  return pow(max(IR, 0.0) / IR_constant, 1. / 4.) * 100.0;
}

float absHorizontalDist(float a, float b) // for wrapping horizontal position around simulation border
{
  return min(min(abs(a - b), abs(1.0 + a - b)), 1.0 - a + b);
}
/*
float realMod(float a, float b)
{
    // proper modulo to handle negative numbers
    return mod(mod(a, b) + b, b);
}
*/


// new hash funtions:


// Standard 2x2 hash algorithm.
vec2 hash22(vec2 p, float seed)
{
  float n = sin(dot(p, vec2(41, 289)));
  p = fract(vec2(2097152, 262144) * n);
  return cos(p * 6.283 + seed * 2.);
  return abs(fract(p + seed * .5) - .5) * 4. - 1.;  // Snooker.
  return abs(cos(p * 6.283 + seed * 2.)) * 2. - 1.; // Bounce.
}

float simplesque2D(vec2 p, float seed)
{
  vec2 s = floor(p + (p.x + p.y) * .3660254); // Skew the current point.
  p -= s - (s.x + s.y) * .2113249;            // Vector to unskewed base vertice.

  // Clever way to perform an "if" statement to determine which of two triangles we need.
  float i = p.x < p.y ? 1. : 0.; // Apparently, faster than: step(p.x, p.y);

  vec2 ioffs = vec2(1. - i, i);  // Vertice offset, based on above.

  // Vectors to the other two triangle vertices.
  vec2 p1 = p - ioffs + .2113249, p2 = p - .5773502;

  // Vector to hold the falloff value of the current pixel with respect to each vertice.
  vec3 d = max(.5 - vec3(dot(p, p), dot(p1, p1), dot(p2, p2)), 0.); // Range [0, 0.5]

  d *= d * d * 12.;                                                 //(2*2*2*1.5)
  // d *= d*d*d*36.;

  vec3 w = vec3(dot(hash22(s, seed), p), dot(hash22(s + ioffs, seed), p1), dot(hash22(s + 1., seed), p2));
  return .5 + dot(w, d); // Range [0, 1]... Hopefully. Needs more attention.
}

float func2D(vec2 p, float seed) { return simplesque2D(p * 4., seed) * .66 + simplesque2D(p * 8., seed) * 0.34; }


// src: https://www.shadertoy.com/view/WttXWX

// --- choose one:
// #define hashi(x) lowbias32(x)
// #define hashi(x) triple32(x)

// #define hash(x) (float(hashi(x)) / float(0xffffffffU))


// bias: 0.17353355999581582 ( very probably the best of its kind )
uint lowbias32(uint x)
{
  x ^= x >> 16;
  x *= 0x7feb352dU;
  x ^= x >> 15;
  x *= 0x846ca68bU;
  x ^= x >> 16;
  return x;
}

// bias: 0.020888578919738908 = minimal theoretic limit
uint triple32(uint x)
{
  x ^= x >> 17;
  x *= 0xed5ad4bbU;
  x ^= x >> 11;
  x *= 0xac4c1b51U;
  x ^= x >> 15;
  x *= 0x31848babU;
  x ^= x >> 14;
  return x;
}

float hash2(int x) { return float(triple32(uint(x))) / float(0xffffffffU); }


// float h = hash( V.x + hashi(V.y) ); // clean 2D hash
//  float h = hash( V.x + (V.y<<16) );  // 2D hash (should be ok too )

float rand2(vec2 s)
{
  // return hash( x + hashi(y) ); // clean 2D hash
  return hash2(int(s.x * 379071.) + int(s.y * 756398.) << 16); // 2D hash (should be ok too )
}

// Color Functions

vec3 hsv2rgb(vec3 c)
{
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 sunColor(float scattering) // 0.0 = white     0.5 = orange     1.0 = red
{
  float val = 1.0 - scattering;
  return hsv2rgb(vec3(0.015 + val * 0.15, min(2.0 - val * 2.0, 1.), 1.));
}