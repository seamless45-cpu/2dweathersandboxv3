float dischargeLeader(float time)
{
  float progress = clamp(time / 0.45, 0.0, 1.0) * 12.0;
  return min((floor(progress) + smoothstep(0.0, 0.42, fract(progress))) / 12.0, 1.0);
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

float cloudChannelStage(float time, float fromSource)
{
  float leader = dischargeLeader(time);
  float visible = 1.0 - smoothstep(leader, leader + 0.035, fromSource);
  float pulse = exp(-pow((fromSource - clamp((time - 0.45) / 0.24, 0.0, 1.0)) / 0.12, 2.0)) * smoothstep(0.43, 0.48, time);
  return visible * (0.006 + 0.994 * smoothstep(0.40, 0.55, time) + pulse * 0.6);
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

vec3 displayAdaptedFlash(vec2 pos, float lightningTime, float currentLightningIntensity, bool positive)
{
  if (!inLightningWorldTile()) return vec3(0.0);
  float height = (positive ? 0.095 : 0.075) * lightningHeightScale();
  float lengthWorld = height * 2.0;
  float direction = random2d(vec2(pos.y * 3.77, 1.23)) < 0.5 ? -1.0 : 1.0;
  float t = 0.5 + direction * (texCoord.x - pos.x) * aspectRatios[0] / lengthWorld;
  float u = 0.5 + (texCoord.y - pos.y) / (lengthWorld * lightningTexAspect);
  vec2 gradX = vec2(screenTexDx.y / (lengthWorld * lightningTexAspect),
                    direction * screenTexDx.x * aspectRatios[0] / lengthWorld);
  vec2 gradY = vec2(screenTexDy.y / (lengthWorld * lightningTexAspect),
                    direction * screenTexDy.x * aspectRatios[0] / lengthWorld);
  float coverage = adaptedUpstreamArtwork(u, t, gradX, gradY);
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
  const float extBoltBrightness = 3000.0;
  return max(pixVal * currentLightningIntensity * extBoltBrightness *
             groundChannelStage(lightningTime, t) * lightningColor, vec3(0.0));
}

vec3 displayCloudToCloudLightning(vec2 targetPos, vec2 originPos, bool isPositiveCC,
                                  float lightningTime, float ccCurve)
{
  if (!inLightningWorldTile())
    return vec3(0.0);
  float relX = texCoord.x - targetPos.x;
  float dxWrap = originPos.x - targetPos.x;
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

  float dPerp = dot(target - c, normDir);
  float u = 0.5 + dPerp / (span * lightningTexAspect);
  vec2 pixelX = vec2(screenTexDx.x * aspectRatios[0], screenTexDx.y);
  vec2 pixelY = vec2(screenTexDy.x * aspectRatios[0], screenTexDy.y);
  float alongScale = max(dLen, 1e-4);
  vec2 gradX = vec2(dot(pixelX, normDir) / (span * lightningTexAspect), dot(pixelX, tanDir) / alongScale);
  vec2 gradY = vec2(dot(pixelY, normDir) / (span * lightningTexAspect), dot(pixelY, tanDir) / alongScale);
  float pixVal = adaptedUpstreamArtwork(u, t, gradX, gradY);
  const float ccBaseBrightness = 900.0;
  return upstreamLightningColor * pixVal * cloudChannelStage(lightningTime, t) * ccCurve * ccBaseBrightness;
}
