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

// Keep the white-hot core in the scene while rebuilding its bloom from the
// strike's coloured emission. Other scene highlights follow the ordinary path.
vec3 bloomSource(vec2 uv)
{
  vec3 scene = texture(hdrTex, uv).rgb;
  if (!hasLightningBloom) return scene;
  vec4 lightning = texture(lightningBloomTex, uv);
  // The alpha is the channel peak, written before the bloom pass. Removing
  // its neutral core avoids washing the coloured halo out with white light.
  return max(scene - vec3(lightning.a), vec3(0.0)) + lightning.rgb;
}

vec3 brightSample(vec2 uv)
{
  vec3 source = bloomSource(uv);
  // An invalid HDR sample must not spread through the entire bloom pyramid.
  if (any(isnan(source)) || any(isinf(source))) return vec3(0.0);
  float peak = max(source.r, max(source.g, source.b));
  // Extract before reducing: a one-pixel channel must not lose its highlight
  // gain just because it shares a large bloom pixel with darker background.
  return source * mix(0.02, 0.12, smoothstep(4.0, 40.0, peak));
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
  // Integrate HDR energy before compression. Compressing every tap first
  // throws away most energy from a subpixel channel that shares a bloom pixel
  // with dark air (Jensen's inequality); averaging first preserves coverage.
  // The shared RGB shoulder still prevents a flat saturated blur and keeps
  // each variant's hue. Uniform fields keep the same brightness as before.
  vec3 highlight = sum / float(countX * countY);
  float highlightPeak = max(highlight.r, max(highlight.g, highlight.b));
  fragmentColor = highlight * (log2(1.0 + highlightPeak) / max(highlightPeak, 1e-6));
}
