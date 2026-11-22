#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

vec2 fragCoord;          // (in) not used just defined for commonDisplay.glsl
in vec2 texCoord;        // this
in vec2 texCoordXmY0;    // left
in vec2 texCoordX0Ym;    // down
in vec2 texCoordXpY0;    // right
in vec2 texCoordX0Yp;    // up

uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float exposure;

uniform sampler2D hdrTex;
uniform sampler2D bloomTex;
uniform sampler2D lightningHaloTex;
uniform bool hasLightningBloom;
uniform vec2 canvasTexelSize;
uniform sampler2D historyTex;
uniform vec2 outputTexelSize;
uniform bool bloomEnabled;
uniform bool toneMappingEnabled;
uniform bool fxaaEnabled;
uniform bool temporalAAEnabled;
uniform bool temporalHistoryValid;
uniform bool motionBlurEnabled;
uniform bool motionBlurHistoryValid;
uniform float motionBlurStrength; // 0..350 (%)
uniform vec3 motionBlurView;        // current render view (x, y, zoom) including shake
uniform vec3 motionBlurPrevView;    // view the history texture was rendered with
uniform vec2 motionBlurAspects;     // (sim aspect, canvas aspect)
uniform sampler2D velocityTex;      // fluid state: xy = velocity in cells per iteration
uniform isampler2D motionBlurWallTex; // solid terrain stays fixed in world space
uniform vec2 motionBlurResolution;  // simulation grid in cells
uniform float motionBlurIterPerFrame; // actual simulation steps since the previous rendered frame
uniform bool motionBlurWrap;
out vec4 fragmentColor;


#include "commonDisplay.glsl"

float luminance(vec3 color)
{
  return dot(color, vec3(0.299, 0.587, 0.114));
}

/*
 * Nothing that reaches the tonemap may be infinite or NaN.
 *
 * The tonemap below divides a value by a polynomial of itself, so an infinity
 * comes out as NaN, and one NaN pixel is enough: FXAA samples it into its
 * neighbours, temporal AA writes it into the history and it spreads over the
 * frame from there. Both inputs are 16-bit float buffers written through
 * softHdrClamp() and a bounded bright pass, so in practice this is a backstop;
 * it costs two comparisons and it means no future change to what is written into
 * the HDR buffer can put a dead pixel on screen.
 */
const float hdrReadCeiling = 65504.0; // the largest finite value of a 16F texel
vec3 safeSample(vec3 value)
{
  if (isnan(value.r) || isnan(value.g) || isnan(value.b))
    return vec3(0.0);
  return clamp(value, vec3(0.0), vec3(hdrReadCeiling));
}

// A tight halo from the actual channel source, not the broad storm bloom.
// Four bilinear diagonal taps form a small 3x3 footprint and keep the colour
// attached to thin or branching channels at screen-pixel resolution.
vec3 lightningContactHalo(vec2 uv)
{
  vec2 stepUV = 0.5 * max(canvasTexelSize, outputTexelSize);
  vec3 a = safeSample(texture(lightningHaloTex, uv + vec2(-stepUV.x, -stepUV.y)).rgb);
  vec3 b = safeSample(texture(lightningHaloTex, uv + vec2( stepUV.x, -stepUV.y)).rgb);
  vec3 c = safeSample(texture(lightningHaloTex, uv + vec2(-stepUV.x,  stepUV.y)).rgb);
  vec3 d = safeSample(texture(lightningHaloTex, uv + vec2( stepUV.x,  stepUV.y)).rgb);
  vec3 light = (a + b + c + d) * 0.25;
  float peak = max(light.r, max(light.g, light.b));
  // If the optional lightning source could not be allocated, the bound HDR
  // scene is a conservative fallback. Only its strongest highlights qualify.
  if (!hasLightningBloom)
    light *= smoothstep(2.0, 8.0, peak);
  // Bound the near halo separately from the large bloom pyramid. Strong
  // strikes remain local instead of turning the whole sky into a bright blob.
  return 0.32 * light / (1.0 + peak / 4.0);
}

vec3 mappedColor(vec2 uv, vec3 contactLight)
{
  vec3 color = safeSample(texture(hdrTex, uv).rgb);
  if (bloomEnabled) {
    vec3 bloom = safeSample(texture(bloomTex, uv).rgb) * 0.990;
    float bloomPeak = max(bloom.r, max(bloom.g, bloom.b));
    // Keep the bloom contribution below display white without independently
    // clipping RGB. The scene and user exposure are otherwise unchanged.
    color += bloom * (0.7 / (0.7 + bloomPeak));
    color += contactLight;
  }
  float hdrPeak = max(color.r, max(color.g, color.b));
  color *= min(1.0, hdrReadCeiling / max(hdrPeak, 1e-6));

  color *= exposure;
  // A scalar highlight shoulder avoids independent RGB clipping, preserving
  // hot-channel hue. Bloom is extracted from HDR *before* this operation.
  float peak = max(color.r, max(color.g, color.b));
  if (toneMappingEnabled) {
    float mappedPeak = clamp((peak * (2.51 * peak + 0.03)) /
                             (peak * (2.43 * peak + 0.59) + 0.14), 0.0, 1.0);
    color *= mappedPeak / max(peak, 1e-6);
  } else {
    color /= max(1.0, peak);
  }
  return pow(max(color, vec3(0.0)), ONE_OVER_GAMMA);
}

vec3 mappedColor(vec2 uv)
{
  return mappedColor(uv, vec3(0.0));
}

void main()
{
  vec3 outputCol = mappedColor(texCoord);
  // Evaluate the small local halo only once, not for every optional FXAA,
  // temporal-AA or 24-tap motion-blur sample. Add its display-space increment
  // after those effects so they cannot detach it from the current channel.
  vec3 contactIncrement = vec3(0.0);
  if (bloomEnabled) {
    vec3 withContact = mappedColor(texCoord, lightningContactHalo(texCoord));
    contactIncrement = max(withContact - outputCol, vec3(0.0));
  }

  // The five mappedColor taps that clamp history are shared by temporal AA and
  // the motion blur below (history there is clamped to the same box), so they
  // are only fetched when at least one of the two feedback effects needs them.
  bool needsNeighborhood = temporalAAEnabled && temporalHistoryValid;
  vec3 neighborhoodMin = outputCol;
  vec3 neighborhoodMax = outputCol;
  if (needsNeighborhood) {
    neighborhoodMin = min(neighborhoodMin, mappedColor(texCoord - vec2(outputTexelSize.x, 0.0)));
    neighborhoodMin = min(neighborhoodMin, mappedColor(texCoord + vec2(outputTexelSize.x, 0.0)));
    neighborhoodMin = min(neighborhoodMin, mappedColor(texCoord - vec2(0.0, outputTexelSize.y)));
    neighborhoodMin = min(neighborhoodMin, mappedColor(texCoord + vec2(0.0, outputTexelSize.y)));
    neighborhoodMax = max(neighborhoodMax, mappedColor(texCoord - vec2(outputTexelSize.x, 0.0)));
    neighborhoodMax = max(neighborhoodMax, mappedColor(texCoord + vec2(outputTexelSize.x, 0.0)));
    neighborhoodMax = max(neighborhoodMax, mappedColor(texCoord - vec2(0.0, outputTexelSize.y)));
    neighborhoodMax = max(neighborhoodMax, mappedColor(texCoord + vec2(0.0, outputTexelSize.y)));
  }

  if (temporalAAEnabled && temporalHistoryValid) {
    vec3 historyColor = clamp(texture(historyTex, texCoord).rgb, neighborhoodMin, neighborhoodMax);
    float historyDifference = max(max(abs(outputCol.r - historyColor.r), abs(outputCol.g - historyColor.g)),
                                  abs(outputCol.b - historyColor.b));
    float historyWeight = 0.12 * (1.0 - smoothstep(0.025, 0.12, historyDifference));
    outputCol = mix(outputCol, historyColor, historyWeight);
  }

  if (fxaaEnabled) {
    vec2 pixel = outputTexelSize;
    vec3 northWest = mappedColor(texCoord + vec2(-pixel.x, pixel.y));
    vec3 northEast = mappedColor(texCoord + vec2(pixel.x, pixel.y));
    vec3 southWest = mappedColor(texCoord + vec2(-pixel.x, -pixel.y));
    vec3 southEast = mappedColor(texCoord + vec2(pixel.x, -pixel.y));
    float centerLuma = luminance(outputCol);
    float minLuma = min(centerLuma, min(min(luminance(northWest), luminance(northEast)),
                                        min(luminance(southWest), luminance(southEast))));
    float maxLuma = max(centerLuma, max(max(luminance(northWest), luminance(northEast)),
                                        max(luminance(southWest), luminance(southEast))));
    float lumaRange = maxLuma - minLuma;
    if (lumaRange >= max(0.0312, maxLuma * 0.125)) {
      vec2 direction = vec2(-((luminance(northWest) + luminance(northEast)) -
                              (luminance(southWest) + luminance(southEast))),
                             (luminance(northWest) + luminance(southWest)) -
                             (luminance(northEast) + luminance(southEast)));
      float reduction = max((luminance(northWest) + luminance(northEast) +
                             luminance(southWest) + luminance(southEast)) * 0.03125, 0.0078125);
      float directionScale = 1.0 / (min(abs(direction.x), abs(direction.y)) + reduction);
      direction = clamp(direction * directionScale, vec2(-8.0), vec2(8.0)) * pixel;

      vec3 edgeA = 0.5 * (mappedColor(texCoord + direction * (1.0 / 3.0 - 0.5)) +
                          mappedColor(texCoord + direction * (2.0 / 3.0 - 0.5)));
      vec3 edgeB = edgeA * 0.5 + 0.25 * (mappedColor(texCoord + direction * -0.5) +
                                         mappedColor(texCoord + direction * 0.5));
      float edgeBLuma = luminance(edgeB);
      outputCol = edgeBLuma < minLuma || edgeBLuma > maxLuma ? edgeA : edgeB;
    }
  }

  if (motionBlurEnabled && motionBlurHistoryValid) {
    // Reproject a material point, not the difference of two world-space
    // coordinates. Invert the current display vertex transform, backtrace
    // actual fluid advection, then project through the previous view. Both
    // camera pan and zoom therefore produce a displacement in screen UV.
    vec2 ndc = texCoord * 2.0 - 1.0;
    float sa = motionBlurAspects.x;
    float ca = motionBlurAspects.y;
    float zoom = max(motionBlurView.z, 0.0001);
    vec2 worldUV = vec2((ndc.x / zoom - motionBlurView.x) * 0.5 + 0.5,
                        (ndc.y * sa / (zoom * ca) - motionBlurView.y * sa) * 0.5 + 0.5);
    vec2 sampleUV = worldUV;
    if (motionBlurWrap)
      sampleUV.x = fract(sampleUV.x);
    bool inWorld = sampleUV.x >= 0.0 && sampleUV.x <= 1.0 &&
                   sampleUV.y >= 0.0 && sampleUV.y <= 1.0;
    vec2 velocity = vec2(0.0);
    if (inWorld && motionBlurIterPerFrame > 0.0) {
      ivec2 cell = clamp(ivec2(sampleUV * motionBlurResolution), ivec2(0), ivec2(motionBlurResolution) - 1);
      if (texelFetch(motionBlurWallTex, cell, 0).y != 0)
        velocity = texture(velocityTex, sampleUV).xy;
    }
    vec2 previousWorld = worldUV - velocity * motionBlurIterPerFrame / max(motionBlurResolution, vec2(1.0));
    // Choose the closest periodic camera image only for wrapped worlds.
    if (motionBlurWrap) {
      float viewDelta = motionBlurPrevView.x - motionBlurView.x;
      previousWorld.x -= floor(viewDelta * 0.5 + 0.5);
    }
    vec2 previousNdc = vec2((previousWorld.x * 2.0 - 1.0 + motionBlurPrevView.x) * motionBlurPrevView.z,
                            (previousWorld.y * 2.0 - 1.0 + motionBlurPrevView.y * sa) * motionBlurPrevView.z * ca / sa);
    vec2 flow = (previousNdc - ndc) * 0.5;

    float flowLength = length(flow);
    // Reject discontinuous camera jumps; static pixels naturally blend zero.
    if (flowLength <= 1.5) {
      float strength = clamp(motionBlurStrength / 350.0, 0.0, 1.0);
      // The shutter stays open longer as the slider rises: one frame of motion
      // at 0 %, ~2.1 frames at 100 %, five frames at 350 % - the difference
      // between a faint one-frame smear and a real long exposure.
      float exposureSpan = 1.0 + 4.0 * strength;
      // The effect fades in with the motion instead of smearing a static image.
      float flowGate = smoothstep(0.0, 0.002, flowLength);
      const int TAPS = 24;
      float weightSum = 0.0;
      float coveredWeight = 0.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < TAPS; i++) {
        // Midpoint samples avoid over-weighting the sharp endpoints. Current
        // and history follow opposite directions to the same exposure time:
        // flow points from the current pixel to its previous position.
        float t = (float(i) + 0.5) / float(TAPS);
        float w = 0.7 + 0.3 * cos(2.0 * PI * (t - 0.5));
        vec2 currentUV = texCoord - flow * (t * exposureSpan);
        vec2 historyUV = texCoord + flow * ((1.0 - t) * exposureSpan);
        bool currentInside = all(greaterThanEqual(currentUV, vec2(0.0))) && all(lessThanEqual(currentUV, vec2(1.0)));
        bool historyInside = all(greaterThanEqual(historyUV, vec2(0.0))) && all(lessThanEqual(historyUV, vec2(1.0)));
        vec3 currentTap = safeSample(mappedColor(clamp(currentUV, vec2(0.0), vec2(1.0))));
        vec3 historyTap = safeSample(texture(historyTex, clamp(historyUV, vec2(0.0), vec2(1.0))).rgb);
        // History contains last frame's postprocessed image, not a clean
        // velocity buffer. Limit feedback per tap without clamping the entire
        // moving trail to the destination pixel's static 5-tap neighbourhood.
        historyTap = clamp(historyTap, max(currentTap - vec3(0.35), vec3(0.0)), min(currentTap + vec3(0.35), vec3(1.0)));
        float currentWeight = currentInside ? w * (1.0 - t) : 0.0;
        float historyWeight = historyInside ? w * t : 0.0;
        acc += currentTap * currentWeight + historyTap * historyWeight;
        weightSum += w;
        coveredWeight += currentWeight + historyWeight;
      }
      vec3 blurred = acc / max(coveredWeight, 0.0001);
      float coverage = weightSum > 0.0 ? coveredWeight / weightSum : 0.0;
      float blend = 0.8 * strength * flowGate * coverage * coverage;
      outputCol = mix(outputCol, blurred, blend);
    }
  }

  /*
    { // Gamma correction test: left without, right with gamma correction
      float modTexCoordx = mod(texCoord.x, 0.5);
      // outputCol = vec3(pow(texCoord.y, 2.)); // light input

      outputCol = vec3(pow(0.9, (1. - texCoord.y) * 50.)); // simulate light coming down and being absorbed by clouds

      if (texCoord.x > 0.5)
        outputCol = pow(outputCol, GAMMA);              // gamma correction

      if (abs(outputCol.r - modTexCoordx * 2.) < 0.001) // plot brightness
        outputCol = vec3(1.0, 0., 0.);
    }
  */

  outputCol = clamp(outputCol + contactIncrement, 0.0, 1.0);
  fragmentColor = vec4(outputCol, 1.0);
}
