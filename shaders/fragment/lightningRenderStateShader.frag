#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D lightningDataTex;
uniform float iterNum;
uniform vec2 resolution;
uniform vec2 aspectRatios;
uniform sampler2D rodDataTex;
uniform int rodCount;
uniform float rodHeight;
vec2 texCoord;
vec2 texelSize;
float dryLapse;
#include "common.glsl"
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

vec2 evalExtArc(float t, float Hw, float V)
{
  float om = max(1.0 - t, 1e-5);
  float tc = max(t, 1e-5);
  float x = Hw * pow(om, 1.3);
  float y = V * (1.0 - pow(tc, 2.8)) + 0.14 * V * sin(PI * t) * (1.0 - t);
  return vec2(x, y);
}


out vec4 stateOutput;
void main()
{
  int slot = int(gl_FragCoord.x);
  stateOutput = vec4(0.0);
    vec4 lightningData = texelFetch(lightningDataTex, ivec2(slot, 0), 0);
    float lightningStartIterNum = lightningData[START_ITERNUM];
    if (lightningStartIterNum <= 0.0 || iterNum >= lightningStartIterNum + 2048.0)
      return; // empty or certainly expired; avoid metadata and lifetime hashes
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
      return;
    if (iterNum < lightningStartIterNum || (metaArt
        ? iterNum >= lightningSlotEnd(lightningData, lightningMeta)
        : iterNum >= parentStrikeAnimEnd(lightningData, lightningMeta)))
      return;

    vec2 lightningPos = lightningData.xy;
    float lightningTime = metaArt ? (iterNum - lightningStartIterNum) / 20.0 : calcLightningTime(lightningStartIterNum);
    // Every strike starts directly on the trigger iteration with zero fixed delay.
    bool ordinaryCG = lightningData[INTENSITY] > LIGHTNING_IC_MAX_INTENSITY && abs(lightningMeta.y) < 0.25;
    float currentLightningIntensity = ordinaryCG
      ? upstreamGroundIntensity(lightningTime, lightningPos, lightningData[INTENSITY])
      : lightningIntensityOverTime(lightningTime, lightningPos, lightningData[INTENSITY]);
    if (currentLightningIntensity <= 0.0 && !(ordinaryCG && lightningTime <= 1.0))
      return;

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
        return;
      effectiveLightningTime = isSuperbolt && lightningTime > 0.0
        ? lightningTime + strokeDurationShorten * smoothstep(0.0, 0.35, lightningTime)
        : lightningTime;
      if (isSuperbolt) {
        currentLightningIntensity = lightningIntensityOverTime(effectiveLightningTime, lightningPos, lightningData[INTENSITY]);
        if (currentLightningIntensity <= 0.0)
          return;
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
    // Rows 0–1 retain the exact timeline. Rows 2–3 cache the four coarse
    // samples of an external CG arc or the seeded IC/CC shape parameters.
    // These depend on the strike, not the screen pixel drawing the channel.
    int row = int(gl_FragCoord.y);
    if (row == 0) {
      stateOutput = vec4(lightningTime, currentLightningIntensity, effectiveLightningTime, 1.0);
    } else if (row == 1) {
      stateOutput = vec4(ccIntensityGain, ccTailFade, extCurve, 0.0);
    } else if (isExternalPositive) {
      float rodTipY = findCapturedRodTipY(lightningPos.x);
      float endY = rodTipY >= 0.0 ? rodTipY : 0.0;
      float topY = rodTipY >= 0.0 ? max(lightningPos.y, endY + 0.04) : lightningPos.y;
      float V = max(topY - endY, 0.05);
      float Hw = (lightningMeta.x - lightningPos.x) * aspectRatios.x;
      int first = (row - 2) * 2;
      vec2 p0 = evalExtArc(float(first) / 3.0, Hw, V);
      vec2 p1 = evalExtArc(float(first + 1) / 3.0, Hw, V);
      stateOutput = vec4(p0, p1);
    } else if (isFlash || isCloudToCloud) {
      float seed, shape;
      if (isFlash) {
        seed = random2d(vec2(lightningPos.x * 37.7 + lightningPos.y * 13.3, lightningPos.y * 29.1 + 3.17));
        shape = random2d(vec2(lightningPos.x * 61.3 + 7.9, lightningPos.y * 41.7 + 5.1));
      } else {
        vec2 originPos = vec2(lightningMeta.x, lightningPos.y);
        vec2 targetPos = vec2(lightningPos.x, metaRawZ);
        seed = random2d(vec2(originPos.x * 29.1 + originPos.y * 17.7,
                             targetPos.x * 41.3 + targetPos.y * 13.9));
        shape = random2d(vec2(targetPos.y * 61.1 + 11.7, originPos.x * 47.9 + 8.3));
      }
      vec2 axis = vec2(0.0);
      if (isFlash) {
        float angle = mix(-0.70, 0.70, seed);
        float direction = shape < 0.5 ? -1.0 : 1.0;
        axis = direction * vec2(cos(angle), sin(angle));
      }
      float bow = (seed < 0.5 ? -1.0 : 1.0) * mix(0.65, 1.05, shape);
      float skew = mix(-0.65, 0.65, seed);
      stateOutput = row == 2 ? vec4(seed, shape, axis) : vec4(bow, skew, 0.0, 0.0);
    }
}
