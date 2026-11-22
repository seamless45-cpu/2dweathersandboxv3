'use strict';
const assert = require('assert');
const fs = require('fs');
const post = fs.readFileSync('shaders/fragment/postProcessingShader.frag', 'utf8');
const mapStart = post.indexOf('vec3 mappedColor(vec2 uv, vec3 contactLight)');
const mapEnd = post.indexOf('\nvec3 mappedColor(vec2 uv)', mapStart);
const map = post.slice(mapStart, mapEnd);
assert(map.indexOf('color /= max(1.0, peak)') < map.indexOf('color += (vec3(1.0) - color) * glow'));
assert.match(map, /bloom \*= max\(exposure, 0\.0\)/);
assert.match(map, /if \(bloomEnabled\)/);
const scale = (v, s) => v.map(x => x*s);
const normalize = v => scale(v, 1/Math.max(1,...v));
const old = (scene, glow) => normalize(scene.map((x,i)=>x+glow[i]));
const composite = (scene, bloom, exposure=1) => {
 const base = normalize(scale(scene,exposure));
 const scaled = scale(bloom,exposure);
 const peak = Math.max(...scaled);
 const glow = scale(scaled, .7/(.7+peak));
 return base.map((x,i)=>x+(1-x)*glow[i]);
};
// The old pre-clamp addition can leave an already bright, uniformly colored
// pixel unchanged even with a substantial same-colored bloom contribution.
for (const scene of [[4,2,1], [8,4,2]]) {
 const bloom=scale(scene,.5), base=normalize(scene), previous=old(scene,bloom), fresh=composite(scene,bloom);
 assert(previous.every((v,i)=>Math.abs(v-base[i])<1e-12));
 assert(fresh[1]>base[1] && fresh[2]>base[2]);
 assert(fresh.every(v=>v>=0 && v<=1));
}
const scene=[.3,.4,.5], hue=[1,.5,.25];
const values=[.05,.2,1,5].map(p=>composite(scene,scale(hue,p))[0]);
for(let i=1;i<values.length;i++)assert(values[i]>values[i-1]);
assert.deepStrictEqual(composite(scene,hue,0),[0,0,0]);
console.log('Bloom on bright backgrounds and falloff checks passed');
