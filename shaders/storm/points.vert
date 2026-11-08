#version 300 es
precision highp float;

/* Hydrometeor / charge super-particle sprites for the storm physics overlay.
 * Positions arrive in sim-normalized coordinates [0..1] and are transformed
 * with the exact same view math as dispShader.vert so particles stay glued
 * to the simulated world while panning/zooming.
 */

in vec2 simPos;   // [0..1] sim coordinates
in vec4 pData;    // [radius m, type, qMetric (sign*log10|q|+14 clamped), seed 0..1]
in vec2 pMisc;    // [multiplicity log10, melt fraction]

uniform vec2 aspectRatios; // sim, canvas
uniform vec3 view;         // x pos, y pos, zoom
uniform float Xmult;       // horizontal domain oversampling
uniform float pointScale;  // base point-size multiplier (px per sim fraction)
uniform int colorMode;     // 0 = by species, 1 = by charge, 2 = species with charge brightness
uniform float alphaScale;

out vec4 vColor;

/* species colour table - chosen to read clearly over the storm display */
vec3 typeColor(float t)
{
  int it = int(t + 0.5);
  if (it == 0) return vec3(0.90, 0.93, 0.97); // cloud droplets   - near white
  if (it == 1) return vec3(0.62, 0.78, 1.00); // supercooled drop - pale blue
  if (it == 2) return vec3(0.75, 0.95, 1.00); // ice crystals     - cyan white
  if (it == 3) return vec3(0.85, 0.87, 0.92); // snow aggregates  - soft grey-white
  if (it == 4) return vec3(0.55, 0.62, 0.78); // graupel          - greyblue
  if (it == 5) return vec3(0.35, 0.38, 0.55); // hail             - dark slate
  return vec3(0.30, 0.55, 1.00);              // rain             - blue
}

void main()
{
  float typ = pData.y;
  float qm  = pData.z;   // 0 => neutral; sign = polarity, magnitude ~ log10|q| C + 14

  /* size from physical radius with a visibility floor, zoom-aware */
  float physMeters = pData.x * 2.0;                       // diameter
  float simFrac    = physMeters / 32000.0;                // resolved via uniform-independent normalization
  // normalize against real sim width passed through pointScale relation
  float sizePx = max(1.6, simFrac * pointScale * view.z);
  // emphasize charging species a touch
  sizePx *= (typ == 4.0 || typ == 5.0) ? 1.25 : 1.0;
  gl_PointSize = min(sizePx, 64.0);

  /* vertex color: species or charge polarity */
  vec3 col = typeColor(typ);
  float brightness = 1.0;
  if (colorMode == 1 || colorMode == 2) {
    if (qm > 0.0) { col = vec3(1.0, 0.32, 0.30); brightness = clamp(qm / 9.0, 0.35, 1.0); }
    else if (qm < 0.0) { col = vec3(0.35, 0.55, 1.00); brightness = clamp(-qm / 9.0, 0.35, 1.0); }
    else { brightness = 0.28; }
    if (colorMode == 2)
      col = mix(typeColor(typ), col, 0.62);
  }
  // melting particles look wetter
  col = mix(col, vec3(0.45, 0.6, 1.0), clamp(pMisc.y, 0.0, 1.0) * 0.35);
  vColor = vec4(col * brightness, alphaScale * (0.55 + 0.45 * brightness));

  vec2 outpos = simPos * 2.0 - 1.0;
  outpos.x *= Xmult;
  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];
  outpos *= view[2];
  outpos.y *= aspectRatios[1] / aspectRatios[0];
  gl_Position = vec4(outpos, 0.0, 1.0);
}
