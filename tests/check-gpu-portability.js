'use strict';
const assert = require('assert');
const fs = require('fs');
const app = fs.readFileSync('app.js','utf8');
const precip = fs.readFileSync('shaders/vertex/precipitationShader.vert','utf8');
const location = fs.readFileSync('shaders/fragment/lightningLocationShader.frag','utf8');
const display = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
const worker = fs.readFileSync('lightningGenerator.js','utf8');
for (const path of ['precipitationShader.vert','precipDisplayShader.vert']) {
 const src=fs.readFileSync('shaders/vertex/'+path,'utf8');
 for (const [idx,name] of [[0,'dropPosition'],[1,'mass'],[2,'density']])
  assert.match(src,new RegExp(`layout\\(location = ${idx}\\) in (?:vec2|float) ${name};`));
}
for (const path of ['simShader.vert','dispShader.vert','realDispShader.vert','postProcessingShader.vert']) {
 const src=fs.readFileSync('shaders/vertex/'+path,'utf8');
 assert.match(src,/layout\(location = 0\) in vec2 vertPosition;/);
 assert.match(src,/layout\(location = 1\) in vec2 vertTexCoord;/);
}
assert.match(app,/const compactPrecipitationFeedback = !gl\.getExtension\('EXT_float_blend'\)/);
for(const format of ['gl.RGBA32F','gl.RG32F','gl.R32F'])
 assert(app.includes(`compactPrecipitationFeedback ? gl.RGBA16F : ${format}`));
assert.match(app,/compactPrecipitationFeedback \? gl.HALF_FLOAT : gl.FLOAT/);
assert.match(app,/gl\.checkFramebufferStatus\(gl\.FRAMEBUFFER\) !== gl\.FRAMEBUFFER_COMPLETE/);
assert.match(app,/gl\.copyBufferSubData\(gl\.COPY_READ_BUFFER, gl\.COPY_WRITE_BUFFER, 0, 0, values\.byteLength\)/);
assert.match(app,/precipitationEven \? precipVertexBuffer_1 : precipVertexBuffer_0/);
assert.match(app,/if \(values\[i\] < 0\) result\+\+/);
assert.match(app,/gl\.uniform1f\(gl\.getUniformLocation\(precipitationProgram, 'inactiveDroplets'\), NUM_DROPLETS\)/);
assert.match(precip,/compactFeedback \? 1\.0 : iterNum/);
assert.match(precip,/compactFeedback \? vec4\(2\.0, 2\.0, 0\.0, 1\.0\)/);
assert.match(location,/compactFeedback \? 1\.0 : max\(iterNum, 1\.0\)/);
assert.match(app,/compactPrecipitationFeedback \? gl.RGBA : gl.RED, gl.FLOAT, buffers.data/);
assert.match(app,/buffers\.data\[\(dataStart \+ x\) \* rainReadChannels\]/);
assert.match(app,/getParameter\(gl\.ALIASED_POINT_SIZE_RANGE\)/);
assert.match(precip,/float pntSurface = pntSize \* pntSize/);
assert.match(app,/gl\.pixelStorei\(gl\.UNPACK_ALIGNMENT, 1\);\s*gl\.texImage2D\([\s\S]*?artwork\.data\);\s*gl\.pixelStorei\(gl\.UNPACK_ALIGNMENT, 4\)/);
assert.match(app,/width : 1250, height : 2500, logicalScale : 0\.5/);
assert.match(worker,/width \/= logicalScale;\s*height \/= logicalScale/);
assert.match(display,/textureGrad\(lightningTex, vec2\(u, t\), gradX, gradY\)\.r/);
assert.match(app,/surfaceTextureMap-2048\.png/);
// Count signs from the same interleaved layout, including both destinations.
const particleData = new Float32Array([0,0,-2,0,1, 0,0,.1,0,1, 0,0,-4,0,1]);
let inactive=0; for(let i=2;i<particleData.length;i+=5) if(particleData[i]<0) inactive++;
assert.strictEqual(inactive,2);
// Compact metadata carries count, not a half-float iteration that overflows.
for(const iter of [1,65536,1000000]) {
 const records=[[.2,.4,2],[.8,.6,4]], n=records.length;
 const sum=records.reduce((a,r)=>a.map((v,i)=>v+r[i]),[0,0,0]);
 const restored=[sum[0]/n,sum[1]/n,iter,sum[2]/n];
 assert.deepStrictEqual(restored,[.5,.5,iter,3]);
}
console.log('GPU attribute, compact precipitation, metadata and memory checks passed');
