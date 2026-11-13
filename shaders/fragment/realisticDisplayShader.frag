#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;
precision highp sampler2DArray;

in vec2 fragCoord;    // pixel
in vec2 texCoord;     // this normalized

in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

in vec2 onScreenUV;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D noiseTex;
uniform sampler2D surfaceTextureMap;
uniform sampler2D curlTex;
uniform sampler2D lightningTex;        // the bolt: one channel, for a stroke
uniform sampler2D lightningNetworkTex; // the network: for an intra-cloud flash
uniform sampler2D lightningDataTex;

uniform sampler2D ambientLightTex;

uniform vec2 aspectRatios; // [0] Sim       [1] canvas

#define URBAN 0
#define FIRE_FOREST 1
#define SNOW_FOREST 2
#define FOREST 3
#define INDUS 4


uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float cellHeight; // in meters

uniform float dryLapse;
uniform float sunAngle;

uniform float minShadowLight;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // Xpos   Ypos  Size   type

uniform float displayVectorField;

uniform float iterNum;
uniform bool volumetricCloudLighting;

out vec4 fragmentColor;

#include "common.glsl"

// Lightning rods: masts standing on the terrain, placed with the Lightning Rod
// tool. (Declared after common.glsl so MAX_LIGHTNING_RODS is known.)
uniform vec2 rodPositions[MAX_LIGHTNING_RODS];
uniform int rodCount;
uniform float rodThickness;     // half width of the mast, in cells
uniform float rodHeight;        // height of the mast, in cells
uniform float lightningBottomU; // bottom trunk U coordinate of active bolt tile

#include "commonDisplay.glsl"

vec4 base, water;
ivec4 wall;
float lightIntensity;

vec3 color;
float opacity = 1.0;

vec3 emittedLight = vec3(0.); // pure light, like lightning

float shadowLight;

vec3 onLight; // extra light that lights up objects, just like sunlight and shadowlight


const vec3 bareDrySoilCol = pow(vec3(0.85, 0.60, 0.40), vec3(GAMMA));
const vec3 bareWetSoilCol = pow(vec3(0.5, 0.2, 0.1), vec3(GAMMA));
const vec3 greenGrassCol = pow(vec3(0.0, 0.7, 0.2), vec3(GAMMA));
const vec3 dryGrassCol = pow(vec3(0.843, 0.588, 0.294), vec3(GAMMA));


vec4 surfaceTexture(int index, vec2 pos)
{
#define numTextures 5.;             // number of textures in the map
  const float texRelHeight = 1. / numTextures;
  pos.y = clamp(pos.y, 0.01, 0.99); // make sure position is within the subtexture
  pos /= numTextures;
  pos.y += float(index) * texRelHeight;
  return texture(surfaceTextureMap, pos);
}


vec3 getWallColor(float depth)
{
  vec3 vegetationCol = mix(greenGrassCol, dryGrassCol, max(1.0 - water[SOIL_MOISTURE] * (1. / fullGreenSoilMoisture), 0.)); // green to brown

  vec3 bareSoilCol = mix(bareDrySoilCol, bareWetSoilCol, map_rangeC(water[SOIL_MOISTURE], 0.0, 20.0, 0.0, 1.0));

  vec3 surfCol = mix(bareSoilCol, vegetationCol, min(float(wall[VEGETATION]) / 50., 1.));

  const vec3 rockCol = vec3(0.70);                                 // gray rock

  vec3 color = mix(surfCol, rockCol, clamp(depth * 0.35, 0., 1.)); // * 0.15


  color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb;                                   // add noise texture

  color = mix(color, vec3(1.0), clamp(min(water[SNOW], fullWhiteSnowHeight) / fullWhiteSnowHeight - max(depth * 0.3, 0.), 0.0, 1.0)); // mix in white for snow cover

  return color;
}

const vec2 lightningTexRes = vec2(2500.0, 5000.0); // the original tile: 9 px channel on a 2500 x 5000 sprite
const float lightningTexAspect = lightningTexRes.x / lightningTexRes.y;

float calcLightningTime(float startIterNum)
{
  float lightningTime = iterNum - startIterNum;
  return lightningTime / 5.0; // zero-latency flash timeline from trigger iteration
}

float lightningIntensityOverTime(float Tin, vec2 lightningPos, float intensity)
{
  float T0 = Tin;

  float repeatPeriod = map_range(random2d(lightningPos), 0., 1., 1.5, 3.0); // 2.5
  float numFlashes = lightningFlickers(vec4(lightningPos, 0., intensity));  // 0.4

  float minT = max(T0 - (repeatPeriod * numFlashes), 0.);

  float T = max(mod(T0, repeatPeriod), minT);

  return max((1. / (0.05 + pow(T * 2.0, 3.))) - 0.005, 0.) * pow(intensity, 2.0); // fading out curve
}

float findCapturedRodTipY(float strikeX)
{
  for (int i = 0; i < MAX_LIGHTNING_RODS; i++) {
    if (i >= rodCount)
      break;
    if (abs(mod(strikeX - rodPositions[i].x + 0.5, 1.0) - 0.5) < 1e-5)
      return rodPositions[i].y + rodHeight / max(resolution.y, 1.0);
  }
  return -1.0;
}

// The cloud-to-ground channel: fires immediately on trigger with no fixed
// pre-strike latency, written at the stroke's own curve times mainBoltBrightness.
// The light it throws is the bolt itself plus one tight lobe on the cloud around
// it, and the bloom takes two percent of the frame as it always did. There is no
// easing of the tail and no second, wide lobe: a stroke goes from white to gone
// as fast as the curve does. When captured by a lightning rod, the channel
// terminates squarely on the rod's copper tip instead of passing underground.
vec3 displayLightning(vec2 pos, float lightningTime, float currentLightningIntensity)
{
  float rodTipY = findCapturedRodTipY(pos.x);
  bool rodHit = rodTipY >= 0.0;
  if (rodHit && texCoord.y < rodTipY)
    return vec3(0);

  float topY = rodHit ? max(pos.y, rodTipY + 0.04) : pos.y;
  float bottomY = rodHit ? rodTipY : 0.0;
  float spanY = max(topY - bottomY, 0.04);
  float scaleMult = 1. / spanY; // 1.0 means lightning is as tall as the simheight

  vec2 lightningTexCoord;
  lightningTexCoord.x = mod(texCoord.x - pos.x + 0.5, 1.0) - 0.5;
  lightningTexCoord.y = texCoord.y - topY;

  lightningTexCoord.x *= scaleMult * aspectRatios[0] / lightningTexAspect;
  lightningTexCoord.y *= -scaleMult;

  float uShift = rodHit ? (lightningBottomU - 0.5) * pow(clamp(lightningTexCoord.y, 0.0, 1.0), 1.25) : 0.0;
  lightningTexCoord.x += 0.5 + uShift;                                                                                    // center lightning bolt

  if (lightningTexCoord.x < 0.01 || lightningTexCoord.x > 1.01 || lightningTexCoord.y < 0.01 || lightningTexCoord.y > 1.01) // prevent edge effect when mipmapping
    return vec3(0);

  // Level 0 of the tile, one bilinear fetch: the shipped read. It lands on the
  // channel or beside it from one screen row to the next, which is why a bolt has
  // always been a slightly dashed line - and it is fine, because a stroke is drawn
  // over dark ground.
  float pixVal = textureLod(lightningTex, lightningTexCoord, 0.0).r;

  const float mainBoltBrightness = 100000.; // 100000.

  const float brightnessThreshold = 0.95;
  currentLightningIntensity *= mainBoltBrightness;

  pixVal -= brightnessThreshold;

  pixVal = max(pixVal, 0.0);

  pixVal *= currentLightningIntensity;

  const vec3 lightningCol = vec3(0.70, 0.57, 1.0); // 0.584, 0.576, 1.0

  vec3 outputColor = max(pixVal * lightningCol, vec3(0));

  return outputColor;
}

/*
 * The intra-cloud channel, and it is a different picture from the bolt because it
 * is a different thing.
 *
 * A stroke is one channel going one way; a flash is a compact network of curved
 * leaders spreading outward around the strike point, forking into fine curved
 * tendrils inside the cloud. So a flash reads its own artwork tile (512 x 256,
 * 2:1, see generateLightningNetwork in lightningGenerator.js).
 *
 * Where it goes: 0.075 of the simulation's height (~22.5 cells, ~0.9 km) and
 * `flashHeight * networkTexAspect / aspectRatios[0]` of its width (~45 cells,
 * ~1.8 km at 2000 x 300), keeping the 512 x 256 (2:1) artwork tile's true world
 * aspect ratio so curved tendrils stay compact inside a convective cell instead
 * of stretching into a large horizontal bar across the sky.
 *
 * The threshold is 0.02 so mip-filtered curved secondary and tertiary tendrils
 * remain continuous and crisp at any zoom without bloating into thick ribbons.
 */
vec3 displayFlash(vec2 pos, float lightningTime, float currentLightningIntensity)
{
  const vec2 networkTexRes = vec2(512.0, 256.0);
  const float networkTexAspect = networkTexRes.x / networkTexRes.y; // 2.0
  const float flashHeight = 0.075;                                  // ~22.5 sim cells tall (~0.9 km) at 300-row sim height
  vec2 flashSpan = vec2(flashHeight * networkTexAspect / aspectRatios[0], flashHeight);
  const float flashThreshold = 0.02;             // preserve thin mip-filtered curved branches and forks

  const float mainBoltBrightness = 7000.;

  float flashDir = random2d(vec2(pos.y * 3.77, 1.23)) < 0.5 ? -1. : 1.;
  float flashFlip = random2d(vec2(pos.x * 5.11, 7.77)) < 0.5 ? -1. : 1.;

  vec2 flashCoord = vec2(0.5 + flashDir * (texCoord.x - mod(pos.x, 1.)) / flashSpan.x,
                         0.5 + flashFlip * (texCoord.y - pos.y) / flashSpan.y);

  if (flashCoord.x < 0.004 || flashCoord.x > 0.996 || flashCoord.y < 0.004 || flashCoord.y > 0.996)
    return vec3(0);

  float pixVal = texture(lightningNetworkTex, flashCoord).r; // mip-filtered: a network of fine channels

  const float brightnessThreshold = flashThreshold;
  currentLightningIntensity *= mainBoltBrightness;

  pixVal -= brightnessThreshold;

  pixVal = max(pixVal, 0.0);

  pixVal *= currentLightningIntensity;

  const vec3 lightningCol = vec3(0.70, 0.57, 1.0); // 0.584, 0.576, 1.0

  vec3 outputColor = max(pixVal * lightningCol, vec3(0));

  return outputColor;
}

// Positive intra-cloud (+IC) anvil/upper-deck flash: warmer hot white-peach
// polarity, broader anvil spread, cleaner primary leaders, and 50% brighter
// peak radiance than negative IC flashes.
vec3 displayPositiveFlash(vec2 pos, float lightningTime, float currentLightningIntensity)
{
  const vec2 networkTexRes = vec2(512.0, 256.0);
  const float networkTexAspect = networkTexRes.x / networkTexRes.y; // 2.0
  const float flashHeight = 0.095;
  vec2 flashSpan = vec2(flashHeight * networkTexAspect / aspectRatios[0], flashHeight);
  const float flashThreshold = 0.045;

  const float mainBoltBrightness = 10500.;

  float flashDir = random2d(vec2(pos.y * 4.91, 2.37)) < 0.5 ? -1. : 1.;
  float flashFlip = random2d(vec2(pos.x * 6.73, 8.91)) < 0.5 ? -1. : 1.;

  vec2 flashCoord = vec2(0.5 + flashDir * (texCoord.x - mod(pos.x, 1.)) / flashSpan.x,
                         0.5 + flashFlip * (texCoord.y - pos.y) / flashSpan.y);

  if (flashCoord.x < 0.004 || flashCoord.x > 0.996 || flashCoord.y < 0.004 || flashCoord.y > 0.996)
    return vec3(0);

  float pixVal = texture(lightningNetworkTex, flashCoord).r;

  const float brightnessThreshold = flashThreshold;
  currentLightningIntensity *= mainBoltBrightness;

  pixVal -= brightnessThreshold;
  pixVal = max(pixVal, 0.0);
  pixVal *= currentLightningIntensity;

  const vec3 positiveIcCol = vec3(1.0, 0.88, 0.80);
  return max(pixVal * positiveIcCol, vec3(0));
}

float extTriWave(float x)
{
  return 4.0 * abs(fract(x) - 0.5) - 1.0;
}

vec2 evalExtArc(float t, float Hw, float V)
{
  float om = max(1.0 - t, 1e-5);
  float tc = max(t, 1e-5);
  float x = Hw * pow(om, 1.3);
  float y = V * (1.0 - pow(tc, 2.8)) + 0.14 * V * sin(PI * t) * (1.0 - t);
  return vec2(x, y);
}

vec2 evalExtArcDeriv(float t, float Hw, float V)
{
  float om = max(1.0 - t, 1e-5);
  float tc = max(t, 1e-5);
  float dx = -1.3 * Hw * pow(om, 0.3);
  float dy = -2.8 * V * pow(tc, 1.8) + 0.14 * V * (PI * cos(PI * t) * (1.0 - t) - sin(PI * t));
  return vec2(dx, dy);
}

// External positive CG ("bolt from the blue"): emerges from the upper storm
// cloud at originX, arches laterally out into clear air far from the storm core,
// and plunges down to groundPos.x (or squarely onto a capturing rod's tip).
vec3 displayExternalLightning(vec2 groundPos, float originX, float lightningTime, float currentLightningIntensity)
{
  float rodTipY = findCapturedRodTipY(groundPos.x);
  float endY = rodTipY >= 0.0 ? rodTipY : 0.0;
  float relX = mod(texCoord.x - groundPos.x + 0.5, 1.0) - 0.5;
  float dxWrap = mod(originX - groundPos.x + 0.5, 1.0) - 0.5;
  float Hw = dxWrap * aspectRatios[0];
  float topY = rodTipY >= 0.0 ? max(groundPos.y, endY + 0.04) : groundPos.y;
  float V = max(topY - endY, 0.05);
  float pxw = relX * aspectRatios[0];
  float pyw = texCoord.y - endY;
  float pad = 0.35 * max(V, 0.35);

  if (pxw < min(0.0, Hw) - pad || pxw > max(0.0, Hw) + pad ||
      pyw < 0.0 || pyw > V * 1.25 + pad)
    return vec3(0.0);

  vec2 target = vec2(pxw, pyw);
  float bestT = 0.0;
  float bestD2 = 1e9;
  for (int k = 0; k < 4; k++) {
    float tc = float(k) / 3.0;
    vec2 diff = evalExtArc(tc, Hw, V) - target;
    float d2 = dot(diff, diff);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestT = tc;
    }
  }

  float t = bestT;
  for (int it = 0; it < 3; it++) {
    vec2 r = evalExtArc(t, Hw, V) - target;
    vec2 dC = evalExtArcDeriv(t, Hw, V);
    float denom = dot(dC, dC) + 1e-6;
    t = clamp(t - dot(r, dC) / denom, 0.0, 1.0);
  }

  vec2 c = evalExtArc(t, Hw, V);
  vec2 dC = evalExtArcDeriv(t, Hw, V);
  float dLen = length(dC);
  vec2 tanDir = dLen > 1e-5 ? dC / dLen : vec2(0.0, -1.0);
  vec2 normDir = vec2(-tanDir.y, tanDir.x);

  float dPerp = dot(target - c, normDir);
  float seed = random2d(vec2(originX * 19.3, groundPos.y * 23.7)) * 4.0 + 0.5;
  float jagScale = clamp(min(abs(Hw), V) * 0.14, 0.025, 0.055);
  float jagEnv = sin(PI * t);
  float jag = (0.65 * extTriWave(t * 3.8 + seed) +
               0.32 * extTriWave(t * 9.3 + seed * 1.9) +
               0.14 * extTriWave(t * 21.0 + seed * 3.1)) * jagScale * jagEnv;
  dPerp += jag;

  float scaleLen = max(V, 0.25);
  float u = 0.5 + dPerp / (scaleLen * lightningTexAspect);
  float v = t;
  if (v < 0.005 || v > 0.998 || u < 0.01 || u > 0.99)
    return vec3(0.0);

  // Sub-pixel cross-channel antialiasing without conditional fwidth() derivatives,
  // keeping the arched bolt continuous against bright daytime sky at 1x zoom.
  float du = clamp(0.24 * aspectRatios[0] / (1400.0 * max(view[2], 0.5) * scaleLen * lightningTexAspect),
                   0.0005, 0.0028);
  float c0 = textureLod(lightningTex, vec2(u, v), 0.0).r;
  float c1 = textureLod(lightningTex, vec2(clamp(u - du, 0.01, 0.99), v), 0.0).r;
  float c2 = textureLod(lightningTex, vec2(clamp(u + du, 0.01, 0.99), v), 0.0).r;
  float pixVal = max(c0, max(c1, c2) * 0.90);

  // Reduced to 200000. (2x mainBoltBrightness = 100000.) and normalize channel
  // excess onto displayLightning()'s (1.0 - 0.95) scale so positive CG shares
  // normal CG's smooth HDR fade curve rather than snapping off harshly.
  const float extBoltBrightness = 200000.;
  const float brightnessThreshold = 0.88;
  const float cgExcessScale = 0.05 / (1.0 - brightnessThreshold);
  float intensity = currentLightningIntensity * extBoltBrightness;

  pixVal = max(pixVal - brightnessThreshold, 0.0) * cgExcessScale;
  pixVal *= intensity;

  const vec3 positiveLightningCol = vec3(1.0, 0.90, 0.82);
  return max(pixVal * positiveLightningCol, vec3(0.0));
}

vec2 evalCcCubic(float t, vec2 p0, vec2 p1, vec2 p2, vec2 p3)
{
  float om = 1.0 - t;
  return om * om * om * p0 +
         3.0 * om * om * t * p1 +
         3.0 * om * t * t * p2 +
         t * t * t * p3;
}

vec2 evalCcCubicDeriv(float t, vec2 p0, vec2 p1, vec2 p2, vec2 p3)
{
  float om = 1.0 - t;
  return 3.0 * om * om * (p1 - p0) +
         6.0 * om * t * (p2 - p1) +
         3.0 * t * t * (p3 - p2);
}

vec2 ccRotate(vec2 v, float angle)
{
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

vec2 ccFractalDisp(float s, float span, float jagPhase, float jagScale)
{
  float normLen = max(span, 0.18);
  float f1 = 2.3 / normLen;
  float f2 = 6.1 / normLen;
  float f3 = 14.8 / normLen;
  float f4 = 33.5 / normLen;

  float x1 = s * f1 + jagPhase;
  float x2 = s * f2 + jagPhase * 1.73 + 0.31;
  float x3 = s * f3 + jagPhase * 2.91 + 0.67;
  float x4 = s * f4 + jagPhase * 4.37 + 0.19;

  float d = (0.58 * extTriWave(x1) +
             0.28 * extTriWave(x2) +
             0.13 * extTriWave(x3) +
             0.06 * extTriWave(x4)) * jagScale;

  float sgn1 = fract(x1) < 0.5 ? 4.0 : -4.0;
  float sgn2 = fract(x2) < 0.5 ? 4.0 : -4.0;
  float sgn3 = fract(x3) < 0.5 ? 4.0 : -4.0;
  float slope = (0.58 * sgn1 * f1 + 0.28 * sgn2 * f2 + 0.13 * sgn3 * f3) * jagScale;
  return vec2(d, clamp(slope, -2.5, 2.5));
}

// Signed-distance core + sheath evaluation for a forked CC side branch.
// Returns vec2(coreMask, combinedSignal).
vec2 ccEvalBranch(vec2 target, vec2 bStart, vec2 bDir, float bLen, float curveSign,
                  float seed, float coreW, float weight)
{
  vec2 bNorm = vec2(-bDir.y, bDir.x);
  vec2 rel = target - bStart;
  float along = dot(rel, bDir);
  float perp = dot(rel, bNorm);
  if (along < -0.015 || along > bLen + 0.025 || abs(perp) > bLen * 0.58)
    return vec2(0.0);

  float bt = clamp(along / max(bLen, 1e-4), 0.0, 1.0);
  float arch = curveSign * 0.11 * bLen * sin(PI * bt);
  float jagScale = clamp(bLen * 0.095, 0.008, 0.028);
  vec2 jag = ccFractalDisp(along, max(bLen, 0.12), seed * 11.3, jagScale);
  float rootPin = smoothstep(0.0, 0.08, bt) * (1.0 - 0.30 * bt);
  float centerPerp = arch + jag.x * rootPin;
  float slope = jag.y * rootPin + curveSign * 0.11 * PI * cos(PI * bt);
  float dist = abs(perp - centerPerp) * inversesqrt(1.0 + clamp(slope * slope, 0.0, 6.25));

  float endMask = smoothstep(-0.006, 0.004, along) * smoothstep(bLen + 0.008, bLen - 0.006, along);
  float taper = mix(0.74, 0.26, bt);
  float bw = max(coreW * taper, 0.0011);
  float core = smoothstep(bw * 1.45, bw * 0.15, dist) * endMask;
  float halo = exp(-dist / max(bw * 3.0, 0.0040)) * 0.20 * endMask;
  float fade = smoothstep(1.0, 0.10, bt) * weight;
  return vec2(core * fade, (core + halo) * fade);
}

// Reworked procedural cloud-to-cloud (CC) channel: draws a genuine tortuous,
// slope-corrected fractured plasma leader between clouds with forward-diverging
// dendritic branches (-CC forms rich 2-level forked bridges in electric violet;
// +CC stays 50% brighter with a thicker incandescent white-peach trunk and sparse
// high-current forks). Uses zero screen-space derivative calls.
vec3 displayCloudToCloudLightning(vec2 targetPos, vec2 originPos, bool isPositiveCC,
                                  float lightningTime, float ccCurve)
{
  float relX = mod(texCoord.x - targetPos.x + 0.5, 1.0) - 0.5;
  float dxWrap = mod(originPos.x - targetPos.x + 0.5, 1.0) - 0.5;
  vec2 p0 = vec2(dxWrap * aspectRatios[0], originPos.y);
  vec2 p3 = vec2(0.0, targetPos.y);
  vec2 target = vec2(relX * aspectRatios[0], texCoord.y);

  float span = length(p3 - p0);
  if (span < 1e-4)
    return vec3(0.0);

  float seed = random2d(vec2(originPos.x * 29.1 + originPos.y * 17.7,
                             targetPos.x * 41.3 + targetPos.y * 13.9));
  float s2 = random2d(vec2(seed * 19.3, originPos.y * 37.1));
  float s3 = random2d(vec2(targetPos.x * 53.7, seed * 23.9));
  float s4 = random2d(vec2(originPos.x * 47.9, seed * 31.3));
  float s5 = random2d(vec2(targetPos.y * 61.1, seed * 41.7));

  float bow1 = (s2 < 0.5 ? 1.0 : -1.0) * mix(0.08, 0.22, s3) * span;
  float bow2 = (s4 < 0.5 ? 1.0 : -1.0) * mix(0.08, 0.20, s5) * span;
  vec2 p1 = mix(p0, p3, 0.32) + vec2((s3 - 0.5) * 0.12 * span, bow1);
  vec2 p2 = mix(p0, p3, 0.68) + vec2((s5 - 0.5) * 0.12 * span, bow2);
  p1.y = clamp(p1.y, 0.04, 0.94);
  p2.y = clamp(p2.y, 0.04, 0.94);

  float pad = max(span * 0.52, 0.26);
  vec2 boxMin = min(min(p0, p3), min(p1, p2)) - vec2(pad);
  vec2 boxMax = max(max(p0, p3), max(p1, p2)) + vec2(pad);
  if (target.x < boxMin.x || target.x > boxMax.x || target.y < boxMin.y || target.y > boxMax.y)
    return vec3(0.0);

  float bestT = 0.0;
  float bestD2 = 1e9;
  for (int k = 0; k < 6; k++) {
    float tc = float(k) / 5.0;
    vec2 diff = evalCcCubic(tc, p0, p1, p2, p3) - target;
    float d2 = dot(diff, diff);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestT = tc;
    }
  }

  float t = bestT;
  for (int it = 0; it < 3; it++) {
    vec2 r = evalCcCubic(t, p0, p1, p2, p3) - target;
    vec2 dC = evalCcCubicDeriv(t, p0, p1, p2, p3);
    float denom = dot(dC, dC) + 1e-6;
    t = clamp(t - dot(r, dC) / denom, 0.0, 1.0);
  }

  vec2 c = evalCcCubic(t, p0, p1, p2, p3);
  vec2 dC = evalCcCubicDeriv(t, p0, p1, p2, p3);
  float dLen = length(dC);
  vec2 tanDir = dLen > 1e-5 ? dC / dLen : vec2(1.0, 0.0);
  vec2 normDir = vec2(-tanDir.y, tanDir.x);

  float jagScale = clamp(span * 0.068, 0.015, 0.052);
  float jagPhase = seed * 7.0 + 0.5;
  vec2 spineDisp = ccFractalDisp(t * span, span, jagPhase, jagScale);
  float spineEnv = sin(PI * t);
  float dPerp = dot(target - c, normDir) - spineDisp.x * spineEnv;
  float spineSlope = spineDisp.y * spineEnv;
  float distMain = abs(dPerp) * inversesqrt(1.0 + clamp(spineSlope * spineSlope, 0.0, 6.25));

  float worldPix = aspectRatios[0] / (1400.0 * max(view[2], 0.5));
  float coreW = max(0.0018, worldPix * 0.90) * (isPositiveCC ? 1.28 : 1.0);
  float edgeFade = smoothstep(0.0, 0.025, t) * smoothstep(1.0, 0.975, t);
  float mainCore = smoothstep(coreW * 1.50, coreW * 0.15, distMain) * edgeFade;
  float mainHalo = exp(-distMain / max(coreW * 3.2, 0.0045)) * 0.20 * edgeFade;
  float mainOuter = exp(-distMain / max(coreW * 7.5, 0.011)) * 0.018 * edgeFade;
  float mainSignal = mainCore + mainHalo + mainOuter;

  float branchCore = 0.0;
  float branchSignal = 0.0;
  for (int b = 0; b < 4; b++) {
    if (isPositiveCC && (b == 0 || b == 3))
      continue;
    float br1 = random2d(vec2(seed * 13.7 + float(b) * 5.3, originPos.y * 43.1));
    float br2 = random2d(vec2(targetPos.x * 29.9 + float(b) * 7.9, seed * 17.3));
    float tb = clamp(0.22 + float(b) * 0.18 + (br1 - 0.5) * 0.05, 0.14, 0.86);

    vec2 rc = evalCcCubic(tb, p0, p1, p2, p3);
    vec2 rdc = evalCcCubicDeriv(tb, p0, p1, p2, p3);
    float rlen = length(rdc);
    vec2 rtan = rlen > 1e-5 ? rdc / rlen : vec2(1.0, 0.0);
    vec2 rnorm = vec2(-rtan.y, rtan.x);
    vec2 rdisp = ccFractalDisp(tb * span, span, jagPhase, jagScale);
    vec2 bStart = rc + rnorm * (rdisp.x * sin(PI * tb));

    float sideSign = ((b % 2) == 0 ? 1.0 : -1.0) * (s2 < 0.5 ? 1.0 : -1.0);
    float forkAngle = sideSign * mix(0.42, 0.78, br2);
    vec2 bDir = ccRotate(rtan, forkAngle);
    float bLen = span * mix(0.20, 0.42, br1) * (isPositiveCC ? 0.78 : 1.0);
    float bWeight = isPositiveCC ? 0.62 : mix(0.68, 0.88, br2);
    vec2 bVal = ccEvalBranch(target, bStart, bDir, bLen, sideSign, seed + float(b) * 1.37, coreW, bWeight);
    branchCore = max(branchCore, bVal.x);
    branchSignal = max(branchSignal, bVal.y);

    if (!isPositiveCC && (b == 1 || b == 2)) {
      float subAlong = 0.44 * bLen;
      float subArch = sideSign * 0.11 * bLen * sin(PI * 0.44);
      float subJagScale = clamp(bLen * 0.095, 0.008, 0.028);
      vec2 subJag = ccFractalDisp(subAlong, max(bLen, 0.12), (seed + float(b) * 1.37) * 11.3, subJagScale);
      vec2 bNorm = vec2(-bDir.y, bDir.x);
      vec2 subStart = bStart + bDir * subAlong + bNorm * (subArch + subJag.x * 0.868);
      vec2 subDir = ccRotate(bDir, -sideSign * mix(0.38, 0.68, br1));
      vec2 subVal = ccEvalBranch(target, subStart, subDir, bLen * 0.50, -sideSign, seed + float(b) * 3.11,
                                 coreW * 0.82, bWeight * 0.65);
      branchCore = max(branchCore, subVal.x);
      branchSignal = max(branchSignal, subVal.y);
    }
  }

  float totalSignal = max(mainSignal, branchSignal) + 0.18 * min(mainSignal, branchSignal);

  const float ccBaseBrightness = 2600.;
  vec3 coreTint = vec3(1.0, 0.98, 1.0);
  vec3 auraTint = isPositiveCC ? vec3(1.0, 0.86, 0.76) : vec3(0.66, 0.52, 1.0);
  vec3 ccCol = mix(auraTint, coreTint, clamp(mainCore * 0.85 + branchCore * 0.55, 0.0, 1.0));
  return max(totalSignal * ccCurve * ccBaseBrightness * ccCol, vec3(0.0));
}




float saturate(float x) { return min(1.0, max(0.0, x)); }
vec3 saturate(vec3 x) { return min(vec3(1., 1., 1.), max(vec3(0., 0., 0.), x)); }


vec3 bump3y(vec3 x, vec3 yoffset)
{
  vec3 y = vec3(1., 1., 1.) - x * x;
  y = saturate(y - yoffset);
  return y;
}
vec3 spectral_zucconi(float w)
{
  // w: [400, 700] wavelenght(nm)
  // x: [0,   1]
  float x = saturate((w - 400.0) / 300.0);
  const vec3 cs = vec3(3.54541723, 2.86670055, 2.29421995);
  const vec3 xs = vec3(0.69548916, 0.49416934, 0.28269708);
  const vec3 ys = vec3(0.02320775, 0.15936245, 0.53520021);
  return bump3y(cs * (x - xs), ys);
}


vec4 computeAirColor(vec2 bndFragCoord)
{
  shadowLight = minShadowLight;

  // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging

  float cloudwater = water[CLOUD];

  vec3 cloudCol = vec3(1.0 / (cloudwater * 0.005 + 1.0)); // 0.10 white to black

  float cloudDensity = max(cloudwater * 13.6, 0.0);

  float totalDensity = cloudDensity + water[PRECIPITATION] * 0.8; // visualize precipitation

  // float cloudOpacity = clamp(cloudwater * 4.0, 0.0, 1.0);
  float cloudOpacity = clamp(1.0 - (1.0 / (1. + totalDensity)), 0.0, 1.0);

  if (volumetricCloudLighting && cloudOpacity > 0.01) {
    vec2 sunDirection = vec2(cos(sunAngle), sin(sunAngle));
    float opticalDepth = 0.0;
    for (int rayStep = 1; rayStep <= 6; rayStep++) {
      vec2 sampleCoord = clamp(
        bndFragCoord + sunDirection * float(rayStep) * 4.0,
        vec2(0.5),
        resolution - vec2(0.5)
      );
      float sampleCloud = max(texture(waterTex, sampleCoord * texelSize)[CLOUD], 0.0);
      opticalDepth += sampleCloud * 0.12;
    }

    float lightTransmission = exp(-opticalDepth);
    vec2 neighborOpacity = vec2(
      clamp(1.0 - 1.0 / (1.0 + max(texture(waterTex, texCoordXmY0)[CLOUD], 0.0) * 13.6), 0.0, 1.0),
      clamp(1.0 - 1.0 / (1.0 + max(texture(waterTex, texCoordXpY0)[CLOUD], 0.0) * 13.6), 0.0, 1.0)
    );
    vec2 verticalOpacity = vec2(
      clamp(1.0 - 1.0 / (1.0 + max(texture(waterTex, texCoordX0Ym)[CLOUD], 0.0) * 13.6), 0.0, 1.0),
      clamp(1.0 - 1.0 / (1.0 + max(texture(waterTex, texCoordX0Yp)[CLOUD], 0.0) * 13.6), 0.0, 1.0)
    );
    float cloudEdge = length(vec2(neighborOpacity.x - neighborOpacity.y,
                                  verticalOpacity.x - verticalOpacity.y));
    float rimLight = smoothstep(0.015, 0.18, cloudEdge) * lightTransmission *
                     clamp(lightIntensity, 0.0, 1.0);
    float twilight = 1.0 - smoothstep(0.05, 0.65, cos(sunAngle));
    vec3 sunlightTint = mix(vec3(1.0, 0.94, 0.82), vec3(1.0, 0.57, 0.34), twilight);
    vec3 shadedCloud = cloudCol * mix(vec3(0.48, 0.59, 0.76), sunlightTint,
                                      0.28 + 0.72 * lightTransmission);
    shadedCloud += sunlightTint * rimLight * 0.65;
    cloudCol = mix(cloudCol, shadedCloud, 0.9);
  }

  const vec3 smokeThinCol = vec3(0.8, 0.51, 0.26);
  const vec3 smokeThickCol = vec3(0., 0., 0.);


  float smokeOpacity = clamp(1. - (1. / (water[SMOKE] + 1.)), 0.0, 1.0);
  float fireIntensity = clamp((smokeOpacity - 0.8) * 25., 0.0, 1.0);

  vec3 fireCol = hsv2rgb(vec3(fireIntensity * 0.008, 0.98, 5.0)) * 1.0; // 1.0, 0.7, 0.0

  vec3 smokeOrFireCol = mix(mix(smokeThinCol, smokeThickCol, smokeOpacity), fireCol, fireIntensity);

  shadowLight += fireIntensity * 2.5;                                                                                 // 1.5

  float opacity = 1. - (1. - smokeOpacity) * (1. - cloudOpacity);                                                     // alpha blending
  vec3 color = (smokeOrFireCol * smokeOpacity / opacity) + (cloudCol * cloudOpacity * (1. - smokeOpacity) / opacity); // color blending


// The light a stroke throws on the clouds around it: one tight lobe and one wide
// one. These are the original values - a return stroke lights its own
// neighbourhood and no further.
#define lightningOnLightBrightness 0.004  // 0.002

  // Every strike in the slot array is drawn until its own animation is over.
  // Slots are independent, so a new strike never truncates a running one.
  vec3 lightningBoltLight = vec3(0.0); // cloud-to-ground strokes
  for (int slot = 0; slot < LIGHTNING_SLOTS; slot++) {
    vec4 lightningData = texelFetch(lightningDataTex, ivec2(slot, 0), 0);
    float lightningStartIterNum = lightningData[START_ITERNUM];
    if (lightningStartIterNum <= 0.0)
      continue;                                              // never used / released
    // its own animation, not the longest one there can be: a flash is drawn for
    // exactly as long as it has light (see strikeAnimEnd in common.glsl)
    if (iterNum < lightningStartIterNum || iterNum >= strikeAnimEnd(lightningData))
      continue;

    vec2 lightningPos = lightningData.xy;
    float lightningTime = calcLightningTime(lightningStartIterNum);
    // Every strike starts directly on the trigger iteration with zero fixed delay.
    float currentLightningIntensity = lightningIntensityOverTime(lightningTime, lightningPos, lightningData[INTENSITY]);
    if (currentLightningIntensity <= 0.0)
      continue;

    // The two kinds, two channels: a stroke is one channel down the picture, a
    // flash is a network spreading across the sky (see displayLightning and
    // displayFlash). The kind is a fact about the strike - its intensity - and it
    // is also what a lightning rod snaps to.
    //
    // A flash is not masked to the cloud it was born in. Its channels leave one deck
    // and carry on through the clear air to the next, which is what cloud-to-cloud
    // lightning is, and what a mask on cloud density threw away: every channel was
    // cut off at its own cloud's edge. What still applies to both kinds is the
    // cloud's attenuation of the *light* at the end of this function, which is a
    // filter on how bright a channel seen through a cloud is, not a mask on whether
    // the channel exists.
    vec4 lightningMeta = texelFetch(lightningDataTex, ivec2(slot, 1), 0);
    bool isFlash = lightningData[INTENSITY] <= LIGHTNING_IC_MAX_INTENSITY;
    bool isPositiveIC = isFlash && lightningMeta.y >= 3.5;
    bool isExternalPositive = !isFlash && abs(lightningMeta.y - 1.0) < 0.25;
    bool isCloudToCloud = !isFlash && lightningMeta.y >= 1.5;
    bool isPositiveCC = isCloudToCloud && lightningMeta.y >= 2.5;
    bool isSuperbolt = !isFlash && !isCloudToCloud && lightningMeta.w >= 0.5;
    const float superboltBrightnessMult = 12.0;
    const float superboltDurationShorten = 0.1;
    const vec3 positiveLightningCol = vec3(1.0, 0.90, 0.82);
    float repeatPeriod = map_range(random2d(lightningPos), 0., 1., 1.5, 3.0);
    if (isSuperbolt && lightningTime >= repeatPeriod * lightningFlickers(lightningData) + (2.924 - superboltDurationShorten))
      continue;
    float effectiveLightningTime = isSuperbolt && lightningTime > 0.0
      ? lightningTime + superboltDurationShorten * smoothstep(0.0, 0.35, lightningTime)
      : lightningTime;
    if (isSuperbolt) {
      currentLightningIntensity = lightningIntensityOverTime(effectiveLightningTime, lightningPos, lightningData[INTENSITY]);
      if (currentLightningIntensity <= 0.0)
        continue;
    }
    float tailT = max(effectiveLightningTime - repeatPeriod * lightningFlickers(lightningData), 0.0);
    float extTailFade = pow(smoothstep(2.924, 1.15, tailT), 2.4);
    float ccTailFade = pow(smoothstep(2.924, 1.25, tailT), 2.2);
    float ccIntensityGain = (isPositiveCC ? 1.5 : 1.0) * (1.8 / max(pow(lightningData[INTENSITY], 2.0), 0.1));
    float extBaseIntensity = clamp(mix(1.8, 3.4, (lightningData[INTENSITY] - 4.6) / 0.8), 1.8, 3.4);
    float extIntensityGain = pow(extBaseIntensity / max(lightningData[INTENSITY], 1.0), 2.0);
    float extCurve = currentLightningIntensity * extIntensityGain * extTailFade;
    if (isExternalPositive) {
      vec3 prevBoltLight = lightningBoltLight;
      lightningBoltLight += displayExternalLightning(lightningPos, lightningMeta.x, effectiveLightningTime, extCurve);
      if (isSuperbolt)
        lightningBoltLight = prevBoltLight + (lightningBoltLight - prevBoltLight) * superboltBrightnessMult;
    } else if (isCloudToCloud) {
      lightningBoltLight += displayCloudToCloudLightning(vec2(lightningPos.x, lightningMeta.z),
                                                         vec2(lightningMeta.x, lightningPos.y),
                                                         isPositiveCC,
                                                         lightningTime,
                                                         currentLightningIntensity * ccIntensityGain * ccTailFade);
    } else if (isPositiveIC) {
      lightningBoltLight += displayPositiveFlash(lightningPos, lightningTime, currentLightningIntensity);
    } else {
      vec3 prevBoltLight = lightningBoltLight;
      lightningBoltLight += isFlash ? displayFlash(lightningPos, lightningTime, currentLightningIntensity)
                                    : displayLightning(lightningPos, lightningTime, currentLightningIntensity);
      if (isSuperbolt) {
        vec3 boltDelta = lightningBoltLight - prevBoltLight;
        lightningBoltLight = prevBoltLight + boltDelta * superboltBrightnessMult * (positiveLightningCol / vec3(0.70, 0.57, 1.0));
      }
    }

    // The light a strike throws on the clouds around it.
    float lightningOnLight;
    if (isFlash) {
      // A flash lights the whole slab it lives in, not a point below itself: its
      // lobe is centred on the strike, reaches twice as far and is twice as bright,
      // because what a player sees of an intra-cloud flash from outside the cloud is
      // mostly this - the deck glowing from the inside - with the network on top.
      vec2 flashDist = vec2((lightningPos.x - texCoord.x) * aspectRatios[0], texCoord.y - lightningPos.y);
      lightningOnLight = lightningOnLightBrightness * 2.0 / (pow(length(flashDist) * 0.5, 2.) + 0.03);
      if (isPositiveIC)
        lightningOnLight *= 1.5;
    } else if (isCloudToCloud) {
      vec2 ccTargetDist = vec2((mod(lightningPos.x - texCoord.x + 0.5, 1.0) - 0.5) * aspectRatios[0],
                               texCoord.y - lightningMeta.z);
      lightningOnLight = lightningOnLightBrightness * 1.4 / (pow(length(ccTargetDist) * 0.5, 2.) + 0.03) * ccIntensityGain * ccTailFade;
      float ccOriginDx = mod(lightningMeta.x - texCoord.x + 0.5, 1.0) - 0.5;
      vec2 ccOriginDist = vec2(ccOriginDx * aspectRatios[0], texCoord.y - lightningPos.y);
      float ccMidDx = mod(lightningPos.x + 0.5 * (mod(lightningMeta.x - lightningPos.x + 0.5, 1.0) - 0.5) - texCoord.x + 0.5, 1.0) - 0.5;
      vec2 ccMidDist = vec2(ccMidDx * aspectRatios[0], texCoord.y - 0.5 * (lightningPos.y + lightningMeta.z));
      onLight += vec3(lightningOnLightBrightness * 1.4 / (pow(length(ccOriginDist) * 0.5, 2.) + 0.03) * ccIntensityGain * ccTailFade * currentLightningIntensity);
      onLight += vec3(lightningOnLightBrightness * 0.9 / (pow(length(ccMidDist) * 0.55, 2.) + 0.035) * ccIntensityGain * ccTailFade * currentLightningIntensity);
    } else {
      // The one lobe the app shipped with, wrapped horizontally across the periodic boundary.
      float cgDx = mod(lightningPos.x - texCoord.x + 0.5, 1.0) - 0.5;
      vec2 dist = vec2(cgDx, max((abs(lightningPos.y / 2. - texCoord.y) - 0.1), 0.));
      dist.x *= aspectRatios[0];
      lightningOnLight = lightningOnLightBrightness / (pow(length(dist), 2.) + 0.03);
    }
    if (isExternalPositive)
      lightningOnLight *= extIntensityGain * extTailFade;
    lightningOnLight *= currentLightningIntensity;
    if (isSuperbolt)
      lightningOnLight *= superboltBrightnessMult;
    onLight += vec3(lightningOnLight);
    if (isExternalPositive) {
      onLight += vec3(lightningOnLight);
      float originDx = mod(lightningMeta.x - texCoord.x + 0.5, 1.0) - 0.5;
      vec2 originDist = vec2(originDx * aspectRatios[0], texCoord.y - lightningPos.y);
      onLight += vec3(lightningOnLightBrightness * 2.0 / (pow(length(originDist) * 0.7, 2.) + 0.03) * extCurve);
      if (isSuperbolt)
        onLight += vec3(lightningOnLightBrightness * 2.0 / (pow(length(originDist) * 0.7, 2.) + 0.03) * extCurve * (superboltBrightnessMult - 1.0));
    }
  }

  emittedLight += lightningBoltLight / (1. + cloudDensity * 100.0);

  return vec4(color, opacity);
}

vec4 getAirColor(vec2 fragCoordIn)
{
  vec2 bndFragCoord = vec2(fragCoordIn.x, clamp(fragCoordIn.y, 0., resolution.y)); // bound y within range
  base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
  wall = texture(wallTex, bndFragCoord * texelSize);                               // texCoord
  water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  lightIntensity = texture(lightTex, bndFragCoord * texelSize)[0] / standardSunBrightness;
  return computeAirColor(bndFragCoord);
}

float rand(float n) { return fract(sin(n) * 43758.5453123); }

void main()
{
  color = vec3(0.0);
  opacity = 1.0;
  emittedLight = vec3(0.0);
  onLight = vec3(0.0);

  if (texCoord.y > 1.0) { // above simulation area
    if (rodCount == 0) {
      fragmentColor = vec4(0.0);
      drawCursor(cursor, view);
      return;
    }
    opacity = 0.0;
    lightIntensity = 0.0;
    shadowLight = minShadowLight;
  } else if (texCoord.y < 0.) { // < texelSize.y below simulation area
    vec2 bndFragCoord = vec2(fragCoord.x, clamp(fragCoord.y, 0., resolution.y)); // bound y within range
    wall = texture(wallTex, bndFragCoord * texelSize);                           // texCoord
    water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
    shadowLight = minShadowLight;

    float depth = float(-wall[VERT_DISTANCE]) - fragCoord.y; // -1.0?

    color = getWallColor(depth);

    lightIntensity = texture(lightTex, vec2(texCoord.x, texelSize.y))[0] / standardSunBrightness; // sample lowest part of sim area
    lightIntensity *= pow(0.5, -fragCoord.y);                                                     // 0.5 should be same as in lightingshader deeper is darker

  } else {
    vec2 bndFragCoord = vec2(fragCoord.x, clamp(fragCoord.y, 0., resolution.y)); // bound y within range
    base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
    wall = texture(wallTex, bndFragCoord * texelSize);                           // texCoord
    water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
    lightIntensity = texture(lightTex, bndFragCoord * texelSize)[0] / standardSunBrightness;

    shadowLight = minShadowLight;

    if (wall[DISTANCE] == 0) { // is wall
      ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
      ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

      switch (wall[TYPE]) {
      // case WALLTYPE_INERT:
      //   color = vec3(0, 0, 0);
      //   break;

    case WALLTYPE_RUNWAY:

      if (wall[VERT_DISTANCE] == 0) {
        vec2 modTexCoord = mod(texCoord * resolution, 1.0);

        color = vec3(0.1);
        color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb; // add noise texture

        if (length(modTexCoord - vec2(0.7, 0.97)) < 0.03) {                                               // side lights
          onLight += vec3(1., 0.8, 0.3) * 300.0;
        }

        if (abs(mod(-iterNum - floor(texCoord.x * resolution.x), 150.0)) < 1.0 && length(modTexCoord - vec2(0.2, 0.98)) < 0.02) {
          onLight += vec3(0., 1.0, 0.) * 5000.0;
        }

        break;
      }

    case WALLTYPE_URBAN:
    case WALLTYPE_INDUSTRIAL:
    case WALLTYPE_FIRE:
    case WALLTYPE_LAND:

      // horizontally interpolate depth value
      float interpDepth = mix(mix(float(-wallXmY0[VERT_DISTANCE]), float(-wall[VERT_DISTANCE]), clamp(fract(fragCoord.x) + 0.5, 0.5, 1.)), float(-wallXpY0[VERT_DISTANCE]), clamp(fract(fragCoord.x) - 0.5, 0., 0.5));
      float depth = interpDepth - fract(fragCoord.y); // - 1.0 ?

      color = getWallColor(depth);

      break;
    case WALLTYPE_WATER:

      // Precomputed values (tweak to taste)
      // Frequencies
      const int numWaveComp = 5;
      const float freqs[numWaveComp] = float[numWaveComp](2.3, 3.7, 5.1, 7.6, 21.7);
      // Amplitudes
      const float amps[numWaveComp] = float[numWaveComp](0.05, 0.03, 0.02, 0.015, 0.004);
      // Speeds
      const float speeds[numWaveComp] = float[numWaveComp](0.006, 0.011, 0.018, 0.025, 0.05);
      // Phases (in radians)
      const float phases[numWaveComp] = float[numWaveComp](1.2, 3.9, 0.7, 5.1, 3.1);

      // Sum up the components
      float waveSignalL = 0.0;
      float waveSignalR = 0.0;

      for (int i = 0; i < numWaveComp; i++) {
        waveSignalL += sin(fragCoord.x * freqs[i] + iterNum * speeds[i] + phases[i]) * amps[i];
        waveSignalR += sin(fragCoord.x * freqs[i] - iterNum * speeds[i] + phases[i]) * amps[i];
      }

      vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);
      float windSpeed = baseX0Yp[VX] * 10.;

      // combine based on wind direction
      float waterLevel = 0.8 + waveSignalL * max(-windSpeed, 0.) + waveSignalR * max(windSpeed, 0.);

      if (wall[VERT_DISTANCE] == 0 && fract(fragCoord.y) > waterLevel) { // air
        vec4 airColor = getAirColor(fragCoord + vec2(0., 0.5));

        opacity = airColor.a;
        color = airColor.rgb;
      } else {
        color = vec3(0, 0.5, 1.0); // water
      }

      // draw 45° slopes under water

      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);
      ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

      if (wallXmY0[DISTANCE] == 0 && wallXmY0[TYPE] != WALLTYPE_WATER && (fragCoord.y < 1. || wallX0Ym[TYPE] != WALLTYPE_WATER)) { // wall to the left and below
        if (localX + localY < 1.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
        }
      }
      if (wallXpY0[DISTANCE] == 0 && wallXpY0[TYPE] != WALLTYPE_WATER && (fragCoord.y < 1. || wallX0Ym[TYPE] != WALLTYPE_WATER)) { // wall to the right and below
        if (localY - localX < 0.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
        }
      }

      break;
    }
  } else { // air

    vec4 airColor = computeAirColor(bndFragCoord);

    opacity = airColor.a;
    color = airColor.rgb;


    vec2 rainbowCenter = vec2(0.0, -1.5 + abs(sunAngle) * 0.60);

    float centerDist = length(onScreenUV - rainbowCenter) * 1.3;

    const float cameraHeight = 1.0;

    float angle = atan(centerDist / cameraHeight) * rad2deg;

    float waveLength = map_range(angle, 40.0, 42.0, 400., 700.);

    float realTemp = potentialToRealT(base[TEMPERATURE]);
    float rainSnowFactor = map_rangeC(KtoC(realTemp), 0.0, 5.0, 0.0, 1.0); // only rain if above freezing

    vec3 rainbowCol = spectral_zucconi(waveLength) * min(pow(lightIntensity, 2.0) * 1.9, 1.0) * min(water[PRECIPITATION] * 3.0, 1.0) * rainSnowFactor * 0.7;

    emittedLight += rainbowCol;
    opacity = max(opacity - length(rainbowCol), 0.); // remove some white rain to prevent overbrightening and increase color saturation


    if (wall[VERT_DISTANCE] >= 0 && wall[VERT_DISTANCE] < 10) { // near surface
      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);
      ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);
      bool nightTime = abs(sunAngle) > 85.0 * deg2rad; // false = day time

#define texAspect 2560. / 4096. // height / width of tree texture
#define maxTreeHeight 40.       // height in meters when vegetation max = 127
#define maxBuildingHeight 400.  // height in meters upto wich the urban texture reaches


      if (wallX0Ym[TYPE] == WALLTYPE_URBAN) {

        float heightAboveGround = localY + float(wall[VERT_DISTANCE] - 1);

        float urbanTexHeightNorm = maxBuildingHeight / cellHeight; // example: 200 / 40 = 5

        float urbanTexCoordX = mod(fragCoord.x, resolution.x) * texAspect / urbanTexHeightNorm;
        float urbanTexCoordY = heightAboveGround / urbanTexHeightNorm;

        // urbanTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // building height

        urbanTexCoordY = 1.0 - urbanTexCoordY;

        vec4 texCol = surfaceTexture(URBAN, vec2(urbanTexCoordX, urbanTexCoordY));
        if (texCol.a > 0.5) { // if not transparent

          if (nightTime) {
            shadowLight = 1.0;                 // city lights
            texCol.rgb *= vec3(1.0, 0.8, 0.5); // yellowish windows
          } else {                             // day time
            texCol.rgb *= vec3(0.8, 0.9, 1.0); // Blueish windows

            if (length(texCol.rgb) < 0.1)
              texCol.rgb = texture(noiseTex, fragCoord * 0.3).rgb * 0.3;
          }
          color = texCol.rgb;
          opacity = texCol.a;
        }
      } else if (wallX0Ym[TYPE] == WALLTYPE_INDUSTRIAL) {

        float heightAboveGround = localY + float(wall[VERT_DISTANCE] - 1);

        float urbanTexHeightNorm = maxBuildingHeight / cellHeight; // example: 200 / 40 = 5

        float urbanTexCoordX = mod(fragCoord.x, resolution.x) * texAspect / urbanTexHeightNorm;
        float urbanTexCoordY = heightAboveGround / urbanTexHeightNorm;

        // urbanTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // building height

        urbanTexCoordY = 1.0 - urbanTexCoordY;

        vec4 texCol = surfaceTexture(INDUS, vec2(urbanTexCoordX, urbanTexCoordY));
        if (texCol.a > 0.5) { // if not transparent

          if (nightTime) {
            shadowLight = 1.0;                 // city lights
            texCol.rgb *= vec3(1.0, 0.8, 0.5); // yellowish windows
          } else {                             // day time
            texCol.rgb *= vec3(0.8, 0.9, 1.0); // Blueish windows

            if (length(texCol.rgb) < 0.1)
              texCol.rgb = texture(noiseTex, fragCoord * 0.3).rgb * 0.3;
          }
          color = texCol.rgb;
          opacity = texCol.a;
        }
      }


      if (wall[VERT_DISTANCE] == 1) {                                                 // 1 above surface
                                                                                      //  if (wallX0Ym[VERT_DISTANCE] == 0) {

        float treeTexHeightNorm = maxTreeHeight / cellHeight;                         // example: 40 / 120 = 0.333

        float treeTexCoordY = localY / treeTexHeightNorm;                             // full height trees

        treeTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // apply trees height depending on vegetation

        float treeTexCoordX = fragCoord.x * texAspect / treeTexHeightNorm;            // static scaled trees

        float heightAboveGround = localY / treeTexHeightNorm;

        treeTexCoordX -= base.x * heightAboveGround * 1.00; // 2.5  trees waving with the wind effect

        treeTexCoordX *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY = 1. - treeTexCoordY;                 // texture is upside down

        vec4 texCol = vec4(0.0);
        if (wallX0Ym[TYPE] == WALLTYPE_LAND || wallX0Ym[TYPE] == WALLTYPE_URBAN) { // land below
          vec4 surfaceWater = texture(waterTex, texCoordX0Ym);                     // snow on land below
          float snow = surfaceWater[SNOW];
          if (snow * 0.01 / cellHeight > heightAboveGround)
            texCol = vec4(vec3(1.), 1.);                                                                                                                          // show white snow layer above ground
          else {                                                                                                                                                  // display vegetation
            vec4 treeColor = surfaceTexture(FOREST, vec2(treeTexCoordX, treeTexCoordY));
            vec4 vegetationCol = mix(treeColor, vec4(dryGrassCol, 1.), max(0.5 - surfaceWater[SOIL_MOISTURE] * (0.5 / fullGreenSoilMoisture), 0.) * treeColor.a); // green to brown
            texCol = mix(vegetationCol, surfaceTexture(SNOW_FOREST, vec2(treeTexCoordX, treeTexCoordY)), min(snow / fullWhiteSnowHeight, 1.0));
          }
        } else if (wallX0Ym[TYPE] == WALLTYPE_FIRE) {
          texCol = surfaceTexture(FIRE_FOREST, vec2(treeTexCoordX, treeTexCoordY));
        }
        if (texCol.a > 0.5) { // if not transparent
          color = texCol.rgb;

          shadowLight = minShadowLight;        // make sure trees are dark at night

          if (wallX0Ym[TYPE] == WALLTYPE_FIRE) // fire below
            shadowLight = 1.0;

          opacity = 1. - (1. - opacity) * (1. - texCol.a); // alpha blending
        }

        // draw 45° slopes
        ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
        ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

        if (wallXmY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER) { // wall to the left and below
          if (localX + localY < 1.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
        if (wallXpY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER) { // wall to the right and below
          if (localY - localX < 0.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
      }
    }
    float arrow = vectorField(base.xy, displayVectorField);

    if (arrow > 0.5) {
      fragmentColor = vec4(vec3(1., 1., 0.), 1.);
      return; // exit shader
    }

    // color.rg += vec2(arrow);
    // color.b -= arrow;
    // opacity += arrow;
    // lightIntensity += arrow;
    }
  }


  // ------------------------------------------------------------ lightning rods
  //
  // A rod is the one piece of scenery the player builds, so it is drawn as a real
  // air terminal instead of a stick: a wide pedestal where it is grounded, a mast
  // that tapers to a point, a cylindrical highlight down its length, and a corona
  // that lives at the tip. When a mast takes a strike the current is drawn down it
  // too - the light runs from the tip toward the ground - so a capture is
  // something to watch rather than something to infer from where the bolt landed.
  //
  // Drawn last so the mast stands in front of the terrain it is planted on, and
  // lit by the same sunlight / lightning light as everything else.
  const float rodBaseCells = 1.9;   // height of the stepped grounding pedestal, in cells
  const float rodCoronaReach = 3.8; // how far the tip's ionized corona reaches, in cells
  for (int i = 0; i < MAX_LIGHTNING_RODS; i++) {
    if (i >= rodCount)
      break;
    vec2 rod = rodPositions[i];
    float dxCells = (mod(texCoord.x - rod.x + 0.5, 1.0) - 0.5) * resolution.x; // wrapped horizontal offset in cells
    float dyCells = (texCoord.y - rod.y) * resolution.y;                       // height above surface, in cells
    if (dyCells < -1.5 || dyCells > rodHeight + rodCoronaReach || abs(dxCells) > max(rodThickness * 3.2, rodCoronaReach + 1.0))
      continue;

    // The current this mast is carrying, if it has taken a strike (wrapped across periodic boundary).
    float strikeGlow = 0.0;
    for (int slot = 0; slot < LIGHTNING_SLOTS; slot++) {
      vec4 strikeData = texelFetch(lightningDataTex, ivec2(slot, 0), 0);
      if (strikeData[START_ITERNUM] <= 0.0 || abs(mod(strikeData.x - rod.x + 0.5, 1.0) - 0.5) > 1e-5)
        continue;
      if (iterNum < strikeData[START_ITERNUM] || iterNum >= strikeAnimEnd(strikeData))
        continue; // this strike is not running
      float rodStrikeT = calcLightningTime(strikeData[START_ITERNUM]);
      float slotGlow = lightningIntensityOverTime(calcLightningTime(strikeData[START_ITERNUM]), strikeData.xy, strikeData[INTENSITY]);
      vec4 strikeMeta = texelFetch(lightningDataTex, ivec2(slot, 1), 0);
      if (strikeData[INTENSITY] > LIGHTNING_IC_MAX_INTENSITY && strikeMeta.y < 1.5 && strikeMeta.w >= 0.5) {
        float rodRepeatPeriod = map_range(random2d(strikeData.xy), 0., 1., 1.5, 3.0);
        if (rodStrikeT >= rodRepeatPeriod * lightningFlickers(strikeData) + 2.824)
          slotGlow = 0.0;
        else
          slotGlow = lightningIntensityOverTime(rodStrikeT > 0.0 ? rodStrikeT + 0.1 * smoothstep(0.0, 0.35, rodStrikeT) : 0.0,
                                                strikeData.xy, strikeData[INTENSITY]) * 12.0;
      }
      strikeGlow = max(strikeGlow, slotGlow);
    }

    float alongRod = clamp(dyCells / max(rodHeight, 1.0), 0.0, 1.0);
    float mastWidth = max(rodThickness * mix(0.92, 0.08, pow(alongRod, 0.85)), 0.24);
    if (alongRod >= 0.80 && alongRod <= 0.835)
      mastWidth = max(mastWidth * 1.65, rodThickness * 0.72); // corona / arrester collar ring
    float plinthT = clamp(dyCells / rodBaseCells, 0.0, 1.0);
    float baseWidth = max(rodThickness * mix(2.75, 0.92, smoothstep(0.0, 1.0, plinthT)), 0.65);
    float halfWidth = dyCells < rodBaseCells ? baseWidth : mastWidth;
    bool onMetal = dyCells >= -0.75 && abs(dxCells) <= halfWidth;

    if (onMetal) {
      float acrossRod = clamp(abs(dxCells) / max(halfWidth, 1e-4), 0.0, 1.0);
      vec3 matCol;
      if (dyCells < rodBaseCells * 0.72) {
        // Grounded masonry/steel mounting plinth
        matCol = mix(vec3(0.28, 0.30, 0.33), vec3(0.14, 0.15, 0.17), pow(acrossRod, 0.85));
      } else if (alongRod >= 0.84) {
        // Copper-bronze air terminal finial tip
        matCol = mix(vec3(0.92, 0.64, 0.36), vec3(0.30, 0.16, 0.08), pow(acrossRod, 0.80));
        matCol += vec3(0.32, 0.20, 0.10) * pow(acrossRod, 3.5);
      } else {
        // Brushed galvanized steel mast with subtle section bands
        float band = 0.94 + 0.06 * cos(alongRod * 28.0);
        matCol = mix(vec3(0.65, 0.71, 0.80), vec3(0.11, 0.12, 0.15), pow(acrossRod, 0.75)) * band;
        matCol += vec3(0.30, 0.35, 0.44) * pow(acrossRod, 4.0);
      }
      color = mix(matCol, vec3(1.0, 0.97, 0.90), clamp(strikeGlow * 0.55, 0.0, 1.0));
      shadowLight = max(shadowLight, 0.38);
      opacity = 1.0;
    }

    // Dynamic tip ionization: subtle St. Elmo's fire intensifies under overhead
    // storm clouds and erupts into a plasma arc when capturing a CG bolt.
    float tipDistance = length(vec2(dxCells, dyCells - rodHeight));
    if (tipDistance < rodCoronaReach) {
      float stormCloud = texture(waterTex, vec2(rod.x, clamp(rod.y + 0.16, 0.0, 0.96)))[CLOUD];
      float ambientIon = clamp(stormCloud * 0.75, 0.0, 1.4) * (0.85 + 0.15 * sin(iterNum * 0.45 + rod.x * 40.0));
      float corona = exp(-tipDistance / max(rodThickness * 1.05, 1.3));
      emittedLight += vec3(0.38, 0.50, 0.96) * corona * (0.28 + 0.60 * ambientIon + strikeGlow * 55.0);
    }

    // Captured return stroke conducts down the mast to the grounding plinth.
    if (strikeGlow > 0.0) {
      float surgeWave = 0.78 + 0.22 * sin(alongRod * 14.0 + iterNum * 2.1);
      float tipCore = smoothstep(0.78, 1.0, alongRod);
      float earthingFlash = smoothstep(0.18, 0.0, alongRod) * 0.35;
      emittedLight += vec3(0.58, 0.72, 1.0) * strikeGlow * surgeWave *
                      (tipCore * 200.0 + earthingFlash * 140.0 + 2600.0) * (onMetal ? 1.0 : 0.22);
    }
  }


  float scatering = clamp(map_range(abs(sunAngle), 75. * deg2rad, 90. * deg2rad, 0., 1.), 0., 1.); // how red the sunlight is

  vec3 finalLight = sunColor(scatering) * lightIntensity;


  if (fract(cursor.w) > 0.5) {                                               // enable flashlight
    vec2 vecFromMouse = cursor.xy - texCoord;
    vecFromMouse.x *= texelSize.y / texelSize.x;                             // aspect ratio correction to make it a circle
                                                                             // shadowLight += max(1. / (1.+length(vecFromMouse)*5.0),0.0); // point light
    shadowLight += max(cos(min(length(vecFromMouse) * 5.0, 2.)) * 1.0, 0.0); // smooth flashlight
  }

  vec3 ambientLight = texture(ambientLightTex, texCoord).rgb;

  onLight += ambientLight * pow(1. - clamp(-texCoord.y * 15., 0., 1.), 2.5);


  finalLight += vec3(shadowLight) + onLight;

  /*
   * The light and the alpha both have to stay inside what the buffer can hold.
   *
   * The scene is rendered into an RGBA16F framebuffer, whose largest finite
   * value is 65504, and it is alpha blended. A CG return stroke is written at a
   * hundred thousand HDR units and more (see displayLightning), so on its own it
   * overflows the buffer to infinity, and the alpha below - length(emittedLight),
   * also in the hundred thousands - makes the blend multiply the destination by
   * (1 - alpha), i.e. by a large negative number. Both come back out of the
   * tonemap divided by itself: NaN, which the bloom, FXAA and temporal AA passes
   * then smear over the frame as dead pixels.
   *
   * softHdrClamp() (common.glsl) is the answer, and it is not a clamp: it
   * compresses the top of the range instead of cutting it off, so a stroke can
   * still be written far past white and arrive in the bloom pass brighter than
   * one that only just overflowed. That extra light is the whole of "brighter
   * than white" - the tonemap flattens everything over ~3 to white, so the only
   * place a bolt's surplus energy can show is the halo it scatters, and the halo
   * is made from this buffer. The alpha is still cut at 1: nothing is more than
   * fully opaque.
   */
  opacity = clamp(opacity + length(emittedLight), 0.0, 1.0);

  fragmentColor = vec4(softHdrClamp(max(color * finalLight, 0.) + emittedLight), opacity);

  drawCursor(cursor, view); // over everything else
}
