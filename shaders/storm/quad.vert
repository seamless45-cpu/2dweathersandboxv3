#version 300 es
precision highp float;

/* Full-domain quad for the storm field overlays. Same view transform
 * contract as dispShader.vert. The quad spans the whole sim domain. */

in vec2 vertPosition;  // [-1..1]

uniform vec2 aspectRatios; // sim, canvas
uniform vec3 view;         // x pos, y pos, zoom
uniform float Xmult;

out vec2 fragCoord;        // sim-normalized [0..1]

void main()
{
  fragCoord = vertPosition * 0.5 + 0.5;
  vec2 outpos = vertPosition;
  outpos.x *= Xmult;
  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];
  outpos *= view[2];
  outpos.y *= aspectRatios[1] / aspectRatios[0];
  gl_Position = vec4(outpos, 0.0, 1.0);
}
