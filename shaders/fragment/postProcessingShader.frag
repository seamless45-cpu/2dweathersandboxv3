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
uniform sampler2D lightningCoverageTex;
uniform sampler2D lightningBackgroundTex;
uniform bool lightningCoverageEnabled;
uniform sampler2D bloomTex;
uniform sampler2D historyTex;
uniform vec2 outputTexelSize;
uniform vec2 canvasTexelSize;
uniform bool zoomSupersampleEnabled;
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

vec3 mapRadiance(vec3 color)
{
  float hdrPeak = max(color.r, max(color.g, color.b));
  color *= min(1.0, hdrReadCeiling / max(hdrPeak, 1e-6));
  color *= exposure;
  if (toneMappingEnabled) {
    float peak = max(color.r, max(color.g, color.b));
    float mappedPeak = clamp((peak * (2.51 * peak + 0.03)) /
                             (peak * (2.43 * peak + 0.59) + 0.14), 0.0, 1.0);
    color *= mappedPeak / max(peak, 1e-6);
  }
  return clamp(pow(max(color, vec3(0.0)), ONE_OVER_GAMMA), 0.0, 1.0);
}

vec3 mappedColor(vec2 uv)
{
  vec3 scene = safeSample(texture(hdrTex, uv).rgb);
  vec3 bloom = vec3(0.0);
  if (bloomEnabled) {
    bloom = safeSample(texture(bloomTex, uv).rgb) * 0.990;
  }
  if (lightningCoverageEnabled) {
    float coverage = clamp(texture(lightningCoverageTex, uv).r, 0.0, 1.0);
    if (coverage > 1e-6) {
      // Resolve the bright covered part before averaging it with the uncovered
      // background. Clipping an averaged HDR value would make even a tiny
      // fraction of a bright channel a solid white pixel.
      vec3 backgroundScene = safeSample(texture(lightningBackgroundTex, uv).rgb);
      vec3 background = backgroundScene + bloom;
      vec3 core = background + max(scene - backgroundScene, vec3(0.0)) / coverage;
      return mix(mapRadiance(background), mapRadiance(core), coverage);
    }
  }
  return mapRadiance(scene + bloom);
}

void main()
{
  vec3 outputCol;
  if (zoomSupersampleEnabled) {
    // Resolve display-mapped samples, not HDR averages: clipping HDR first
    // turns subpixel lightning into fully white square pixels.
    vec2 offset = canvasTexelSize * 0.25;
    outputCol = 0.25 * (mappedColor(texCoord + vec2(-offset.x, -offset.y)) +
                        mappedColor(texCoord + vec2( offset.x, -offset.y)) +
                        mappedColor(texCoord + vec2(-offset.x,  offset.y)) +
                        mappedColor(texCoord + vec2( offset.x,  offset.y)));
  } else {
    outputCol = mappedColor(texCoord);
  }
  // Only TAA needs a five-tap neighborhood to clamp its history.
  bool needsNeighborhood = temporalAAEnabled && temporalHistoryValid;
  vec3 neighborhoodMin = outputCol;
  vec3 neighborhoodMax = outputCol;
  if (needsNeighborhood) {
    vec3 left = mappedColor(texCoord - vec2(outputTexelSize.x, 0.0));
    vec3 right = mappedColor(texCoord + vec2(outputTexelSize.x, 0.0));
    vec3 down = mappedColor(texCoord - vec2(0.0, outputTexelSize.y));
    vec3 up = mappedColor(texCoord + vec2(0.0, outputTexelSize.y));
    neighborhoodMin = min(neighborhoodMin, left);
    neighborhoodMin = min(neighborhoodMin, right);
    neighborhoodMin = min(neighborhoodMin, down);
    neighborhoodMin = min(neighborhoodMin, up);
    neighborhoodMax = max(neighborhoodMax, left);
    neighborhoodMax = max(neighborhoodMax, right);
    neighborhoodMax = max(neighborhoodMax, down);
    neighborhoodMax = max(neighborhoodMax, up);
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

    // A shutter gathers the current, unblurred frame along the measured motion
    // vector. Never feed last frame's already-blurred result back into the blur:
    // recursive history smears lightning and leaves trails after motion stops.
    vec2 flowPixels = flow / max(canvasTexelSize, vec2(1e-8));
    float flowLength = length(flowPixels);
    float strength = clamp(motionBlurStrength / 350.0, 0.0, 1.0);
    if (strength > 0.0 && flowLength > 0.1 && flowLength < 256.0) {
      float shutter = 3.5 * strength;
      vec2 trailPixels = flowPixels * shutter;
      float trailLength = length(trailPixels);
      // Bound the cost and footprint on teleports and very fast pans.
      trailPixels *= min(1.0, 48.0 / max(trailLength, 1e-6));
      vec2 trail = trailPixels * canvasTexelSize;
      const int TAPS = 16;
      vec3 acc = vec3(0.0);
      float coveredWeight = 0.0;
      for (int i = 0; i < TAPS; i++) {
        float t = (float(i) + 0.5) / float(TAPS);
        vec2 sampleUV = texCoord - trail * t;
        if (all(greaterThanEqual(sampleUV, vec2(0.0))) && all(lessThanEqual(sampleUV, vec2(1.0)))) {
          acc += mappedColor(sampleUV);
          coveredWeight += 1.0;
        }
      }
      if (coveredWeight > 0.0) {
        vec3 blurred = acc / coveredWeight;
        // Smoothly fade the effect below one display pixel of motion.
        float blend = smoothstep(0.1, 1.0, length(trailPixels));
        outputCol = mix(outputCol, blurred, blend);
      }
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

  fragmentColor = vec4(outputCol, 1.0);
}
