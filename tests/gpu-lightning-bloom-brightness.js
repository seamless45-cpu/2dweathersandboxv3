// Optional real-WebGL regression: npm install --no-save playwright-core @sparticuz/chromium
// Run from the repository root with node tests/gpu-lightning-bloom-brightness.js.
const fs = require("fs"),
  { chromium } = require("playwright-core");
(async () => {
  const bin = (await import(require.resolve("@sparticuz/chromium"))).default;
  const bright = "shaders/fragment/isolateBrightPartsShader.frag",
    post = "shaders/fragment/postProcessingShader.frag";
  const read = (p) => fs.readFileSync(p, "utf8");
  const before = read(bright).replace(
    "mix(1.0, 4.0, lightningShare)",
    "mix(1.0, 1.0, lightningShare)",
  );
  if (before === read(bright)) throw Error("missing lightning gain");
  const inline = (s) =>
    s.replace(
      '#include "commonDisplay.glsl"',
      read("shaders/commonDisplay.glsl"),
    );
  const shader = {
    before,
    after: read(bright),
    post: inline(read(post)),
    blur: read("shaders/fragment/bloomBlurShader.frag"),
  };
  const browser = await chromium.launch({
    executablePath: await bin.executablePath(),
    args: [
      ...bin.args,
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
    headless: true,
  });
  let page = await browser.newPage();
  let out = await page.evaluate((s) => {
    const N = 128,
      c = document.createElement("canvas");
    c.width = c.height = N;
    const gl = c.getContext("webgl2", { preserveDrawingBuffer: true });
    if (
      !gl ||
      !gl.getExtension("EXT_color_buffer_float") ||
      !gl.getExtension("OES_texture_float_linear")
    )
      throw Error("float unsupported");
    const vert = `#version 300 es\nprecision highp float; uniform vec2 texelSize;out vec2 texCoord,texCoordXmY0,texCoordX0Ym,texCoordXpY0,texCoordX0Yp;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);texCoord=p;texCoordXmY0=p-vec2(texelSize.x,0);texCoordXpY0=p+vec2(texelSize.x,0);texCoordX0Ym=p-vec2(0,texelSize.y);texCoordX0Yp=p+vec2(0,texelSize.y);gl_Position=vec4(p*2.-1.,0,1);}`;
    function compile(type, src) {
      let a = gl.createShader(type);
      gl.shaderSource(a, src);
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
    let ps = Object.fromEntries(
      Object.entries(s).map(([k, v]) => [k, program(v)]),
    );
    function texture(w, h, data = null, int = false) {
      let t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        int ? gl.NEAREST : gl.LINEAR,
      );
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MAG_FILTER,
        int ? gl.NEAREST : gl.LINEAR,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (int)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8I,
          w,
          h,
          0,
          gl.RGBA_INTEGER,
          gl.BYTE,
          new Int8Array(w * h * 4),
        );
      else if (data)
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
      else
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA16F,
          w,
          h,
          0,
          gl.RGBA,
          gl.HALF_FLOAT,
          null,
        );
      return t;
    }
    function target(size) {
      let t = texture(size, size),
        f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        t,
        0,
      );
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw Error("fbo");
      return { t, f, size };
    }
    const zero = texture(N, N, new Float32Array(N * N * 4)),
      wall = texture(N, N, null, true);
    function bind(i, t) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
    }
    function ui(p, n, v) {
      gl.uniform1i(gl.getUniformLocation(p, n), v);
    }
    function uv(p, n, x, y) {
      gl.uniform2f(gl.getUniformLocation(p, n), x, y);
    }
    function draw(p, f, size) {
      gl.useProgram(p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.viewport(0, 0, size, size);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function run(which, scale, intensity, bg, fallback, enabled, ambient) {
      let scene = new Float32Array(N * N * 4),
        light = new Float32Array(N * N * 4);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          let i = (y * N + x) * 4;
          scene.set([...bg, 1], i);
          if (x === 64 && y >= 12 && y < 116) {
            scene.set([intensity, intensity, intensity, 1], i);
            if (!ambient)
              light.set(
                [intensity, intensity * 0.45, intensity * 0.2, intensity],
                i,
              );
          }
        }
      let st = texture(N, N, scene),
        lt = texture(N, N, light),
        levels = [];
      for (let size = N * scale; size >= 4; size >>= 1)
        levels.push(target(size));
      let p = ps[which];
      gl.useProgram(p);
      bind(0, st);
      bind(1, fallback ? st : lt);
      ui(p, "hdrTex", 0);
      ui(p, "lightningBloomTex", 1);
      ui(p, "hasLightningBloom", !fallback);
      gl.disable(gl.BLEND);
      draw(p, levels[0].f, levels[0].size);
      p = ps.blur;
      gl.useProgram(p);
      ui(p, "bloomTexture", 0);
      for (let i = 1; i < levels.length; i++) {
        bind(0, levels[i - 1].t);
        uv(p, "texelSize", 1 / levels[i - 1].size, 1 / levels[i - 1].size);
        draw(p, levels[i].f, levels[i].size);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = levels.length - 2; i >= 0; i--) {
        bind(0, levels[i + 1].t);
        uv(p, "texelSize", 1 / levels[i + 1].size, 1 / levels[i + 1].size);
        draw(p, levels[i].f, levels[i].size);
      }
      gl.disable(gl.BLEND);
      p = ps.post;
      gl.useProgram(p);
      for (let [i, t] of [
        st,
        levels[0].t,
        zero,
        zero,
        wall,
        fallback ? st : lt,
      ].entries())
        bind(i, t);
      for (let [n, v] of [
        ["hdrTex", 0],
        ["bloomTex", 1],
        ["historyTex", 2],
        ["velocityTex", 3],
        ["motionBlurWallTex", 4],
        ["lightningHaloTex", 5],
        ["bloomEnabled", enabled],
        ["hasLightningBloom", !fallback],
      ])
        ui(p, n, v);
      uv(p, "outputTexelSize", 1 / N, 1 / N);
      uv(p, "canvasTexelSize", 1 / N, 1 / N);
      gl.uniform1f(gl.getUniformLocation(p, "exposure"), 1);
      draw(p, null, N);
      let pixels = new Uint8Array(N * N * 4);
      gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let samples = [2, 4, 8, 16, 24, 32].map((x) => [
          x,
          ...pixels.slice((64 * N + 64 + x) * 4, (64 * N + 64 + x) * 4 + 3),
        ]),
        error = gl.getError();
      for (const level of levels) {
        gl.deleteFramebuffer(level.f);
        gl.deleteTexture(level.t);
      }
      gl.deleteTexture(st);
      gl.deleteTexture(lt);
      return { samples, error };
    }
    let results = {};
    for (let scale of [1, 0.5, 0.25])
      for (let intensity of [80, 20000])
        for (let mode of ["dark", "day", "fallback", "ambient"]) {
          let fallback = mode === "fallback",
            ambient = mode === "ambient",
            bg = mode === "day" ? [0.3, 0.45, 0.6] : [0.01, 0.01, 0.01],
            key = `${scale}-${intensity}-${mode}`;
          results[key] = {
            old: run("before", scale, intensity, bg, fallback, true, ambient),
            new: run("after", scale, intensity, bg, fallback, true, ambient),
            off: run("after", scale, intensity, bg, fallback, false, ambient),
          };
        }
    return results;
  }, shader);
  console.log(JSON.stringify(out, null, 2));
  for (const [key, v] of Object.entries(out)) {
    if (v.old.error || v.new.error || v.off.error)
      throw Error(key + " GL error");
    let a = v.old.samples[2][1],
      n = v.new.samples[2][1],
      off = v.off.samples[2][1];
    if (key.endsWith("-ambient")) {
      if (n !== a) throw Error(key + " changed non-lightning glow");
    } else if (!(n > a && n > off))
      throw Error(key + " no visible increase " + [a, n, off]);
    let profile = v.new.samples.map((x) => x[1]);
    if (
      !key.endsWith("-ambient") &&
      profile.some((x, i) => i > 0 && x >= profile[i - 1])
    )
      throw Error(key + " lost halo falloff " + profile);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
