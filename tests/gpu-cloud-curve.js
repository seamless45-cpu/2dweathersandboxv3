// Exercise the real GLSL projection: anchored ends, asymmetrical bend, analytic
// gradients, orientations, degenerate spans and cheap rejection of distant pixels.
const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright-core');
(async()=>{
 const s=fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
 const a=s.indexOf('bool cloudCurveProjection('), body=s.slice(a,s.indexOf('\n}',a)+2);
 assert(!/for\s*\(/.test(body));
 const bin=(await import(require.resolve('@sparticuz/chromium'))).default;
 const browser=await chromium.launch({executablePath:await bin.executablePath(),args:[...bin.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {const page=await browser.newPage();const results=await page.evaluate((body)=>{
 const c=document.createElement('canvas'),gl=c.getContext('webgl2');if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('float framebuffer unavailable');
 function shader(type,src){let o=gl.createShader(type);gl.shaderSource(o,src);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(o));return o}
 let p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,`#version 300 es
 void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`));
 gl.attachShader(p,shader(gl.FRAGMENT_SHADER,`#version 300 es
 precision highp float;uniform vec2 texCoord,start,end,dx,dy;uniform float bow,skew;out vec4 outColor;
 const float lightningTexAspect=.5;const vec2 aspectRatios=vec2(1.);vec2 screenTexDx,screenTexDy;
 `+body+`
 void main(){screenTexDx=dx;screenTexDy=dy;float u=0.,t=0.;vec2 gx,gy;bool ok=cloudCurveProjection(start,end,bow,skew,u,t,gx,gy);outColor=ok?vec4(u,t,gx):vec4(-10.,t,0,0);}`));
 gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
 let tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1,1,0,gl.RGBA,gl.FLOAT,null);let f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('framebuffer');gl.viewport(0,0,1,1);
 function run(start,end,point,bow,skew,dx=[.0001,0]){for(const [n,v] of Object.entries({start,end,texCoord:point,dx,dy:[0,.0001]}))gl.uniform2fv(gl.getUniformLocation(p,n),v);gl.uniform1f(gl.getUniformLocation(p,'bow'),bow);gl.uniform1f(gl.getUniformLocation(p,'skew'),skew);gl.drawArrays(gl.TRIANGLES,0,3);let out=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,out);return [...out]}
 let cases=[];for(const angle of [-1.1,-.5,0,.7,1.3])for(const bow of [-1.05,.65,1.05])for(const skew of [-.65,0,.65])for(const t of [.02,.2,.5,.8,.98]){
 let start=[.2,.25],span=.45,ax=[Math.cos(angle),Math.sin(angle)],normal=[-ax[1],ax[0]],end=start.map((x,i)=>x+span*ax[i]);let profile=t*(1-t)*(1+skew*(2*t-1));let point=start.map((x,i)=>x+span*(t*ax[i]+bow*profile*normal[i]));let r=run(start,end,point,bow,skew),next=run(start,end,[point[0]+.0001,point[1]],bow,skew);cases.push([r,next]);}
 return {cases,outside:run([.2,.2],[.8,.2],[.1,.2],.9,.5),degenerate:run([.2,.2],[.2,.2],[.2,.2],.9,.5),error:gl.getError()};
 },body);assert.equal(results.error,0);assert.equal(results.outside[0],-10);assert.equal(results.degenerate[0],-10);for(const [r,n] of results.cases){assert(Math.abs(r[0]-.5)<2e-5,JSON.stringify(r));assert(Math.abs((n[0]-r[0])-r[2])<4e-6,JSON.stringify([r,n]));assert(Math.abs((n[1]-r[1])-r[3])<4e-6,JSON.stringify([r,n]));}console.log('GPU curved cloud projection and gradients passed',results.cases.length,'angles, bows, skews and distances');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
