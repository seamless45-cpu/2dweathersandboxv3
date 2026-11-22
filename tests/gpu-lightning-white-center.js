// Optional integration test: npm install --no-save playwright-core @sparticuz/chromium
// Exercises shared bloom with no separate lightning-only contact halo.
const assert = require('assert');
const fs = require('fs');
const { chromium } = require('playwright-core');
(async () => {
  const bin = (await import(require.resolve('@sparticuz/chromium'))).default;
  const source = fs.readFileSync('shaders/fragment/postProcessingShader.frag', 'utf8')
    .replace('#include "commonDisplay.glsl"', fs.readFileSync('shaders/commonDisplay.glsl', 'utf8'));
  const browser = await chromium.launch({executablePath: await bin.executablePath(), headless:true,
    args:[...bin.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage();
    const results = await page.evaluate(source => {
      const canvas = document.createElement('canvas'); canvas.width=canvas.height=32;
      const gl = canvas.getContext('webgl2', {preserveDrawingBuffer:true});
      if (!gl || !gl.getExtension('EXT_color_buffer_float') || !gl.getExtension('OES_texture_float_linear')) throw Error('float WebGL2 unavailable');
      const vertex = `#version 300 es
        precision highp float;
        out vec2 texCoord,texCoordXmY0,texCoordX0Ym,texCoordXpY0,texCoordX0Yp;
        void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); texCoord=p;
          texCoordXmY0=p;texCoordX0Ym=p;texCoordXpY0=p;texCoordX0Yp=p; gl_Position=vec4(p*2.-1.,0,1);}`;
      function shader(type, src) {const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));return s;}
      function program(src) {const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,src));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));return p;}
      const current=program(source), old=program(source.replace('color += safeSample(texture(bloomTex, uv).rgb) * 0.990;',''));
      function tex(unit, data, integer=false) {gl.activeTexture(gl.TEXTURE0+unit);const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,integer?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,integer?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,integer?gl.RGBA8I:gl.RGBA32F,32,32,0,integer?gl.RGBA_INTEGER:gl.RGBA,integer?gl.BYTE:gl.FLOAT,data);}
      function run(p, tint, background, enabled, hasSource) {
        const scene=new Float32Array(32*32*4), bloom=new Float32Array(scene.length), halo=new Float32Array(scene.length);
        for(let y=0;y<32;y++) for(let x=0;x<32;x++) {let i=(y*32+x)*4;for(let c=0;c<3;c++){scene[i+c]=background[c];bloom[i+c]=tint[c]*.2;if(x===16)halo[i+c]=tint[c]*100;}scene[i+3]=1;}
        tex(0,scene);tex(1,bloom);tex(2,scene);tex(3,scene);tex(4,new Int8Array(scene.length),true);tex(5,halo);
        gl.useProgram(p);const ui=(n,v)=>gl.uniform1i(gl.getUniformLocation(p,n),v);
        for(const [n,v] of [['hdrTex',0],['bloomTex',1],['historyTex',2],['velocityTex',3],['motionBlurWallTex',4],['lightningHaloTex',5],['bloomEnabled',enabled],['hasLightningBloom',hasSource],['toneMappingEnabled',1]])ui(n,v);
        gl.uniform1f(gl.getUniformLocation(p,'exposure'),1);gl.uniform2f(gl.getUniformLocation(p,'canvasTexelSize'),1/32,1/32);gl.uniform2f(gl.getUniformLocation(p,'outputTexelSize'),1/32,1/32);
        gl.viewport(0,0,32,32);gl.drawArrays(gl.TRIANGLES,0,3);const out=new Uint8Array(32*32*4);gl.readPixels(0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,out);if(gl.getError())throw Error('WebGL error');
        return [13,15,16,17,19].map(x=>Array.from(out.slice((16*32+x)*4,(16*32+x)*4+3)));
      }
      return [[1,.35,.15],[.3,.5,1]].flatMap(tint=>[[.02,.03,.05],[.8,.7,.5]].map(bg=>({now:run(current,tint,bg,1,1),before:run(old,tint,bg,1,1),off:run(current,tint,bg,0,1),offBefore:run(old,tint,bg,0,1),fallback:run(current,tint,bg,1,0),fallbackBefore:run(old,tint,bg,1,0)})));
    },source);
    for(const r of results) {
      assert.deepStrictEqual(r.now[1], r.now[0]);
      assert.deepStrictEqual(r.now[2], r.now[0]);
      assert.deepStrictEqual(r.now[3], r.now[0]);
      assert.deepStrictEqual(r.now[4], r.now[0]);
      assert.notDeepStrictEqual(r.now[0],r.before[0]);
      assert.deepStrictEqual(r.off,r.offBefore);
      assert.deepStrictEqual(r.now,r.fallback);
    }
    console.log('Shared upstream bloom, unchanged bloom-off and no contact halo checks passed');
  } finally {await browser.close();}
})().catch(err=>{console.error(err);process.exit(1)});
