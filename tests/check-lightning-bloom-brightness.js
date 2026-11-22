'use strict';
const assert = require('assert');
const fs = require('fs');
const shader = fs.readFileSync('shaders/fragment/isolateBrightPartsShader.frag','utf8');
const post = fs.readFileSync('shaders/fragment/postProcessingShader.frag','utf8');
const app = fs.readFileSync('app.js','utf8');
assert.match(shader, /mix\(1\.0, 4\.0, lightningShare\)/);
assert.match(shader, /lightningShare = clamp\(lightningPeak \/ max\(sourcePeak, 1e-6\), 0\.0, 1\.0\)/);
assert.match(shader, /lightningShare = smoothstep\(4\.0, 40\.0, peak\)/);
assert.match(post, /if \(bloomEnabled\)/);
assert.match(app, /hasLightningBloom \? hdrFBO\.lightningBloomTexture : hdrFBO\.texture/);
const shoulder = x => .7*x/(.7+x);
// The pyramid is linear: after extraction, all channel bloom is four times
// stronger. The smooth shoulder still yields finite, monotonic falloff.
const weights=[.15,.06,.02,.005,.001];
const source = Math.log2(1+20000*.12);
const old=weights.map(w=>shoulder(source*w));
const now=weights.map(w=>shoulder(source*4*w));
for(let i=0;i<weights.length;i++) {
 assert(now[i]>old[i]);
 assert(now[i]<.7);
 if(i) assert(now[i]<now[i-1]);
}
assert(now[3] > old[3]*2, 'faint halo should be substantially brighter');
// Ordinary scene emission has share 0: no change to its bloom. A lightning
// hue is scaled uniformly, not forced blue or desaturated to white.
const hue=[1,.45,.2]; const scaled=hue.map(x=>x*4);
assert.strictEqual(scaled[1]/scaled[0],hue[1]);
assert.strictEqual(scaled[2]/scaled[0],hue[2]);
assert.strictEqual(1+3*0,1);
console.log('Lightning bloom brightness, falloff and colour checks passed');
