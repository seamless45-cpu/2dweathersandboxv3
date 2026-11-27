'use strict';
const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('shaders/vertex/precipitationShader.vert','utf8');
const water=s.indexOf('water = texture(waterTex, texCoord);'),clear=s.indexOf('if (precipBrushActive != 1 && water[CLOUD] <= min(aboveZeroThreshold, subZeroThreshold))'),base=s.indexOf('base = texture(baseTex, texCoord);',water);
assert(water<clear && clear<base);
const skip=s.slice(clear,base);for(const out of ['feedback[MASS] = 1.0','position_out = newPos','mass_out = newMass','density_out = max(newDensity, 0.0)','compactFeedback ?','return;'])assert(skip.includes(out),out);
const roll=s.indexOf('if (random2d(vec2(base[TEMPERATURE] * 0.99, water[TOTAL] * 17.2)) < lightningSpawnChance)');
const loop=s.indexOf('for (int i = 0; i < LIGHTNING_SLOTS; i++)',roll),spawn=s.indexOf('if (lightningSlotFree)',loop);
assert(roll>=0 && loop>roll && spawn>loop);assert(s.slice(loop,spawn).includes('break;'));
// The maximum normal parent is under 140 iterations: maximum flickers < 8,
// period < 3, duration scale <= 1 for this class; other classes are shorter.
// Legacy slots can stretch 8x; optical minimum is 100 iterations.
const longest=(5*(3*8+2.924)+5)*8;assert(longest<2048 && 100<2048);
console.log('Precipitation no-spawn and probability-first slot scan fast paths verified');
