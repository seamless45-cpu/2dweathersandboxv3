// Exercises the actual spatial reconstruction shader on an enlarged source.
const fs = require('fs'), assert = require('assert'), {chromium} = require('playwright-core');
(async () => {
  const source = fs.readFileSync('shaders/fragment/postProcessingShader.frag', 'utf8');
  const code = source.slice(source.indexOf('const float hdrReadCeiling'), source.indexOf('\nvoid main()'));
  const bin = (await import(require.resolve('@sparticuz/chromium'))).default;
  const browser = await chromium.launch({executablePath:await bin.executablePath(),args:[...bin.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(code => {
      const canvas=document.createElement('canvas'); canvas.width=8; canvas.height=8;
      const gl=canvas.getContext('webgl2');
      const vs='#version 300 es\nout vec2 uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0,1);}';
      const fs=`#version 300 es
      precision highp float;in vec2 uv;out vec4 result;
      uniform sampler2D hdrTex,bloomTex,lightningCoverageTex,lightningBackgroundTex;
      uniform bool bloomEnabled,toneMappingEnabled,lightningCoverageEnabled,spatialUpscalingEnabled;
      uniform vec2 outputTexelSize;uniform float exposure;const vec3 ONE_OVER_GAMMA=vec3(1./2.2);`+code+'\nvoid main(){result=vec4(mappedColor(uv),1);}';
      function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
      const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
      const pixels=new Uint8Array(4*4*4);for(let y=0;y<4;y++)for(let x=0;x<4;x++){const i=(y*4+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=x>=2?255:0;pixels[i+3]=255;}
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,4,4,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      gl.uniform1i(gl.getUniformLocation(program,'hdrTex'),0);gl.uniform1f(gl.getUniformLocation(program,'exposure'),1);gl.uniform2f(gl.getUniformLocation(program,'outputTexelSize'),.25,.25);gl.viewport(0,0,8,8);
      function draw(enabled){gl.uniform1i(gl.getUniformLocation(program,'spatialUpscalingEnabled'),enabled);gl.drawArrays(gl.TRIANGLES,0,3);const out=new Uint8Array(8*8*4);gl.readPixels(0,0,8,8,gl.RGBA,gl.UNSIGNED_BYTE,out);return [...Array(8)].map((_,x)=>out[(4*8+x)*4]);}
      return {linear:draw(false),upscaled:draw(true),error:gl.getError()};
    }, code);
    assert.equal(result.error,0); assert.notDeepStrictEqual(result.linear,result.upscaled);
    assert(result.upscaled.every(v=>v>=0&&v<=255));
    assert(result.upscaled[0]===0&&result.upscaled[7]===255);
    console.log('GPU spatial reconstruction changes the interpolated edge and preserves its bounds:',result);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
