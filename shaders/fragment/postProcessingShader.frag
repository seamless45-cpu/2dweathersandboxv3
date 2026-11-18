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

vec3 mappedColor(vec2 uv)
{
  vec3 color = safeSample(texture(hdrTex, uv).rgb);
  if (bloomEnabled)
    color += safeSample(texture(bloomTex, uv).rgb) * 0.990;
  color = min(color, vec3(hdrReadCeiling));

  color *= exposure;
  if (toneMappingEnabled) {
    color = clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
  }
  return pow(max(color, vec3(0.0)), ONE_OVER_GAMMA);
}

void main()
{
  vec3 outputCol = mappedColor(texCoord);

  if (temporalAAEnabled && temporalHistoryValid) {
    vec3 neighborhoodMin = outputCol;
    vec3 neighborhoodMax = outputCol;
    neighborhoodMin = min(neighborhoodMin, mappedColor(texCoord - vec2(outputTexelSize.x, 0.0)));
    neighborhoodMin = min(neighborhoodMin, mappedColor(texCoord + vec2(outputTexelSize.x, 0.0)));
    neighborhoodMin = min(neighborhoodMin, mappedColor(texCoord - vec2(0.0, outputTexelSize.y)));
    neighborhoodMin = min(neighborhoodMin, mappedColor(texCoord + vec2(0.0, outputTexelSize.y)));
    neighborhoodMax = max(neighborhoodMax, mappedColor(texCoord - vec2(outputTexelSize.x, 0.0)));
    neighborhoodMax = max(neighborhoodMax, mappedColor(texCoord + vec2(outputTexelSize.x, 0.0)));
    neighborhoodMax = max(neighborhoodMax, mappedColor(texCoord - vec2(0.0, outputTexelSize.y)));
    neighborhoodMax = max(neighborhoodMax, mappedColor(texCoord + vec2(0.0, outputTexelSize.y)));

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
    // Shutter integral along the camera motion vector. The display mesh slides
    // under a fixed uv window, so the same world point sits at a different uv on
    // every frame; reprojecting through the current and previous view recovers the
    // screen-space path the point travelled during the last frame. Eight taps
    // gathered along that path approximate the long-exposure average across the
    // interval (each tap mixes this frame's scene with the held frame from the
    // canvas history, so storms smeared across the interval integrate in).
    // Zoom is part of the view, so radial zoom blurs work too; a stationary
    // camera produces a zero vector and the frame is left untouched.
    vec2 ndc = texCoord * 2.0 - 1.0;
    float sa = motionBlurAspects.x;
    float ca = motionBlurAspects.y;
    vec2 flow = vec2(0.0);
    flow.x = (ndc.x / motionBlurPrevView.z - motionBlurPrevView.x) * 0.5 + 0.5
           - ((ndc.x / motionBlurView.z - motionBlurView.x) * 0.5 + 0.5);
    flow.y = ((ndc.y * sa / (motionBlurPrevView.z * ca) - motionBlurPrevView.y * sa) * 0.5 + 0.5)
           - ((ndc.y * sa / (motionBlurView.z * ca) - motionBlurView.y * sa) * 0.5 + 0.5);

    float flowLength = length(flow);
    // A seam wrap (camera wraps horizontally) or an extreme view jump makes the
    // reprojection meaningless for one frame; skip rather than smear the world.
    if (flowLength <= 0.05 && flowLength > 0.0) {
      float strength = clamp(motionBlurStrength / 350.0, 0.0, 1.0);
      // The effect fades in with the motion instead of smearing a static image.
      float flowGate = smoothstep(0.0, 0.002, flowLength);
      vec3 acc = safeSample(mappedColor(texCoord).rgb); // shutter start = this frame
      for (int i = 1; i < 8; i++) {
        float t = float(i) / 7.0;
        vec2 tapUV = clamp(texCoord + flow * t, vec2(0.0), vec2(1.0));
        vec3 currentTap = safeSample(mappedColor(tapUV).rgb);
        vec3 historyTap = safeSample(texture(historyTex, tapUV).rgb);
        acc += mix(currentTap, historyTap, 0.5);
      }
      vec3 blurred = acc * (1.0 / 8.0);
      float blend = strength * flowGate;
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

  fragmentColor = vec4(outputCol, 1.0);
}
