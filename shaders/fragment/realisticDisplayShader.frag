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
uniform bool lightningBloomEnabled;

layout(location = 0) out vec4 fragmentColor;
layout(location = 1) out vec4 lightningBloomOutput;
layout(location = 2) out vec4 lightningBackgroundOutput;
layout(location = 3) out vec4 lightningCoverageOutput;

#include "common.glsl"

// Lightning rods: masts standing on the terrain, placed with the Lightning Rod
// tool. Rod data is sorted by position for spatial lookup.
uniform sampler2D rodDataTex; // sorted x, ground y, super-rod flag
uniform int rodCount;
uniform float rodThickness;     // half width of the mast, in cells
uniform float rodHeight;        // height of the mast, in cells

vec4 rodDataAt(int index)
{
  return texelFetch(rodDataTex, ivec2(index, 0), 0);
}
// Lower bound in the sorted rod table; no per-fragment scan of distant rods.
int rodLowerBound(float x)
{
  int lo = 0, hi = rodCount;
  while (lo < hi) {
    int mid = (lo + hi) / 2;
    if (rodDataAt(mid).x < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
uniform float originalBoltBottomU; // original artwork ground contact for rod alignment

#include "commonDisplay.glsl"

vec4 base, water;
ivec4 wall;
float lightIntensity;

vec3 color;
float opacity = 1.0;

vec3 emittedLight = vec3(0.); // pure light, like lightning
vec3 lightningBloomLight = vec3(0.0); // chromatic source before core whitening
// Coverage is tracked separately from HDR radiance for display compositing.
float sampledStrikeCoverage = 0.0;
float lightningPixelCoverage = 0.0;
vec3 lightningEmission = vec3(0.0);

float shadowLight;

vec3 onLight; // extra light that lights up objects, just like sunlight and shadowlight
vec3 rodGlow = vec3(0.0); // the rod's own light (tip corona, strike surge): drawn over whatever stands in front of it
// Derivatives captured before any divergent strike, terrain or cloud branches.
// These describe one actual HDR render-target pixel, including render scale/zoom.
vec2 screenTexDx, screenTexDy;


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

// The intensity curve used to peak at t=0 while the channel was still a
// dim leader, leaving the first return far weaker than later restrikes. Hold
// its peak through attachment and the return front, then rejoin the original
// curve before even the shortest IC restrike period. Do not extend the slot.
float firstReturnIntensity(float time, float intensity, float holdEnd, float fadeEnd)
{
  return (1.0 / 0.05 - 0.005) * intensity * intensity *
         (1.0 - smoothstep(holdEnd, fadeEnd, time));
}

float lightningIntensityOverTime(float Tin, vec2 lightningPos, float intensity)
{
  // The whole strike timeline is stretched or compressed by lifetimeScale so
  // intra-cloud flashes die sooner and +CC discharges linger - and the slot
  // manager holds the slot for exactly trainEnd * lifetimeScale, matching.
  float T0 = Tin / max(lightningLifetimeScale(vec4(lightningPos, 0., intensity)), 1e-3);

  vec4 strike = vec4(lightningPos, 0., intensity);
  float repeatPeriod = lightningRepeatPeriod(strike);          // per-strike spacing (shared with the slot manager)
  float numFlashes = lightningFlickers(strike);                 // 0.4

  float minT = max(T0 - (repeatPeriod * numFlashes), 0.);

  float T = max(mod(T0, repeatPeriod), minT);

  float curve = max((1. / (0.05 + pow(T * 2.0, 3.))) - 0.005, 0.) * pow(intensity, 2.0);
  return max(curve, firstReturnIntensity(Tin, intensity, 0.65, 0.78));
}

// Niels747's ordinary CG return curve: the leader occupies the first unit,
// then the original position-seeded restrike train and decay run unchanged.
float upstreamGroundIntensity(float time, vec2 pos, float intensity)
{
  float T0 = time - 1.0;
  float repeatPeriod = map_range(random2d(pos), 0.0, 1.0, 1.5, 3.0);
  float flashes = floor(map_range(random2d(pos * 2.737250), 0.0, 1.0, 1.0, max(intensity - 0.5, 0.0) * 2.0));
  float minT = max(T0 - repeatPeriod * flashes, 0.0);
  float T = max(mod(T0, repeatPeriod), minT);
  return max(1.0 / (0.05 + pow(T * 2.0, 3.0)) - 0.005, 0.0) * pow(intensity, 2.0);
}

// Visual timeline in the existing strike clock. A stepped leader grows from
// the source to the attachment point; after attachment a faster bright front
// runs back up the established path. This is an animation approximation:
// real return strokes are much faster than our iteration-based frame cadence.
float dischargeLeader(float time)
{
  float progress = clamp(time / 0.45, 0.0, 1.0) * 12.0;
  return min((floor(progress) + smoothstep(0.0, 0.42, fract(progress))) / 12.0, 1.0);
}

float dischargeBranchGrowth(float time, float root)
{
  return clamp((dischargeLeader(time) - root) * 4.5, 0.0, 1.0);
}

// Forks are leader channels, not persistent return-stroke filaments. Fade
// them after the first re-illumination; restrikes follow the established trunk.
float dischargeBranchFade(float time)
{
  return 1.0 - smoothstep(0.68, 1.10, time);
}

float groundChannelStage(float time, float fromCloud)
{
  float leader = dischargeLeader(time);
  float visible = 1.0 - smoothstep(leader, leader + 0.035, fromCloud);
  float returnFront = clamp((time - 0.45) / 0.20, 0.0, 1.0);
  float returned = smoothstep(1.0 - returnFront - 0.04, 1.0 - returnFront + 0.04, fromCloud);
  // Keep the growing leader visibly luminous before the return front arrives.
  // It is still far dimmer than the return, but supplies real HDR bloom.
  return visible * mix(0.003, 1.0, returned);
}

// IC/CC channels do not have a ground return stroke. Their leaders extend
// from their source, then a bright re-illumination follows the established
// path. Upper atmospheric sprites, jets and elves keep their own physics.
float cloudChannelStage(float time, float fromSource)
{
  float leader = dischargeLeader(time);
  float visible = 1.0 - smoothstep(leader, leader + 0.035, fromSource);
  float pulse = exp(-pow((fromSource - clamp((time - 0.45) / 0.24, 0.0, 1.0)) / 0.12, 2.0)) * smoothstep(0.43, 0.48, time);
  return visible * (0.006 + 0.994 * smoothstep(0.40, 0.55, time) + pulse * 0.6);
}

float findCapturedRodTipY(float strikeX)
{
  int index = rodLowerBound(strikeX - 1e-5);
  if (index < rodCount) {
    vec4 rod = rodDataAt(index);
    if (abs(strikeX - rod.x) < 1e-5)
      return rod.y + rodHeight * (rod.z > 0.5 ? 1.8 : 1.0) / max(resolution.y, 1.0);
  }
  return -1.0;
}

// The simulation background can repeat horizontally, but a lightning event is
// owned by the canonical 0..1 world tile. Never replicate its channel into a
// neighboring rendered tile: near an edge that looks like it crossed the seam.
bool inLightningWorldTile()
{
  return texCoord.x >= 0.0 && texCoord.x < 1.0;
}

float extTriWave(float x)
{
  return 4.0 * abs(fract(x) - 0.5) - 1.0;
}

// Lightning variant world scales are fixed in kilometres at the 12 km reference
// simulation height. Every constant written for that world has to be re-expressed
// for the current sim height, or the variants scale linearly with the texture
// height (and with the cell size when the vertical resolution changes).
float lightningHeightScale()
{
  return (cellHeight * float(resolution.y) * 0.001) / 12.0;
}

// Fractal triangular-wave jag for a channel: the same octave family and weights
// as the CC lightning (see ccFractalDisp), shared so every channel - CG bolts,
// external positive CGs - buckles
// the same way instead of wiggling its own way. t is the travel parameter in
// [0, 1], spanKm the channel length in kilometres, amp the lateral displacement
// of the channel in world units (fraction of the sim height).
float fractalLateralJag(float t, float spanKm, float seed, float amp)
{
  float norm = max(spanKm, 0.18 * lightningHeightScale());
  float s = t * spanKm;
  float f1 = 2.3 / norm, f2 = 6.1 / norm, f3 = 14.8 / norm;
  return (0.58 * extTriWave(s * f1 + seed) +
          0.28 * extTriWave(s * f2 + seed * 1.73 + 0.31) +
          0.13 * extTriWave(s * f3 + seed * 2.91 + 0.67)) * amp;
}

// d(fractalLateralJag)/dt, used to propagate mip gradients through the warp.
float fractalLateralJagDeriv(float t, float spanKm, float seed, float amp)
{
  float norm = max(spanKm, 0.18 * lightningHeightScale());
  float s = t * spanKm;
  float f1 = 2.3 / norm, f2 = 6.1 / norm, f3 = 14.8 / norm;
  float d1 = s * f1 + seed;
  float d2 = s * f2 + seed * 1.73 + 0.31;
  float d3 = s * f3 + seed * 2.91 + 0.67;
  float sgn1 = fract(d1) < 0.5 ? -1.0 : 1.0;
  float sgn2 = fract(d2) < 0.5 ? -1.0 : 1.0;
  float sgn3 = fract(d3) < 0.5 ? -1.0 : 1.0;
  return (0.58 * f1 * sgn1 + 0.28 * f2 * sgn2 + 0.13 * f3 * sgn3) * spanKm * amp * 4.0;
}

// Niels747's original linear-RGB lightning channel colour. All variants keep
// their own geometry and intensity, but use the same upstream colour.
const vec3 upstreamLightningColor = vec3(0.70, 0.57, 1.0);
vec3 upstreamColorize(vec3 radiance)
{
  float peak = max(radiance.r, max(radiance.g, radiance.b));
  return max(peak, 0.0) * upstreamLightningColor;
}

// Increase lightning-only emission before the bloom pyramid. This boosts weak
// optical transients too, rather than only lifting the brightest bolt cores.
// The common RGB shoulder bounds extreme overlapping strikes while preserving
// their chromaticity and leaving HDR headroom for the glow pass.
vec3 displayLightningRadiance(vec3 radiance)
{
  vec3 c = max(radiance, vec3(0.0)) * 18.0;
  float peak = max(c.r, max(c.g, c.b));
  return c / (1.0 + peak / 24000.0);
}

// Preserve saturated channel radiance while suppressing low-coverage haze.
// Gradual coverage remains nonzero for thin, minified branches.
float lightningCoverage(float sampleValue, float threshold)
{
  float coverage = clamp((sampleValue - threshold) / (1.0 - threshold), 0.0, 1.0);
  return pow(coverage, 1.2);
}

// Two taps along the elongated projected footprint retain fine texture
// detail without disabling mip filtering or increasing the HDR render scale.
// Gradients are captured outside the divergent lightning slot loop.
vec3 sampleLightningArtwork(sampler2D artworkTex, vec2 uv, vec2 gradX, vec2 gradY)
{
  vec2 size = vec2(textureSize(artworkTex, 0));
  float lenX = length(gradX * size);
  float lenY = length(gradY * size);
  if (max(lenX, lenY) <= 1.5 * max(min(lenX, lenY), 1.0))
    return textureGrad(artworkTex, uv, gradX, gradY).rgb;
  bool majorX = lenX > lenY;
  vec2 major = majorX ? gradX : gradY;
  vec2 dx = majorX ? gradX * 0.5 : gradX;
  vec2 dy = majorX ? gradY : gradY * 0.5;
  return 0.5 * (textureGrad(artworkTex, uv - major * 0.25, dx, dy).rgb +
                textureGrad(artworkTex, uv + major * 0.25, dx, dy).rgb);
}

// Artwork stores trunks in red and forks in green. Forks tagged with a low
// green value are omitted for positive discharges; this is selected per fork
// at generation time, not per fragment or animation frame.
float artworkBranchCoverage(float sampleValue, bool positive)
{
  float threshold = positive ? 0.36 : 0.004;
  return lightningCoverage(sampleValue, threshold);
}

vec2 ccRotate(vec2 v, float angle)
{
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

vec2 ccFractalDisp(float s, float span, float jagPhase, float jagScale)
{
  float hScale = lightningHeightScale();
  float normLen = max(span, 0.18 * hScale);
  float f1 = 2.3 / normLen;
  float f2 = 6.1 / normLen;
  float f3 = 14.8 / normLen;

  float x1 = s * f1 + jagPhase;
  float x2 = s * f2 + jagPhase * 1.73 + 0.31;
  float x3 = s * f3 + jagPhase * 2.91 + 0.67;

  float d = (0.58 * extTriWave(x1) +
             0.28 * extTriWave(x2) +
             0.06 * extTriWave(x3)) * jagScale;

  float sgn1 = fract(x1) < 0.5 ? -4.0 : 4.0;
  float sgn2 = fract(x2) < 0.5 ? -4.0 : 4.0;
  float sgn3 = fract(x3) < 0.5 ? -4.0 : 4.0;
  float slope = (0.58 * sgn1 * f1 + 0.28 * sgn2 * f2 + 0.06 * sgn3 * f3) * jagScale;
  return vec2(d, clamp(slope, -2.5, 2.5));
}

// Signed-distance core + sheath evaluation for a forked side branch.
// Returns vec2(coreMask, combinedSignal).
// pixelT is the pixel footprint in the same units as target - callers compute
// it from the captured screenTexDx/Dy so the branch is anti-aliased at any zoom
// (a distance-shaped edge narrower than a pixel breaks into stair-stepped
// dashes otherwise).
vec2 ccEvalBranch(vec2 target, vec2 bStart, vec2 bDir, float bLen, float curveSign,
                  float seed, float coreW, float weight, float pixelT)
{
  float hScale = lightningHeightScale();
  vec2 bNorm = vec2(-bDir.y, bDir.x);
  vec2 rel = target - bStart;
  float along = dot(rel, bDir);
  float perp = dot(rel, bNorm);
  if (along < -0.015 * hScale || along > bLen + 0.025 * hScale || abs(perp) > bLen * 0.58)
    return vec2(0.0);

  float bt = clamp(along / max(bLen, 1e-4), 0.0, 1.0);
  float arch = curveSign * 0.11 * bLen * sin(PI * bt);
  float jagScale = clamp(bLen * 0.095, 0.008 * hScale, 0.028 * hScale);
  vec2 jag = ccFractalDisp(along, max(bLen, 0.12 * hScale), seed * 11.3, jagScale);
  float rootPin = smoothstep(0.0, 0.08, bt) * (1.0 - 0.30 * bt);
  float centerPerp = arch + jag.x * rootPin;
  float rootT = clamp(bt / 0.08, 0.0, 1.0);
  float rootSmooth = rootT * rootT * (3.0 - 2.0 * rootT);
  float rootDerivative = (6.0 * rootT * (1.0 - rootT) / 0.08 * (1.0 - 0.30 * bt) - 0.30 * rootSmooth) / max(bLen, 1e-4);
  float slope = jag.y * rootPin + jag.x * rootDerivative + curveSign * 0.11 * PI * cos(PI * bt);
  float dist = abs(perp - centerPerp) * inversesqrt(1.0 + clamp(slope * slope, 0.0, 6.25));

  float endMask = smoothstep(-0.006 * hScale, 0.004 * hScale, along) * (1.0 - smoothstep(bLen - 0.006 * hScale, bLen + 0.008 * hScale, along));
  float taper = mix(0.74, 0.26, bt);
  float bw = max(coreW * taper, 0.0011 * hScale);
  // Filter the core profile over the pixel it will be drawn on (the same
  // Gaussian footprint idiom as channelGlow), preserving integrated energy:
  // a branch narrower than a pixel dims smoothly instead of dissolving into
  // dashes or sparkling along its path.
  float aa = max(pixelT, 1e-6);
  float f2 = bw * bw + 0.5625 * aa * aa;
  float invF = inversesqrt(f2);
  float core = exp(-dist * dist * invF * invF) * clamp(bw * invF, 0.0, 1.0) * endMask;
  float halo = exp(-dist / max(bw * 3.0, 0.0040 * hScale)) * 0.20 * endMask;
  float fade = (1.0 - smoothstep(0.10, 1.0, bt)) * weight;
  return vec2(core * fade, (core + halo) * fade);
}

// The cloud-to-ground channel: fires immediately on trigger with no fixed
// pre-strike latency, written at the stroke's own curve times mainBoltBrightness.
// The light it throws is the bolt itself plus one tight lobe on the cloud around
// it, and the bloom takes two percent of the frame as it always did. There is no
// easing of the tail and no second, wide lobe: a stroke goes from white to gone
// as fast as the curve does. When captured by a lightning rod, the channel
// terminates squarely on the rod's copper tip instead of passing underground.
vec3 displayLightning(vec2 pos, float originX, float lightningTime, float currentLightningIntensity)
{
  if (!inLightningWorldTile())
    return vec3(0.0);
  float rodTipY = findCapturedRodTipY(pos.x);
  bool rodHit = rodTipY >= 0.0;
  if (rodHit && texCoord.y < rodTipY)
    return vec3(0);

  float topY = rodHit ? max(pos.y, rodTipY + 0.04) : pos.y;
  float bottomY = rodHit ? rodTipY : 0.0;
  float spanY = max(topY - bottomY, 0.04);
  float scaleMult = 1. / spanY; // 1.0 means lightning is as tall as the simheight

  vec2 lightningTexCoord;
  // A captured leader keeps its cloud origin and bends toward the mast only
  // near the ground instead of translating the entire bolt to the rod.
  float descent = clamp((topY - texCoord.y) / spanY, 0.0, 1.0);
  float bendT = clamp((descent - 0.35) / 0.65, 0.0, 1.0);
  float bend = bendT * bendT * (3.0 - 2.0 * bendT);
  float originOffset = rodHit ? originX - pos.x : 0.0;
  lightningTexCoord.x = texCoord.x - pos.x - originOffset * (1.0 - bend);
  lightningTexCoord.y = texCoord.y - topY;

  lightningTexCoord.x *= scaleMult * aspectRatios[0] / lightningTexAspect;
  lightningTexCoord.y *= -scaleMult;

  // Y is unaffected by lateral distortion. Reject off-channel pixels before
  // evaluating the fractal displacement and its derivative.
  if (lightningTexCoord.y < 0.01 || lightningTexCoord.y > 1.01)
    return vec3(0.0);

  // Use the upstream artwork directly, without the fork's additional warp or
  // procedural branches. Keep only the rod shear needed to meet a captured tip.
  float uShift = rodHit ? (originalBoltBottomU - 0.5) * pow(clamp(lightningTexCoord.y, 0.0, 1.0), 1.25) : 0.0;
  lightningTexCoord.x += 0.5 + uShift;
  if (lightningTexCoord.x < 0.01 || lightningTexCoord.x > 1.01)
    return vec3(0.0);

  // Return-stroke coverage is thresholded before the mip chain is built.
  // Filtering coverage (rather than thresholding already-filtered intensity)
  // preserves the light of subpixel branches without artificially widening it.
  const float branchShowFactor = 2.5;
  const float leaderBrightness = 50000.0;
  const float mainBoltBrightness = 100000.0;
  float pixVal;
  if (lightningTime > 1.0) {
    vec2 gradX = vec2(screenTexDx.x * scaleMult * aspectRatios[0] / lightningTexAspect,
                      -screenTexDx.y * scaleMult);
    vec2 gradY = vec2(screenTexDy.x * scaleMult * aspectRatios[0] / lightningTexAspect,
                      -screenTexDy.y * scaleMult);
    if (rodHit) {
      float bendSlope = 6.0 * bendT * (1.0 - bendT) / 0.65;
      float shearSlope = (originalBoltBottomU - 0.5) * 1.25 * pow(clamp(lightningTexCoord.y, 0.0, 1.0), 0.25)
                       + originOffset * bendSlope * scaleMult * aspectRatios[0] / lightningTexAspect;
      gradX.x += shearSlope * gradX.y;
      gradY.x += shearSlope * gradY.y;
    }
    pixVal = textureGrad(lightningTex, lightningTexCoord, gradX, gradY).r * 0.05;
    sampledStrikeCoverage = pixVal / 0.05;
    currentLightningIntensity *= mainBoltBrightness;
    pixVal *= currentLightningIntensity;
  } else {
    // Keep the original raw source for the moving leader threshold.
    float raw = textureLod(lightningTex, lightningTexCoord, 0.0).g;
    float threshold = clamp(1.0 - lightningTime * branchShowFactor + lightningTexCoord.y * branchShowFactor, 0.0, 1.0);
    sampledStrikeCoverage = clamp((raw - threshold) / max(1.0 - threshold, 1e-5), 0.0, 1.0);
    pixVal = max(raw - threshold, 0.0) * leaderBrightness;
  }

  vec3 lightningCol = upstreamLightningColor;

  vec3 outputColor = max(pixVal * lightningCol, vec3(0));

  return outputColor;
}

// Project the original bolt tile onto a path. The green channel stores the
// unpremultiplied Niels747 artwork; the endpoint shear keeps captured rods and
// cloud-to-cloud targets attached to the generated bolt's actual lower tip.
float adaptedUpstreamArtwork(float u, float t, vec2 gradX, vec2 gradY)
{
  float shear = originalBoltBottomU - 0.5;
  u += shear * clamp(t, 0.0, 1.0);
  if (u < 0.01 || u > 0.99 || t < 0.01 || t > 0.99)
    return 0.0;
  gradX.x += shear * gradX.y;
  gradY.x += shear * gradY.y;
  sampledStrikeCoverage = textureGrad(lightningTex, vec2(u, t), gradX, gradY).r;
  return sampledStrikeCoverage;
}

// Project a bent cloud channel in a local orthonormal frame. The asymmetric
// arch has exact endpoints and a single-valued mapping, so no per-pixel nearest
// cubic search is needed. Derivatives follow the same warp for textureGrad.
bool cloudCurveProjection(vec2 start, vec2 end, float bow, float skew,
                          out float u, out float t, out vec2 gradX, out vec2 gradY)
{
  vec2 delta = end - start;
  float span = length(delta);
  if (span < 1e-4) return false;
  vec2 tangent = delta / span;
  vec2 normal = vec2(-tangent.y, tangent.x);
  vec2 point = vec2(texCoord.x * aspectRatios[0], texCoord.y) - start;
  t = dot(point, tangent) / span;
  if (t < 0.01 || t > 0.99) return false;
  float asym = 1.0 + skew * (2.0 * t - 1.0);
  float profile = t * (1.0 - t) * asym;
  float slope = (1.0 - 2.0 * t) * asym + 2.0 * skew * t * (1.0 - t);
  u = 0.5 + (dot(point, normal) / span - bow * profile) / lightningTexAspect;
  vec2 pixelX = vec2(screenTexDx.x * aspectRatios[0], screenTexDx.y);
  vec2 pixelY = vec2(screenTexDy.x * aspectRatios[0], screenTexDy.y);
  float tx = dot(pixelX, tangent) / span;
  float ty = dot(pixelY, tangent) / span;
  gradX = vec2((dot(pixelX, normal) / span - bow * slope * tx) / lightningTexAspect, tx);
  gradY = vec2((dot(pixelY, normal) / span - bow * slope * ty) / lightningTexAspect, ty);
  return true;
}

// IC channels sweep through different tilted, asymmetric arches while retaining
// the original detailed artwork, width, timing and polarity-specific span.
vec3 displayAdaptedFlash(vec2 pos, float lightningTime, float currentLightningIntensity, bool positive)
{
  if (!inLightningWorldTile()) return vec3(0.0);
  float height = (positive ? 0.095 : 0.075) * lightningHeightScale();
  float lengthWorld = height * 2.0;
  // A conservative square covers every angle, curve and artwork edge.
  vec2 offset = vec2((texCoord.x - pos.x) * aspectRatios[0], texCoord.y - pos.y);
  if (max(abs(offset.x), abs(offset.y)) > lengthWorld * 1.7) return vec3(0.0);
  float seed = random2d(vec2(pos.x * 37.7 + pos.y * 13.3, pos.y * 29.1 + 3.17));
  float shape = random2d(vec2(pos.x * 61.3 + 7.9, pos.y * 41.7 + 5.1));
  float angle = mix(-0.70, 0.70, seed);
  float direction = shape < 0.5 ? -1.0 : 1.0;
  vec2 axis = direction * vec2(cos(angle), sin(angle));
  vec2 center = vec2(pos.x * aspectRatios[0], pos.y);
  vec2 start = center - axis * lengthWorld * 0.5;
  vec2 end = center + axis * lengthWorld * 0.5;
  float bow = (seed < 0.5 ? -1.0 : 1.0) * mix(0.65, 1.05, shape);
  float skew = mix(-0.65, 0.65, seed);
  float u, t; vec2 gradX, gradY;
  if (!cloudCurveProjection(start, end, bow, skew, u, t, gradX, gradY)) return vec3(0.0);
  float coverage = adaptedUpstreamArtwork(u, t, gradX, gradY);
  if (coverage <= 0.0) return vec3(0.0);
  float stage = cloudChannelStage(lightningTime, abs(t - 0.5) * 2.0);
  return upstreamLightningColor * coverage * currentLightningIntensity * (positive ? 3600.0 : 2400.0) * stage;
}
vec3 displayFlash(vec2 pos, float lightningTime, float currentLightningIntensity)
{
  return displayAdaptedFlash(pos, lightningTime, currentLightningIntensity, false);
}
vec3 displayPositiveFlash(vec2 pos, float lightningTime, float currentLightningIntensity)
{
  return displayAdaptedFlash(pos, lightningTime, currentLightningIntensity, true);
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
vec3 displayExternalLightning(vec2 groundPos, float originX, float lightningTime, float currentLightningIntensity, vec3 lightningColor, float branchTime)
{
  if (!inLightningWorldTile())
    return vec3(0.0);
  float hScale = lightningHeightScale();
  float rodTipY = findCapturedRodTipY(groundPos.x);
  float endY = rodTipY >= 0.0 ? rodTipY : 0.0;
  float relX = texCoord.x - groundPos.x;
  float dxWrap = originX - groundPos.x;
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
  float scaleLen = max(V, 0.25 * hScale);
  float u = 0.5 + dPerp / (scaleLen * lightningTexAspect);
  vec2 pixelX = vec2(screenTexDx.x * aspectRatios[0], screenTexDx.y);
  vec2 pixelY = vec2(screenTexDy.x * aspectRatios[0], screenTexDy.y);
  float alongScale = max(dLen, 1e-4);
  vec2 gradX = vec2(dot(pixelX, normDir) / (scaleLen * lightningTexAspect), dot(pixelX, tanDir) / alongScale);
  vec2 gradY = vec2(dot(pixelY, normDir) / (scaleLen * lightningTexAspect), dot(pixelY, tanDir) / alongScale);
  float pixVal = adaptedUpstreamArtwork(u, t, gradX, gradY);
  if (pixVal <= 0.0) return vec3(0.0);
  const float extBoltBrightness = 3000.0;
  return max(pixVal * currentLightningIntensity * extBoltBrightness *
             groundChannelStage(lightningTime, t) * lightningColor, vec3(0.0));
}

// CC uses the actual two cloud endpoints, with a stable varied arch in their
// local frame. No nearest-point iterations or per-pixel cubic search are needed.
vec3 displayCloudToCloudLightning(vec2 targetPos, vec2 originPos, bool isPositiveCC,
                                  float lightningTime, float ccCurve)
{
  if (!inLightningWorldTile()) return vec3(0.0);
  vec2 start = vec2(originPos.x * aspectRatios[0], originPos.y);
  vec2 end = vec2(targetPos.x * aspectRatios[0], targetPos.y);
  float span = length(end - start);
  if (span < 1e-4) return vec3(0.0);
  vec2 point = vec2(texCoord.x * aspectRatios[0], texCoord.y);
  vec2 pad = vec2(span * 1.1);
  if (any(lessThan(point, min(start, end) - pad)) ||
      any(greaterThan(point, max(start, end) + pad))) return vec3(0.0);
  float seed = random2d(vec2(originPos.x * 29.1 + originPos.y * 17.7,
                             targetPos.x * 41.3 + targetPos.y * 13.9));
  float shape = random2d(vec2(targetPos.y * 61.1 + 11.7, originPos.x * 47.9 + 8.3));
  float bow = (seed < 0.5 ? -1.0 : 1.0) * mix(0.65, 1.05, shape);
  float skew = mix(-0.65, 0.65, seed);
  float u, t; vec2 gradX, gradY;
  if (!cloudCurveProjection(start, end, bow, skew, u, t, gradX, gradY)) return vec3(0.0);
  float pixVal = adaptedUpstreamArtwork(u, t, gradX, gradY);
  if (pixVal <= 0.0) return vec3(0.0);
  const float ccBaseBrightness = 900.0;
  return upstreamLightningColor * pixVal * cloudChannelStage(lightningTime, t) * ccCurve * ccBaseBrightness;
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
#define lightningOnLightBrightness 0.0008

  // Every strike in the slot array is drawn until its own animation is over.
  // Slots are independent, so a new strike never truncates a running one.
  vec3 lightningBoltLight = vec3(0.0); // special discharge channels
  vec3 upstreamGroundLight = vec3(0.0); // ordinary CG retains upstream radiance
  for (int slot = 0; slot < LIGHTNING_SLOTS; slot++) {
    if (!inLightningWorldTile())
      break; // no channel, crawler or lightning illumination in repeated tiles
    vec4 lightningData = texelFetch(lightningDataTex, ivec2(slot, 0), 0);
    float lightningStartIterNum = lightningData[START_ITERNUM];
    if (lightningStartIterNum <= 0.0 || iterNum >= lightningStartIterNum + 2048.0)
      continue; // empty or certainly expired; avoid metadata and lifetime hashes
    // The longest supported ordinary parent is under 140 iterations; even the
    // 8x legacy duration and 100-iteration optical minimum stay below 2048.
    // Recent strikes still use their exact end calculation below.
    vec4 lightningMeta = texelFetch(lightningDataTex, ivec2(slot, 1), 0);
    // Artificial (manually clicked) strikes mark their meta.z with the +10
    // offset; metaRawZ recovers the real height/sentinel, metaArt flags them.
    float metaRawZ = artificialMetaRawZ(lightningMeta.z);
    bool metaArt = artificialMeta(lightningMeta.z);
    // The parent channel retains its own animation even if an optical effect
    // keeps the slot alive longer for visibility at high iteration rates.
    // A loaded legacy upward-leader slot must not be reinterpreted as CC.
    if (abs(lightningMeta.y - 5.0) < 0.25)
      continue;
    if (iterNum < lightningStartIterNum || (metaArt
        ? iterNum >= lightningSlotEnd(lightningData, lightningMeta)
        : iterNum >= parentStrikeAnimEnd(lightningData, lightningMeta)))
      continue;

    vec2 lightningPos = lightningData.xy;
    float lightningTime = metaArt ? (iterNum - lightningStartIterNum) / 20.0 : calcLightningTime(lightningStartIterNum);
    // Every strike starts directly on the trigger iteration with zero fixed delay.
    bool ordinaryCG = lightningData[INTENSITY] > LIGHTNING_IC_MAX_INTENSITY && abs(lightningMeta.y) < 0.25;
    float currentLightningIntensity = ordinaryCG
      ? upstreamGroundIntensity(lightningTime, lightningPos, lightningData[INTENSITY])
      : lightningIntensityOverTime(lightningTime, lightningPos, lightningData[INTENSITY]);
    if (currentLightningIntensity <= 0.0 && !(ordinaryCG && lightningTime <= 1.0))
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
    bool isFlash = lightningData[INTENSITY] <= LIGHTNING_IC_MAX_INTENSITY;
    bool isPositiveIC = isFlash && lightningMeta.y >= 3.5;
    bool isExternalPositive = !isFlash && abs(lightningMeta.y - 1.0) < 0.25;
    bool isCloudToCloud = !isFlash && lightningMeta.y >= 1.5;
    bool isPositiveCC = isCloudToCloud && lightningMeta.y >= 2.5;
    bool isSuperbolt = isExternalPositive && lightningMeta.w >= 0.5;
    bool isHyperbolt = isExternalPositive && lightningMeta.w >= 1.5;
    // Upstream lights its surroundings neutrally, not with a variant tint.
    vec3 lightningIlluminationTint = vec3(1.0);
    const float superboltBrightnessMult = 12.0;
    const float superboltDurationShorten = 0.1;
    const float hyperboltBrightnessMult = 30.0; // 2.5x a superbolt
    const float hyperboltDurationShorten = 2.624; // 2.924 - 0.3: a 0.3 second lifetime
    float strokeBrightnessMult = isHyperbolt ? hyperboltBrightnessMult : superboltBrightnessMult;
    float strokeDurationShorten = isHyperbolt ? hyperboltDurationShorten : superboltDurationShorten;
    float effectiveLightningTime = lightningTime;
    float ccIntensityGain = 1.0;
    float ccTailFade = 1.0;
    float extCurve = 0.0;
    // Ordinary ground strokes and IC flashes never use CC/external tail or
    // intensity calculations. The classification is per strike, so this
    // coherent branch avoids multiple hashes, flicker curves and powers for
    // every affected screen fragment without changing any strike timing.
    if (isExternalPositive || isCloudToCloud) {
      float repeatPeriod = map_range(random2d(lightningPos), 0., 1., 1.5, 3.0);
      float flickers = lightningFlickers(lightningData);
      if (isSuperbolt && lightningTime >= repeatPeriod * flickers + (2.924 - strokeDurationShorten))
        continue;
      effectiveLightningTime = isSuperbolt && lightningTime > 0.0
        ? lightningTime + strokeDurationShorten * smoothstep(0.0, 0.35, lightningTime)
        : lightningTime;
      if (isSuperbolt) {
        currentLightningIntensity = lightningIntensityOverTime(effectiveLightningTime, lightningPos, lightningData[INTENSITY]);
        if (currentLightningIntensity <= 0.0)
          continue;
      }
      float tailT = max(effectiveLightningTime - repeatPeriod * flickers, 0.0);
      if (isCloudToCloud) {
        ccTailFade = pow(smoothstep(2.924, 1.25, tailT), 2.2);
        ccIntensityGain = (isPositiveCC ? 1.5 : 1.0) * (1.8 / max(pow(lightningData[INTENSITY], 2.0), 0.1));
      }
      if (isExternalPositive) {
        float extTailFade = pow(smoothstep(2.924, 1.15, tailT), 2.4);
        float extBaseIntensity = clamp(mix(1.8, 3.4, (lightningData[INTENSITY] - 4.6) / 0.8), 1.8, 3.4);
        float extIntensityGain = pow(extBaseIntensity / max(lightningData[INTENSITY], 1.0), 2.0);
        extCurve = currentLightningIntensity * extIntensityGain * extTailFade;
        if (isHyperbolt)
          extCurve = max(extCurve, firstReturnIntensity(lightningTime, lightningData[INTENSITY], 0.10, 0.26) * extIntensityGain);
      }
    }
    sampledStrikeCoverage = 0.0;
    vec3 strikeChannel = vec3(0.0);
    if (isExternalPositive) {
      strikeChannel += displayExternalLightning(lightningPos, lightningMeta.x, effectiveLightningTime, extCurve,
                                                     upstreamLightningColor,
                                                     lightningTime);
      if (isSuperbolt)
        strikeChannel *= strokeBrightnessMult;
    } else if (isCloudToCloud) {
      strikeChannel += displayCloudToCloudLightning(vec2(lightningPos.x, metaRawZ),
                                                         vec2(lightningMeta.x, lightningPos.y),
                                                         isPositiveCC,
                                                         lightningTime,
                                                         currentLightningIntensity * ccIntensityGain * ccTailFade);
    } else if (isPositiveIC) {
      strikeChannel += displayPositiveFlash(lightningPos, lightningTime, currentLightningIntensity);
    } else {
      strikeChannel += isFlash ? displayFlash(lightningPos, lightningTime, currentLightningIntensity)
                                    : displayLightning(lightningPos, lightningMeta.x, lightningTime, currentLightningIntensity);
    }

    // Brighten the channel, with a uniform 2.5x polarity gain for +IC,
    // +CC and +CG (including superbolts and hyperbolts). Geometry and
    // coverage are unchanged; the existing HDR bloom receives the same light.
    // IC/CC already include a 1.5x positive gain in their variant paths.
    float polarityGain = isExternalPositive ? 2.5 : ((isPositiveIC || isPositiveCC) ? (2.5 / 1.5) : 1.0);
    strikeChannel *= 2.0 * polarityGain;

    // Ordinary CG already carries the upstream RGB. Other variants retain
    // their geometry while adopting that same colour.
    float strikePeak = max(strikeChannel.r, max(strikeChannel.g, strikeChannel.b));
    if (strikePeak > 0.0)
      lightningPixelCoverage = min(1.0, lightningPixelCoverage + sampledStrikeCoverage);
    if (ordinaryCG)
      upstreamGroundLight += strikeChannel;
    else
      lightningBoltLight += upstreamColorize(strikeChannel);
    if (lightningBloomEnabled)
      lightningBloomLight += strikePeak * upstreamLightningColor;

    // The light a strike throws on the clouds around it.
    float lightningOnLight;
    if (isFlash) {
      // A flash lights the whole slab it lives in, not a point below itself: its
      // lobe is centred on the strike, reaches twice as far and is twice as bright,
      // because what a player sees of an intra-cloud flash from outside the cloud is
      // mostly this - the deck glowing from the inside - with the network on top.
      vec2 flashDist = vec2((lightningPos.x - texCoord.x) * aspectRatios[0], texCoord.y - lightningPos.y);
      lightningOnLight = lightningOnLightBrightness * 2.0 / (pow(length(flashDist) * 0.5, 2.) + 0.03 * lightningHeightScale());
      if (isPositiveIC)
        lightningOnLight *= 1.5;
    } else if (isCloudToCloud) {
      vec2 ccTargetDist = vec2((lightningPos.x - texCoord.x) * aspectRatios[0],
                               texCoord.y - metaRawZ);
      lightningOnLight = lightningOnLightBrightness * 1.4 / (pow(length(ccTargetDist) * 0.5, 2.) + 0.03 * lightningHeightScale()) * ccIntensityGain * ccTailFade;
      float ccOriginDx = lightningMeta.x - texCoord.x;
      vec2 ccOriginDist = vec2(ccOriginDx * aspectRatios[0], texCoord.y - lightningPos.y);
      float ccMidDx = 0.5 * (lightningPos.x + lightningMeta.x) - texCoord.x;
      vec2 ccMidDist = vec2(ccMidDx * aspectRatios[0], texCoord.y - 0.5 * (lightningPos.y + metaRawZ));
      onLight += lightningIlluminationTint * (lightningOnLightBrightness * 1.4 / (pow(length(ccOriginDist) * 0.5, 2.) + 0.03 * lightningHeightScale()) * ccIntensityGain * ccTailFade * currentLightningIntensity);
      onLight += lightningIlluminationTint * (lightningOnLightBrightness * 0.9 / (pow(length(ccMidDist) * 0.55, 2.) + 0.035 * lightningHeightScale()) * ccIntensityGain * ccTailFade * currentLightningIntensity);
    } else {
      // The ground lobe remains in the same world tile as the strike.
      float cgDx = lightningPos.x - texCoord.x;
      vec2 dist = vec2(cgDx, max((abs(lightningPos.y / 2. - texCoord.y) - 0.1 * lightningHeightScale()), 0.));
      dist.x *= aspectRatios[0];
      lightningOnLight = lightningOnLightBrightness / (pow(length(dist), 2.) + 0.03 * lightningHeightScale());
    }
    lightningOnLight *= isExternalPositive ? extCurve : currentLightningIntensity;
    if (isSuperbolt)
      lightningOnLight *= strokeBrightnessMult;
    onLight += lightningIlluminationTint * lightningOnLight;
    if (isExternalPositive) {
      onLight += lightningIlluminationTint * lightningOnLight;
      float originDx = lightningMeta.x - texCoord.x;
      vec2 originDist = vec2(originDx * aspectRatios[0], texCoord.y - lightningPos.y);
      onLight += lightningIlluminationTint * (lightningOnLightBrightness * 2.0 / (pow(length(originDist) * 0.7, 2.) + 0.03 * lightningHeightScale()) * extCurve * (isSuperbolt ? strokeBrightnessMult : 1.0));
    }
  }

  vec3 visibleLightning = displayLightningRadiance(lightningBoltLight / (1. + cloudDensity * 100.0));
  lightningEmission = visibleLightning + upstreamGroundLight / (1. + cloudDensity * 100.0);
  emittedLight += visibleLightning + upstreamGroundLight / (1. + cloudDensity * 100.0);
  if (lightningBloomEnabled) {
    vec3 glowColor = displayLightningRadiance(lightningBloomLight / (1. + cloudDensity * 100.0));
    float glowPeak = max(glowColor.r, max(glowColor.g, glowColor.b));
    float visiblePeak = max(visibleLightning.r, max(visibleLightning.g, visibleLightning.b));
    lightningBloomLight = glowColor * (visiblePeak / max(glowPeak, 1e-6));
  }

  return vec4(color, opacity);
}

vec4 getAirColor(vec2 fragCoordIn)
{
  vec2 bndFragCoord = vec2(fragCoordIn.x, clamp(fragCoordIn.y, 0., resolution.y)); // bound y within range
  bilerpWallVisPair(baseTex, waterTex, wallTex, bndFragCoord, base, water);
  wall = texture(wallTex, bndFragCoord * texelSize);                               // texCoord
  lightIntensity = texture(lightTex, bndFragCoord * texelSize)[0] / standardSunBrightness;
  return computeAirColor(bndFragCoord);
}

float rand(float n) { return fract(sin(n) * 43758.5453123); }

void main()
{
  screenTexDx = dFdx(texCoord);
  screenTexDy = dFdy(texCoord);
  color = vec3(0.0);
  opacity = 1.0;
  emittedLight = vec3(0.0);
  lightningBloomLight = vec3(0.0);
  lightningBloomOutput = vec4(0.0);
  lightningBackgroundOutput = vec4(0.0);
  lightningCoverageOutput = vec4(0.0);
  lightningPixelCoverage = 0.0;
  lightningEmission = vec3(0.0);
  onLight = vec3(0.0);
  rodGlow = vec3(0.0);
  // Precise per-pixel terrain coverage for the flash: how much solid geometry
  // stands in front of this fragment, from the same wall data the silhouette is
  // drawn from - 1 deep inside solid ground, 0 in open air, and the foliage/
  // building texture's alpha across the edges. The flash is multiplied by
  // (1 - coverage) at the composite, so it stops at the silhouette exactly.
  float terrainOcclusion = 0.0;

  if (texCoord.y > 1.0) { // above simulation area
    if (rodCount == 0) {
      // Pure additive transient over the sky background: alpha 0 so a premultiplied
      // blend leaves the destination untouched and adds the emitted light on top.
      fragmentColor = vec4(0.0);
      drawCursor(cursor, view);
      return;
    }
    opacity = 0.0;
    lightIntensity = 0.0;
    shadowLight = minShadowLight;
  } else if (texCoord.y < 0.) { // < texelSize.y below simulation area
    terrainOcclusion = 1.0;
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
    bilerpWallVisPair(baseTex, waterTex, wallTex, bndFragCoord, base, water);
    wall = texture(wallTex, bndFragCoord * texelSize);                           // texCoord
    lightIntensity = texture(lightTex, bndFragCoord * texelSize)[0] / standardSunBrightness;

    shadowLight = minShadowLight;

    if (wall[DISTANCE] == 0) { // is wall
      terrainOcclusion = 1.0;
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
    case WALLTYPE_SUPER_LAKE: // super lake: same sea, noticeably deeper water color
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
        terrainOcclusion = 0.0;
        vec4 airColor = getAirColor(fragCoord + vec2(0., 0.5));

        opacity = airColor.a;
        color = airColor.rgb;
      } else {
        color = wall[TYPE] == WALLTYPE_SUPER_LAKE ? vec3(0.0, 0.13, 0.34) : vec3(0, 0.5, 1.0); // water; super lake runs a much deeper blue
      }

      // draw 45° slopes under water

      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);
      ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

      if (wallXmY0[DISTANCE] == 0 && wallXmY0[TYPE] != WALLTYPE_WATER && wallXmY0[TYPE] != WALLTYPE_SUPER_LAKE && (fragCoord.y < 1. || (wallX0Ym[TYPE] != WALLTYPE_WATER && wallX0Ym[TYPE] != WALLTYPE_SUPER_LAKE))) { // wall to the left and below
        if (localX + localY < 1.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
          emittedLight = vec3(0.0); // opaque terrain foreground: the flash may not shine through it
          terrainOcclusion = 1.0;
        }
      }
      if (wallXpY0[DISTANCE] == 0 && wallXpY0[TYPE] != WALLTYPE_WATER && wallXpY0[TYPE] != WALLTYPE_SUPER_LAKE && (fragCoord.y < 1. || (wallX0Ym[TYPE] != WALLTYPE_WATER && wallX0Ym[TYPE] != WALLTYPE_SUPER_LAKE))) { // wall to the right and below
        if (localY - localX < 0.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
          emittedLight = vec3(0.0); // opaque terrain foreground: the flash may not shine through it
          terrainOcclusion = 1.0;
        }
      }

      break;
    }
  } else { // air

    vec4 airColor = computeAirColor(bndFragCoord);

    opacity = airColor.a;
    color = airColor.rgb;


    // The rainbow contribution is exactly zero without precipitation. Avoid
    // the per-pixel angle, spectral and temperature calculations in clear air.
    if (water[PRECIPITATION] != 0.0) {
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
    }

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
          emittedLight = vec3(0.0); // opaque terrain foreground: the flash may not shine through it
          terrainOcclusion = max(terrainOcclusion, texCol.a);
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
          emittedLight = vec3(0.0); // opaque terrain foreground: the flash may not shine through it
          terrainOcclusion = max(terrainOcclusion, texCol.a);
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
          emittedLight = vec3(0.0); // opaque terrain foreground: the flash may not shine through it
          terrainOcclusion = max(terrainOcclusion, texCol.a);
        }

        // draw 45° slopes
        ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
        ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

        if (wallXmY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER && wall[TYPE] != WALLTYPE_SUPER_LAKE) { // wall to the left and below
          if (localX + localY < 1.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
            emittedLight = vec3(0.0); // opaque terrain foreground: the flash may not shine through it
            terrainOcclusion = 1.0;
          }
        }
        if (wallXpY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER && wall[TYPE] != WALLTYPE_SUPER_LAKE) { // wall to the right and below
          if (localY - localX < 0.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
            emittedLight = vec3(0.0); // opaque terrain foreground: the flash may not shine through it
            terrainOcclusion = 1.0;
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
  // Cull by sorted x before any per-rod shading. The second interval handles
  // only the periodic seam, preserving repeated scenery without duplicates.
  float lastMetalRodOrder = -1.0;
  float rodX = fract(texCoord.x);
  float reach = min(0.5, max(rodThickness * 1.35 * 3.2, rodCoronaReach + 1.0) / resolution.x);
  for (int pass = 0; pass < 2; pass++) {
    float left = max(0.0, rodX - reach), right = min(1.0, rodX + reach);
    if (pass == 1) {
      if (reach >= 0.5) break;
      if (rodX - reach < 0.0) { left = rodX - reach + 1.0; right = 1.0; }
      else if (rodX + reach > 1.0) { left = 0.0; right = rodX + reach - 1.0; }
      else break;
    } else if (reach >= 0.5) { left = 0.0; right = 1.0; }
    for (int i = rodLowerBound(left); i < rodCount; i++) {
    vec4 rodInfo = rodDataAt(i);
    if (rodInfo.x > right) break;
    vec2 rod = rodInfo.xy;
    bool isSuperRod = rodInfo.z > 0.5;
    float thisRodHeight = rodHeight * (isSuperRod ? 1.8 : 1.0);
    float thisRodThickness = rodThickness * (isSuperRod ? 1.35 : 1.0);
    float dyCells = (texCoord.y - rod.y) * resolution.y; // height above surface, in cells
    // Most pixels are nowhere near the mast vertically. Skip wrap arithmetic
    // and all subsequent rod shading/slot reads for those pixels.
    if (dyCells < -1.5 || dyCells > thisRodHeight + rodCoronaReach)
      continue;
    float dxCells = (mod(texCoord.x - rod.x + 0.5, 1.0) - 0.5) * resolution.x;
    if (abs(dxCells) > max(thisRodThickness * 3.2, rodCoronaReach + 1.0))
      continue;

    // A captured strike energizes only the canonical mast, never a repeated copy.
    float strikeGlow = 0.0;
    for (int slot = 0; slot < LIGHTNING_SLOTS; slot++) {
      if (!inLightningWorldTile() || abs(texCoord.x - rod.x) > 0.5)
        break;
      vec4 strikeData = texelFetch(lightningDataTex, ivec2(slot, 0), 0);
      if (strikeData[START_ITERNUM] <= 0.0 || abs(strikeData.x - rod.x) > 1e-5)
        continue;
      vec4 strikeMeta = texelFetch(lightningDataTex, ivec2(slot, 1), 0);
      // Only ground strokes can energize a mast; a cloud channel may happen
      // to share its x coordinate without ever touching it.
      if (strikeData[INTENSITY] <= LIGHTNING_IC_MAX_INTENSITY ||
          (abs(strikeMeta.y) >= 0.25 && abs(strikeMeta.y - 1.0) >= 0.25))
        continue;
      if (iterNum < strikeData[START_ITERNUM] || (artificialMeta(strikeMeta.z)
          ? iterNum >= lightningSlotEnd(strikeData, strikeMeta)
          : iterNum >= parentStrikeAnimEnd(strikeData, strikeMeta)))
        continue; // this strike is not running
      float rodStrikeT = artificialMeta(strikeMeta.z) ? (iterNum - strikeData[START_ITERNUM]) / 20.0 : calcLightningTime(strikeData[START_ITERNUM]);
      bool rodOrdinaryCG = strikeData[INTENSITY] > LIGHTNING_IC_MAX_INTENSITY && abs(strikeMeta.y) < 0.25;
      float slotGlow = rodOrdinaryCG
        ? upstreamGroundIntensity(rodStrikeT, strikeData.xy, strikeData[INTENSITY])
        : lightningIntensityOverTime(rodStrikeT, strikeData.xy, strikeData[INTENSITY]);
      if (strikeData[INTENSITY] > LIGHTNING_IC_MAX_INTENSITY && abs(strikeMeta.y - 1.0) < 0.25 && strikeMeta.w >= 0.5) {
        bool rodStrikeIsHyperbolt = strikeMeta.w >= 1.5;
        float rodEndWindow = rodStrikeIsHyperbolt ? 0.3 : 2.824;
        float rodDurationShorten = rodStrikeIsHyperbolt ? 2.624 : 0.1;
        float rodBrightnessMult = rodStrikeIsHyperbolt ? 30.0 : 12.0;
        float rodRepeatPeriod = map_range(random2d(strikeData.xy), 0., 1., 1.5, 3.0);
        if (rodStrikeT >= rodRepeatPeriod * lightningFlickers(strikeData) + rodEndWindow)
          slotGlow = 0.0;
        else {
          slotGlow = lightningIntensityOverTime(rodStrikeT > 0.0 ? rodStrikeT + rodDurationShorten * smoothstep(0.0, 0.35, rodStrikeT) : 0.0,
                                                strikeData.xy, strikeData[INTENSITY]);
          if (rodStrikeIsHyperbolt)
            slotGlow = max(slotGlow, firstReturnIntensity(rodStrikeT, strikeData[INTENSITY], 0.10, 0.26));
          slotGlow *= rodBrightnessMult;
        }
      }
      strikeGlow = max(strikeGlow, slotGlow);
    }

    float alongRod = clamp(dyCells / max(thisRodHeight, 1.0), 0.0, 1.0);
    float mastWidth = max(thisRodThickness * mix(0.92, 0.08, pow(alongRod, 0.85)), 0.24);
    if (alongRod >= 0.80 && alongRod <= 0.835)
      mastWidth = max(mastWidth * 1.65, thisRodThickness * 0.72); // corona / arrester collar ring
    float plinthT = clamp(dyCells / rodBaseCells, 0.0, 1.0);
    float baseWidth = max(thisRodThickness * mix(2.75, 0.92, smoothstep(0.0, 1.0, plinthT)), 0.65);
    float halfWidth = dyCells < rodBaseCells ? baseWidth : mastWidth;
    bool onMetal = dyCells >= -0.75 && abs(dxCells) <= halfWidth;

    if (onMetal && rodInfo.w > lastMetalRodOrder) {
      lastMetalRodOrder = rodInfo.w;
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
      if (isSuperRod && alongRod > 0.08 && alongRod < 0.84)
        matCol = mix(matCol, vec3(0.55, 0.66, 0.82), 0.48);
      color = mix(matCol, vec3(1.0, 0.97, 0.90), clamp(strikeGlow * 0.55, 0.0, 1.0));
      shadowLight = max(shadowLight, 0.38);
      opacity = 1.0;
    }

    // Dynamic tip ionization: subtle St. Elmo's fire intensifies under overhead
    // storm clouds and erupts into a plasma arc when capturing a CG bolt.
    float tipDistance = length(vec2(dxCells, dyCells - thisRodHeight));
    if (tipDistance < rodCoronaReach) {
      float stormCloud = texture(waterTex, vec2(rod.x, clamp(rod.y + 0.16, 0.0, 0.96)))[CLOUD];
      float ambientIon = clamp(stormCloud * 0.75, 0.0, 1.4) * (0.85 + 0.15 * sin(iterNum * 0.45 + rod.x * 40.0));
      float corona = exp(-tipDistance / max(rodThickness * 1.05, 1.3));
      rodGlow += vec3(0.38, 0.50, 0.96) * corona * (0.28 + 0.60 * ambientIon + strikeGlow * 55.0);
    }

    // Captured return stroke conducts down the mast to the grounding plinth.
    if (strikeGlow > 0.0) {
      float surgeWave = 0.78 + 0.22 * sin(alongRod * 14.0 + iterNum * 2.1);
      float tipCore = smoothstep(0.78, 1.0, alongRod);
      float earthingFlash = smoothstep(0.18, 0.0, alongRod) * 0.35;
      rodGlow += vec3(0.58, 0.72, 1.0) * strikeGlow * surgeWave *
                      (tipCore * 200.0 + earthingFlash * 140.0 + 2600.0) * (onMetal ? 1.0 : 0.22);
    }
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
   * The light has to stay inside what the buffer can hold.
   *
   * The scene is rendered into an RGBA16F framebuffer, whose largest finite
   * value is 65504, and it is alpha blended. Bright overlapping return strokes
   * can still exceed that range (see displayLightning) and overflow to infinity. Both come back out of the
   * tonemap divided by itself: NaN, which the bloom, FXAA and temporal AA passes
   * then smear over the frame as dead pixels.
   *
   * Two things fix this together. softHdrClamp() (common.glsl) is not a clamp:
   * it compresses the top of the range instead of cutting it off, so a stroke
   * can still be written far past white and arrive in the bloom pass brighter
   * than one that only just overflowed. And this pass is drawn with premultiplied
   * blending (ONE, ONE_MINUS_SRC_ALPHA) instead of SRC_ALPHA/ONE_MINUS_SRC_ALPHA:
   * the surface colour is multiplied by its own coverage, while emittedLight is
   * added on top as pure additive light. Unpremultiplied alpha on a
   * SRC_ALPHA blend made every dim halo fragment multiply the destination by
   * (1 - a) without adding back light, so each bolt was ringed by a dark fringe -
   * the emitted light now simply adds to whatever is behind it.
   */
  opacity = clamp(opacity, 0.0, 1.0);

  // Precise terrain collision: the accumulated flash is scaled by how much
  // solid ground stands in front of this fragment. The rod's own light is not
  // attenuated - the mast stands in front of the terrain.
  vec3 sceneBeforeClamp = max(color * finalLight * opacity, 0.0)
                           + emittedLight * (1.0 - terrainOcclusion) + rodGlow;
  fragmentColor = vec4(softHdrClamp(max(color * finalLight * opacity, 0.0)
                                    + emittedLight * (1.0 - terrainOcclusion) + rodGlow), opacity);
  vec3 sceneWithLightning = fragmentColor.rgb;
  // Keep a bolt-free HDR scene, blended over the same sky with the same
  // opacity. Storing the background directly avoids catastrophic FP16
  // cancellation from subtracting two nearly equal, very bright values.
  vec3 sceneWithoutLightning = sceneWithLightning;
  if (lightningPixelCoverage > 0.0 && terrainOcclusion < 1.0)
    sceneWithoutLightning = softHdrClamp(max(sceneBeforeClamp - lightningEmission * (1.0 - terrainOcclusion), vec3(0.0)));
  lightningBackgroundOutput = vec4(sceneWithoutLightning, opacity);
  lightningCoverageOutput = vec4(lightningPixelCoverage * (1.0 - terrainOcclusion), 0.0, 0.0, 0.0);

  // Preserve a chromatic bloom source independently of the white-hot channel.
  // Alpha stores its peak so the bright pass can replace the core's white
  // contribution, rather than adding coloured light on top of white bloom.
  vec3 bloomSource = lightningBloomLight * (1.0 - terrainOcclusion);
  float bloomPeak = max(bloomSource.r, max(bloomSource.g, bloomSource.b));
  lightningBloomOutput = vec4(bloomSource, bloomPeak);
  drawCursor(cursor, view); // over everything else
  if (any(notEqual(fragmentColor, vec4(sceneWithLightning, opacity)))) {
    lightningBackgroundOutput = fragmentColor;
    lightningCoverageOutput = vec4(0.0);
  }
}
