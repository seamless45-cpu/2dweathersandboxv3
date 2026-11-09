#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;

in vec2 texCoordX0Yp; // up
in vec2 texCoordX0Ym; // down

uniform sampler2D precipFeedbackTex;
uniform sampler2D lightningDataTex; // slot array from the previous iteration

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float iterNum;

out vec4 lightningLocation;

uniform float dryLapse;

#include "common.glsl"

// Lightning slot manager.
//
// The lightning data texture is LIGHTNING_SLOTS x 1: one texel per strike.
// Each strike keeps its slot for its whole animation, so a newer strike can
// never overwrite (and therefore cut short) one that is still flashing. A new
// strike only starts when a slot has finished; if every slot is busy the
// strike is simply dropped before it is ever drawn.
//
// This pass also ping-pongs the slot array (it samples the previous state and
// writes the next one), because sampling and rendering the same texture in one
// draw is a feedback loop.

bool slotBusy(vec4 data)
{
  float start = data[START_ITERNUM];
  return start > 0.0 && (iterNum - start) < LIGHTNING_ANIM_ITERS;
}

void main()
{
  int slot = int(gl_FragCoord.x); // pixel centres land on 0.5, 1.5, ... -> slots 0..3
  vec4 previous = texelFetch(lightningDataTex, ivec2(slot, 0), 0);

  // A precipitation particle writes a new strike into pixel (1, 0) of the
  // precipitation feedback, with additive blending. If several particles spawn
  // a strike in the same iteration their contributions sum up, so the start
  // number becomes k * iterNum: recover k and average the contributions into a
  // single strike instead of throwing the whole iteration away (a dense storm
  // easily produces more than one strike per iteration).
  vec4 incomingRaw = texelFetch(precipFeedbackTex, ivec2(1, 0), 0);
  float strikeCount = clamp(round(incomingRaw[START_ITERNUM] / max(iterNum, 1.0)), 1.0, 64.0);
  vec4 incoming = vec4(incomingRaw.xy / strikeCount,
                       incomingRaw[START_ITERNUM] / strikeCount,
                       incomingRaw[INTENSITY] / strikeCount);
  bool hasNewStrike = incoming[START_ITERNUM] >= max(iterNum - 1.0, 1.0) &&
                      incoming[START_ITERNUM] <= iterNum;

  bool duplicate = false;
  int freeSlot = -1;
  if (hasNewStrike) {
    for (int i = 0; i < LIGHTNING_SLOTS; i++) {
      vec4 data = texelFetch(lightningDataTex, ivec2(i, 0), 0);
      // The feedback texture can present the same strike for two iterations
      // while it ping-pongs; never store it twice.
      if (data[START_ITERNUM] > 0.0 &&
          abs(data[START_ITERNUM] - incoming[START_ITERNUM]) < 0.5)
        duplicate = true;
      if (freeSlot < 0 && !slotBusy(data))
        freeSlot = i;
    }
  }

  vec4 result = previous;
  if (hasNewStrike && !duplicate && slot == freeSlot)
    result = incoming;

  lightningLocation = result;
}
