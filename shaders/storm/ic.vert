#version 300 es
precision highp float;

/* Quad for an intra-cloud flash billboard. The quad is placed in sim space
 * (metres normalised by the domain) and transformed with exactly the same
 * view math as the particle / channel overlays, so the IC artwork stays glued
 * to the storm while panning and zooming. */

in vec2 quadPos;            // [-1..1]

uniform vec2 center;        // sim-normalised flash centre
uniform vec2 halfSize;      // sim-normalised half extents
uniform vec2 aspectRatios;  // sim, canvas
uniform vec3 view;          // x pos, y pos, zoom

out vec2 vUV;

void main()
{
  vUV = quadPos * 0.5 + 0.5;
  vec2 simPos = center + quadPos * halfSize;
  vec2 outpos = simPos * 2.0 - 1.0;
  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];
  outpos *= view[2];
  outpos.y *= aspectRatios[1] / aspectRatios[0];
  gl_Position = vec4(outpos, 0.0, 1.0);
}
