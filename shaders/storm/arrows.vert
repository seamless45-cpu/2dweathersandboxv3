#version 300 es
precision highp float;

/* E-field vector arrows: one point sprite per coarse field cell. Direction
 * and magnitude arrive as attributes computed on the CPU from the solved
 * Coulomb field. */

in vec2 simPos;   // sim-normalized arrow center
in vec2 vec;      // field vector in m/s-like units (normalized by CPU scale)
in float mag;     // 0..1 normalized magnitude

uniform vec2 aspectRatios;
uniform vec3 view;
uniform float extentFrac;  // arrow length scale in sim units

out vec3 vColor;
out vec2 vVec;
out float vPixelLen;

void main()
{
  vColor = mix(vec3(0.45, 0.7, 1.0), vec3(1.0, 0.85, 0.35), clamp(mag, 0.0, 1.0));
  float len = mag * extentFrac;
  vVec = vec * len;
  gl_PointSize = max(8.0, len * 900.0 * view.z);
  vPixelLen = gl_PointSize;

  vec2 outpos = simPos * 2.0 - 1.0;
  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];
  outpos *= view[2];
  outpos.y *= aspectRatios[1] / aspectRatios[0];
  gl_Position = vec4(outpos, 0.0, 1.0);
}
