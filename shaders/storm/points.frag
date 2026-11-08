#version 300 es
precision highp float;

/* Round soft sprites; slight rim lighting gives ice/graupel depth. */

in vec4 vColor;
uniform int shapeMode; // 0 = soft disc, 1 = hard core (charge mode pops charged ones)
out vec4 outColor;

void main()
{
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float fall = smoothstep(1.0, 0.35, r);
  float core = smoothstep(0.55, 0.0, r);
  float a = vColor.a * (0.55 * fall + 0.45 * core);
  outColor = vec4(vColor.rgb, a);
}
