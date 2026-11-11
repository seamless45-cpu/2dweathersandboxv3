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

// The light the bloom pyramid is made of.
//
// Two terms, because the frame holds two very different ranges of light.
//
//   * `ambientGain` is what this pass has always been: two percent of the whole
//     scene, blurred. It is the soft veil that every bright thing in the frame
//     carries - a sunlit cloud, the sky, the sun itself - and it is kept exactly
//     as it was, so nothing about the ordinary look of the sky changes.
//
//   * `brightGain` is the bright pass proper: only light far past white, which in
//     this frame means a lightning channel and nothing else (a sunlit cloud is
//     about 1, the sun disc a few units; the knee is 32). A CG return stroke is
//     written at a hundred thousand HDR units, so it contributes thousands of
//     units to the pyramid while a cloud contributes its two percent and not one
//     unit more. That is what lets a bolt's halo grow into a blaze without
//     brightening the rest of the frame, and it is the surface on which "brighter
//     than white" is actually visible: the tonemap flattens everything over ~3 to
//     the same white, so a bolt's surplus energy can only read on screen as the
//     light it scatters around itself.
//
// Both the knee and the ceiling are hard numbers on purpose. The knee sits above
// the brightest thing in the frame that is not lightning, so the bright pass
// cannot reach into the clouds and haze the image; the ceiling keeps one level of
// the pyramid far away from 65504, the largest finite value of the 16-bit float
// buffers it is stored in, so the blur and the upsample that follow cannot
// overflow however bright a stroke is written.
const float ambientGain = 0.02;
const float brightKnee = 32.0;
const float brightGain = 0.45;
const float brightCeiling = 5450.0;

void main()
{
  vec3 scene = texture(hdrTex, texCoord).rgb;

  // A backstop, not the mechanism: the scene is written through softHdrClamp()
  // (common.glsl), so it arrives finite. If a sample were ever NaN, every term
  // below would be NaN and the blur would smear it over the whole frame.
  if (isnan(scene.r) || isnan(scene.g) || isnan(scene.b))
    scene = vec3(0.0);

  vec3 over = max(scene - vec3(brightKnee), vec3(0.0)) * brightGain;

  // Asymptotic, so a stroke written at a hundred thousand units and a stroke
  // written at a million are both finite here but still ordered: the second one
  // has the wider halo.
  over = brightCeiling * (1.0 - exp(-over / brightCeiling));

  fragmentColor = scene * ambientGain + over;
}
