#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;
precision highp sampler2DArray;

in vec2 fragCoord;    // pixel
in vec2 texCoord;     // this normalized

in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

in vec2 onScreenUV;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D noiseTex;
uniform sampler2D surfaceTextureMap;
uniform sampler2D curlTex;
uniform sampler2D lightningTex;
uniform sampler2D lightningDataTex;
uniform sampler2DArray icLightningTex; // one layer of intra-cloud artwork per pattern
uniform vec2 icSpriteSize;        // size of one intra-cloud flash, in normalized sim coords

uniform sampler2D ambientLightTex;

uniform vec2 aspectRatios; // [0] Sim       [1] canvas

#define URBAN 0
#define FIRE_FOREST 1
#define SNOW_FOREST 2
#define FOREST 3
#define INDUS 4


uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float cellHeight; // in meters

uniform float dryLapse;
uniform float sunAngle;

uniform float minShadowLight;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // Xpos   Ypos  Size   type

uniform float displayVectorField;

uniform float iterNum;
uniform bool volumetricCloudLighting;

// Set to 1.0 for the second, additive draw of this same program: that draw
// returns nothing but the intra-cloud light (see computeICLight and the draw in
// app.js) and leaves the scene alone.
uniform float icLightPass;

out vec4 fragmentColor;

#include "common.glsl"

// Lightning rods: masts standing on the terrain, placed with the Lightning Rod
// tool. (Declared after common.glsl so MAX_LIGHTNING_RODS is known.)
uniform vec2 rodPositions[MAX_LIGHTNING_RODS];
uniform int rodCount;
uniform float rodThickness; // half width of the mast, in cells
uniform float rodHeight;    // height of the mast, in cells

#include "commonDisplay.glsl"

vec4 base, water;
ivec4 wall;
float lightIntensity;

vec3 color;
float opacity = 1.0;

vec3 emittedLight = vec3(0.); // pure light, like lightning

// Intra-cloud light is not part of this pass at all: it is drawn afterwards, on
// top of the finished scene, by a second additive draw of this program (see
// computeICLight and the draw in app.js). Alpha blending can only *trade* a
// backdrop for a source, so a channel drawn in an alpha-blended fragment has to
// give up as much cloud as it is opaque - and a sunlit cloud is brighter than
// the light of a channel, so the channel lost that trade and disappeared inside
// it. An addition cannot lose: the cloud stays exactly as it is and the channel
// sits on top of it.

float shadowLight;

vec3 onLight; // extra light that lights up objects, just like sunlight and shadowlight


const vec3 bareDrySoilCol = pow(vec3(0.85, 0.60, 0.40), vec3(GAMMA));
const vec3 bareWetSoilCol = pow(vec3(0.5, 0.2, 0.1), vec3(GAMMA));
const vec3 greenGrassCol = pow(vec3(0.0, 0.7, 0.2), vec3(GAMMA));
const vec3 dryGrassCol = pow(vec3(0.843, 0.588, 0.294), vec3(GAMMA));


vec4 surfaceTexture(int index, vec2 pos)
{
#define numTextures 5.;             // number of textures in the map
  const float texRelHeight = 1. / numTextures;
  pos.y = clamp(pos.y, 0.01, 0.99); // make sure position is within the subtexture
  pos /= numTextures;
  pos.y += float(index) * texRelHeight;
  return texture(surfaceTextureMap, pos);
}


vec3 getWallColor(float depth)
{
  vec3 vegetationCol = mix(greenGrassCol, dryGrassCol, max(1.0 - water[SOIL_MOISTURE] * (1. / fullGreenSoilMoisture), 0.)); // green to brown

  vec3 bareSoilCol = mix(bareDrySoilCol, bareWetSoilCol, map_rangeC(water[SOIL_MOISTURE], 0.0, 20.0, 0.0, 1.0));

  vec3 surfCol = mix(bareSoilCol, vegetationCol, min(float(wall[VEGETATION]) / 50., 1.));

  const vec3 rockCol = vec3(0.70);                                 // gray rock

  vec3 color = mix(surfCol, rockCol, clamp(depth * 0.35, 0., 1.)); // * 0.15


  color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb;                                   // add noise texture

  color = mix(color, vec3(1.0), clamp(min(water[SNOW], fullWhiteSnowHeight) / fullWhiteSnowHeight - max(depth * 0.3, 0.), 0.0, 1.0)); // mix in white for snow cover

  return color;
}

const vec2 lightningTexRes = vec2(1250.0, 2500.0);
const float lightningTexAspect = lightningTexRes.x / lightningTexRes.y;

float calcLightningTime(float startIterNum)
{
  float lightningTime = iterNum - startIterNum;
  return lightningTime / 5.0; // 5 iterations per unit of the intensity curve
}

float lightningIntensityOverTime(float Tin, vec2 lightningPos, float intensity)
{
  float T0 = Tin - 1.;

  float repeatPeriod = map_range(random2d(lightningPos), 0., 1., 1.5, 3.0);                                            // 2.5
  float numFlashes = floor(map_range(random2d(lightningPos * 2.737250), 0., 1., 1.0, max(intensity - 0.5, 0.) * 2.0)); // 0.4

  float minT = max(T0 - (repeatPeriod * numFlashes), 0.);

  float T = max(mod(T0, repeatPeriod), minT);

  return max((1. / (0.05 + pow(T * 2.0, 3.))) - 0.005, 0.) * pow(intensity, 2.0); // fading out curve
}

// Height of whatever the bolt is landing on. A strike that was captured by a
// lightning rod ends on the rod's tip instead of on the ground plane.
float lightningGroundHeight(vec2 pos)
{
  for (int i = 0; i < MAX_LIGHTNING_RODS; i++) {
    if (i >= rodCount)
      break;
    if (abs(pos.x - rodPositions[i].x) < 1e-6 && pos.y > rodPositions[i].y)
      return rodPositions[i].y;
  }
  return 0.0;
}

vec3 displayLightning(vec2 pos, float lightningTime, float currentLightningIntensity, float groundY)
{
  float boltHeight = max(pos.y - groundY, 0.02); // cloud base down to the ground / rod tip
  vec2 lightningTexCoord = texCoord;

  lightningTexCoord.x -= mod(pos.x, 1.);

  lightningTexCoord.y = (pos.y - lightningTexCoord.y) / boltHeight; // 0 at cloud base, 1 at ground

  float scaleMult = 1. / boltHeight; // 1.0 means lightning is as tall as the simheight

  lightningTexCoord.x *= scaleMult * aspectRatios[0] / lightningTexAspect;

  lightningTexCoord.x += 0.5;                                                                                               // center lightning bolt

  if (lightningTexCoord.x < 0.01 || lightningTexCoord.x > 1.01 || lightningTexCoord.y < 0.01 || lightningTexCoord.y > 1.01) // prevent edge effect when mipmapping
    return vec3(0);

  float pixVal = texture(lightningTex, lightningTexCoord).r;

  const float mainBoltBrightness = 100000.; // 100000.

  // The whole channel, at once.
  //
  // A stepped leader is a real thing, but it is not the part of a return stroke
  // anybody sees, and drawing it as a lit stage cost more than it was worth: a
  // strike spent its first iterations with the bolt held at one fixed brightness
  // (it could not follow the flicker curve, because the curve is still near zero
  // while a leader would be crawling), so the glow on screen was static - a frozen
  // bright shape for a fifth of a second on a slow machine, before the flash it
  // was announcing had even started. A return stroke is a few tens of
  // microseconds of light: it should be there, whole, in the iteration it is
  // booked, and then flicker with the curve like every other strike.
  float brightnessThreshold = 0.95;
  currentLightningIntensity *= mainBoltBrightness;

  pixVal -= brightnessThreshold;

  pixVal = max(pixVal, 0.0);

  pixVal *= currentLightningIntensity;

  const vec3 lightningCol = vec3(0.70, 0.57, 1.0); // 0.584, 0.576, 1.0

  vec3 outputColor = max(pixVal * lightningCol, vec3(0));

  return outputColor;
}


// Intra-cloud flash.
//
// The artwork comes from lightningGenerator.js ('IC' mode): a network of
// hair-thin channels spreading through a charge layer and never reaching the
// ground. The generator draws eight different networks, one per layer of a 2D
// array texture, and every strike picks one of them - and a mirroring of it -
// from its own start iteration and position, so two flashes rarely look alike.
//
// One atlas tile is the whole flash: the tile is drawn at the size a flash
// covers on screen, so the artwork is sampled at roughly one artwork pixel per
// screen pixel and its strokes arrive as strokes. An earlier version sampled a
// quarter of a much bigger tile, which minified the artwork four to one - a
// hair then fell between screen pixels and the flash dissolved into a sprinkle
// of hot dots.
//
// The artwork lives in a 2D array texture, one layer per pattern, so each layer
// gets its own mip chain and the flash is filtered correctly at every camera
// zoom: crisp where a channel is several pixels wide, and a smooth glow where the
// whole flash is a hundred pixels across. An atlas would have needed an inset per
// tile and would have bled one pattern into the next as soon as it was mipmapped.
const float icTileCount = 8.0;
// Keep in step with icLightningTileWidth in app.js.
const float icTileWidthPx = 256.0;

// The light a channel carries per unit of artwork luminance. The artwork's own
// tone already separates a trunk (1.0) from an arm (0.60) from a hair (0.35);
// this constant only sets what one unit of that tone is worth in HDR light.
//
// It is small on purpose. The knee in computeICLight() is fed
// channel * icBrightness * icPower * icEnergy * cloudGain, which at the default
// camera is about 10x the artwork tone (icEnergy 2.56 x cloud gain 3), so the
// constant has to be well below one for the tiers to land apart instead of all
// arriving as the same pure white: at 0.5 a trunk reaches 0.95 of the knee, an
// arm 0.75 and a hair 0.5, which is a hierarchy the eye can see.
const float icBrightness = 0.58;

// ---------------------------------------------------------------- the halo ---
//
// A cloud-to-ground bolt gets its glow for free. It is written at a hundred
// thousand HDR units, so the two percent of the frame that the bloom pyramid
// keeps is still blinding, and that smeared-out brightness is what the eye reads
// as the bolt's halo. An intra-cloud flash cannot be written that way: its pass
// is added over a finished, sunlit cloud, where anything past 1.0 is clipped and
// a flash of clipped white is a slab with no channels left in it.
//
// So the halo is drawn here, out of the same artwork, and built the way the bloom
// pyramid builds one: by averaging the tile over larger and larger areas, which
// is exactly what the hardware mip chain already holds. That average is not a
// stand-in for the light, it *is* the light - it is the share of the flash's ink
// that falls in that area - so a trunk glows hard, a hair barely, and the halo
// follows the shape of the network instead of hanging around it as a blob.
//
// Three radii, because one radius never looks like light: a flare of a couple of
// screen pixels right on a channel (a lens effect, so it is measured in screen
// pixels), the light a channel scatters into the cloud it is in, and a bed of
// light over half a kilometre of cloud that the whole network sits in - the part
// that reads as a cloud lit from the inside.
//
// The weights are counterweights to the averaging: a ring four times wider has a
// mean about four times smaller, so it needs a bigger weight just to sit at the
// same brightness. And all three together are deliberately kept far below the
// channels they surround - the halo is light *around* the network, and a halo as
// bright as a channel would fill the gaps between channels and turn the flash
// into the bright slab this whole pass exists to avoid.
// ------------------------------------------------ the glare on a channel ---
//
// The halo above is light *around* the network and it has to stay dimmer than the
// channels it surrounds, or the gaps between channels fill in and the flash turns
// into the white slab this whole pass exists to avoid. A channel's own glare is
// the opposite kind of light: it is the part of a flash that is brighter than the
// frame can hold, and it is what a cloud-to-ground bolt has always had (it is
// written at a hundred thousand HDR units and the bloom's bright pass - knee 32 -
// turns that surplus into the halo around it).
//
// An intra-cloud flash could never have one, because everything it wrote was
// squeezed under 1.0 before it reached the buffer. So the two rings that hug a
// channel - a flare a couple of screen pixels wide and the light it scatters a few
// pixels out - are lifted to their own ceiling instead, where the bright pass can
// see them. The wide ring, the cloud glow and the tiers of the network itself are
// not lifted, so the glow hangs on the channels and not on the whole sprite.
const vec3 icFlareCol = vec3(0.86, 0.90, 1.0); // hotter and less blue than the halo
const float icFlareBoost = 55.0;               // lifts a channel's glare past white
const float icFlareCeiling = 220.0;            // its own ceiling, far inside a 16F texel

const float icGlowTightBias = 1.5; // extra LOD on top of the sampling LOD
const float icGlowMidLod = 4.0;
const float icGlowWideLod = 6.5;
const float icGlowTight = 0.32;
const float icGlowMid = 0.25;
const float icGlowWide = 0.30;
// Scattered light is colder than the channel it came from - the cloud absorbs and
// re-emits it, and it is the diffuse part that reaches the eye. It is the same
// family of colour as the CG bolt's lightningCol, only bluer: intra-cloud light
// arrives through the cloud, which takes the violet out of it.
const vec3 icGlowCol = vec3(0.64, 0.70, 1.0);

// Returns the flash in .rgb and the channel glare in .a. The two go through
// different ceilings in computeICLight(): the flash has to stay inside the range a
// thin channel can carry, while the glare is the part that is allowed past white
// so that a channel carries a glow the way a cloud-to-ground bolt does.
vec4 displayICLightning(vec2 pos, float lightningTime, float currentLightningIntensity,
                        float tileSeed, float artPerPixel)
{
  // The flash is always the same size and orientation on screen: the artwork is
  // deliberately never stretched, so a flash does not swim while it is on. Its
  // variety comes from the eight tiles and the mirroring below.
  const float revealSpeed = 2.4;

  // position inside the flash, -0.5 .. 0.5
  vec2 local = vec2((texCoord.x - mod(pos.x, 1.)) / max(icSpriteSize.x, 1e-5),
                    (texCoord.y - pos.y) / max(icSpriteSize.y, 1e-5));

  // The halo reaches a little past the sprite, so this is wider than the artwork
  // rectangle: the light has faded out to nothing by 0.62 anyway.
  float reach = max(abs(local.x), abs(local.y));
  if (reach > 0.62)
    return vec4(0.0);

  // Which of the eight networks this strike uses, and which way round it is
  // mirrored. The hash runs on the strike's own start iteration and position, so
  // it is fixed for the whole flash and different for the next one. Eight tiles
  // times four mirrorings is thirty-two looks out of a texture of eight.
  float tileHash = fract(sin(tileSeed * 12.9898 + dot(pos, vec2(41.7, 91.3))) * 43758.5453);
  float layer = min(floor(tileHash * icTileCount), icTileCount - 1.0);
  float look = floor(fract(tileHash * 17.31) * 4.0);
  vec2 artCoord = vec2(mod(look, 2.0) < 0.5 ? local.x : -local.x,
                       look < 2.0 ? local.y : -local.y);
  vec2 uv = vec2(artCoord.x + 0.5, 0.5 - artCoord.y);

  // The level the artwork is sampled at is the one the screen can resolve, worked
  // out from artPerPixel rather than from fwidth() inside this loop: a screen
  // pixel covers artPerPixel artwork pixels, so one texel of level log2() of it
  // is a screen pixel. Every fetch below is an explicit LOD for the same reason -
  // derivatives are undefined inside a loop that skips slots.
  float artLod = log2(max(artPerPixel, 1e-4));
  float channel = max(textureLod(icLightningTex, vec3(uv, layer), artLod).r, 0.0);

  // The flash spreads outwards from the origin: channels appear at the centre
  // first and the outer branches light up as lightningTime grows.
  float radial = reach * 2.0; // 0 centre .. 1 at the sprite edge
  float spread = clamp(lightningTime * revealSpeed, 0.0, 1.0);
  float reveal = clamp((spread - radial * 0.9) / 0.3, 0.0, 1.0);

  // The halo of a flash runs ahead of its channels and outlives them: the cloud
  // around a channel starts to glow a little before the channel itself arrives,
  // and the light it has scattered lingers as the flash decays. Slightly wider
  // and slightly earlier than the reveal above, so the flash is a growing ball of
  // light with channels in it instead of a hard-edged rectangle of artwork.
  float haloReveal = clamp((spread * 1.30 - radial * 0.55) / 0.45, 0.0, 1.0);
  if (reveal <= 0.0 && haloReveal <= 0.0)
    return vec4(0.0);

  // Fade the outer part of the sprite out, so a branch never ends in a hard cut
  // where the artwork stops. The artwork keeps a margin of its own, so this only
  // has to soften the last few percent.
  vec2 edge = abs(local) * 2.0; // 0 at the centre, 1 at the sprite border
  float window = (1.0 - smoothstep(0.80, 0.99, edge.x)) * (1.0 - smoothstep(0.80, 0.99, edge.y));

  // The halo is allowed its margin outside the sprite, and is only cut where the
  // light has already run out - a hard edge here would be a visible box.
  float glowWindow = 1.0 - smoothstep(1.00, 1.24, max(edge.x, edge.y));

  // A channel loses light to filtering as the sprite shrinks, so the artwork is
  // scaled by how many artwork pixels one screen pixel covers. The clamp is
  // deliberately narrow: outside it this becomes a licence to overdrive the
  // whole flash, and an overdriven flash clips to one flat white slab in which
  // the thickness of a channel means nothing.
  float icEnergy = clamp(artPerPixel, 1.0, 3.0);

  // The strike intensity curve peaks around 20 for a couple of iterations.
  // Driving the artwork straight from it pushed every channel past white at the
  // peak, so the peak is compressed: the flash still flickers, but it stays in
  // the range a thin channel can carry.
  float icPower = currentLightningIntensity / (1.0 + currentLightningIntensity * 0.85);

  float core = channel * reveal * window;

  // The halo. The widest ring is fetched first and on its own: most of the screen
  // is nowhere near a flash, and for those pixels it is the only fetch paid.
  float glow = 0.0;
  float glare = 0.0;
  if (haloReveal > 0.0) {
    float wide = textureLod(icLightningTex, vec3(uv, layer), icGlowWideLod).r;
    glow = wide * icGlowWide;
    if (wide > 0.0 || channel > 0.0) {
      float mid = textureLod(icLightningTex, vec3(uv, layer), icGlowMidLod).r;
      // the flare is measured in screen pixels, so it keeps the artwork's own
      // sampling LOD and only adds a couple of levels to it
      float tight = textureLod(icLightningTex, vec3(uv, layer), artLod + icGlowTightBias).r;
      glow += mid * icGlowMid;
      glow += tight * icGlowTight;
      // The two rings that hug a channel are also the glare on it: this is the
      // light that is allowed past white (see icFlareCeiling), so a channel
      // blooms the way a bolt does. The wide ring is deliberately not in here -
      // it is the cloud lit from the inside, and that has to stay under the
      // channels or the whole sprite turns into the white slab this pass exists
      // to avoid.
      glare = tight * icGlowTight + mid * icGlowMid * 0.55;
    }
    glow *= haloReveal * glowWindow;
    glare *= haloReveal * glowWindow;
  }

  // The channel is white and the light around it is cold. Adding them keeps the
  // channel readable inside its own halo, which is the whole difference between
  // a flash and a bright smear.
  vec3 light = vec3(core) + icGlowCol * glow;
  return vec4(light * icPower * icBrightness * icEnergy, glare * icPower * icBrightness * icEnergy);
}


// Light of every running intra-cloud flash, and nothing else.
//
// This is drawn as a second, additive pass over the finished scene (see the draw
// in app.js), so it is added to whatever a pixel already shows and can neither
// replace a cloud nor darken anything. No cloud mask and no depth attenuation:
// an intra-cloud flash is *inside* the cloud, so the cloud it was born in is not
// something the light has to get through - it is the medium that scatters it
// towards the viewer, and it is also what the channel has to be readable
// against.
//
// Between the flashes the pass returns zero and the additive draw is a no-op,
// which is why it can safely run every frame.
vec3 computeICLight()
{
  vec3 icLight = vec3(0.0);
  float icGlare = 0.0; // light past white, on the channels themselves
  float cgFlash = 0.0; // the frame-wide light of a cloud-to-ground stroke

  // How many artwork pixels one screen pixel covers, worked out once, outside
  // the slot loop: screen-space derivatives inside a loop with `continue` are
  // undefined, and every flash shares the same sprite scale anyway.
  float artPerPixel = fwidth(texCoord.x) * icTileWidthPx / max(icSpriteSize.x, 1e-5);
  for (int slot = 0; slot < LIGHTNING_SLOTS; slot++) {
    vec4 lightningData = texelFetch(lightningDataTex, ivec2(slot, 0), 0);
    float lightningStartIterNum = lightningData[START_ITERNUM];
    if (lightningStartIterNum <= 0.0)
      continue; // never used / released
    if (iterNum < lightningStartIterNum || iterNum >= strikeAnimEnd(lightningData))
      continue; // not started yet, or its own animation is over
    vec2 lightningPos = lightningData.xy;
    float lightningTime = calcLightningTime(lightningStartIterNum);

    if (lightningData[INTENSITY] > LIGHTNING_IC_MAX_INTENSITY) {
      // A cloud-to-ground stroke draws its own bolt in the scene pass, but the
      // light it throws over the *frame* has to be added here: this pass runs over
      // the finished picture, so it reaches the sky above the cloud deck as well,
      // which the scene pass (clouds and terrain only) cannot.
      float cgIntensity = lightningIntensityOverTime(lightningTime + 1.0, lightningPos, lightningData[INTENSITY]);
      cgFlash = max(cgFlash, cgIntensity);
      continue;
    }

    // The curve starts one unit in: no strike has a leader stage to climb out of,
    // so a flash is at its peak brightness in the iteration it is booked and the
    // curve is what the player sees from the first frame on (strikeAnimEnd knows).
    float icIntensity = lightningIntensityOverTime(lightningTime + 1.0, lightningPos, lightningData[INTENSITY]);
    if (icIntensity <= 0.0)
      continue;

    vec4 ic = displayICLightning(lightningPos, lightningTime, icIntensity,
                                 lightningStartIterNum * 0.6180339 + float(slot) * 11.7,
                                 artPerPixel);
    icLight += ic.rgb;
    icGlare += ic.a;
  }

  if (dot(icLight, vec3(1.0)) <= 0.0 && icGlare <= 0.0 && cgFlash <= 0.0)
    return vec3(0.0); // nothing running: no cloud sample needed

  // The light a cloud-to-ground stroke throws over the whole frame, including the
  // part of the sky the scene pass never touches. It is bounded by its own ceiling
  // so that a storm-core stroke covers the frame instead of blowing it out to a
  // value the post-processing has to guess about.
  const vec3 icScreenFlashCol = vec3(0.55, 0.62, 1.0);
  const float icScreenFlashGain = 0.020;
  const float icScreenFlashCeiling = 1.60;
  vec3 screenLight = icScreenFlashCol * (icScreenFlashCeiling *
                     (1.0 - exp(-cgFlash * icScreenFlashGain / icScreenFlashCeiling)));

  // Seen through the cloud it is in. A channel has to stay readable against the
  // cloud around it, and a sunlit cloud is ~1.0 in HDR units - about 230/255 on
  // screen - while a thin channel only carries a fraction of that. How much
  // light gets from a flash to the viewer grows with the amount of cloud in the
  // way, because that is the medium scattering it, so the light is scaled by the
  // cloud it is seen through. In clear air there is nothing to scatter and no
  // bright backdrop to beat, so the gain is 1 there.
  // Same smooth 2x2 water sample the scene pass uses, so the gain follows the
  // cloud instead of stepping from cell to cell along a channel.
  float cloudWater = max(bilerpWallVis(waterTex, wallTex, fragCoord)[CLOUD], 0.0);
  float cloudDensity = cloudWater * 13.6; // same scale as getAirColor
  float cloudOpacity = clamp(1.0 - 1.0 / (1.0 + cloudDensity), 0.0, 1.0);
  const float icCloudScatter = 2.0;
  vec3 gained = max(icLight, vec3(0.0)) * (1.0 + icCloudScatter * cloudOpacity);

  // ... and then compressed with a soft knee before it reaches the frame.
  //
  // The default display path has no tone mapping (ACES off), so anything above
  // 1.0 in HDR is simply clipped: without a knee, a bright trunk and a faint
  // hair both arrive as the same pure white and the channel structure - the one
  // thing that makes a flash look like a flash - is thrown away exactly where
  // the flash is brightest. 1 - exp(-x) passes small values almost untouched,
  // gives the trunk a shoulder, and cannot exceed 1, so every tier stays a
  // different colour on screen instead of all of them clipping together.
  vec3 flashLight = vec3(1.0) - exp(-gained);

  // The glare on the channels goes through a second, much higher ceiling.
  //
  // A cloud-to-ground bolt is written at a hundred thousand HDR units and gets a
  // halo out of the bloom's bright pass, which only sees light above its knee
  // (32). An intra-cloud flash could never have one: everything it wrote was
  // squeezed under 1.0 by the knee above, and the frame only carries halo-making
  // light above 32. So the two rings that hug a channel - a screen-pixel flare
  // and the light it scatters a few pixels out - are kept out of that knee and
  // written against their own ceiling instead. They are the glare of the channel,
  // the part that is allowed to be brighter than white, and the bright pass picks
  // them up; the flash, the wide cloud glow and the tiers above them are not
  // touched by it, so the network keeps its structure instead of turning into the
  // white slab this pass exists to avoid.
  vec3 glare = icFlareCol * icGlare * icFlareBoost * (1.0 + icCloudScatter * cloudOpacity);
  vec3 glareLight = vec3(icFlareCeiling) * (1.0 - exp(-max(glare, vec3(0.0)) / icFlareCeiling));

  return flashLight + glareLight + screenLight;
}


float saturate(float x) { return min(1.0, max(0.0, x)); }
vec3 saturate(vec3 x) { return min(vec3(1., 1., 1.), max(vec3(0., 0., 0.), x)); }


vec3 bump3y(vec3 x, vec3 yoffset)
{
  vec3 y = vec3(1., 1., 1.) - x * x;
  y = saturate(y - yoffset);
  return y;
}
vec3 spectral_zucconi(float w)
{
  // w: [400, 700] wavelenght(nm)
  // x: [0,   1]
  float x = saturate((w - 400.0) / 300.0);
  const vec3 cs = vec3(3.54541723, 2.86670055, 2.29421995);
  const vec3 xs = vec3(0.69548916, 0.49416934, 0.28269708);
  const vec3 ys = vec3(0.02320775, 0.15936245, 0.53520021);
  return bump3y(cs * (x - xs), ys);
}


vec4 getAirColor(vec2 fragCoordIn)
{
  vec2 bndFragCoord = vec2(fragCoordIn.x, clamp(fragCoordIn.y, 0., resolution.y)); // bound y within range
  base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
  wall = texture(wallTex, bndFragCoord * texelSize);                               // texCoord
  water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  lightIntensity = texture(lightTex, bndFragCoord * texelSize)[0] / standardSunBrightness;

  ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

  float realTemp = potentialToRealT(base[TEMPERATURE]);

  bool nightTime = abs(sunAngle) > 85.0 * deg2rad; // false = day time

  shadowLight = minShadowLight;

  // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging

  float cloudwater = water[CLOUD];

  vec3 cloudCol = vec3(1.0 / (cloudwater * 0.005 + 1.0)); // 0.10 white to black

  float cloudDensity = max(cloudwater * 13.6, 0.0);

  float totalDensity = cloudDensity + water[PRECIPITATION] * 0.8; // visualize precipitation

  // float cloudOpacity = clamp(cloudwater * 4.0, 0.0, 1.0);
  float cloudOpacity = clamp(1.0 - (1.0 / (1. + totalDensity)), 0.0, 1.0);

  if (volumetricCloudLighting && cloudOpacity > 0.01) {
    vec2 sunDirection = vec2(cos(sunAngle), sin(sunAngle));
    float opticalDepth = 0.0;
    for (int rayStep = 1; rayStep <= 6; rayStep++) {
      vec2 sampleCoord = clamp(
        bndFragCoord + sunDirection * float(rayStep) * 4.0,
        vec2(0.5),
        resolution - vec2(0.5)
      );
      float sampleCloud = max(texture(waterTex, sampleCoord * texelSize)[CLOUD], 0.0);
      opticalDepth += sampleCloud * 0.12;
    }

    float lightTransmission = exp(-opticalDepth);
    vec2 neighborOpacity = vec2(
      clamp(1.0 - 1.0 / (1.0 + max(texture(waterTex, texCoordXmY0)[CLOUD], 0.0) * 13.6), 0.0, 1.0),
      clamp(1.0 - 1.0 / (1.0 + max(texture(waterTex, texCoordXpY0)[CLOUD], 0.0) * 13.6), 0.0, 1.0)
    );
    vec2 verticalOpacity = vec2(
      clamp(1.0 - 1.0 / (1.0 + max(texture(waterTex, texCoordX0Ym)[CLOUD], 0.0) * 13.6), 0.0, 1.0),
      clamp(1.0 - 1.0 / (1.0 + max(texture(waterTex, texCoordX0Yp)[CLOUD], 0.0) * 13.6), 0.0, 1.0)
    );
    float cloudEdge = length(vec2(neighborOpacity.x - neighborOpacity.y,
                                  verticalOpacity.x - verticalOpacity.y));
    float rimLight = smoothstep(0.015, 0.18, cloudEdge) * lightTransmission *
                     clamp(lightIntensity, 0.0, 1.0);
    float twilight = 1.0 - smoothstep(0.05, 0.65, cos(sunAngle));
    vec3 sunlightTint = mix(vec3(1.0, 0.94, 0.82), vec3(1.0, 0.57, 0.34), twilight);
    vec3 shadedCloud = cloudCol * mix(vec3(0.48, 0.59, 0.76), sunlightTint,
                                      0.28 + 0.72 * lightTransmission);
    shadedCloud += sunlightTint * rimLight * 0.65;
    cloudCol = mix(cloudCol, shadedCloud, 0.9);
  }

  const vec3 smokeThinCol = vec3(0.8, 0.51, 0.26);
  const vec3 smokeThickCol = vec3(0., 0., 0.);


  float smokeOpacity = clamp(1. - (1. / (water[SMOKE] + 1.)), 0.0, 1.0);
  float fireIntensity = clamp((smokeOpacity - 0.8) * 25., 0.0, 1.0);

  vec3 fireCol = hsv2rgb(vec3(fireIntensity * 0.008, 0.98, 5.0)) * 1.0; // 1.0, 0.7, 0.0

  vec3 smokeOrFireCol = mix(mix(smokeThinCol, smokeThickCol, smokeOpacity), fireCol, fireIntensity);

  shadowLight += fireIntensity * 2.5;                                                                                 // 1.5

  float opacity = 1. - (1. - smokeOpacity) * (1. - cloudOpacity);                                                     // alpha blending
  vec3 color = (smokeOrFireCol * smokeOpacity / opacity) + (cloudCol * cloudOpacity * (1. - smokeOpacity) / opacity); // color blending


#define lightningOnLightBrightness 0.004  // 0.002
#define lightningSkyLightBrightness 0.0022 // the wide lobe of the same flash
// How much of the frame a cloud-to-ground stroke lights.
//
// A bolt drawn on its own, with a halo around it, reads as a spark in a dark room.
// A return stroke is a current of tens of kiloamps over a channel some kilometres
// long, and what a player recognises as lightning is the whole sky going up with
// it: the cloudscape jumps several stops and every shadow in the scene is redrawn
// by the flash. That is this number. It is driven by the strike's own intensity
// curve, so a weak stroke lifts the frame a little and a storm-core stroke covers
// it, and it only ever *adds* light.
#define lightningScreenFlashBrightness 0.010

  // Every strike in the slot array is drawn until its own animation is over.
  // Slots are independent, so a new strike never truncates a running one.
  vec3 lightningBoltLight = vec3(0.0); // cloud-to-ground strokes
  float screenFlash = 0.0;             // the frame-wide light of the strongest stroke
  for (int slot = 0; slot < LIGHTNING_SLOTS; slot++) {
    vec4 lightningData = texelFetch(lightningDataTex, ivec2(slot, 0), 0);
    float lightningStartIterNum = lightningData[START_ITERNUM];
    if (lightningStartIterNum <= 0.0)
      continue;                                              // never used / released
    // its own animation, not the longest one there can be: a flash is drawn for
    // exactly as long as it has light (see strikeAnimEnd in common.glsl)
    if (iterNum < lightningStartIterNum || iterNum >= strikeAnimEnd(lightningData))
      continue;

    vec2 lightningPos = lightningData.xy;
    float lightningTime = calcLightningTime(lightningStartIterNum);
    // One unit in, for both kinds: there is no leader stage to climb out of, so a
    // strike is at its peak brightness in the iteration it is booked and the curve
    // is what the player sees from the first frame on (see strikeAnimEnd).
    float currentLightningIntensity = lightningIntensityOverTime(lightningTime + 1.0, lightningPos, lightningData[INTENSITY]);
    if (currentLightningIntensity <= 0.0)
      continue;

    // Cloud-to-ground strokes light the scene here; intra-cloud flashes are the
    // additive pass, so they only contribute their light-on-objects term below.
    // The strongest running stroke also sets how much of the frame is lit: `max`
    // rather than a sum, because six strikes at once must not light the sky six
    // times over.
    if (lightningData[INTENSITY] > LIGHTNING_IC_MAX_INTENSITY) {
      lightningBoltLight += displayLightning(lightningPos, lightningTime, currentLightningIntensity, lightningGroundHeight(lightningPos));
      screenFlash = max(screenFlash, currentLightningIntensity);
    }

    // The light a strike throws on the clouds around it: one tight lobe that
    // blows out the cloud right next to the channel, and one wide lobe that lifts
    // the whole sky it is in. The wide lobe is what makes a return stroke read as
    // brighter than white rather than as a bright line: the surplus has to go
    // somewhere the eye can see it, and a cloud is the surface it lands on. Both
    // lobes scale with the strike's own intensity, so a weak flash only lights its
    // own neighbourhood.
    vec2 dist = vec2(lightningPos.x - texCoord.x, max((abs(lightningPos.y / 2. - texCoord.y) - 0.1), 0.));
    dist.x *= aspectRatios[0];
    float distanceSquared = pow(length(dist), 2.);
    float lightningOnLight = lightningOnLightBrightness / (distanceSquared + 0.03);
    lightningOnLight += lightningSkyLightBrightness / (distanceSquared + 0.45);
    lightningOnLight *= currentLightningIntensity;
    onLight += vec3(lightningOnLight);
  }

  // ... and the light that is no longer local to one strike. This is added to
  // `onLight`, which multiplies the scene's own colour, so a flash brightens what
  // is there (cloud, terrain, smoke) instead of painting a flat white over it, and
  // the structure of the cloudscape survives the flash.
  if (screenFlash > 0.0)
    onLight += vec3(0.50, 0.58, 1.0) * (screenFlash * lightningScreenFlashBrightness);

  emittedLight += lightningBoltLight / (1. + cloudDensity * 100.0);

  return vec4(color, opacity);
}

float rand(float n) { return fract(sin(n) * 43758.5453123); }

void main()
{
  // Intra-cloud light pass: nothing but the flash light, added on top of the
  // finished scene by an additive draw (gl.blendFunc(gl.ONE, gl.ONE) in app.js).
  // Everything the scene pass does - lighting, clouds, terrain - is skipped.
  if (icLightPass > 0.5) {
    // Clamped through the same ceiling as the scene: an intra-cloud flash lives
    // far below it, so nothing about its look changes, but no sample it writes
    // can be infinite either.
    fragmentColor = vec4(softHdrClamp(computeICLight()), 0.0);
    return;
  }

  color = vec3(0.0);
  opacity = 1.0;
  emittedLight = vec3(0.0);
  onLight = vec3(0.0);

  vec2 bndFragCoord = vec2(fragCoord.x, clamp(fragCoord.y, 0., resolution.y)); // bound y within range
  base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
  wall = texture(wallTex, bndFragCoord * texelSize);                           // texCoord
  water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  lightIntensity = texture(lightTex, bndFragCoord * texelSize)[0] / standardSunBrightness;

  ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

  float realTemp = potentialToRealT(base[TEMPERATURE]);

  bool nightTime = abs(sunAngle) > 85.0 * deg2rad; // false = day time

  shadowLight = minShadowLight;

  // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging

  float cloudwater = water[CLOUD];

  if (texCoord.y < 0.) {                                     // < texelSize.y below simulation area

    float depth = float(-wall[VERT_DISTANCE]) - fragCoord.y; // -1.0?

    color = getWallColor(depth);

    lightIntensity = texture(lightTex, vec2(texCoord.x, texelSize.y))[0] / standardSunBrightness; // sample lowest part of sim area
    lightIntensity *= pow(0.5, -fragCoord.y);                                                     // 0.5 should be same as in lightingshader deeper is darker

  } else if (texCoord.y > 1.0) {                                                                  // above simulation area
    // color = vec3(0); // no need to set
    opacity = 0.0;                  // completely transparent
  } else if (wall[DISTANCE] == 0) { // is wall
                                    // color = getWallColor(texCoord);

    ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
    ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

    switch (wall[TYPE]) {
      // case WALLTYPE_INERT:
      //   color = vec3(0, 0, 0);
      //   break;

    case WALLTYPE_RUNWAY:

      if (wall[VERT_DISTANCE] == 0) {
        vec2 modTexCoord = mod(texCoord * resolution, 1.0);

        color = vec3(0.1);
        color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb; // add noise texture

        if (length(modTexCoord - vec2(0.7, 0.97)) < 0.03) {                                               // side lights
          onLight += vec3(1., 0.8, 0.3) * 300.0;
        }

        if (abs(mod(-iterNum - floor(texCoord.x * resolution.x), 150.0)) < 1.0 && length(modTexCoord - vec2(0.2, 0.98)) < 0.02) {
          onLight += vec3(0., 1.0, 0.) * 5000.0;
        }

        break;
      }

    case WALLTYPE_URBAN:
    case WALLTYPE_INDUSTRIAL:
    case WALLTYPE_FIRE:
    case WALLTYPE_LAND:

      // horizontally interpolate depth value
      float interpDepth = mix(mix(float(-wallXmY0[VERT_DISTANCE]), float(-wall[VERT_DISTANCE]), clamp(fract(fragCoord.x) + 0.5, 0.5, 1.)), float(-wallXpY0[VERT_DISTANCE]), clamp(fract(fragCoord.x) - 0.5, 0., 0.5));
      float depth = interpDepth - fract(fragCoord.y); // - 1.0 ?

      color = getWallColor(depth);

      break;
    case WALLTYPE_WATER:

      // Precomputed values (tweak to taste)
      // Frequencies
      const int numWaveComp = 5;
      const float freqs[numWaveComp] = float[numWaveComp](2.3, 3.7, 5.1, 7.6, 21.7);
      // Amplitudes
      const float amps[numWaveComp] = float[numWaveComp](0.05, 0.03, 0.02, 0.015, 0.004);
      // Speeds
      const float speeds[numWaveComp] = float[numWaveComp](0.006, 0.011, 0.018, 0.025, 0.05);
      // Phases (in radians)
      const float phases[numWaveComp] = float[numWaveComp](1.2, 3.9, 0.7, 5.1, 3.1);

      // Sum up the components
      float waveSignalL = 0.0;
      float waveSignalR = 0.0;

      for (int i = 0; i < numWaveComp; i++) {
        waveSignalL += sin(fragCoord.x * freqs[i] + iterNum * speeds[i] + phases[i]) * amps[i];
        waveSignalR += sin(fragCoord.x * freqs[i] - iterNum * speeds[i] + phases[i]) * amps[i];
      }

      vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);
      float windSpeed = baseX0Yp[VX] * 10.;

      // combine based on wind direction
      float waterLevel = 0.8 + waveSignalL * max(-windSpeed, 0.) + waveSignalR * max(windSpeed, 0.);

      if (wall[VERT_DISTANCE] == 0 && fract(fragCoord.y) > waterLevel) { // air
        vec4 airColor = getAirColor(fragCoord + vec2(0., 0.5));

        opacity = airColor.a;
        color = airColor.rgb;
      } else {
        color = vec3(0, 0.5, 1.0); // water
      }

      // draw 45° slopes under water

      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);

      if (wallXmY0[DISTANCE] == 0 && wallXmY0[TYPE] != WALLTYPE_WATER && (fragCoord.y < 1. || wallX0Ym[TYPE] != WALLTYPE_WATER)) { // wall to the left and below
        if (localX + localY < 1.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
        }
      }
      if (wallXpY0[DISTANCE] == 0 && wallXpY0[TYPE] != WALLTYPE_WATER && (fragCoord.y < 1. || wallX0Ym[TYPE] != WALLTYPE_WATER)) { // wall to the right and below
        if (localY - localX < 0.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
        }
      }

      break;
    }
  } else { // air

    vec4 airColor = getAirColor(fragCoord);

    opacity = airColor.a;
    color = airColor.rgb;


    vec2 rainbowCenter = vec2(0.0, -1.5 + abs(sunAngle) * 0.60);

    float centerDist = length(onScreenUV - rainbowCenter) * 1.3;

    const float cameraHeight = 1.0;

    float angle = atan(centerDist / cameraHeight) * rad2deg;

    float waveLength = map_range(angle, 40.0, 42.0, 400., 700.);

    float rainSnowFactor = map_rangeC(KtoC(realTemp), 0.0, 5.0, 0.0, 1.0); // only rain if above freezing

    vec3 rainbowCol = spectral_zucconi(waveLength) * min(pow(lightIntensity, 2.0) * 1.9, 1.0) * min(water[PRECIPITATION] * 3.0, 1.0) * rainSnowFactor * 0.7;

    emittedLight += rainbowCol;
    opacity = max(opacity - length(rainbowCol), 0.); // remove some white rain to prevent overbrightening and increase color saturation


    if (wall[VERT_DISTANCE] >= 0 && wall[VERT_DISTANCE] < 10) { // near surface
      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);
      // ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

#define texAspect 2560. / 4096. // height / width of tree texture
#define maxTreeHeight 40.       // height in meters when vegetation max = 127
#define maxBuildingHeight 400.  // height in meters upto wich the urban texture reaches


      if (wallX0Ym[TYPE] == WALLTYPE_URBAN) {

        float heightAboveGround = localY + float(wall[VERT_DISTANCE] - 1);

        float urbanTexHeightNorm = maxBuildingHeight / cellHeight; // example: 200 / 40 = 5

        float urbanTexCoordX = mod(fragCoord.x, resolution.x) * texAspect / urbanTexHeightNorm;
        float urbanTexCoordY = heightAboveGround / urbanTexHeightNorm;

        // urbanTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // building height

        urbanTexCoordY = 1.0 - urbanTexCoordY;

        vec4 texCol = surfaceTexture(URBAN, vec2(urbanTexCoordX, urbanTexCoordY));
        if (texCol.a > 0.5) { // if not transparent

          if (nightTime) {
            shadowLight = 1.0;                 // city lights
            texCol.rgb *= vec3(1.0, 0.8, 0.5); // yellowish windows
          } else {                             // day time
            texCol.rgb *= vec3(0.8, 0.9, 1.0); // Blueish windows

            if (length(texCol.rgb) < 0.1)
              texCol.rgb = texture(noiseTex, fragCoord * 0.3).rgb * 0.3;
          }
          color = texCol.rgb;
          opacity = texCol.a;
        }
      } else if (wallX0Ym[TYPE] == WALLTYPE_INDUSTRIAL) {

        float heightAboveGround = localY + float(wall[VERT_DISTANCE] - 1);

        float urbanTexHeightNorm = maxBuildingHeight / cellHeight; // example: 200 / 40 = 5

        float urbanTexCoordX = mod(fragCoord.x, resolution.x) * texAspect / urbanTexHeightNorm;
        float urbanTexCoordY = heightAboveGround / urbanTexHeightNorm;

        // urbanTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // building height

        urbanTexCoordY = 1.0 - urbanTexCoordY;

        vec4 texCol = surfaceTexture(INDUS, vec2(urbanTexCoordX, urbanTexCoordY));
        if (texCol.a > 0.5) { // if not transparent

          if (nightTime) {
            shadowLight = 1.0;                 // city lights
            texCol.rgb *= vec3(1.0, 0.8, 0.5); // yellowish windows
          } else {                             // day time
            texCol.rgb *= vec3(0.8, 0.9, 1.0); // Blueish windows

            if (length(texCol.rgb) < 0.1)
              texCol.rgb = texture(noiseTex, fragCoord * 0.3).rgb * 0.3;
          }
          color = texCol.rgb;
          opacity = texCol.a;
        }
      }


      if (wall[VERT_DISTANCE] == 1) {                                                 // 1 above surface
                                                                                      //  if (wallX0Ym[VERT_DISTANCE] == 0) {

        float treeTexHeightNorm = maxTreeHeight / cellHeight;                         // example: 40 / 120 = 0.333

        float treeTexCoordY = localY / treeTexHeightNorm;                             // full height trees

        treeTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // apply trees height depending on vegetation

        float treeTexCoordX = fragCoord.x * texAspect / treeTexHeightNorm;            // static scaled trees

        float heightAboveGround = localY / treeTexHeightNorm;

        treeTexCoordX -= base.x * heightAboveGround * 1.00; // 2.5  trees waving with the wind effect

        treeTexCoordX *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY = 1. - treeTexCoordY;                 // texture is upside down

        vec4 texCol = vec4(0.0);
        if (wallX0Ym[TYPE] == WALLTYPE_LAND || wallX0Ym[TYPE] == WALLTYPE_URBAN) { // land below
          vec4 surfaceWater = texture(waterTex, texCoordX0Ym);                     // snow on land below
          float snow = surfaceWater[SNOW];
          if (snow * 0.01 / cellHeight > heightAboveGround)
            texCol = vec4(vec3(1.), 1.);                                                                                                                          // show white snow layer above ground
          else {                                                                                                                                                  // display vegetation
            vec4 treeColor = surfaceTexture(FOREST, vec2(treeTexCoordX, treeTexCoordY));
            vec4 vegetationCol = mix(treeColor, vec4(dryGrassCol, 1.), max(0.5 - surfaceWater[SOIL_MOISTURE] * (0.5 / fullGreenSoilMoisture), 0.) * treeColor.a); // green to brown
            texCol = mix(vegetationCol, surfaceTexture(SNOW_FOREST, vec2(treeTexCoordX, treeTexCoordY)), min(snow / fullWhiteSnowHeight, 1.0));
          }
        } else if (wallX0Ym[TYPE] == WALLTYPE_FIRE) {
          texCol = surfaceTexture(FIRE_FOREST, vec2(treeTexCoordX, treeTexCoordY));
        }
        if (texCol.a > 0.5) { // if not transparent
          color = texCol.rgb;

          shadowLight = minShadowLight;        // make sure trees are dark at night

          if (wallX0Ym[TYPE] == WALLTYPE_FIRE) // fire below
            shadowLight = 1.0;

          opacity = 1. - (1. - opacity) * (1. - texCol.a); // alpha blending
        }

        // draw 45° slopes
        ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
        ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

        if (wallXmY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER) { // wall to the left and below
          if (localX + localY < 1.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
        if (wallXpY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER) { // wall to the right and below
          if (localY - localX < 0.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
      }
    }
    float arrow = vectorField(base.xy, displayVectorField);

    if (arrow > 0.5) {
      fragmentColor = vec4(vec3(1., 1., 0.), 1.);
      return; // exit shader
    }

    // color.rg += vec2(arrow);
    // color.b -= arrow;
    // opacity += arrow;
    // lightIntensity += arrow;
  }


  // ------------------------------------------------------------ lightning rods
  //
  // A rod is the one piece of scenery the player builds, so it is drawn as a real
  // air terminal instead of a stick: a wide pedestal where it is grounded, a mast
  // that tapers to a point, a cylindrical highlight down its length, and a corona
  // that lives at the tip. When a mast takes a strike the current is drawn down it
  // too - the light runs from the tip toward the ground - so a capture is
  // something to watch rather than something to infer from where the bolt landed.
  //
  // Drawn last so the mast stands in front of the terrain it is planted on, and
  // lit by the same sunlight / lightning light as everything else.
  const float rodBaseCells = 1.6;   // height of the pedestal above the ground
  const float rodCoronaReach = 3.0; // how far the tip's own glow reaches, in cells
  for (int i = 0; i < MAX_LIGHTNING_RODS; i++) {
    if (i >= rodCount)
      break;
    vec2 rod = rodPositions[i];
    float dxCells = (texCoord.x - rod.x) * resolution.x; // horizontal offset in cells
    float dyCells = (texCoord.y - rod.y) * resolution.y; // height above the surface, in cells
    if (dyCells < -1.5 || dyCells > rodHeight + rodCoronaReach)
      continue;

    // The current this mast is carrying, if it has taken a strike: the same curve
    // at the same one-unit offset the bolt itself is drawn with.
    float strikeGlow = 0.0;
    for (int slot = 0; slot < LIGHTNING_SLOTS; slot++) {
      vec4 strikeData = texelFetch(lightningDataTex, ivec2(slot, 0), 0);
      if (strikeData[START_ITERNUM] <= 0.0 || abs(strikeData.x - rod.x) > 1e-6)
        continue;
      if (iterNum < strikeData[START_ITERNUM] || iterNum >= strikeAnimEnd(strikeData))
        continue; // this strike is not running
      strikeGlow = max(strikeGlow, lightningIntensityOverTime(calcLightningTime(strikeData[START_ITERNUM]) + 1.0,
                                                              strikeData.xy, strikeData[INTENSITY]));
    }

    float alongRod = clamp(dyCells / max(rodHeight, 1.), 0., 1.);                      // 0 base .. 1 tip
    float mastWidth = max(rodThickness * mix(0.85, 0.10, pow(alongRod, 0.85)), 0.35);  // to a point at the top
    float baseWidth = max(rodThickness * mix(2.6, 0.85, clamp(dyCells / rodBaseCells, 0., 1.)), 0.6);
    float halfWidth = dyCells < rodBaseCells ? baseWidth : mastWidth;
    bool onMetal = dyCells >= -0.75 && abs(dxCells) <= halfWidth;

    if (onMetal) {
      float acrossRod = clamp(abs(dxCells) / halfWidth, 0., 1.);  // 0 centre .. 1 edge
      // Dark steel with the light coming down one side of it, so the mast reads as
      // round instead of as a flat strip, and a bright edge where it turns away.
      vec3 steel = mix(vec3(0.62, 0.67, 0.76), vec3(0.10, 0.11, 0.13), pow(acrossRod, 0.75));
      steel += vec3(0.30, 0.34, 0.42) * pow(acrossRod, 4.0);
      color = mix(steel, vec3(1.0, 0.97, 0.88), clamp(strikeGlow * 0.5, 0.0, 1.0));
      shadowLight = max(shadowLight, 0.35);                       // never fully black
      opacity = 1.0;
    }

    // The corona at the tip. It is drawn as light rather than as metal, so it
    // reaches past the mast into the air, and it is what makes a rod visible at all
    // against a night sky.
    float tipDistance = length(vec2(dxCells, dyCells - rodHeight));
    float corona = tipDistance < rodCoronaReach
      ? exp(-tipDistance / max(rodThickness * 0.9, 1.2))
      : 0.0;
    emittedLight += vec3(0.35, 0.45, 0.85) * corona * (0.30 + strikeGlow * 40.0);

    // A captured strike runs down the mast, brightest at the point it entered.
    float tipCore = smoothstep(0.80, 1.0, alongRod);
    emittedLight += vec3(0.55, 0.68, 1.0) * strikeGlow * (tipCore * 120.0 + 2500.0) * (onMetal ? 1.0 : 0.20);
  }


  float scatering = clamp(map_range(abs(sunAngle), 75. * deg2rad, 90. * deg2rad, 0., 1.), 0., 1.); // how red the sunlight is

  vec3 finalLight = sunColor(scatering) * lightIntensity;


  if (fract(cursor.w) > 0.5) {                                               // enable flashlight
    vec2 vecFromMouse = cursor.xy - texCoord;
    vecFromMouse.x *= texelSize.y / texelSize.x;                             // aspect ratio correction to make it a circle
                                                                             // shadowLight += max(1. / (1.+length(vecFromMouse)*5.0),0.0); // point light
    shadowLight += max(cos(min(length(vecFromMouse) * 5.0, 2.)) * 1.0, 0.0); // smooth flashlight
  }

  vec3 ambientLight = texture(ambientLightTex, texCoord).rgb;

  onLight += ambientLight * pow(1. - clamp(-texCoord.y * 15., 0., 1.), 2.5);


  finalLight += vec3(shadowLight) + onLight;

  /*
   * The light and the alpha both have to stay inside what the buffer can hold.
   *
   * The scene is rendered into an RGBA16F framebuffer, whose largest finite
   * value is 65504, and it is alpha blended. A CG return stroke is written at a
   * hundred thousand HDR units and more (see displayLightning), so on its own it
   * overflows the buffer to infinity, and the alpha below - length(emittedLight),
   * also in the hundred thousands - makes the blend multiply the destination by
   * (1 - alpha), i.e. by a large negative number. Both come back out of the
   * tonemap divided by itself: NaN, which the bloom, FXAA and temporal AA passes
   * then smear over the frame as dead pixels.
   *
   * softHdrClamp() (common.glsl) is the answer, and it is not a clamp: it
   * compresses the top of the range instead of cutting it off, so a stroke can
   * still be written far past white and arrive in the bloom pass brighter than
   * one that only just overflowed. That extra light is the whole of "brighter
   * than white" - the tonemap flattens everything over ~3 to white, so the only
   * place a bolt's surplus energy can show is the halo it scatters, and the halo
   * is made from this buffer. The alpha is still cut at 1: nothing is more than
   * fully opaque.
   */
  opacity = clamp(opacity + length(emittedLight), 0.0, 1.0);

  // The intra-cloud flash is not in this fragment: it is added afterwards, by
  // the additive light pass (see computeICLight), so it can never trade a cloud
  // for itself or dim what it is drawn over.
  fragmentColor = vec4(softHdrClamp(max(color * finalLight, 0.) + emittedLight), opacity);

  drawCursor(cursor, view); // over everything else
}
