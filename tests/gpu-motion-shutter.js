// Browser/SwiftShader regression for the actual motion-shutter shader block.
const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright-core');
(async()=>{
 const source=fs.readFileSync('shaders/fragment/postProcessingShader.frag','utf8');
 const block=source.slice(source.indexOf('  if (motionBlurEnabled && motionBlurHistoryValid) {'),source.indexOf('\n  /*\n    { // Gamma correction test'));
 const bin=(await import(require.resolve('@sparticuz/chromium'))).default;
 const browser=await chromium.launch({executablePath:await bin.executablePath(),args:[...bin.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {const page=await browser.newPage();const result=await page.evaluate((block)=>{
 const canvas=document.createElement('canvas');canvas.width=32;canvas.height=8;const gl=canvas.getContext('webgl2');
 const vs='#version 300 es\nout vec2 texCoord;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);texCoord=p;gl_Position=vec4(p*2.-1.,0,1);}';
 const fs=`#version 300 es
 precision highp float;precision highp isampler2D;in vec2 texCoord;out vec4 result;
 uniform sampler2D scene,velocityTex,historyTex;uniform isampler2D motionBlurWallTex;
 uniform bool motionBlurEnabled,motionBlurHistoryValid,motionBlurWrap;
 uniform float motionBlurStrength,motionBlurIterPerFrame;uniform vec3 motionBlurView,motionBlurPrevView;
 uniform vec2 canvasTexelSize,motionBlurAspects,motionBlurResolution;
 vec3 mappedColor(vec2 uv){return texture(scene,uv).rgb;}
 void main(){vec3 outputCol=mappedColor(texCoord);`+block+'\nresult=vec4(outputCol,1.);}';
 function shader(type,src){let s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
 let p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vs));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 const data=new Uint8Array(32*8*4);for(let y=0;y<8;y++)for(let x=16;x<18;x++){let i=(y*32+x)*4;data[i]=data[i+1]=data[i+2]=data[i+3]=255;}
 function tex(unit,internal,fmt,type,data,w,h){gl.activeTexture(gl.TEXTURE0+unit);let t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,fmt,type,data);}
 tex(0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,data,32,8);tex(3,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,data,32,8);tex(1,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4),1,1);tex(2,gl.RGBA8I,gl.RGBA_INTEGER,gl.BYTE,new Int8Array([0,1,0,0]),1,1);
 const loc=n=>gl.getUniformLocation(p,n);gl.uniform1i(loc('scene'),0);gl.uniform1i(loc('historyTex'),3);gl.uniform1i(loc('velocityTex'),1);gl.uniform1i(loc('motionBlurWallTex'),2);gl.uniform1i(loc('motionBlurEnabled'),1);gl.uniform1i(loc('motionBlurHistoryValid'),1);gl.uniform2f(loc('canvasTexelSize'),1/32,1/8);gl.uniform2f(loc('motionBlurAspects'),1,1);gl.uniform2f(loc('motionBlurResolution'),1,1);gl.uniform3f(loc('motionBlurView'),0,0,1);gl.viewport(0,0,32,8);
 function draw(strength,prev){gl.uniform1f(loc('motionBlurStrength'),strength);gl.uniform3f(loc('motionBlurPrevView'),prev,0,1);gl.drawArrays(gl.TRIANGLES,0,3);let pixels=new Uint8Array(32*8*4);gl.readPixels(0,0,32,8,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return [...Array(32)].map((_,x)=>pixels[(4*32+x)*4]);}
 const off=draw(0,-.25),still=draw(350,0),moving=draw(350,-.25);gl.activeTexture(gl.TEXTURE1);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([32,0,0,255]));gl.uniform1f(loc('motionBlurIterPerFrame'),1);const fluid=draw(350,0);gl.uniform1f(loc('motionBlurIterPerFrame'),0);gl.activeTexture(gl.TEXTURE3);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,32,8,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(data.length));return {off,still,moving,fluid,changing:draw(350,0),error:gl.getError()};
 },block);assert.equal(result.error,0);assert.deepEqual(result.off,result.still);assert(result.moving.some((v,i)=>v>0&&i<16),JSON.stringify(result));assert(result.moving.some(v=>v>0&&v<255),JSON.stringify(result));assert.notDeepStrictEqual(result.fluid,result.still,'fluid motion should blur even when camera is still');assert(result.changing[16]>100&&result.changing[16]<155,'temporal shutter should integrate changing scene under stationary camera');console.log('GPU motion shutter: zero strength, stationary frame and moving trail passed');}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
