#version 300 es
precision highp float;

/* Storm-field overlay: charge density / |E| / potential, sampled from the
 * solver grid with manual bilinear so R32F textures work everywhere. */

in vec2 fragCoord;         // sim-normalized

uniform sampler2D fieldTex; // R32F-by-channel packed RGBA32F: r=rho, g=|E|, b=phi
uniform vec2 gridCells;     // field nx, ny
uniform int mode;           // 0 charge density, 1 |E|, 2 potential, 3 combined(charge+E heat)
uniform float maxRho;       // C/m^3 normalization
uniform float maxE;         // V/m normalization
uniform float maxPhi;
uniform float alphaScale;

out vec4 outColor;

vec4 sampleBilinear(vec2 uv)
{
  vec2 g = uv * gridCells - 0.5;
  vec2 i0 = floor(g);
  vec2 f = g - i0;
  vec2 c00 = clamp(i0, vec2(0.0), gridCells - 1.0);
  vec2 c10 = clamp(i0 + vec2(1.0, 0.0), vec2(0.0), gridCells - 1.0);
  vec2 c01 = clamp(i0 + vec2(0.0, 1.0), vec2(0.0), gridCells - 1.0);
  vec2 c11 = clamp(i0 + vec2(1.0, 1.0), vec2(0.0), gridCells - 1.0);
  vec4 v00 = texelFetch(fieldTex, ivec2(c00), 0);
  vec4 v10 = texelFetch(fieldTex, ivec2(c10), 0);
  vec4 v01 = texelFetch(fieldTex, ivec2(c01), 0);
  vec4 v11 = texelFetch(fieldTex, ivec2(c11), 0);
  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}

vec3 heat(float t) // black->purple->orange->white
{
  t = clamp(t, 0.0, 1.0);
  vec3 a = mix(vec3(0.02, 0.0, 0.05), vec3(0.55, 0.05, 0.65), smoothstep(0.0, 0.45, t));
  vec3 b = mix(a, vec3(1.0, 0.45, 0.05), smoothstep(0.45, 0.8, t));
  return mix(b, vec3(1.0, 0.95, 0.8), smoothstep(0.8, 1.0, t));
}

void main()
{
  // fragCoord.x may span multiple tiles when the view wraps horizontally
  vec2 uv = vec2(fract(fragCoord.x), clamp(fragCoord.y, 0.0, 1.0));
  vec4 v = sampleBilinear(uv);
  float rho = v.r, emag = v.g, phi = v.b;

  vec3 col = vec3(0.0);
  float alpha = 0.0;

  if (mode == 0 || mode == 3) {
    float q = rho / max(maxRho, 1e-12);
    float a = clamp(abs(q), 0.0, 1.0);
    if (q > 0.0) col = vec3(1.0, 0.15, 0.10);
    else col = vec3(0.15, 0.4, 1.0);
    alpha = pow(a, 0.6) * 0.85;
    if (mode == 3) {
      float e = emag / max(maxE, 1.0);
      col = mix(col, heat(e), 0.45);
      alpha = max(alpha, pow(clamp(e, 0.0, 1.0), 0.7) * 0.55);
    }
  } else if (mode == 1) {
    float e = emag / max(maxE, 1.0);
    col = heat(e);
    alpha = pow(clamp(e, 0.0, 1.0), 0.8) * 0.8;
  } else {
    // potential iso-shading: contour lines + faint fill
    float p = phi / max(maxPhi, 1.0);
    float band = abs(fract(p * 14.0) - 0.5);
    float line = smoothstep(0.16, 0.02, band);
    col = mix(vec3(0.1, 0.25, 0.6), vec3(0.9, 0.95, 1.0), 0.5 + 0.5 * p);
    alpha = line * 0.75 + clamp(abs(p), 0.0, 1.0) * 0.16;
  }
  outColor = vec4(col, alpha * alphaScale);
}
