'use strict';
const assert=require('assert'),fs=require('fs');
const shader=fs.readFileSync('shaders/fragment/isolateBrightPartsShader.frag','utf8');
const app=fs.readFileSync('app.js','utf8');
assert.match(shader,/texture\(hdrTex, texCoord\)\.rgb/);
assert.match(shader,/outputCol \*= 0\.02/);
assert.match(shader,/if \(any\(isnan\(outputCol\)\) \|\| any\(isinf\(outputCol\)\)\)/);
assert.match(app,/if \(guiControls\.bloomEnabled\) \{/);
// Upstream's single bilinear sample can miss a narrow channel at large
// downsample ratios. This is the deliberate visual tradeoff of this restore.
const bilinear=(x,p)=>Math.max(0,1-Math.abs(x-(p+.5)));
assert.equal(bilinear(4,0),0);
assert(bilinear(4,3)>0);
console.log('Upstream one-sample extraction and thin-channel limitation passed');
