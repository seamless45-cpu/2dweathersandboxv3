// Optional browser GPU test: npm install --no-save playwright-core @sparticuz/chromium
// Compare the actual ordinary-CG function to original leader equations and
// independently calculated filtered return coverage, and
// exercise the actual repeated-feedback guard, without a simulated storm.
const fs=require('fs'), assert=require('assert'), {chromium}=require('playwright-core');
(async()=>{
 const source=fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
 const cg=source.slice(source.indexOf('vec3 displayLightning('),source.indexOf('\n// Project the original bolt tile',source.indexOf('vec3 displayLightning(')));
 const colorize=source.slice(source.indexOf('vec3 upstreamColorize('),source.indexOf('\n}',source.indexOf('vec3 upstreamColorize('))+2);
 const loc=fs.readFileSync('shaders/fragment/lightningLocationShader.frag','utf8');
 const guard=loc.slice(loc.indexOf('bool sameNaturalStrike('),loc.indexOf('\n}',loc.indexOf('bool sameNaturalStrike('))+2);
 const bin=(await import(require.resolve('@sparticuz/chromium'))).default;
 const browser=await chromium.launch({executablePath:await bin.executablePath(),args:[...bin.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try { const page=await browser.newPage(); const result=await page.evaluate(({cg,guard,colorize})=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const gl=canvas.getContext('webgl2');
  if(!gl || !gl.getExtension('EXT_color_buffer_float') || !gl.getExtension('OES_texture_float_linear'))throw Error('float WebGL unavailable');
  const vert=`#version 300 es\nprecision highp float;out vec2 texCoord;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);texCoord=p;gl_Position=vec4(p*2.-1.,0,1);}`;
  function shader(t,s){let sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh}
  function program(f){let p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vert));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p}
  const prefix=`#version 300 es\nprecision highp float;precision highp sampler2D;in vec2 texCoord;out vec4 result;uniform sampler2D lightningTex;uniform vec2 aspectRatios;uniform float originalBoltBottomU;uniform float t;uniform float current;vec2 screenTexDx,screenTexDy;const float lightningTexAspect=.5;const vec3 upstreamLightningColor=vec3(.70,.57,1.);bool inLightningWorldTile(){return true;}float findCapturedRodTipY(float x){return -1.;}float random2d(vec2 p){return 0.;}vec3 planckBlackbody(float x){return vec3(1.);}`;
  const reference=`vec3 reference(vec2 pos,float time,float intensity){vec2 uv=texCoord;uv.x-=mod(pos.x,1.);uv.y-=pos.y;float scaleMult=1./pos.y;uv.x*=scaleMult*aspectRatios.x/lightningTexAspect;uv.y*=-scaleMult;uv.x+=.5;vec2 dx=dFdx(uv),dy=dFdy(uv);if(uv.x<.01||uv.x>1.01||uv.y<.01||uv.y>1.01)return vec3(0);float value;if(time>1.){value=textureGrad(lightningTex,uv,dx,dy).r*.05*intensity*100000.;}else{float raw=textureLod(lightningTex,uv,0.).g;float threshold=clamp(1.-time*2.5+uv.y*2.5,0.,1.);value=max(raw-threshold,0.)*50000.;}return value*vec3(.70,.57,1.);}`;
  const a=program(prefix+cg+'\nvoid main(){screenTexDx=dFdx(texCoord);screenTexDy=dFdy(texCoord);result=vec4(displayLightning(vec2(.5,.8),t,current),1.);}');
  const b=program(prefix+reference+'\nvoid main(){result=vec4(reference(vec2(.5,.8),t,current),1.);}');
  gl.activeTexture(gl.TEXTURE0);let art=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,art);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);let pixels=new Float32Array(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++){let i=(y*64+x)*4;if((x>=30 && x<=34) || (x>=39 && x<=41)){pixels[i+1]=x<=34?1:.8;pixels[i]=Math.max(pixels[i+1]-.95,0)*20;}}gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,64,64,0,gl.RGBA,gl.FLOAT,pixels);gl.generateMipmap(gl.TEXTURE_2D);
  gl.activeTexture(gl.TEXTURE1);let out=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,out);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,64,64,0,gl.RGBA,gl.FLOAT,null);let f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,out,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('framebuffer');gl.viewport(0,0,64,64);
  function render(p,t){gl.useProgram(p);gl.uniform1i(gl.getUniformLocation(p,'lightningTex'),0);gl.uniform2f(gl.getUniformLocation(p,'aspectRatios'),1,1);gl.uniform1f(gl.getUniformLocation(p,'t'),t);gl.uniform1f(gl.getUniformLocation(p,'current'),2);gl.drawArrays(gl.TRIANGLES,0,3);let out=new Float32Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.FLOAT,out);return out}
  let max=0,lit=0;for(const t of [.2,.7,1,1.01,2]){let x=render(a,t),y=render(b,t);for(let i=0;i<x.length;i+=4){for(let c=0;c<3;c++)max=Math.max(max,Math.abs(x[i+c]-y[i+c]));if(x[i]>0)lit++;}}
  const pre=`#version 300 es\nprecision highp float;out vec4 result;#define START_ITERNUM 2\nuniform vec4 data,meta,incoming;uniform bool manual;uniform float now;uniform vec2 cell;bool artificialMeta(float z){return z < -.5 || z >= 10.;}`.replace('result;#define','result;\n#define');
  const g=program(pre+guard+'\nvoid main(){result=vec4(sameNaturalStrike(data,meta,incoming,manual,now,cell)?1.:0.,0,0,1);}');
  function test(dx,dy,manual,age,metaZ){gl.useProgram(g);gl.uniform4f(gl.getUniformLocation(g,'data'),.3,.6,100.,2.8);gl.uniform4f(gl.getUniformLocation(g,'meta'),.3,0,metaZ,0);gl.uniform4f(gl.getUniformLocation(g,'incoming'),.3+dx,.6+dy,0,2.8);gl.uniform1i(gl.getUniformLocation(g,'manual'),manual);gl.uniform1f(gl.getUniformLocation(g,'now'),100+age);gl.uniform2f(gl.getUniformLocation(g,'cell'),.01,.01);gl.drawArrays(gl.TRIANGLES,0,3);let p=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,p);return p[0]}
  const colorProgram=program(`#version 300 es
precision highp float;out vec4 result;uniform vec3 inputColor;const vec3 upstreamLightningColor=vec3(.70,.57,1.);`+colorize+`
void main(){result=vec4(upstreamColorize(inputColor),1.);}`);
  const colors=[];for(const color of [[100,50,10],[10,30,100],[0,100,40],[0,0,0]]){gl.useProgram(colorProgram);gl.uniform3f(gl.getUniformLocation(colorProgram,'inputColor'),...color);gl.drawArrays(gl.TRIANGLES,0,3);const p=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,p);colors.push([...p.slice(0,3)]);}
  return {max,lit,colors,duplicate:[test(0,0,0,1,0),test(.01,0,0,1,0),test(0,0,1,1,0),test(0,0,0,3,0),test(0,0,0,1,-1)],error:gl.getError()};
 },{cg,guard,colorize}); assert.equal(result.error,0);assert(result.max<.05,`maximum render error ${result.max}`);assert(result.lit>0);assert.deepStrictEqual(result.duplicate,[1,0,0,0,0]); for(const color of result.colors.slice(0,3)){assert(Math.abs(color[0]/color[2]-.7)<1e-5);assert(Math.abs(color[1]/color[2]-.57)<1e-5)} assert.deepStrictEqual(result.colors[3],[0,0,0]);console.log('Upstream leader and filtered return GPU parity and natural duplicate guard passed');
 } finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
