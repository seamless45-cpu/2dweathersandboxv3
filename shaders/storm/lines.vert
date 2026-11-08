#version 300 es
precision highp float;

/* Lightning channel segments (GL_LINES). Brightness attribute drives the
 * return-stroke flash and afterglow decay. */

in vec2 simPos;    // sim-normalized
in vec2 lData;     // [brightness 0..1, polarity -1/0/+1]

uniform vec2 aspectRatios;
uniform vec3 view;

out vec4 vColor;

void main()
{
  float b = clamp(lData.x, 0.0, 1.0);
  // hot plasma: blue-white core; positive flashes slightly warmer
  vec3 coldCol = lData.y > 0.0 ? vec3(1.0, 0.9, 0.75) : vec3(0.75, 0.82, 1.0);
  vec3 hotCol  = vec3(1.0);
  vColor = vec4(mix(coldCol, hotCol, b * 0.8), clamp(0.15 + b, 0.0, 1.0));

  vec2 outpos = simPos * 2.0 - 1.0;
  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];
  outpos *= view[2];
  outpos.y *= aspectRatios[1] / aspectRatios[0];
  gl_Position = vec4(outpos, 0.0, 1.0);
}
