// Optional integration test: npm install --no-save playwright-core @sparticuz/chromium
// Run from repository root: node tests/gpu-bloom-readback.js
const fs = require("fs"),
  { chromium } = require("playwright-core");
(async () => {
  const bin = (await import(require.resolve("@sparticuz/chromium"))).default;
  const file = "shaders/fragment/isolateBrightPartsShader.frag",
    current = fs.readFileSync(file, "utf8"),
    app = fs.readFileSync("app.js", "utf8"),
    helper = app.slice(
      app.indexOf("function createPrecipitationCountReadback("),
      app.indexOf("\nfunction createHdrFBO()"),
    );
  let b = await chromium.launch({
    executablePath: await bin.executablePath(),
    args: [
      ...bin.args,
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
    headless: true,
  });
  let page = await b.newPage();
  let result = await page.evaluate(
    async ({ current, helper }) => {
      let canvas = document.createElement("canvas"),
        gl = canvas.getContext("webgl2");
      if (
        !gl ||
        !gl.getExtension("EXT_color_buffer_float") ||
        !gl.getExtension("OES_texture_float_linear")
      )
        throw Error("float unsupported");
      const vert = `#version 300 es\nprecision highp float;out vec2 texCoord; void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);texCoord=p;gl_Position=vec4(p*2.-1.,0,1);}`;
      function compile(t, s) {
        let a = gl.createShader(t);
        gl.shaderSource(a, s);
        gl.compileShader(a);
        if (!gl.getShaderParameter(a, gl.COMPILE_STATUS))
          throw Error(gl.getShaderInfoLog(a));
        return a;
      }
      function program(src) {
        let p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, vert));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, src));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
          throw Error(gl.getProgramInfoLog(p));
        return p;
      }
      function texture(w, h, data) {
        let t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA32F,
          w,
          h,
          0,
          gl.RGBA,
          gl.FLOAT,
          data,
        );
        return t;
      }
      function fbo(t) {
        let f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          t,
          0,
        );
        if (
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
        )
          throw Error("fbo");
        return f;
      }
      let currentProgram = program(current);
      function render(p, ratio, uniform, mode = "lightning") {
        const n = 64,
          d = n / ratio;
        let data = new Float32Array(n * n * 4);
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            let k = (y * n + x) * 4;
            if (uniform || x === 32) data.set([1000, 450, 200, 1000], k);
          }
        const scene = new Float32Array(data.length), lightning = new Float32Array(data.length);
        for (let i=0; i<data.length; i+=4) {
          if (data[i] === 0) continue;
          if (mode === "other" || mode === "fallback") scene.set([1000,450,200,1], i);
          else if (mode === "mixed") { scene.set([1500,1500,1500,1], i); lightning.set([1000,450,200,1000], i); }
          else {scene.set([1000,450,200,1], i); lightning.set([1000,450,200,1000], i);}
        }
        gl.activeTexture(gl.TEXTURE0);
        let tex = texture(n, n, scene);
        gl.activeTexture(gl.TEXTURE1);
        let tex2 = texture(n, n, lightning);
        let out = texture(d, d, null),
          f = fbo(out);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tex2);
        gl.useProgram(p);
        gl.uniform1i(gl.getUniformLocation(p, "hdrTex"), 0);
        gl.uniform1i(gl.getUniformLocation(p, "lightningBloomTex"), 1);
        gl.uniform1i(gl.getUniformLocation(p, "hasLightningBloom"), mode === "fallback" ? 0 : 1);
        gl.viewport(0, 0, d, d);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        let pixel = new Float32Array(4);
        gl.readPixels(
          Math.floor(32 / ratio),
          Math.floor(d / 2),
          1,
          1,
          gl.RGBA,
          gl.FLOAT,
          pixel,
        );
        return [...pixel];
      }
      let bloom = [];
      for (let ratio of [1, 2, 4, 8])
        for (let uniform of [false, true])
          bloom.push({
            ratio,
            uniform,
            output: render(currentProgram, ratio, uniform),
            error: gl.getError(),
          });
      let split = {};
      for (const mode of ["lightning", "other", "mixed", "fallback"])
        split[mode] = render(currentProgram, 1, true, mode);
      const factory = new Function(
        helper + ";return createPrecipitationCountReadback",
      )();
      let counts = [];
      for (let compact of [false, true]) {
        let reads = factory(gl, 3, compact);
        let src = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, src);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([0, 0, -2, 0, 1, 0, 0, 1, 0, 1, 0, 0, -1, 0, 1]),
          gl.STATIC_DRAW,
        );
        for (let n = 1; n <= 2; n++) {
          if (!compact) {
            let target = texture(1, 1, null);
            fbo(target);
            gl.clearBufferfv(gl.COLOR, 0, new Float32Array([7, 0, 0, 1]));
          }
          let immediate = reads.request(src, n);
          if (immediate) throw Error("unexpected synchronous readback");
          let ready = null;
          for (let i = 0; i < 100 && !ready; i++) {
            await new Promise((r) => setTimeout(r, 5));
            ready = reads.poll();
          }
          if (!ready) throw Error("readback timeout");
          counts.push({ compact, ...ready, error: gl.getError() });
        }
        reads.dispose();
      }
      return { bloom, counts, split };
    },
    { current, helper },
  );
  console.log(JSON.stringify(result, null, 2));
  if (
    result.bloom.some(
      (x) => x.error || x.output[0] <= 0 ||
        Math.abs(x.output[1] / x.output[0] - 0.45) > 0.002 ||
        (x.uniform && Math.abs(x.output[0] - 120) > 0.05)
    ) ||
    result.counts.some((x) => x.error || x.count !== (x.compact ? 2 : 7))
  )
    throw Error("regression");
  // Composite multiplies by 12. Lightning therefore contributes 12 times
  // the old bright-pass value, other highlights remain unchanged, and the
  // no-MRT fallback intentionally boosts all highlights.
  for (let c=0;c<3;c++) {
    const lightning = [1000,450,200][c], other = [500,500,500][c];
    const close = (actual, expected) => Math.abs(actual-expected) < .08;
    if (!close(result.split.lightning[c]*12, lightning*.12*12) ||
        !close(result.split.other[c]*12, lightning*.12) ||
        !close(result.split.mixed[c]*12, (lightning*12+other)*.12) ||
        !close(result.split.fallback[c]*12, lightning*.12*12))
      throw Error('lightning/scene bloom gain regression: '+JSON.stringify(result.split));
  }
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
