'use strict';
const assert = require('assert');
const fs = require('fs');
const post = fs.readFileSync('shaders/fragment/postProcessingShader.frag', 'utf8');
const map = post.slice(post.indexOf('vec3 mappedColor(vec2 uv, vec3 contactLight)'), post.indexOf('\nvec3 mappedColor(vec2 uv)'));
assert.match(map, /if \(bloomEnabled\) \{/);
assert(map.indexOf('texture(bloomTex, uv)') < map.indexOf('color /= max(1.0, peak)'));
assert.doesNotMatch(map, /color \+= \(vec3\(1.0\) - color\) \* glow/);
// Known limitation of the requested restore: normalizing an already-bright
// same-hued scene can hide the bloom contribution despite high HDR energy.
const norm = v => v.map(x=>x/Math.max(1,...v));
const scene=[4,2,1], bloom=[2,1,.5];
assert.deepStrictEqual(norm(scene.map((x,i)=>x+bloom[i])), norm(scene));
console.log('Restored HDR bloom composite and bright-background limitation passed');
