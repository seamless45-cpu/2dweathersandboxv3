#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform vec2 resolution;
uniform vec2 texelSize;
uniform vec3 view;
uniform vec4 cursor;

out vec4 fragmentColor;

#define CLOUD 1
#define PRECIPITATION 2
#define TYPE 0
#define DISTANCE 1
#define WALLTYPE_INERT 0
#define WALLTYPE_WATER 2

#include "commonDisplay.glsl"

vec3 reflectivityColor(float dBZ)
{
  if (dBZ < 5.0) return vec3(0.10, 0.16, 0.28);
  if (dBZ < 10.0) return vec3(0.05, 0.75, 0.95);
  if (dBZ < 20.0) return vec3(0.05, 0.82, 0.22);
  if (dBZ < 30.0) return vec3(0.98, 0.92, 0.05);
  if (dBZ < 40.0) return vec3(1.0, 0.48, 0.04);
  if (dBZ < 50.0) return vec3(0.92, 0.04, 0.04);
  if (dBZ < 60.0) return vec3(0.92, 0.08, 0.86);
  return vec3(0.72, 0.45, 1.0);
}

void main()
{
  ivec2 cellPos = clamp(ivec2(floor(fragCoord)), ivec2(0), ivec2(resolution) - 1);
  ivec4 wall = texelFetch(wallTex, cellPos, 0);

  if (wall[DISTANCE] == 0) {
    if (wall[TYPE] == WALLTYPE_WATER)
      fragmentColor = vec4(0.03, 0.20, 0.38, 1.0);
    else if (wall[TYPE] == WALLTYPE_INERT)
      fragmentColor = vec4(0.0, 0.0, 0.0, 1.0);
    else
      fragmentColor = vec4(0.16, 0.17, 0.19, 1.0);
  } else {
    vec4 water = texelFetch(waterTex, cellPos, 0);
    float hydrometeorProxy = max(water[PRECIPITATION], 0.0) + max(water[CLOUD], 0.0) * 0.2;
    float dBZ = 10.0 * log(1.0 + hydrometeorProxy * 1000.0) / log(10.0);
    fragmentColor = vec4(reflectivityColor(dBZ), 1.0);
    if (hydrometeorProxy < 0.001)
      fragmentColor.rgb *= 0.2;
  }

  drawCursor(cursor, view);
}
