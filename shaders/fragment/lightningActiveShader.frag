#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D lightningRenderStateTex;

layout(location = 0) out vec4 activeOutput;

// One texel summary of the strike slot array. Row 0 of the render-state pass
// stores w = 1.0 for an animating strike and 0.0 otherwise (inactive slots
// early-return and leave the cleared zero behind). Fold the six w values into
// a single texel so the full-screen display pass can skip its per-pixel slot
// scan with one fetch instead of six when the sky is quiet.
// Keep the slot count in sync with LIGHTNING_SLOTS in common.glsl and
// numLightningSlots in app.js.
void main()
{
  float anyActive = 0.0;
  for (int slot = 0; slot < 6; slot++)
    anyActive = max(anyActive, texelFetch(lightningRenderStateTex, ivec2(slot, 0), 0).w);
  activeOutput = vec4(anyActive, 0.0, 0.0, 1.0);
}
