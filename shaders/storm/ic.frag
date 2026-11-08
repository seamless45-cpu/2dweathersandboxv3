#version 300 es
precision highp float;
precision highp sampler2D;

/* Intra-cloud flash artwork from lightningGenerator.js (mode "IC").
 *
 * The texture is a single-channel luminance map of a wide, flat, heavily
 * forked channel network. IC light is seen *through* cloud, so it is drawn
 * additively and softly: a dim halo around a white-blue core, with no hard
 * edges. Flicker and the multi-stroke cadence come from the CPU-side
 * brightness uniform. */

in vec2 vUV;

uniform sampler2D icTex;
uniform float brightness;   // 0..~1, already includes flicker / decay
uniform float flipX;        // 0/1 horizontal mirror for repeat variety
uniform float seed;         // per-flash dither

out vec4 outColor;

void main()
{
  vec2 uv = vUV;
  if (flipX > 0.5) uv.x = 1.0 - uv.x;

  float v = texture(icTex, uv).r;
  // faint filaments should still register; the artwork itself already fades
  // with branch order and distance from the origin
  v = max(v - 0.03, 0.0) / 0.97;

  float core = v * v;
  float halo = sqrt(v);

  vec3 col = mix(vec3(0.55, 0.68, 1.00), vec3(0.96, 0.98, 1.00), core);
  float a = (halo * 0.45 + core * 0.85) * brightness * 1.15;
  outColor = vec4(col * a, a);
}
