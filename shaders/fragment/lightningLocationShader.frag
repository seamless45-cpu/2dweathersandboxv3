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
uniform sampler2D baseTex;          // potential temperature field for cloud temperature gating

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float iterNum;

out vec4 lightningLocation;

uniform float dryLapse;
uniform vec4 artificialStrike;      // x, origin y, intensity, active
uniform bool compactFeedback; // half-float feedback encodes count directly
uniform float artificialStrikeVariant; // which kind of event a manual click queues (see app.js)
uniform float simHeightMeters; // simulation height in meters, for physical strike ranges

#include "common.glsl"

// Lightning rods (placed with the Lightning Rod tool in app.js). rodPositions[].x
// is the normalized horizontal position of the mast, .y the normalized height of
// the terrain surface it stands on. A rod only affects cloud-to-ground strikes:
// an intra-cloud flash keeps the place it formed in.
uniform vec2 rodPositions[MAX_LIGHTNING_RODS];
uniform float rodTypes[MAX_LIGHTNING_RODS]; // 1 = super rod
uniform int rodCount;
uniform float rodHeight;        // mast height, in cells

float lightningHorizontalDist(float a, float b)
{
  return abs(a - b);
}

// Only coalesce an immediately repeated natural source, not a neighboring cell,
// a later strike, or an intentional manual click. Meta.x is the cloud origin,
// even if a rod or a special variant moved the visible target elsewhere.
bool sameNaturalStrike(vec4 data, vec4 meta, vec4 incoming, bool isArtificial, float now, vec2 cellSize)
{
  float age = now - data[START_ITERNUM];
  vec2 originDifference = abs(vec2(meta.x, data.y) - incoming.xy);
  return !isArtificial && !artificialMeta(meta.z) && data[START_ITERNUM] > 0.0 &&
         age > 0.0 && age <= 2.0 && all(lessThanEqual(originDifference, cellSize * 0.25));
}

// Gameplay-scale rolling-sphere approximation, not an engineering protection
// calculation. The intensity is a simulation index, not measured current.
// Express the reach in metres before converting to world coordinates, so a
// wider simulation or a different grid resolution does not grow the rod.
float rodEffectiveRadius(int rodIdx, float strikingDistance, float worldWidth)
{
  float heightMeters = rodHeight * simHeightMeters / max(resolution.y, 1.0);
  bool superRod = rodTypes[rodIdx] > 0.5;
  heightMeters = min(heightMeters * (superRod ? 1.8 : 1.0), strikingDistance);
  float radiusMeters = sqrt(max(2.0 * strikingDistance * heightMeters - heightMeters * heightMeters, 0.0));
  return min(0.5, radiusMeters * (superRod ? 2.5 : 1.0) / worldWidth);
}

// Lightning slot manager.
//
// The lightning data texture is LIGHTNING_SLOTS x 2: strike and metadata rows.
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

bool slotBusy(vec4 data, vec4 meta)
{
  return data[START_ITERNUM] > 0.0 && iterNum < lightningSlotEnd(data, meta);
}

float superboltWorldWidthMeters();

// Pull any CG strike (normal -CG or external +CG) onto the nearest reachable rod.
// Uses a gameplay rolling-sphere reach based on mast height and strike intensity:
// inside the inner protective cone (35% for normal, 70% for super rods) capture
// is guaranteed, tapering
// smoothly toward the outer boundary without jumping the world seam.
vec4 attractToRodWithinRange(vec4 strike, float originX, float minRangeMeters, float maxRangeMeters)
{
  if (strike[INTENSITY] <= LIGHTNING_IC_MAX_INTENSITY)
    return strike; // intra-cloud: no ground contact, so nothing to attract

  if (rodCount == 0)
    return strike;
  int nearestRod = -1;
  float bestNormalizedDist = 1.0;
  float worldWidth = max(superboltWorldWidthMeters(), 1.0);
  float strikingDistance = clamp(500.0 + 180.0 * strike[INTENSITY], 600.0, 1600.0);
  for (int i = 0; i < MAX_LIGHTNING_RODS; i++) {
    if (i >= rodCount)
      break;
    float rodRangeMeters = lightningHorizontalDist(originX, rodPositions[i].x) * worldWidth;
    if (rodRangeMeters < minRangeMeters || rodRangeMeters > maxRangeMeters)
      continue;
    float dx = lightningHorizontalDist(strike.x, rodPositions[i].x);
    // The rolling-sphere radius cannot exceed its striking distance. Reject
    // distant rods before the square root and the normalized comparison.
    float maxReachMeters = strikingDistance * (rodTypes[i] > 0.5 ? 2.5 : 1.0);
    if (dx * worldWidth >= maxReachMeters)
      continue;
    float effRadius = max(rodEffectiveRadius(i, strikingDistance, worldWidth), 1e-5);
    float normDist = dx / effRadius;
    if (normDist < bestNormalizedDist) {
      bestNormalizedDist = normDist;
      nearestRod = i;
    }
  }
  if (nearestRod < 0)
    return strike;

  float guaranteedReach = rodTypes[nearestRod] > 0.5 ? 0.70 : 0.35;
  float pull = bestNormalizedDist <= guaranteedReach
    ? 1.0
    : pow(clamp((1.0 - bestNormalizedDist) / (1.0 - guaranteedReach), 0.0, 1.0), 1.35);
  if (random2d(vec2(strike.y * 149.7 + fract(strike.x) * 31.3, strike[START_ITERNUM] * 7.31)) > pull)
    return strike;

  strike.x = rodPositions[nearestRod].x;
  // a captured strike is always a full return stroke
  strike[INTENSITY] = max(strike[INTENSITY], LIGHTNING_IC_MAX_INTENSITY + 0.6);
  return strike;
}

vec4 attractToRod(vec4 strike)
{
  return attractToRodWithinRange(strike, strike.x, 0.0, superboltWorldWidthMeters());
}

float stormScoreAt(float cx, float yMid)
{
  float wx = clamp(cx, 0.0, 0.999999);
  float wxL = clamp(cx - 0.03, 0.0, 0.999999);
  float wxR = clamp(cx + 0.03, 0.0, 0.999999);
  vec4 wMid = texture(waterTex, vec2(wx, yMid));
  vec4 wLow = texture(waterTex, vec2(wx, 0.08));
  vec4 wSkirtL = texture(waterTex, vec2(wxL, 0.14));
  vec4 wSkirtR = texture(waterTex, vec2(wxR, 0.14));
  return max(wMid[CLOUD] + wMid[PRECIPITATION], 0.0) +
         max(wLow[CLOUD] + wLow[PRECIPITATION], 0.0) +
         0.45 * max(wSkirtL[CLOUD] + wSkirtL[PRECIPITATION], 0.0) +
         0.45 * max(wSkirtR[CLOUD] + wSkirtR[PRECIPITATION], 0.0);
}

// Physical world width, independent of grid resolution and simulation height.
float superboltWorldWidthMeters()
{
  return simHeightMeters * resolution.x / max(resolution.y, 1.0);
}

// A strike may use either side only when the full minimum distance fits in
// that side of the *same* world tile. Do not cross the periodic seam.
bool externalRangeFits(float originX, float minMeters)
{
  return max(originX, 0.999999 - originX) * superboltWorldWidthMeters() >= minMeters;
}

float selectExternalStrikeTarget(vec2 originPos, float iter, float minMeters, float maxMeters)
{
  float widthMeters = superboltWorldWidthMeters();
  float minDx = minMeters / widthMeters;
  float yMid = clamp(originPos.y * 0.55, 0.08, 0.45);
  float bestX = originPos.x + (originPos.x >= 0.5 ? -minDx : minDx);
  float bestScore = 1e9;
  for (int k = 0; k < 6; k++) {
    float side = ((k % 2) == 0) ? 1.0 : -1.0;
    float available = side > 0.0 ? 0.999999 - originPos.x : originPos.x;
    float maxDx = min(maxMeters / widthMeters, available);
    if (maxDx < minDx)
      continue;
    float rDist = random2d(vec2(originPos.x * 23.7 + float(k) * 11.3,
                                originPos.y * 17.9 + iter * 2.13 + float(k) * 3.7));
    float cx = originPos.x + side * mix(minDx, maxDx, rDist);
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
  float yHigh = clamp(originPos.y + 0.13, 0.14, 0.84);
  float yAnvil = clamp(originPos.y + 0.22, 0.18, 0.88);
  float yLow = clamp(originPos.y - 0.12, 0.08, 0.72);

  float dxList[8];
  dxList[0] = d1;
  dxList[1] = -d1;
  dxList[2] = d2;
  dxList[3] = -d2;
  dxList[4] = d3;
  dxList[5] = -d3;
  dxList[6] = d4;
  dxList[7] = -d4;

  float yList[4];
  yList[0] = ySame;
  yList[1] = yHigh;
  yList[2] = yAnvil;
  yList[3] = yLow;

  float bestX = originPos.x;
  float bestY = ySame;
  float bestScore = -1e9;
  bool found = false;

  for (int k = 0; k < 8; k++) {
    float dx = dxList[k];
    float cx = originPos.x + dx;
    if (cx < 0.0 || cx >= 1.0)
      continue;
    float mx = originPos.x + 0.5 * dx;
    for (int yi = 0; yi < 4; yi++) {
      float cy = yList[yi];
      if (texture(baseTex, vec2(cx, cy))[TEMPERATURE] >= 500.0)
        continue; // never terminate inside terrain walls
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
  int row = int(gl_FragCoord.y);  // row 0: (groundOrTargetX, originY, iter, intensity); row 1: meta (originX, type, targetY, strike class: 0 ordinary, 1 superbolt, 2 hyperbolt)
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
  float strikeCount = max(round(incomingRaw[START_ITERNUM] / (compactFeedback ? 1.0 : max(iterNum, 1.0))), 1.0);
  vec4 incoming = vec4(incomingRaw.xy / strikeCount,
                       iterNum,
                       incomingRaw[INTENSITY] / strikeCount);
  // Real lightning triggers always write START_ITERNUM >= 1.0 and INTENSITY >= 0.75.
  // Evaporating droplets near the bottom-left corner can splat small positive VAPOR
  // (channel 2 == START_ITERNUM) into (1, 0), leaving INTENSITY at 0; require both
  // channels so phantom zero-intensity vapor splats never hijack a lightning slot.
  bool hasNewStrike = incomingRaw[START_ITERNUM] >= 0.5 && incomingRaw[INTENSITY] >= 0.5;
  bool isArtificial = artificialStrike.w > 0.5;
  if (isArtificial) {
    incoming = vec4(artificialStrike.xy, iterNum, artificialStrike.z);
    hasNewStrike = true;
  }

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
      vec4 meta = texelFetch(lightningDataTex, ivec2(i, 1), 0);
      // A repeated natural feedback sample from the same source on the next
      // iteration is one strike, not a second parallel channel. Restrict this
      // to an almost identical origin and two steps; deliberate manual clicks
      // and genuinely separate storm cells can still coexist.
      if (sameNaturalStrike(data, meta, incoming, isArtificial, iterNum, texelSize))
        duplicate = true;
      if (freeSlot < 0 && !slotBusy(data, meta))
        freeSlot = i;
    }
  }

  vec4 result = previous;
  if (hasNewStrike && !duplicate && slot == freeSlot) {
    float originX = fract(incoming.x);
    if (isArtificial) {
      // Artificial lightning: the "Artificial Lightning Variant" option picked in
      // the UI decides which kind of event the click produces. Ground-striking
      // variants still obey rod capture, exactly as natural strikes do; the
      // intra-cloud, cloud-to-cloud and upward variants keep the place they
      // formed in. Strikes that carry an extra target/anchor height in meta.z
      // store it with the artificial offset of 10.0 (see artificialMeta() in
      // common.glsl); the rest leave meta.z at the -1 artificial sentinel.
      float variant = artificialStrikeVariant;
      vec4 artData = incoming;
      vec4 artMeta = vec4(originX, 0.0, -1.0, 0.0); // ordinary CG by default
      if (variant > 0.5 && variant < 1.5) {         // intra-cloud flash
        artData[INTENSITY] = 0.85;
      } else if (variant > 1.5 && variant < 2.5) {  // positive intra-cloud flash
        artData[INTENSITY] = 0.95;
        artMeta.y = 4.0;
      } else if (variant > 2.5 && variant < 4.5) {  // cloud-to-cloud (-CC / +CC)
        bool ccPositive = variant >= 3.5;
        vec3 ccTarget = selectCloudToCloudTarget(vec2(originX, incoming.y), iterNum);
        if (ccTarget.z > 0.5) {
          artData.x = ccTarget.x;
          if (ccPositive) {
            artData[INTENSITY] = clamp(5.5 + (incoming[INTENSITY] - 0.75) * 0.13, 5.5, 6.0);
            artMeta = vec4(originX, 3.0, 10.0 + ccTarget.y, 0.0);
          } else {
            artData[INTENSITY] = clamp(1.5 + (incoming[INTENSITY] - 0.75) * 0.22, 1.5, 2.3);
            artMeta = vec4(originX, 2.0, 10.0 + ccTarget.y, 0.0);
          }
        } else {
          artData[INTENSITY] = 0.85; // no cloud deck to reach: fall back to an ordinary flash
        }
      } else if (variant > 4.5 && variant < 5.5) {  // positive cloud-to-ground
        artData[INTENSITY] = 4.8;
        artMeta.y = 1.0;
        artData = attractToRod(artData);
      } else if (variant > 5.5 && variant < 6.5) {  // superbolt
        artData[INTENSITY] = 5.0;
        artMeta = vec4(originX, 1.0, -1.0, 1.0); // integer meta.w = 1 superbolt, 2 hyperbolt
        artData = attractToRod(artData);
      } else if (variant > 11.5 && variant < 12.5) { // hyperbolt (720,000 K positive CG)
        artData[INTENSITY] = 5.0;
        artMeta = vec4(originX, 1.0, -1.0, 2.0); // integer meta.w = 2 hyperbolt flag
        artData = attractToRod(artData);
      } else {                                      // ordinary cloud-to-ground (default)
        artData = attractToRod(artData);
      }
      result = (row == 0) ? artData : artMeta;
    } else {
      // Tall convective clouds only initiate external positive CG from cold upper
      // charge regions strictly below -25 °C.
      float originPotentialT = texture(baseTex, vec2(originX, incoming.y))[TEMPERATURE];
      float originTempK = potentialToRealT(originPotentialT, incoming.y);
      float originTempC = KtoC(originTempK);
      float coldFactor = clamp((-25.0 - originTempC) / 30.0, 0.0, 1.0);
      float posChance = mix(0.14, 0.26, coldFactor);
      bool isExternalPositive = incoming.y >= 0.18 &&
                                externalRangeFits(originX, 5500.0) &&
                                originTempK > 50.0 &&
                                originTempK < CtoK(-25.0) &&
                                random2d(vec2(originX * 31.7 + incoming.y * 59.3, iterNum * 0.73)) < posChance;
      if (isExternalPositive) {
        // Roll only when a 9 km same-tile path fits. Otherwise keep an
        // ordinary external CG; if even 5.5 km cannot fit, use the normal branch.
        bool isSuperboltExt = externalRangeFits(originX, 9000.0) &&
          random2d(vec2(originX * 89.3 + incoming.y * 47.1, iterNum * 1.13)) < 0.072;
        // A hyperbolt is the same eligibility with the dice halved again:
        // half as rare as an ordinary superbolt (0.072 * 0.5 = 0.036).
        bool isHyperboltExt = isSuperboltExt &&
          random2d(vec2(originX * 97.7 + incoming.y * 53.3, iterNum * 1.29)) < 0.5;
        float minRangeMeters = isSuperboltExt ? 9000.0 : 5500.0;
        float maxRangeMeters = isSuperboltExt ? 37000.0 : 34000.0;
        vec4 extStrike = incoming;
        extStrike.x = selectExternalStrikeTarget(vec2(originX, incoming.y), iterNum, minRangeMeters, maxRangeMeters);
        // Encode external positive CG in (4.5, 5.4] for its single-stroke preference.
        extStrike[INTENSITY] = clamp(4.6 + (incoming[INTENSITY] - 0.75) * 0.25, 4.6, 5.4);
        // Filter rods before picking the nearest so an invalid rod cannot hide a valid one.
        extStrike = attractToRodWithinRange(extStrike, originX, minRangeMeters, maxRangeMeters);
        result = (row == 0) ? extStrike : vec4(originX, 1.0, 0.0, isHyperboltExt ? 2.0 : (isSuperboltExt ? 1.0 : 0.0));
      } else {
        // Decide whether CC is attempted before the expensive cloud-deck
        // search. A ground rod cannot change a discharge into a ground strike.
        float ccRoll = random2d(vec2(originX * 47.3 + incoming.y * 83.1, iterNum * 1.37));
        float ccShare = (incoming[INTENSITY] <= LIGHTNING_IC_MAX_INTENSITY) ? 0.55 : 0.30;
        bool tryCC = incoming.y >= 0.08 && ccRoll < ccShare;
        vec3 ccTarget = tryCC ? selectCloudToCloudTarget(vec2(originX, incoming.y), iterNum) : vec3(0.0);
        if (tryCC && ccTarget.z > 0.5) {
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
  }

  lightningLocation = result;
}
