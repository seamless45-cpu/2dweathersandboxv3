#version 300 es
precision highp float;

/* Arrow glyph via signed-distance evaluation in the point sprite: a shaft
 * line plus a head triangle, oriented along vVec. */

in vec3 vColor;
in vec2 vVec;
in float vPixelLen;

out vec4 outColor;

void main()
{
  vec2 p = (gl_PointCoord - 0.5) * 2.0;     // -1..1 in sprite space
  float ang = atan(vVec.y, vVec.x + 1e-6);
  float ca = cos(-ang), sa = sin(-ang);
  vec2 q = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y); // rotate into +x direction space

  // shaft: from -0.8 to 0.45, half-width 0.05
  float dShaft = (abs(q.y) - 0.05) * step(-0.8, q.x) * step(q.x, 0.5) + step(0.5, q.x);
  if (q.x < -0.8 || q.x > 0.8) discard;
  float inShaft = (q.x > -0.8 && q.x < 0.5 && abs(q.y) < 0.05) ? 1.0 : 0.0;
  // head: triangle tip at x=0.8, base at 0.5, half height 0.20
  float inHead = 0.0;
  if (q.x >= 0.5 && q.x <= 0.8) {
    float hh = 0.20 * (0.8 - q.x) / 0.3;
    inHead = abs(q.y) < hh ? 1.0 : 0.0;
  }
  if (max(inShaft, inHead) < 0.5) discard;
  outColor = vec4(vColor, 0.9);
}
