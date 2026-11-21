#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D hdrTex;
out vec3 fragmentColor;

// Build the bloom pyramid from HDR radiance. The baseline remains subtle,
// while high-energy highlights receive a stronger, hue-preserving contribution.
void main()
{
  // Integrate the destination footprint rather than taking one point sample.
  // At reduced bloom quality a narrow bolt can otherwise fall between samples
  // and contribute no glow at all.
  vec2 dx = dFdx(texCoord) * 0.25;
  vec2 dy = dFdy(texCoord) * 0.25;
  vec3 outputCol = (texture(hdrTex, texCoord - dx - dy).rgb +
                    texture(hdrTex, texCoord + dx - dy).rgb +
                    texture(hdrTex, texCoord - dx + dy).rgb +
                    texture(hdrTex, texCoord + dx + dy).rgb) * 0.25;

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
