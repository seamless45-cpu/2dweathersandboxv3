// Test the scene's actual background/coverage output and WebGL blending at FP16 precision.
const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright-core');
(async()=>{
 const scene=fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
 const block=scene.slice(scene.indexOf('  vec3 sceneBeforeClamp ='),scene.indexOf('  // Preserve a chromatic bloom source'));
 const common=fs.readFileSync('shaders/common.glsl','utf8');
 const soft=common.slice(common.indexOf('#define HDR_CEILING'),common.indexOf('\n}',common.indexOf('vec3 softHdrClamp(vec3 value)'))+2);
 const bin=(await import(require.resolve('@sparticuz/chromium'))).default;
 const browser=await chromium.launch({executablePath:await bin.executablePath(),args:[...bin.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{const page=await browser.newPage();const result=await page.evaluate(({block,soft})=>{
 const c=document.createElement('canvas');c.width=c.height=1;const gl=c.getContext('webgl2');if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('float buffer unsupported');
 const v='#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}';
 const header='#version 300 es\nprecision highp float;layout(location=0) out vec4 fragmentColor;layout(location=2) out vec4 lightningBackgroundOutput;layout(location=3) out vec4 lightningCoverageOutput;';
 const sky=header+'\nvoid main(){fragmentColor=vec4(.2,.2,.2,1);lightningBackgroundOutput=fragmentColor;}';
 const clouds=header+'\n'+soft+`\nvoid main(){vec3 color=vec3(.1),finalLight=vec3(1),emittedLight=vec3(5000),rodGlow=vec3(0),lightningEmission=vec3(5000);float opacity=.5,terrainOcclusion=0.,lightningPixelCoverage=.125;`+block+'\n}';
 function prog(f){function sh(t,s){let a=gl.createShader(t);gl.shaderSource(a,s);gl.compileShader(a);if(!gl.getShaderParameter(a,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(a));return a}let p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,v));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p}
 let a=prog(sky),b=prog(clouds),frame=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,frame);
 for(const [attachment,internal,fmt] of [[gl.COLOR_ATTACHMENT0,gl.RGBA16F,gl.RGBA],[gl.COLOR_ATTACHMENT2,gl.RGBA16F,gl.RGBA],[gl.COLOR_ATTACHMENT3,gl.R16F,gl.RED]]){let t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,internal,1,1,0,fmt,gl.HALF_FLOAT,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,attachment,gl.TEXTURE_2D,t,0)}
 gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.NONE,gl.COLOR_ATTACHMENT2,gl.COLOR_ATTACHMENT3]);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('MRT incomplete');gl.clearBufferfv(gl.COLOR,3,new Float32Array(4));gl.viewport(0,0,1,1);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.NONE,gl.COLOR_ATTACHMENT2]);gl.useProgram(a);gl.drawArrays(gl.TRIANGLES,0,3);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.NONE,gl.COLOR_ATTACHMENT2,gl.COLOR_ATTACHMENT3]);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(b);gl.drawArrays(gl.TRIANGLES,0,3);gl.disable(gl.BLEND);
 function read(attachment,format,n){gl.readBuffer(attachment);let p=new Float32Array(n);gl.readPixels(0,0,1,1,format,gl.FLOAT,p);return Array.from(p)}
 return {scene:read(gl.COLOR_ATTACHMENT0,gl.RGBA,4),background:read(gl.COLOR_ATTACHMENT2,gl.RGBA,4),coverage:read(gl.COLOR_ATTACHMENT3,gl.RGBA,4),error:gl.getError()};
 },{block,soft});assert.equal(result.error,0,JSON.stringify(result));assert(result.scene[0]>1000);assert(Math.abs(result.background[0]-.15)<.002,JSON.stringify(result));assert(Math.abs(result.coverage[0]-.125)<.001,JSON.stringify(result));console.log('GPU FP16 MRT sky, premultiplied cloud, bolt-free background and coverage passed');}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
