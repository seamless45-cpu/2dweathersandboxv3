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
uniform sampler2D velocityTex;      // fluid state: xy = velocity in cells per iteration
uniform vec2 motionBlurResolution;  // simulation grid in cells
uniform float motionBlurIterPerFrame; // simulation iterations per rendered frame
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

  // The five mappedColor taps that clamp history are shared by temporal AA and
  // the motion blur below (history there is clamped to the same box), so they
  // are only fetched when at least one of the two feedback effects needs them.
  bool needsNeighborhood = (temporalAAEnabled && temporalHistoryValid) || (motionBlurEnabled && motionBlurHistoryValid);
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
    // Reworked shutter integral, two motion paths gathered on one axis:
    //
    // 1. Camera motion - reproject this pixel through the current and previous
    //    render view (position and zoom, shake included), as before. The display
    //    mesh slides under a fixed uv window, so a world point travels a
    //    screen-space path between frames; radial zoom blurs for free.
    //
    // 2. Scene motion - the fluid advects the clouds, and the history holds
    //    last frame's render of them. The velocity field (cells per iteration)
    //    is sampled at this pixel's simulation coordinate, converted to uv per
    //    rendered frame, then mapped into canvas uv through the same derivative
    //    of the view transform. A stationary camera with a moving storm finally
    //    blurs along the wind. The gather axis is the SUM of both paths, so a
    //    panning camera over a storm streaks along the true trajectory.
    //
    // Sixteen taps with a raised-cosine weighting approximate the shutter
    // integral. The gather span scales with the strength slider, so 100 % is a
    // soft two-frame veil and 350 % a genuinely long exposure instead of a
    // one-frame smear at the same mix opacity. History taps are clamped to the
    // five-tap neighborhood of this pixel, which keeps the recursive feedback
    // from dragging ghosts across the frame. Taps that fall outside the frame
    // lose their weight; the blend is scaled by the covered fraction so edges
    // are softened, never smeared.
    vec2 ndc = texCoord * 2.0 - 1.0;
    float sa = motionBlurAspects.x;
    float ca = motionBlurAspects.y;
    float zoom = motionBlurView.z;
    vec2 flow = vec2(0.0);
    flow.x = (ndc.x / motionBlurPrevView.z - motionBlurPrevView.x) * 0.5 + 0.5
           - ((ndc.x / zoom - motionBlurView.x) * 0.5 + 0.5);
    flow.y = ((ndc.y * sa / (motionBlurPrevView.z * ca) - motionBlurPrevView.y * sa) * 0.5 + 0.5)
           - ((ndc.y * sa / (zoom * ca) - motionBlurView.y * sa) * 0.5 + 0.5);
    // The world tiles horizontally every 2.0 of view.x, which is exactly 1.0 uv.
    // A camera crossing the seam shifts every sample by one full uv between
    // frames; folding back into [-0.5, 0.5) keeps the wrap from reading as a
    // one-frame smear across the whole frame.
    flow.x = mod(flow.x + 0.5, 1.0) - 0.5;

    // Scene path: simulation coordinate of this canvas pixel (same inverse view
    // transform the camera path uses), then velocity -> uv -> canvas uv.
    vec2 simUV = vec2((ndc.x / zoom - motionBlurView.x) * 0.5 + 0.5,
                      (ndc.y * sa / (zoom * ca) - motionBlurView.y * sa) * 0.5 + 0.5);
    simUV.x = fract(simUV.x);              // the world mesh repeats horizontally
    simUV.y = clamp(simUV.y, 0.0, 1.0);
    vec2 velocity = texture(velocityTex, simUV).xy; // cells per iteration
    vec2 uvPerFrame = velocity * motionBlurIterPerFrame / max(motionBlurResolution, vec2(1.0));
    vec2 sceneFlow = 0.5 * zoom * vec2(uvPerFrame.x, uvPerFrame.y * ca / sa);
    flow -= sceneFlow;                       // material came *from* upwind, not downwind

    float flowLength = length(flow);
    // The fold above keeps the horizontal seam inside [-0.5, 0.5) uv, so a real
    // reprojection never lands here with a huge vector; this only catches an
    // absurd view jump between frames (a zoom explosion, a broken upload), for
    // which the history cannot be reprojected at all - skip rather than smear.
    // A truly static frame produces a zero vector and is left untouched (the
    // flow gate below flattens the blend to 0).
    if (flowLength <= 1.5) {
      float strength = clamp(motionBlurStrength / 350.0, 0.0, 1.0);
      // The shutter stays open longer as the slider rises: one frame of motion
      // at 0 %, ~2.1 frames at 100 %, five frames at 350 % - the difference
      // between a faint one-frame smear and a real long exposure.
      float exposureSpan = 1.0 + 4.0 * strength;
      // The effect fades in with the motion instead of smearing a static image.
      float flowGate = smoothstep(0.0, 0.002, flowLength);
      const int TAPS = 16;
      float weightSum = 0.0;
      float coveredWeight = 0.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < TAPS; i++) {
        float t = float(i) / float(TAPS - 1);
        // Raised-cosine: a uniform shutter box would be ideal, this just
        // suppresses the banding a box leaves on hard edges.
        float w = 0.7 + 0.3 * cos(2.0 * PI * (t - 0.5));
        vec2 rawUV = texCoord + flow * (t * exposureSpan);
        bool inBounds = rawUV.x >= 0.0 && rawUV.x <= 1.0 && rawUV.y >= 0.0 && rawUV.y <= 1.0;
        vec2 tapUV = clamp(rawUV, vec2(0.0), vec2(1.0));
        vec3 currentTap = safeSample(mappedColor(tapUV).rgb);
        vec3 historyTap = clamp(safeSample(texture(historyTex, tapUV).rgb), neighborhoodMin, neighborhoodMax);
        acc += w * mix(currentTap, historyTap, 0.5);
        weightSum += w;
        coveredWeight += inBounds ? w : 0.0;
      }
      vec3 blurred = acc / weightSum;
      float coverage = weightSum > 0.0 ? coveredWeight / weightSum : 0.0;
      float blend = strength * flowGate * coverage * coverage;
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
