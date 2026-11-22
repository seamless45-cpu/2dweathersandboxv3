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

void main()
{
  // Integrate the destination footprint: downsampled bloom must not skip a
  // narrow channel simply because it falls between output pixels.
  vec2 dx = dFdx(texCoord) * 0.25;
  vec2 dy = dFdy(texCoord) * 0.25;
  vec3 outputCol = (bloomSource(texCoord - dx - dy) +
                    bloomSource(texCoord + dx - dy) +
                    bloomSource(texCoord - dx + dy) +
                    bloomSource(texCoord + dx + dy)) * 0.25;

  // A backstop, not the mechanism: the scene is written through softHdrClamp()
  // (common.glsl), so it arrives finite. If a sample were ever NaN, every term
  // below would be NaN and the blur would smear it over the whole frame.
  if (isnan(outputCol.r) || isnan(outputCol.g) || isnan(outputCol.b))
    outputCol = vec3(0.0);

  // Reserve the stronger contribution for HDR highlights, leaving ordinary
  // sky and clouds at the existing bloom level. Preserve the hue ratios.
  float peak = max(outputCol.r, max(outputCol.g, outputCol.b));
  outputCol *= mix(0.02, 0.12, smoothstep(4.0, 40.0, peak));

  fragmentColor = vec3(outputCol);
}
