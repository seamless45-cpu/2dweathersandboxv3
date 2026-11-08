#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform sampler2D capeTex;
uniform isampler2D wallTex;
uniform vec2 resolution;
uniform vec2 texelSize;
uniform vec3 view;
uniform vec4 cursor;

out vec4 fragmentColor;

#define TYPE 0
#define DISTANCE 1
#define WALLTYPE_INERT 0
#define WALLTYPE_WATER 2

#include "commonDisplay.glsl"

vec3 capeColor(float cape)
{
  if (cape < 25.0) return vec3(0.08, 0.12, 0.34);
  if (cape < 100.0) return mix(vec3(0.08, 0.12, 0.34), vec3(0.0, 0.72, 0.92), cape / 100.0);
  if (cape < 500.0) return mix(vec3(0.0, 0.72, 0.92), vec3(0.08, 0.80, 0.28), (cape - 100.0) / 400.0);
  if (cape < 1000.0) return mix(vec3(0.08, 0.80, 0.28), vec3(0.95, 0.9, 0.08), (cape - 500.0) / 500.0);
  if (cape < 2000.0) return mix(vec3(0.95, 0.9, 0.08), vec3(1.0, 0.42, 0.04), (cape - 1000.0) / 1000.0);
  if (cape < 3000.0) return mix(vec3(1.0, 0.42, 0.04), vec3(0.9, 0.04, 0.04), (cape - 2000.0) / 1000.0);
  return mix(vec3(0.9, 0.04, 0.04), vec3(0.82, 0.25, 0.9), clamp((cape - 3000.0) / 2000.0, 0.0, 1.0));
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
    int x = int(floor(fragCoord.x));
    if (cursorWrapHorizontally)
      x = (x % int(resolution.x) + int(resolution.x)) % int(resolution.x);
    else
      x = clamp(x, 0, int(resolution.x) - 1);

    float cape = texelFetch(capeTex, ivec2(x, 0), 0).r;
    fragmentColor = vec4(capeColor(cape), 1.0);
  }

  drawCursor(cursor, view);
}
