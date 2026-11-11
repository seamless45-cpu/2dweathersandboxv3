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

// Lightning rods (placed with the Lightning Rod tool in app.js). rodPositions[].x
// is the normalized horizontal position of the mast, .y the normalized height of
// the terrain surface it stands on. A rod only affects cloud-to-ground strikes:
// an intra-cloud flash keeps the place it formed in.
uniform vec2 rodPositions[MAX_LIGHTNING_RODS];
uniform int rodCount;
uniform float rodAttractRadius; // horizontal reach, in normalized sim width

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
//
// A slot is busy while its strike can still be seen, and not one iteration
// longer: strikeAnimEnd() (common.glsl) works out that strike's own end. Holding
// a slot for the worst case instead - which is what this used to do - meant a
// flash booked a slot for three or four times its own length, and a storm spent
// most of its time with every slot booked and every new strike dropped.

bool slotBusy(vec4 data)
{
  return data[START_ITERNUM] > 0.0 && iterNum < strikeAnimEnd(data);
}

// Pull a newly formed CG strike onto the nearest rod it can reach. Strikes that
// form close to a mast almost always land on it, far ones rarely do; this is
// what makes a rod read as an attractor instead of a decoration.
vec4 attractToRod(vec4 strike)
{
  if (strike[INTENSITY] <= LIGHTNING_IC_MAX_INTENSITY)
    return strike; // intra-cloud: no ground contact, so nothing to attract

  int nearestRod = -1;
  float nearestDist = rodAttractRadius;
  for (int i = 0; i < MAX_LIGHTNING_RODS; i++) {
    if (i >= rodCount)
      break;
    float dx = abs(strike.x - rodPositions[i].x);
    if (dx < nearestDist) {
      nearestDist = dx;
      nearestRod = i;
    }
  }
  if (nearestRod < 0)
    return strike;

  // chance falls off linearly with distance from the mast
  float pull = 1.0 - nearestDist / max(rodAttractRadius, 1e-5);
  if (random2d(vec2(strike.y * 149.7, strike[START_ITERNUM] * 7.31)) > pull)
    return strike;

  strike.x = rodPositions[nearestRod].x;
  // a captured strike is always a full return stroke
  strike[INTENSITY] = max(strike[INTENSITY], LIGHTNING_IC_MAX_INTENSITY + 0.6);
  return strike;
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
    result = attractToRod(incoming);

  lightningLocation = result;
}
