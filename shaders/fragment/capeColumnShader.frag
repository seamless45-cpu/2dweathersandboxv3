#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform vec2 resolution;
uniform float dryLapse;
uniform float simHeight;

out vec4 fragmentColor;

#define TOTAL 0
#define DISTANCE 1
#define TEMPERATURE 3

const float gravity = 9.80665;
const float dryAdiabaticLapse = 9.8;
const float moistAdiabaticLapse = 6.0;

float realTemperature(float potentialTemperature, int y)
{
  return potentialTemperature - (float(y) / resolution.y) * dryLapse;
}

void main()
{
  int x = clamp(int(gl_FragCoord.x), 0, int(resolution.x) - 1);
  int surfaceY = -1;
  for (int y = 0; y < int(resolution.y); y++) {
    if (texelFetch(wallTex, ivec2(x, y), 0)[DISTANCE] > 0) {
      surfaceY = y;
      break;
    }
  }

  if (surfaceY < 0) {
    fragmentColor = vec4(0.0);
    return;
  }

  float surfaceTemperature = realTemperature(texelFetch(baseTex, ivec2(x, surfaceY), 0)[TEMPERATURE], surfaceY);
  float surfaceWater = max(texelFetch(waterTex, ivec2(x, surfaceY), 0)[TOTAL], 0.0);
  float dewpoint = surfaceWater < 0.00001
    ? 0.0
    : 250.0 * pow(surfaceWater, 1.0 / 17.0);
  dewpoint = min(dewpoint, surfaceTemperature);
  float lclHeight = min(max((surfaceTemperature - dewpoint) * 125.0, 0.0), simHeight);
  float cellHeight = simHeight / resolution.y;
  float cape = 0.0;
  float previousBuoyancy = 0.0;
  float previousHeight = 0.0;
  bool foundLfc = false;

  for (int y = surfaceY + 1; y < int(resolution.y); y++) {
    if (texelFetch(wallTex, ivec2(x, y), 0)[DISTANCE] == 0)
      continue;

    float height = float(y - surfaceY) * cellHeight;
    float parcelTemperature = surfaceTemperature -
      dryAdiabaticLapse * min(height, lclHeight) * 0.001 -
      moistAdiabaticLapse * max(height - lclHeight, 0.0) * 0.001;
    float environmentTemperature = realTemperature(texelFetch(baseTex, ivec2(x, y), 0)[TEMPERATURE], y);
    float buoyancy = gravity * (parcelTemperature - environmentTemperature) / max(environmentTemperature, 150.0);
    float layerDepth = height - previousHeight;

    if (!foundLfc) {
      if (buoyancy > 0.0) {
        foundLfc = true;
        if (previousBuoyancy < 0.0) {
          float positiveFraction = buoyancy / (buoyancy - previousBuoyancy);
          cape += 0.5 * buoyancy * layerDepth * positiveFraction;
        } else {
          cape += 0.5 * buoyancy * layerDepth;
        }
      }
    } else if (buoyancy > 0.0) {
      cape += 0.5 * (previousBuoyancy + buoyancy) * layerDepth;
    } else {
      float positiveFraction = previousBuoyancy / max(previousBuoyancy - buoyancy, 0.000001);
      cape += 0.5 * previousBuoyancy * layerDepth * positiveFraction;
      break;
    }

    previousBuoyancy = buoyancy;
    previousHeight = height;
  }

  fragmentColor = vec4(max(cape, 0.0), surfaceTemperature - 273.15, dewpoint - 273.15, lclHeight);
}
