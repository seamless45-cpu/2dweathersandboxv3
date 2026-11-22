'use strict';
const assert=require('assert'),fs=require('fs');
const post=fs.readFileSync('shaders/fragment/postProcessingShader.frag','utf8');
const app=fs.readFileSync('app.js','utf8');
assert.doesNotMatch(post,/lightningContactHalo|whiteCenter|lightningHaloTex/);
assert.match(app,/const hasLightningBloom = ensureLightningBloomTarget\(false\)/);
assert.match(post,/if \(bloomEnabled\)/);
console.log('Upstream shared bloom without separate contact halo passed');
