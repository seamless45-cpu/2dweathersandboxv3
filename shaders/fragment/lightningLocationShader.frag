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
  float wxL = fract(cx - 0.03);
  float wxR = fract(cx + 0.03);
  vec4 wMid = texture(waterTex, vec2(wx, yMid));
  vec4 wLow = texture(waterTex, vec2(wx, 0.08));
  vec4 wSkirtL = texture(waterTex, vec2(wxL, 0.14));
  vec4 wSkirtR = texture(waterTex, vec2(wxR, 0.14));
  return max(wMid[CLOUD] + wMid[PRECIPITATION], 0.0) +
         max(wLow[CLOUD] + wLow[PRECIPITATION], 0.0) +
         0.45 * max(wSkirtL[CLOUD] + wSkirtL[PRECIPITATION], 0.0) +
         0.45 * max(wSkirtR[CLOUD] + wSkirtR[PRECIPITATION], 0.0);
}

// Choose a ground strike location in clear air outside the main storm core for
// an external positive CG ("bolt from the blue"), sampling uniformly at random
// across the full 5.5 km - 39.0 km range (0.4583 - 3.25 world height units at
// 12 km sim height, clamped < 0.4875 domain width so periodic wrapping never
// flips sides) while steering clear of dense cloud/rain cells.
float selectExternalStrikeTarget(vec2 originPos, float iter)
{
  float aspect = max(resolution.x / max(resolution.y, 1.0), 1.0);
  const float minWorld = 5.5 / 12.0;  // ~5.5 km minimum lateral travel
  const float maxWorld = 39.0 / 12.0; // ~39.0 km maximum lateral travel
  float yMid = clamp(originPos.y * 0.55, 0.08, 0.45);

  float bestX = fract(originPos.x + clamp(minWorld / aspect, 0.03, 0.4875));
  float bestScore = 1e9;
  for (int k = 0; k < 6; k++) {
    float rDist = random2d(vec2(originPos.x * 23.7 + float(k) * 11.3,
                                originPos.y * 17.9 + iter * 2.13 + float(k) * 3.7));
    float worldDist = mix(minWorld, maxWorld, rDist);
    float dx = clamp(worldDist / aspect, 0.03, 0.4875);
    float side = ((k % 2) == 0) ? 1.0 : -1.0;
    float cx = fract(originPos.x + side * dx);
    float tieBias = 0.02 * random2d(vec2(originPos.x * 17.3 + float(k) * 5.7, iter * 1.9 + float(k)));
    float score = stormScoreAt(cx, yMid) + tieBias;
    if (score < bestScore) {
      bestScore = score;
      bestX = cx;
    }
  }
  return bestX;
}

// Probe waterTex laterally on both sides and vertically across storm decks to
// find a distinct cloud cell or anvil deck target for cloud-to-cloud (CC)
// lightning, favoring separated pockets with clearer air in between so the
// discharge visibly bridges across cloud structures. Returns vec3(targetX, targetY, found).
vec3 selectCloudToCloudTarget(vec2 originPos, float iter)
{
  float aspect = max(resolution.x / max(resolution.y, 1.0), 1.0);
  float w1 = map_range(random2d(vec2(originPos.x * 37.9, iter * 1.3)), 0.0, 1.0, 0.28, 0.58);
  float w2 = map_range(random2d(vec2(originPos.y * 53.3, iter * 1.9)), 0.0, 1.0, 0.62, 0.92);
  float w3 = map_range(random2d(vec2(originPos.x * 41.1, iter * 2.3)), 0.0, 1.0, 0.96, 1.32);
  float w4 = map_range(random2d(vec2(originPos.y * 43.1, iter * 2.7)), 0.0, 1.0, 1.36, 1.76);

  float d1 = clamp(w1 / aspect, 0.04, 0.09);
  float d2 = clamp(w2 / aspect, d1 + 0.03, 0.14);
  float d3 = clamp(w3 / aspect, d2 + 0.03, 0.20);
  float d4 = clamp(w4 / aspect, d3 + 0.04, 0.27);

  float ySame = clamp(originPos.y, 0.08, 0.80);
  float yHigh = clamp(originPos.y + 0.14, 0.14, 0.84);
  float yLow = clamp(originPos.y - 0.14, 0.08, 0.72);

  float dxList[8];
  dxList[0] = d1;
  dxList[1] = -d1;
  dxList[2] = d2;
  dxList[3] = -d2;
  dxList[4] = d3;
  dxList[5] = -d3;
  dxList[6] = d4;
  dxList[7] = -d4;

  float yList[3];
  yList[0] = ySame;
  yList[1] = yHigh;
  yList[2] = yLow;

  float bestX = originPos.x;
  float bestY = ySame;
  float bestScore = -1e9;
  bool found = false;

  for (int k = 0; k < 8; k++) {
    float dx = dxList[k];
    float cx = fract(originPos.x + dx);
    float mx = fract(originPos.x + 0.5 * dx);
    for (int yi = 0; yi < 3; yi++) {
      float cy = yList[yi];
      vec4 wTarget = texture(waterTex, vec2(cx, cy));
      float targetDensity = max(wTarget[CLOUD] + wTarget[PRECIPITATION], 0.0);
      if (targetDensity < 0.14)
        continue;
      vec4 wMid = texture(waterTex, vec2(mx, 0.5 * (originPos.y + cy)));
      float midDensity = max(wMid[CLOUD] + wMid[PRECIPITATION], 0.0);
      // Prefer bridging across clear/thin gaps between separate cloud decks/cells.
      float separationBonus = max(targetDensity - midDensity, 0.0) * 0.55;
      float spanBonus = 0.18 * (abs(dx) / max(d4, 1e-4));
      float tieBias = 0.05 * random2d(vec2(originPos.x * 29.3 + float(k) * 7.1, iter * 3.1 + float(yi)));
      float score = targetDensity - 0.45 * midDensity + separationBonus + spanBonus + tieBias;
      if (!found || score > bestScore) {
        bestScore = score;
        bestX = cx;
        bestY = cy;
        found = true;
      }
    }
  }
  return vec3(bestX, bestY, found ? 1.0 : 0.0);
}

void main()
{
  int slot = int(gl_FragCoord.x); // pixel centres land on 0.5, 1.5, ... -> slots 0..LIGHTNING_SLOTS-1
  int row = int(gl_FragCoord.y);  // row 0: (groundOrTargetX, originY, iter, intensity); row 1: meta (originX, type, targetY, 0)
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
      // Encode external positive CG in (4.5, 5.4] so lightningFlickers() selects
      // a single return stroke (0 restrikes most of the time, rare 1 restroke)
      // while remaining bounded well inside the maximum slot lifetime.
      extStrike[INTENSITY] = clamp(4.6 + (incoming[INTENSITY] - 0.75) * 0.25, 4.6, 5.4);
      extStrike = attractToRod(extStrike);
      result = (row == 0) ? extStrike : vec4(originX, 1.0, 0.0, 0.0);
    } else {
      vec3 ccTarget = incoming.y >= 0.08 ? selectCloudToCloudTarget(vec2(originX, incoming.y), iterNum) : vec3(0.0);
      float ccRoll = random2d(vec2(originX * 47.3 + incoming.y * 83.1, iterNum * 1.37));
      float ccShare = (incoming[INTENSITY] <= LIGHTNING_IC_MAX_INTENSITY) ? 0.55 : 0.30;
      if (ccTarget.z > 0.5 && ccRoll < ccShare) {
        // Cloud-to-cloud (CC): meta.y = 2.0 for negative (-CC), 3.0 for positive (+CC).
        bool isPositiveCC = random2d(vec2(ccTarget.x * 71.9 + ccTarget.y * 31.1, iterNum * 2.19)) < 0.30;
        vec4 ccStrike = incoming;
        ccStrike.x = ccTarget.x;
        if (isPositiveCC) {
          // Encode +CC above 5.45 for single-stroke preference + rare restroke.
          ccStrike[INTENSITY] = clamp(5.5 + (incoming[INTENSITY] - 0.75) * 0.13, 5.5, 6.0);
          result = (row == 0) ? ccStrike : vec4(originX, 3.0, ccTarget.y, 0.0);
        } else {
          // Keep -CC above LIGHTNING_IC_MAX_INTENSITY so it stays distinct from IC flash.
          ccStrike[INTENSITY] = clamp(1.5 + (incoming[INTENSITY] - 0.75) * 0.22, 1.5, 2.3);
          result = (row == 0) ? ccStrike : vec4(originX, 2.0, ccTarget.y, 0.0);
        }
      } else {
        vec4 normalStrike = attractToRod(incoming);
        bool isNormalIC = normalStrike[INTENSITY] <= LIGHTNING_IC_MAX_INTENSITY;
        float posIcChance = mix(0.20, 0.36, clamp((incoming.y - 0.16) / 0.28, 0.0, 1.0));
        bool isPositiveIC = isNormalIC && incoming.y >= 0.16 &&
                            random2d(vec2(originX * 61.3 + incoming.y * 41.7, iterNum * 1.91)) < posIcChance;
        if (isPositiveIC) {
          normalStrike[INTENSITY] = clamp(max(normalStrike[INTENSITY], 0.88), 0.88, LIGHTNING_IC_MAX_INTENSITY);
          result = (row == 0) ? normalStrike : vec4(originX, 4.0, 0.0, 0.0);
        } else {
          result = (row == 0) ? normalStrike : vec4(originX, 0.0, 0.0, 0.0);
        }
      }
    }
  }

  lightningLocation = result;
}
