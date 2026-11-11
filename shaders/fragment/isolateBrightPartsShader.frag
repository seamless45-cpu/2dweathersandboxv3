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

// The light the bloom pyramid is made of: two percent of the frame, as this pass
// has always taken. Nothing is singled out here - a lightning channel and a sunlit
// cloud go through the same multiply - so the halo around a bolt is the blurred
// remainder of the frame, exactly as it was before any of this was touched.
void main()
{
  vec3 outputCol = texture(hdrTex, texCoord).rgb;

  // A backstop, not the mechanism: the scene is written through softHdrClamp()
  // (common.glsl), so it arrives finite. If a sample were ever NaN, every term
  // below would be NaN and the blur would smear it over the whole frame.
  if (isnan(outputCol.r) || isnan(outputCol.g) || isnan(outputCol.b))
    outputCol = vec3(0.0);

  outputCol *= 0.02;

  fragmentColor = vec3(outputCol);
}
