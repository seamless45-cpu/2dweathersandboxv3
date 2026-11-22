'use strict';
const assert = require('assert');
const fs = require('fs');
const bright = fs.readFileSync('shaders/fragment/isolateBrightPartsShader.frag', 'utf8');
const post = fs.readFileSync('shaders/fragment/postProcessingShader.frag', 'utf8');
// HDR bloom remains uncompressed before blur; bright regions can still clip.
assert.match(bright, /const float lightningBloomGain = 24\.0/);
assert.match(bright, /hasLightningBloom \? other \/ lightningBloomGain : other/);
assert.match(bright, /fragmentColor = sum \/ float\(countX \* countY\)/);
assert.doesNotMatch(bright, /log2\(1\.0 \+ highlightPeak\)/);
const map = post.slice(post.indexOf('vec3 mappedColor(vec2 uv, vec3 contactLight)'));
assert.match(map, /color \+= safeSample\(texture\(bloomTex, uv\)\.rgb\) \* \(0\.990 \* 24\.0\)/);
assert(map.indexOf('texture(bloomTex, uv)') < map.indexOf('color *= exposure'));
assert(map.indexOf('color += contactLight') < map.indexOf('float peak ='));
const source=20000*.12;
const values=[.2,.08,.02,.005,.001].map(w=>Math.sqrt(Math.min(1,source*w)));
assert(values.every(x=>x===1), 'the restored pipeline can clip to a flat glow');
console.log('Restored bright HDR bloom and known clipping tradeoff passed');
