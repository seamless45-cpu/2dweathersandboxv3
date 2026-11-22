'use strict';
const assert=require('assert'),fs=require('fs');
const shader=fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
assert.match(shader,/const vec3 upstreamLightningColor = vec3\(0\.70, 0\.57, 1\.0\)/);
assert.match(shader,/return max\(peak, 0\.0\) \* upstreamLightningColor/);
assert.doesNotMatch(shader,/apparentChannelColor|whiteCore/);
console.log('Lightning channels use original upstream RGB rather than added white cores');
