#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D lightningDataTex;
uniform float iterNum;
vec2 resolution;
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
    // Two rows keep all strike-wide timeline calculations in float32.
    stateOutput = int(gl_FragCoord.y) == 0
      ? vec4(lightningTime, currentLightningIntensity, effectiveLightningTime, 1.0)
      : vec4(ccIntensityGain, ccTailFade, extCurve, 0.0);
}
