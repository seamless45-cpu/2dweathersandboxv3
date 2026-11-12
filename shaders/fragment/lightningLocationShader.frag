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
uniform sampler2D waterTex;         // cloud & precipitation field for clear-air positive CG targeting

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

float stormScoreAt(float cx, float yMid)
{
  float wx = fract(cx);
  vec4 wMid = texture(waterTex, vec2(wx, yMid));
  vec4 wLow = texture(waterTex, vec2(wx, 0.08));
  return max(wMid[CLOUD] + wMid[PRECIPITATION], 0.0) +
         max(wLow[CLOUD] + wLow[PRECIPITATION], 0.0);
}

// Choose a distant ground strike location in clear air outside the storm core
// for an external positive CG ("bolt from the blue"). Probing both sides at
// near and far lateral distances lets the bolt escape wide storm anvils and
// steer away from adjacent storm cells into clear sky.
float selectExternalStrikeTarget(vec2 originPos, float iter)
{
  float aspect = resolution.x / max(resolution.y, 1.0);
  float nearWorld = map_range(random2d(vec2(originPos.y * 13.1, iter * 2.1)), 0.0, 1.0, 0.70, 1.05);
  float farWorld = map_range(random2d(vec2(originPos.x * 23.7, iter * 3.3)), 0.0, 1.0, 1.10, 1.65);

  float dNear = clamp(nearWorld / max(aspect, 1.0), 0.06, 0.22);
  float dFar = clamp(farWorld / max(aspect, 1.0), dNear + 0.03, 0.28);
  float yMid = clamp(originPos.y * 0.55, 0.08, 0.45);

  float cands[4];
  cands[0] = fract(originPos.x + dNear);
  cands[1] = fract(originPos.x - dNear);
  cands[2] = fract(originPos.x + dFar);
  cands[3] = fract(originPos.x - dFar);

  float bestX = cands[0];
  float bestScore = 1e9;
  for (int k = 0; k < 4; k++) {
    float cx = cands[k];
    float tieBias = 0.08 * random2d(vec2(originPos.x * 17.3 + float(k) * 5.7, iter * 1.9 + float(k)));
    float score = stormScoreAt(cx, yMid) + tieBias;
    if (score < bestScore) {
      bestScore = score;
      bestX = cx;
    }
  }
  return bestX;
}

void main()
{
  int slot = int(gl_FragCoord.x); // pixel centres land on 0.5, 1.5, ... -> slots 0..LIGHTNING_SLOTS-1
  int row = int(gl_FragCoord.y);  // row 0: strike (groundX, originY, iter, intensity); row 1: meta (originX, isExternalPositive, 0, 0)
  vec4 previous = texelFetch(lightningDataTex, ivec2(slot, row), 0);

  // A precipitation particle writes a new strike into pixel (1, 0) of the
  // precipitation feedback, with additive blending. If several particles spawn
  // a strike in the same iteration their contributions sum up, so the start
  // number becomes k * iterNum: recover k and average the contributions into a
  // single strike instead of throwing the whole iteration away (a dense storm
  // easily produces more than one strike per iteration).
  //
  // The count must not be capped. This used to be
  // `clamp(round(raw / iterNum), 1., 64.)`, and past 64 contributions the texel
  // then divided to k/64 * iterNum - a start iteration *ahead* of the current one -
  // which failed the "is this strike from now?" test below. Every strike in a dense
  // storm was dropped, silently, for the whole session: no channel, no glow, no
  // thunder, both kinds of lightning, no matter what the artwork did. The start
  // iteration is therefore not recovered from the sum at all - the texel is cleared
  // every iteration, so anything in it was formed this iteration - and the count is
  // only used to average the position and the intensity.
  vec4 incomingRaw = texelFetch(precipFeedbackTex, ivec2(1, 0), 0);
  float strikeCount = max(round(incomingRaw[START_ITERNUM] / max(iterNum, 1.0)), 1.0);
  vec4 incoming = vec4(incomingRaw.xy / strikeCount,
                       iterNum,
                       incomingRaw[INTENSITY] / strikeCount);
  // Real lightning triggers always write START_ITERNUM >= 1.0 and INTENSITY >= 0.75.
  // Evaporating droplets near the bottom-left corner can splat small positive VAPOR
  // (channel 2 == START_ITERNUM) into (1, 0), leaving INTENSITY at 0; require both
  // channels so phantom zero-intensity vapor splats never hijack a lightning slot.
  bool hasNewStrike = incomingRaw[START_ITERNUM] >= 0.5 && incomingRaw[INTENSITY] >= 0.5;

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
  if (hasNewStrike && !duplicate && slot == freeSlot) {
    float originX = fract(incoming.x);
    // Tall convective clouds build upper positive charge that occasionally
    // discharges out the side/anvil as a high-current external positive CG.
    float posChance = mix(0.14, 0.24, clamp((incoming.y - 0.18) / 0.28, 0.0, 1.0));
    bool isExternalPositive = incoming.y >= 0.18 &&
                              random2d(vec2(originX * 31.7 + incoming.y * 59.3, iterNum * 0.73)) < posChance;
    if (isExternalPositive) {
      vec4 extStrike = incoming;
      extStrike.x = selectExternalStrikeTarget(vec2(originX, incoming.y), iterNum);
      extStrike[INTENSITY] = clamp(max(incoming[INTENSITY] * 1.45, 2.8), 2.8, 4.5);
      extStrike = attractToRod(extStrike);
      result = (row == 0) ? extStrike : vec4(originX, 1.0, 0.0, 0.0);
    } else {
      vec4 normalStrike = attractToRod(incoming);
      result = (row == 0) ? normalStrike : vec4(originX, 0.0, 0.0, 0.0);
    }
  }

  lightningLocation = result;
}
