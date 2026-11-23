'use strict';
const assert=require('assert'),fs=require('fs');
const post=fs.readFileSync('shaders/fragment/postProcessingShader.frag','utf8');
const map=post.slice(post.indexOf('vec3 mappedColor(vec2 uv)'),post.indexOf('\nvoid main()'));
assert.match(map,/if \(bloomEnabled\) \{/);
assert(map.indexOf('texture(bloomTex, uv)') < map.indexOf('color *= exposure'));
assert(map.indexOf('color *= exposure') < map.indexOf('return clamp(pow('));
assert.doesNotMatch(map,/color \+= \(vec3\(1.0\) - color\) \* glow/);
// Bloom is composited in HDR, then exposure and gamma are applied before the
// canvas clips each component. Extremely bright backgrounds can still hide it.
const display=v=>v.map(x=>Math.min(1,Math.pow(x,1/2.2)));
const scene=[4,2,1],bloom=[2,1,.5];
assert.deepStrictEqual(display(scene.map((x,i)=>x+bloom[i])),display(scene));
const dim=[.04,.02,.01];
assert(display(dim.map((x,i)=>x+bloom[i]*.01))[0]>display(dim)[0]);
console.log('Upstream HDR bloom composite and bright-background limitation passed');
