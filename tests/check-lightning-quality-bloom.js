'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const app = fs.readFileSync('app.js','utf8');
const scene = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
const bright = fs.readFileSync('shaders/fragment/isolateBrightPartsShader.frag','utf8');
const post = fs.readFileSync('shaders/fragment/postProcessingShader.frag','utf8');
assert.match(scene, /layout\(location = 1\) out vec4 lightningBloomOutput/);
assert.match(scene, /strikePeak \* lightningIlluminationTint/);
assert.match(scene, /lightningBloomLight \* \(1\.0 - terrainOcclusion\)/);
assert.match(scene, /lightningBloomOutput = vec4\(bloomSource, bloomPeak\)/);
assert.match(scene, /lightningBloomOutput = vec4\(0\.0\)/);
assert.match(bright, /max\(scene - vec3\(lightning\.a\), vec3\(0\.0\)\) \+ lightning\.rgb/);
assert.match(bright, /if \(!hasLightningBloom\) \{/);
assert.match(post, /if \(bloomEnabled\)/);
assert.match(scene, /sampleLightningArtwork\(lightningTex, lightningTexCoord, gradX, gradY\)/);
assert.equal((scene.match(/sampleLightningArtwork\(lightningNetworkTex, flashCoord, gradX, gradY\)/g)||[]).length,2);
assert.match(scene, /textureGrad\(artworkTex, uv - major \* 0\.25, dx, dy\)/);
assert.match(scene, /textureGrad\(artworkTex, uv \+ major \* 0\.25, dx, dy\)/);
assert.match(scene, /float coreW = 0\.0018 \* hScale/);
assert.match(app, /width : mobileArtwork \? 1024 : 2048, height : mobileArtwork \? 512 : 1024/);
assert.match(app, /gl\.clearBufferfv\(gl\.COLOR, 1, clearLightningBloom\)/);
assert.match(app, /lightningBloomEnabled'\), hasLightningBloom/);
// Actual optional-attachment implementation exercised with a stateful GL fake:
// reuse, disposal, disabling, failed attachment, and retry after disable.
const source=app.slice(app.indexOf('function ensureLightningBloomTarget('),app.indexOf('\nconst clearLightningBloom'));
function makeTest(status) {
 const calls=[]; let complete=status, next=0;
 const gl={TEXTURE0:0,TEXTURE_2D:1,TEXTURE_MIN_FILTER:2,TEXTURE_MAG_FILTER:3,LINEAR:4,TEXTURE_WRAP_S:5,TEXTURE_WRAP_T:6,CLAMP_TO_EDGE:7,RGBA16F:8,RGBA:9,HALF_FLOAT:10,FRAMEBUFFER:11,COLOR_ATTACHMENT1:12,FRAMEBUFFER_COMPLETE:13,
 createTexture:()=>({id:++next}),activeTexture:()=>{},bindTexture:()=>{},texParameteri:()=>{},texImage2D:()=>{},framebufferTexture2D:(...a)=>calls.push(['attach',a[3]]),checkFramebufferStatus:()=>complete?13:99,deleteTexture:t=>calls.push(['delete',t])};
 const context={gl,hdrFBO:{width:120,height:80},console:{warn:()=>{}}};vm.createContext(context);vm.runInContext(source,context);
 return {context,calls,setComplete:v=>{complete=v}};
}
const good=makeTest(true);assert(good.context.ensureLightningBloomTarget(true));const texture=good.context.hdrFBO.lightningBloomTexture;
assert(good.context.ensureLightningBloomTarget(true));assert.equal(good.context.hdrFBO.lightningBloomTexture,texture);
assert.equal(good.calls.filter(x=>x[0]==='attach').length,1);
assert(!good.context.ensureLightningBloomTarget(false));assert(good.calls.some(x=>x[0]==='delete'&&x[1]===texture));
const bad=makeTest(false);assert(!bad.context.ensureLightningBloomTarget(true));assert.equal(bad.context.hdrFBO.lightningBloomTexture,undefined);
assert.equal(bad.calls.filter(x=>x[0]==='delete').length,1);bad.setComplete(true);assert(!bad.context.ensureLightningBloomTarget(true));
bad.context.ensureLightningBloomTarget(false);assert(bad.context.ensureLightningBloomTarget(true));
const oversized=makeTest(true); oversized.context.hdrFBO.width=8192; oversized.context.hdrFBO.height=8192;
assert(!oversized.context.ensureLightningBloomTarget(true)); assert.equal(oversized.calls.length,0);
// Simulate white-core and chromatic bloom extraction through the same RGB
// shoulder and gamma mapping used in the renderer. No fixed blue tint, and
// background remains unchanged where there is no lightning contribution.
const extract=(scene,tint,peak)=>scene.map((v,i)=>Math.max(v-peak,0)+tint[i]*peak);
const gamma=c=>{const p=Math.max(1,...c);return c.map(x=>(x/p)**(1/2.2));};
for(const tint of [[1,.52,.25],[.47,.72,1],[1,.5,.67],[.62,.51,1],[1,.45,.24],[1,.75,.29],[.95,.97,1],[.4,1,.76]]) {
 const core=[100,98,96], old=gamma(core), fresh=gamma(extract(core,tint,100));
 if(Math.min(...tint)<.9) assert(Math.min(...fresh)<Math.min(...old)-.05,'bloom hue should be measurably less white');
 assert.equal(fresh.indexOf(Math.max(...fresh)),tint.indexOf(Math.max(...tint)));
}
assert.deepStrictEqual(extract([.2,.4,.6],[1,.5,.2],0),[.2,.4,.6]);
console.log('Lightning bloom source, optional MRT fallback and detail filtering checks passed');
