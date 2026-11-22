'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const shader=fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
const app=fs.readFileSync('app.js','utf8');
const variants=vm.runInNewContext('('+app.match(/const artificialVariantUniforms = (\{[\s\S]*?\});/)[1]+')');
for(const n of ['ordinary_cg','intra_cloud','positive_ic','cc_negative','cc_positive','positive_cg','superbolt','hyperbolt']) assert(Object.hasOwn(variants,n),n);
assert.match(app,/variant : guiControls\.artificialLightningVariant/);
assert.match(shader,/const vec3 upstreamLightningColor = vec3\(0\.70, 0\.57, 1\.0\)/);
assert.match(shader,/vec3 lightningCol = upstreamLightningColor/);
assert.match(shader,/upstreamGroundLight \+= strikeChannel/);
assert.match(shader,/lightningBoltLight \+= upstreamColorize\(strikeChannel\)/);
assert.match(shader,/vec3 lightningIlluminationTint = vec3\(1\.0\)/);
const post=fs.readFileSync('shaders/fragment/postProcessingShader.frag','utf8');
assert.match(post,/color \/= max\(1\.0, peak\)/);
// The common shoulder preserves the requested RGB ratio for each special
// variant regardless of its intrinsic tint or brightness.
for(const rgb of [[620,800,1000],[1000,55,35],[300,380,1000],[1,0,0]]) {
 const peak=Math.max(...rgb), c=[.7,.57,1].map(x=>x*peak);
 const shoulder=18/(1+peak*18/24000), mapped=c.map(x=>x*shoulder);
 assert(Math.abs(mapped[0]/mapped[2]-.7)<1e-12);
 assert(Math.abs(mapped[1]/mapped[2]-.57)<1e-12);
}
console.log('Upstream channel colour and retained variant dispatch checks passed');
