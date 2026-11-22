#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D hdrTex;
uniform sampler2D lightningBloomTex;
uniform bool hasLightningBloom;
out vec3 fragmentColor;

// The pyramid is stored at one twelfth of its eventual strength. This lets us
// brighten only lightning by 12x without overflowing the half-float pyramid:
// its lightning component stays at the old level, and ordinary highlights are
// divided by 12 here and restored by the post-processing composite.
const float lightningBloomGain = 12.0;
vec3 brightSample(vec2 uv)
{
  vec3 scene = texture(hdrTex, uv).rgb;
  vec4 lightning = hasLightningBloom ? texture(lightningBloomTex, uv) : vec4(0.0);
  vec3 other = hasLightningBloom ? max(scene - vec3(lightning.a), vec3(0.0)) : scene;
  vec3 source = other + lightning.rgb;
  // An invalid HDR sample must not spread through the entire bloom pyramid.
  if (any(isnan(source)) || any(isinf(source))) return vec3(0.0);
  float peak = max(source.r, max(source.g, source.b));
  // Keep the original gain calculation and extract before footprint reduction.
  float gain = mix(0.02, 0.12, smoothstep(4.0, 40.0, peak));
  // Without the optional lightning target the contributions cannot be
  // separated, so amplify the fallback scene highlights as well.
  return ((hasLightningBloom ? other / lightningBloomGain : other) + lightning.rgb) * gain;
}

void main()
{
  // Cover the full HDR footprint at every supported HDR/bloom scale ratio.
  // Two bilinear samples span up to four source pixels; up to four samples
  // per axis cover the maximum 200% HDR / 25% bloom ratio of eight. The common
  // ratios use only the original four samples, with no additional textures.
  vec2 dx = dFdx(texCoord);
  vec2 dy = dFdy(texCoord);
  vec2 size = vec2(textureSize(hdrTex, 0));
  float footprintX = length(dx * size);
  float footprintY = length(dy * size);
  int countX = int(clamp(ceil(footprintX * 0.5), 2.0, 4.0));
  int countY = int(clamp(ceil(footprintY * 0.5), 2.0, 4.0));
  vec3 sum = vec3(0.0);
  for (int y = 0; y < 4; y++) {
    if (y >= countY) break;
    for (int x = 0; x < 4; x++) {
      if (x >= countX) break;
      float sx = (float(x) + 0.5) / float(countX) - 0.5;
      float sy = (float(y) + 0.5) / float(countY) - 0.5;
      sum += brightSample(texCoord + dx * sx + dy * sy);
    }
  }
  fragmentColor = sum / float(countX * countY);
}
