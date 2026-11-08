#version 300 es
precision highp float;

/* Full-domain quad for the storm field overlays, mirroring the app's
 * dispShader.vert transform exactly (Xmult tiling for wrap-around views) so
 * the charge/field overlays stay glued to the simulated clouds. */

in vec2 vertPosition;  // [-1..1]

uniform vec2 aspectRatios; // sim, canvas
uniform vec3 view;         // x pos, y pos, zoom
uniform float Xmult;       // horizontal domain tiling (3 when wrapping)

out vec2 fragCoord;        // sim-domain [0..1] before tiling offset

void main()
{
  vec2 texCoordAdjusted = vertPosition * 0.5 + 0.5;

  texCoordAdjusted.x *= Xmult;
  // same tiling correction as dispShader.vert, expressed in tile units
  texCoordAdjusted.x -= (Xmult - 1.0) / 2.0;

  fragCoord = texCoordAdjusted;

  vec2 outpos = vertPosition;
  outpos.x *= Xmult;
  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];
  outpos *= view[2];
  outpos.y *= aspectRatios[1] / aspectRatios[0];
  gl_Position = vec4(outpos, 0.0, 1.0);
}
