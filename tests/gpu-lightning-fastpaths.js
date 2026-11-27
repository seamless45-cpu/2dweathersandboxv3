// Compare pre-optimization and actual optimized per-variant shader calculations.
const fs=require('fs'),assert=require('assert'),{chromium}=require('playwright-core');
(async()=>{
 const old=fs.readFileSync('tests/fixtures/lightning-variant-calculations-before.glsl','utf8');
 const shader=fs.readFileSync('shaders/fragment/lightningRenderStateShader.frag','utf8');
 const begin=shader.indexOf('    float strokeBrightnessMult = isHyperbolt'),end=shader.indexOf('    // Two rows keep',begin),now=shader.slice(begin,end).replace(/return;/g, "continue;");
 const bin=(await import(require.resolve('@sparticuz/chromium'))).default;
 const browser=await chromium.launch({executablePath:await bin.executablePath(),args:[...bin.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{const page=await browser.newPage();const results=await page.evaluate(({old,now})=>{
 let c=document.createElement('canvas');c.width=c.height=1;const gl=c.getContext('webgl2');if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('float framebuffer unavailable');
 const vs='#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}';
 const header=`#version 300 es
 precision highp float;out vec4 outColor;uniform int variant;uniform float t,intensity,pos;
 const float superboltBrightnessMult=12.,superboltDurationShorten=.1,hyperboltBrightnessMult=30.,hyperboltDurationShorten=2.624;const int INTENSITY=3;
 float random2d(vec2 v){return fract(abs(v.x*.361+v.y*.127));}float map_range(float x,float a,float b,float c,float d){return c+(x-a)*(d-c)/(b-a);}float lightningFlickers(vec4 v){return floor(fract(v.x*9.)*3.);}
 float lightningIntensityOverTime(float t,vec2 p,float i){return max(0.,1.0-t*.1)*i;}
 float firstReturnIntensity(float t,float i,float a,float b){return max(0.,1.-t)*i;}
 vec3 planckBlackbody(float t){return vec3(.5,.7,1.);}
 vec4 eval(){bool isExternalPositive=variant>=3;bool isCloudToCloud=variant==1||variant==2;bool isPositiveCC=variant==2;bool isSuperbolt=variant>=4;bool isHyperbolt=variant==5;vec2 lightningPos=vec2(pos,.5);vec4 lightningData=vec4(pos,.5,1.,intensity);vec4 lightningMeta=vec4(.4,1,0,0);float lightningTime=t;float currentLightningIntensity=2.;for(int j=0;j<1;j++){`;
 const suffix=`return vec4(currentLightningIntensity,effectiveLightningTime,isExternalPositive?extCurve:0.,isCloudToCloud?ccIntensityGain*ccTailFade:0.);}return vec4(-1.);}\nvoid main(){outColor=eval();}`;
 function prog(s){function sh(t,x){let a=gl.createShader(t);gl.shaderSource(a,x);gl.compileShader(a);if(!gl.getShaderParameter(a,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(a));return a}let p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,vs));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,s));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p}let a=prog(header+old+suffix),b=prog(header+now+suffix);
 let tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1,1,0,gl.RGBA,gl.FLOAT,null);let f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('FBO');gl.viewport(0,0,1,1);
 function run(p,v,t,i,pos){gl.useProgram(p);gl.uniform1i(gl.getUniformLocation(p,'variant'),v);gl.uniform1f(gl.getUniformLocation(p,'t'),t);gl.uniform1f(gl.getUniformLocation(p,'intensity'),i);gl.uniform1f(gl.getUniformLocation(p,'pos'),pos);gl.drawArrays(gl.TRIANGLES,0,3);let d=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,d);return Array.from(d)}
 let max=0,count=0;for(let v=0;v<6;v++)for(let t of [-.1,0,.05,.2,.5,1,2,3,5,10])for(let i of [.8,1.5,4.8,6])for(let p of [.1,.35,.8]){let x=run(a,v,t,i,p),y=run(b,v,t,i,p);for(let k=0;k<4;k++){if(!Number.isFinite(x[k])||!Number.isFinite(y[k]))throw Error('nonfinite');max=Math.max(max,Math.abs(x[k]-y[k]));}count++;}return {max,count,error:gl.getError()};
 },{old,now});assert.equal(results.error,0);assert(results.max<1e-6,JSON.stringify(results));console.log('GPU pre/post variant timing and intensity parity passed',results);}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
