/*
 * stormview.js — live integration between the fluid weather sandbox and
 * stormsim.js, the particle-based atmospheric microphysics + electrical
 * charge-separation + lightning engine.
 *
 * Responsibilities:
 *  - sample the GPU fluid state (base/water/wall textures) column-by-column
 *    in a strided round-robin, and feed stormsim's environment grid;
 *  - run stormsim in real time (it substeps internally and adapts its time
 *    steps and population budget);
 *  - render physically-derived overlays on a stacked WebGL2 canvas:
 *    hydrometeor sprites (per species), +/- charge tinting, charge density,
 *    electric-field magnitude / vectors, electric potential contours, and
 *    emergent lightning channels with leader/stroke/afterglow;
 *  - fire thunder through the existing sound system when flashes occur;
 *  - expose a dat.GUI control folder and graceful auto-quality scaling.
 *
 * Everything shown is computed from hydrometeor populations and the solved
 * Coulomb field — there are no scripted shapes, no random flash timings.
 */

'use strict';

(function () {

const SHADER_BASE = 'shaders/storm/';

/* ------------------------------------------------------------------ */
/* utilities                                                           */
/* ------------------------------------------------------------------ */

function fetchText(url) {
  return fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.text(); });
}

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    console.error('stormview shader compile error:', log);
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function linkProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('stormview program link error:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* main overlay object                                                 */
/* ------------------------------------------------------------------ */

class StormOverlay {
  constructor() {
    const qs = new URLSearchParams(location.search);
    this.params = {
      enabled: qs.get('storm') === '0' ? false : true,
      view: 'charge',            // charge|combined|species|chargeDensity|field|potential|realistic
      showCharges: true,         // master toggle for all charge overlays/tinting
      chargeRate: 1.0,
      particleBudget: 12000,
      alpha: 0.85,
      arrows: false,
      channelsOn: true,
      hud: true
    };
    this.sim = null;
    this.envNx = 64; this.envNy = 40;
    this.readyGL = false;
    this.failed = false;
    this.bootstrapped = false;
    this.sampleCursor = 0;
    this.lastIter = -1;
    this.lastFlashCount = 0;
    this.lastHud = 0;
    this.cpuEma = 0;
    this.qualityLevel = 0;     // 0 full, 1 reduced, 2 minimal
    this.particleOut = null;
    this.timeMs = 0;
    this._demoT = 0;              // >0 while demo thunderstorm injection is active

    // stacking canvas above the ecosystem overlay
    const cv = document.createElement('canvas');
    cv.id = 'stormOverlayCanvas';
    cv.style.position = 'fixed';
    cv.style.left = '0'; cv.style.top = '0';
    cv.style.width = '100vw'; cv.style.height = '100vh';
    cv.style.pointerEvents = 'none';
    cv.style.zIndex = '2';
    document.body.appendChild(cv);
    this.canvas = cv;
    this.gl = cv.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false });

    // HUD
    const hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:3;color:#cfe6ff;' +
      'background:#06101acc;padding:6px 9px;border-radius:4px;font:11px/1.45 monospace;' +
      'white-space:pre;pointer-events:none;display:block;';
    document.body.appendChild(hud);
    this.hud = hud;

    if (this.gl) this._initGL();
    this._attachGui();
  }

  /* ---------------------------- GUI -------------------------------- */
  _attachGui() {
    const attach = () => {
      if (typeof datGui === 'undefined' || !datGui) { setTimeout(attach, 600); return; }
      if (this._guiDone) return;
      this._guiDone = true;
      const folder = datGui.addFolder('Storm Physics & Electricity');
      folder.add(this.params, 'enabled').name('Enable storm physics')
        .onChange(() => { if (!this.params.enabled) this._clearCanvas(); });
      folder.add(this.params, 'view', {
        'Show Charges (+ red / − blue)': 'charge',
        'Combined (charges + density field)': 'combined',
        'Particles by species': 'species',
        'Charge density': 'chargeDensity',
        'Electric field magnitude': 'field',
        'Electric potential': 'potential',
        'Realistic (lightning only)': 'realistic'
      }).name('Visualization');
      folder.add(this.params, 'showCharges').name('Show Charges')
        .onChange(() => { /* takes effect next frame; HUD keeps stats */ });
      folder.add(this.params, 'chargeRate', 0.0, 6.0, 0.05).name('Charge separation rate')
        .onChange((v) => { if (this.sim) this.sim.chargeRate = v; });
      folder.add(this.params, 'particleBudget', 2000, 40000, 500).name('Particle budget')
        .onChange((v) => { if (this.sim) this.sim.setParticleBudget(v); });
      folder.add(this.params, 'alpha', 0.2, 1.0, 0.05).name('Particle opacity');
      folder.add(this.params, 'arrows').name('E-field vectors');
      folder.add(this.params, 'channelsOn').name('Lightning channels');
      folder.add(this.params, 'hud').name('Show stats HUD')
        .onChange((v) => { this.hud.style.display = v ? 'block' : 'none'; });
      folder.add({ startDemo: () => this.startDemoStorm() }, 'startDemo')
        .name('\u26a1 Spawn demo thunderstorm');
      folder.open();
      this._guiFolder = folder;
    };
    attach();
  }

  /* ---------------------------- GL --------------------------------- */
  _initGL() {
    const gl = this.gl;
    this.glProgramMeta = {};
    const names = ['points', 'field', 'lines', 'arrows'];
    const pairs = {
      points: ['points.vert', 'points.frag'],
      field: ['quad.vert', 'field.frag'],
      lines: ['lines.vert', 'lines.frag'],
      arrows: ['arrows.vert', 'arrows.frag']
    };
    Promise.all(Object.keys(pairs).map((k) =>
      Promise.all([fetchText(SHADER_BASE + pairs[k][0]), fetchText(SHADER_BASE + pairs[k][1])])
        .then(([vs, fs]) => [k, vs, fs])
    )).then((loaded) => {
      for (const [k, vs, fs] of loaded) {
        const prog = linkProgram(gl, vs, fs);
        if (!prog) { this.failed = true; return; }
        this['prog_' + k] = prog;
      }
      // buffers
      this.vaoPoints = gl.createVertexArray();
      this.bufPos = gl.createBuffer();
      this.bufData = gl.createBuffer();
      this.bufMisc = gl.createBuffer();
      gl.bindVertexArray(this.vaoPoints);
      const P = this.prog_points;
      const setup = (buf, loc, size) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      setup(this.bufPos, gl.getAttribLocation(P, 'simPos'), 2);
      setup(this.bufData, gl.getAttribLocation(P, 'pData'), 4);
      setup(this.bufMisc, gl.getAttribLocation(P, 'pMisc'), 2);

      this.vaoLines = gl.createVertexArray();
      this.bufLinePos = gl.createBuffer();
      this.glLineData = gl.createBuffer();
      gl.bindVertexArray(this.vaoLines);
      const L = this.prog_lines;
      setup(this.bufLinePos, gl.getAttribLocation(L, 'simPos'), 2);
      setup(this.glLineData, gl.getAttribLocation(L, 'lData'), 2);

      this.vaoArrows = gl.createVertexArray();
      this.bufArrPos = gl.createBuffer();
      this.bufArrVec = gl.createBuffer();
      this.bufArrMag = gl.createBuffer();
      gl.bindVertexArray(this.vaoArrows);
      const A = this.prog_arrows;
      setup(this.bufArrPos, gl.getAttribLocation(A, 'simPos'), 2);
      setup(this.bufArrVec, gl.getAttribLocation(A, 'vec'), 2);
      setup(this.bufArrMag, gl.getAttribLocation(A, 'mag'), 1);

      this.vaoQuad = gl.createVertexArray();
      this.bufQuad = gl.createBuffer();
      gl.bindVertexArray(this.vaoQuad);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufQuad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const F = this.prog_field;
      gl.enableVertexAttribArray(gl.getAttribLocation(F, 'vertPosition'));
      gl.vertexAttribPointer(gl.getAttribLocation(F, 'vertPosition'), 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      // field texture
      this.fieldTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.readyGL = true;
    }).catch((e) => { console.error('stormview shader load failed:', e); this.failed = true; });
  }

  _clearCanvas() {
    if (!this.gl) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.hud.textContent = '';
  }

  rebuild() { this.sim = null; this.bootstrapped = false; }

  /* -------------------- environment sampling ----------------------- */
  _dimensionsChanged() {
    return this.sim && (this.sim.env.wCells !== sim_res_x || this.sim.env.hCells !== sim_res_y);
  }

  _ensureSim() {
    if (!window.StormSimAPI || typeof sim_res_x === 'undefined') return false;
    if (this.sim && this._dimensionsChanged()) this.rebuild();
    if (!this.sim) {
      const S = window.StormSimAPI;
      this.envNx = Math.max(32, Math.min(96, Math.round(sim_res_x / 16)));
      this.envNy = Math.max(28, Math.min(64, Math.round(sim_res_y / 5)));
      this.sim = new S.StormSim({
        seed: (Math.random() * 1e9) >>> 0,
        maxParticles: this.params.particleBudget,
        chargeRate: this.params.chargeRate,
        widthM: sim_res_x * cellHeight,
        heightM: sim_res_y * cellHeight,
        wrapX: !!guiControls.wrapHorizontally,
        fieldNX: 96, fieldNY: 64
      });
      // allocate env arrays
      const n = this.envNx * this.envNy;
      this._envObj = {
        nx: this.envNx, ny: this.envNy,
        wCells: sim_res_x, hCells: sim_res_y,
        cellSizeM: cellHeight, iterSeconds: timePerIteration * 3600.0,
        vx: new Float32Array(n), vy: new Float32Array(n), tK: new Float32Array(n),
        vapor: new Float32Array(n), cloud: new Float32Array(n),
        precip: new Float32Array(n), wall: new Uint8Array(n)
      };
      this.sampleCursor = 0;
      this.bootstrapped = false;
    }
    return !!this.sim;
  }

  /** Read one sim column and fold it into the coarse environment grid. */
  _sampleColumn(gl2, ix) {
    const envNx = this.envNx, envNy = this.envNy;
    const simX = Math.min(sim_res_x - 1, Math.max(0, Math.floor(((ix + 0.5) / envNx) * sim_res_x)));

    gl2.bindFramebuffer(gl2.FRAMEBUFFER, this._frameBuff());
    gl2.readBuffer(gl2.COLOR_ATTACHMENT0);
    gl2.readPixels(simX, 0, 1, sim_res_y, gl2.RGBA, gl2.FLOAT, this._colBase);
    gl2.readBuffer(gl2.COLOR_ATTACHMENT1);
    gl2.readPixels(simX, 0, 1, sim_res_y, gl2.RGBA, gl2.FLOAT, this._colWater);
    gl2.readBuffer(gl2.COLOR_ATTACHMENT2);
    gl2.readPixels(simX, 0, 1, sim_res_y, gl2.RGBA_INTEGER, gl2.INT, this._colWall);

    const E = this._envObj;
    const rowsPerSim = sim_res_y / envNy;
    for (let j = 0; j < envNy; j++) {
      const y0 = Math.floor(j * rowsPerSim);
      const y1 = Math.max(y0 + 1, Math.min(sim_res_y, Math.ceil((j + 1) * rowsPerSim)));
      let vx = 0, vy = 0, t = 0, vap = 0, cld = 0, wall = 0;
      const cnt = y1 - y0;
      for (let y = y0; y < y1; y++) {
        const b = y * 4;
        vx += this._colBase[b]; vy += this._colBase[b + 1];
        // potentialToRealT per row to be exact
        t += typeof potentialToRealT === 'function' ?
          potentialToRealT(this._colBase[b + 3], y) :
          (this._colBase[b + 3] - (y / sim_res_y) * dryLapse);
        vap += this._colWater[b]; cld += this._colWater[b + 1];
        wall += this._colWall[b + 1] == 0 ? 1 : 0; // row type: 0 = wall
      }
      const io = ix * envNy + j;
      E.vx[io] = vx / cnt; E.vy[io] = vy / cnt; E.tK[io] = t / cnt;
      E.vapor[io] = vap / cnt; E.cloud[io] = cld / cnt;
      E.wall[io] = wall > cnt * 0.4 ? 1 : 0;
    }
    // precipitation proxy: condensate share that is falling; strongly smoothed
    // downwards so a plume of cloud establishes a falling precip core below it
    for (let j = envNy - 2; j >= 0; j--) {
      const io = ix * envNy + j, ia = ix * envNy + j + 1;
      const baseP = Math.max(0, E.cloud[io] - 0.45) * 0.9;
      E.precip[io] = Math.max(baseP, E.precip[ia] * 0.82);
    }
    const topP = Math.max(0, E.cloud[ix * envNy + envNy - 1] - 0.45) * 0.9;
    E.precip[ix * envNy + envNy - 1] = topP;
    if (this._demoT > 0) this._injectDemoColumn(E, ix);
    this.sim.updateEnvColumn(ix, E._colScratch ? E._colScratch : this._makeColScratch(ix));
  }

  /** Superimpose a synthetic mature thunderstorm column while demo mode runs. */
  startDemoStorm() {
    this._demoT = 180.0; // simulated seconds of injection
    if (this.sim) this.sim.chargeRate = Math.max(this.sim.chargeRate, 2.5);
    this.params.chargeRate = Math.max(this.params.chargeRate, 2.5);
    console.log('[StormEngine v1.1] demo thunderstorm injected (~3 simulated minutes)');
  }

  _injectDemoColumn(E, ix) {
    const envNy = this.envNy;
    const x0 = Math.floor(this.envNx * 0.28), x1 = Math.floor(this.envNx * 0.72);
    if (ix < x0 || ix > x1) return;
    const u = (ix - x0) / Math.max(1, x1 - x0);       // 0..1 across the cell
    const upCore = Math.sin(Math.PI * u);             // updraft envelope
    const mid = (x0 + x1) / 2;
    const toward = Math.sign(mid - ix) || 1;          // low-level convergence
    const km = E.cellSizeM / 1000;
    for (let j = 0; j < envNy; j++) {
      const zk = (j + 0.5) * km;
      const io = ix * envNy + j;
      if (E.wall[io]) continue;
      const g = (zc, zw) => Math.exp(-((zk - zc) / zw) * ((zk - zc) / zw));
      // moisten and warm the column
      E.vapor[io] = Math.min(32, E.vapor[io] + 6.0 * g(2.5, 6));
      E.tK[io] += 2.5 * upCore * (zk < 8 ? 1 : 0.4);
      // cloud between ~1.5 and 10.5 km, precip core underneath
      E.cloud[io] = Math.max(E.cloud[io], 2.4 * g(5.5, 3.0) * (0.4 + 0.6 * upCore));
      E.precip[io] = Math.max(E.precip[io], 1.3 * g(2.5, 1.9) * upCore);
      // organized updraft with convergence/divergence pattern
      E.vy[io] = Math.max(E.vy[io], 22.0 * upCore * g(5.0, 3.6));
      E.vx[io] += 7.0 * toward * g(1.2, 1.6) - 6.0 * toward * g(9.0, 2.2);
    }
  }

  _makeColScratch(ix) {
    // slice views into the env arrays for column ix
    const E = this._envObj, ny = this.envNy, o = ix * ny;
    const scratch = {
      vx: E.vx.subarray(o, o + ny), vy: E.vy.subarray(o, o + ny),
      tK: E.tK.subarray(o, o + ny), vapor: E.vapor.subarray(o, o + ny),
      cloud: E.cloud.subarray(o, o + ny), precip: E.precip.subarray(o, o + ny),
      wall: E.wall.subarray(o, o + ny)
    };
    this._scratches = this._scratches || {};
    this._scratches[ix] = scratch;
    return scratch;
  }

  _sampleSomeColumns() {
    if (!this.sim) return;
    const glApp = (typeof gl !== 'undefined') ? gl : null;
    const fb = this._frameBuff();
    if (!glApp || !fb) return;
    if (!this._colBase || this._colBase.length !== sim_res_y * 4) {
      this._colBase = new Float32Array(sim_res_y * 4);
      this._colWater = new Float32Array(sim_res_y * 4);
      this._colWall = new Int32Array(sim_res_y * 4);
      this._scratches = {};
    }
    if (!this._envObj) {
      this.sim.setEnvironment(this._buildZeroEnv());
      return;
    }
    const colsPerFrame = this.bootstrapped ? 3 : 24;
    const savedFb = glApp.getParameter(glApp.FRAMEBUFFER_BINDING);
    const savedRead = glApp.getParameter(glApp.READ_BUFFER);
    for (let k = 0; k < colsPerFrame; k++) {
      const ix = this.sampleCursor;
      this._sampleColumn(glApp, ix);
      this.sampleCursor = (this.sampleCursor + 1) % this.envNx;
      if (this.sampleCursor === 0) this.bootstrapped = true;
    }
    // leave GL read state exactly as found (BACK is only valid unbound)
    glApp.bindFramebuffer(glApp.FRAMEBUFFER, savedFb);
    try { glApp.readBuffer(savedRead); } catch (e) { /* BACK vs attachment edge */ }
  }

  _buildZeroEnv() {
    // used on the very first frame (before any real sample): neutral calm
    const E = this._envObj;
    E.vx.fill(0); E.vy.fill(0);
    for (let j = 0; j < this.envNy; j++) {
      const tK = 288.0 - 6.5 * (j / this.envNy) * 12.0;
      for (let ix = 0; ix < this.envNx; ix++) {
        const io = ix * this.envNy + j;
        E.tK[io] = tK; E.vapor[io] = 3.0; E.cloud[io] = 0; E.precip[io] = 0; E.wall[io] = j === 0 ? 1 : 0;
      }
    }
    return E;
  }

  // app.js exposes the function-scoped FBO on window (see mainScript)
  _frameBuff() {
    return (typeof window !== 'undefined' && window.frameBuff_1) ?
      window.frameBuff_1 : (typeof frameBuff_1 !== 'undefined' ? frameBuff_1 : null);
  }

  /* ------------------------- per-frame ----------------------------- */
  lightningGate() { return (this.params.enabled && this.sim) ? 0.0 : 1.0; }

  frame() {
    if (!this.gl || this.failed || !this.readyGL || !this.params.enabled) return;
    if (typeof iterNum === 'undefined' || !this._frameBuff()) return;
    if (typeof SETUP_MODE !== 'undefined' && SETUP_MODE) return;
    const t0 = performance.now();

    if (!this._ensureSim()) return;
    this._sampleSomeColumns();

    // step physics with the amount of simulated time that just passed
    const dIter = Math.max(0, iterNum - this.lastIter);
    this.lastIter = iterNum;
    const dt = Math.min(dIter * timePerIteration * 3600.0, 25.0);
    if (dt > 0.0 && this.bootstrapped) {
      this.sim.chargeRate = this.params.chargeRate;
      this.sim.step(dt);
      if (this._demoT > 0) {
        this._demoT -= dt;
        if (this._demoT <= 0) console.log('[StormEngine v1.1] demo thunderstorm injection ended');
      }
    }

    this._render();
    this._maybeSound();
    this._updateHud(t0);

    const ms = performance.now() - t0;
    this.cpuEma = this.cpuEma * 0.95 + ms * 0.05;
    this._autoQuality();
  }

  _view() {
    const out = { x: 0, y: 0, z: 1, ax: 1, ab: 1, xmult: 1 };
    if (typeof cam !== 'undefined') { out.x = cam.curXpos; out.y = cam.curYpos; out.z = cam.curZoom; }
    if (typeof sim_aspect !== 'undefined') out.ax = sim_aspect;
    if (typeof canvas_aspect !== 'undefined') out.ab = canvas_aspect;
    if (typeof horizontalDisplayMult !== 'undefined') out.xmult = horizontalDisplayMult;
    return out;
  }

  _render() {
    const gl = this.gl, cv = this.canvas, appCv = window.canvas;
    if (appCv && (cv.width !== appCv.width || cv.height !== appCv.height)) {
      cv.width = appCv.width; cv.height = appCv.height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);

    const v = this._view();
    const mode = this.params.view;
    const chargeOn = this.params.showCharges;
    // 'charge' without the toggle degrades to a clear species view; 'combined'
    // keeps species particles but swaps the density film for E magnitude
    const effMode = (!chargeOn && mode === 'charge') ? 'species' : mode;
    const drawParticles = effMode === 'species' || effMode === 'charge' || effMode === 'combined';
    const drawField = effMode === 'chargeDensity' ? 0 : effMode === 'field' ? 1 :
                      effMode === 'potential' ? 2 : effMode === 'combined' ? (chargeOn ? 3 : 1) : -1;
    const colorModeEff = effMode === 'charge' ? (chargeOn ? 1 : 0) : (effMode === 'combined' ? (chargeOn ? 2 : 0) : 0);

    // ---- field overlay ----
    if (drawField >= 0 && this._uploadField()) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.prog_field);
      gl.bindVertexArray(this.vaoQuad);
      gl.uniform1i(gl.getUniformLocation(this.prog_field, 'fieldTex'), 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
      const F = this._fieldMeta;
      gl.uniform2f(gl.getUniformLocation(this.prog_field, 'gridCells'), F.nx, F.ny);
      gl.uniform1i(gl.getUniformLocation(this.prog_field, 'mode'), drawField);
      gl.uniform1f(gl.getUniformLocation(this.prog_field, 'maxRho'), F.maxRho);
      gl.uniform1f(gl.getUniformLocation(this.prog_field, 'maxE'), F.maxE);
      gl.uniform1f(gl.getUniformLocation(this.prog_field, 'maxPhi'), F.maxPhi);
      gl.uniform1f(gl.getUniformLocation(this.prog_field, 'alphaScale'), 0.85);
      this._setViewUniforms(this.prog_field, v);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ---- E-field arrows ----
    if ((this.params.arrows || effMode === 'field') && this._buildArrows()) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.prog_arrows);
      gl.bindVertexArray(this.vaoArrows);
      gl.uniform1f(gl.getUniformLocation(this.prog_arrows, 'extentFrac'), 0.015);
      this._setViewUniforms(this.prog_arrows, v);
      gl.drawArrays(gl.POINTS, 0, this._arrowCount);
    }

    // ---- particles ----
    if (drawParticles) {
      const out = this.sim.getParticles(this.particleOut);
      this.particleOut = out;
      if (out.count > 0) {
        // normalize positions into sim fraction [0..1]
        const n = out.count;
        if (!this._posN || this._posN.length < n * 2) this._posN = new Float32Array(n * 2);
        const posN = this._posN, pos = out.pos;
        for (let i = 0; i < n; i++) { posN[i * 2] = pos[i * 2] / this.sim.env.wCells; posN[i * 2 + 1] = pos[i * 2 + 1] / this.sim.env.hCells; }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.prog_points);
        gl.bindVertexArray(this.vaoPoints);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
        gl.bufferData(gl.ARRAY_BUFFER, posN.subarray(0, n * 2), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufData);
        gl.bufferData(gl.ARRAY_BUFFER, out.data.subarray(0, n * 4), gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufMisc);
        gl.bufferData(gl.ARRAY_BUFFER, out.misc.subarray(0, n * 2), gl.DYNAMIC_DRAW);
        const P = this.prog_points;
        // super-particles are statistical cohorts: size with a small
        // physical component and a visibility floor (see shader)
        gl.uniform1f(gl.getUniformLocation(P, 'pointScale'), 6.0);
        gl.uniform1i(gl.getUniformLocation(P, 'colorMode'), colorModeEff);
        gl.uniform1f(gl.getUniformLocation(P, 'alphaScale'), this.params.alpha);
        this._setViewUniforms(P, v);
        gl.drawArrays(gl.POINTS, 0, n);
      }
    }

    // ---- lightning channels ----
    if (this.params.channelsOn && this._buildLines()) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(this.prog_lines);
      gl.bindVertexArray(this.vaoLines);
      this._setViewUniforms(this.prog_lines, v);
      gl.drawArrays(gl.LINES, 0, this._lineVertCount);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  _setViewUniforms(prog, v) {
    const gl = this.gl;
    gl.uniform2f(gl.getUniformLocation(prog, 'aspectRatios'), v.ax, v.ab);
    gl.uniform3f(gl.getUniformLocation(prog, 'view'), v.x, v.y, v.z);
    gl.uniform1f(gl.getUniformLocation(prog, 'Xmult'), v.xmult);
  }

  _uploadField() {
    const gl = this.gl;
    const ft = this.sim.getFieldTextures();
    const n = ft.nx * ft.ny;
    if (!this._fieldPix || this._fieldPix.length !== n * 4) this._fieldPix = new Float32Array(n * 4);
    let maxRho = 1e-12, maxE = 1, maxPhi = 1;
    const rho = ft.rho, emag = ft.emag, phi = ft.phi, pix = this._fieldPix;
    for (let i = 0; i < n; i++) {
      const r = rho[i], e = emag[i], p = phi[i];
      pix[i * 4] = r; pix[i * 4 + 1] = e; pix[i * 4 + 2] = p; pix[i * 4 + 3] = 0;
      const ar = Math.abs(r);
      if (ar > maxRho) maxRho = ar;
      if (e > maxE) maxE = e;
      const ap = Math.abs(p);
      if (ap > maxPhi) maxPhi = ap;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    if (!this._fieldMeta || this._fieldMeta.nx !== ft.nx || this._fieldMeta.ny !== ft.ny) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ft.nx, ft.ny, 0, gl.RGBA, gl.FLOAT, pix);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ft.nx, ft.ny, gl.RGBA, gl.FLOAT, pix);
    }
    this._fieldMeta = { nx: ft.nx, ny: ft.ny, maxRho, maxE, maxPhi };
    return true;
  }

  _buildLines() {
    const gl = this.gl;
    const chans = this.sim.getChannels();
    let segs = 0;
    for (const ch of chans) segs += ch.segBright.length;
    if (segs === 0) return false;
    if (!this._linePosArr || this._linePosArr.length < segs * 4) {
      this._linePosArr = new Float32Array(segs * 4);
      this._lineDatArr = new Float32Array(segs * 4);
    }
    const widthM = this.sim.env.wCells * this.sim.env.cellSizeM;
    const heightM = this.sim.env.hCells * this.sim.env.cellSizeM;
    let v = 0;
    for (const ch of chans) {
      const pol = ch.polarity;
      for (let s = 0; s < ch.segA.length; s++) {
        const a = ch.segA[s], b = ch.segB[s], br = ch.segBright[s];
        this._linePosArr[v * 4] = ch.nodesX[a] / widthM;
        this._linePosArr[v * 4 + 1] = ch.nodesY[a] / heightM;
        this._linePosArr[v * 4 + 2] = ch.nodesX[b] / widthM;
        this._linePosArr[v * 4 + 3] = ch.nodesY[b] / heightM;
        this._lineDatArr[v * 4] = br; this._lineDatArr[v * 4 + 1] = pol;
        this._lineDatArr[v * 4 + 2] = br; this._lineDatArr[v * 4 + 3] = pol;
        v++;
      }
    }
    this._lineVertCount = v * 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLinePos);
    gl.bufferData(gl.ARRAY_BUFFER, this._linePosArr.subarray(0, v * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glLineData);
    gl.bufferData(gl.ARRAY_BUFFER, this._lineDatArr.subarray(0, v * 4), gl.DYNAMIC_DRAW);
    return true;
  }

  _buildArrows() {
    const gl = this.gl;
    const ft = this.sim.getFieldTextures();
    const stepX = Math.max(1, Math.floor(ft.nx / 22));
    const stepY = Math.max(1, Math.floor(ft.ny / 12));
    let count = 0;
    const maxCount = 600;
    if (!this._arrPos || this._arrPos.length < maxCount * 2) {
      this._arrPos = new Float32Array(maxCount * 2);
      this._arrVec = new Float32Array(maxCount * 2);
      this._arrMag = new Float32Array(maxCount);
    }
    let maxE = 1;
    for (let i = 0; i < ft.nx * ft.ny; i++) if (ft.emag[i] > maxE) maxE = ft.emag[i];
    for (let iy = 0; iy < ft.ny; iy += stepY) {
      for (let ix = 0; ix < ft.nx; ix += stepX) {
        if (count >= maxCount) break;
        const i = iy * 0 + ix * ft.ny + iy; // field arrays are x-major (y fastest)
        const e = ft.emag[i];
        const ex = ft.ex[i], ey = ft.ey[i];
        this._arrPos[count * 2] = ((ix + 0.5) / ft.nx);
        this._arrPos[count * 2 + 1] = ((iy + 0.5) / ft.ny);
        const inv = e > 1e-6 ? 1 / e : 0;
        this._arrVec[count * 2] = ex * inv;
        this._arrVec[count * 2 + 1] = ey * inv;
        this._arrMag[count] = Math.min(1, e / maxE);
        count++;
      }
    }
    this._arrowCount = count;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufArrPos);
    gl.bufferData(gl.ARRAY_BUFFER, this._arrPos.subarray(0, count * 2), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufArrVec);
    gl.bufferData(gl.ARRAY_BUFFER, this._arrVec.subarray(0, count * 2), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufArrMag);
    gl.bufferData(gl.ARRAY_BUFFER, this._arrMag.subarray(0, count), gl.DYNAMIC_DRAW);
    return count > 0;
  }

  _maybeSound() {
    if (typeof guiControls === 'undefined' || !guiControls.sound) return;
    if (typeof soundSystem === 'undefined' || !soundSystem.soundThunder) return;
    const st = this.sim.getStats();
    if (st.flashes > this.lastFlashCount) {
      // find the freshest channel
      let best = null, bestT = -1;
      for (const ch of this.sim.getChannels()) {
        if (ch.flashLevel > bestT) { bestT = ch.flashLevel; best = ch; }
      }
      if (best) {
        const wM = this.sim.env.wCells * this.sim.env.cellSizeM;
        const hM = this.sim.env.hCells * this.sim.env.cellSizeM;
        const intensity = Math.max(0.3, Math.min(4.0,
          best.toGround ? 2.2 * best.flashLevel : 0.9 * best.flashLevel));
        try {
          soundSystem.soundThunder(best.attachX / wM, best.attachY / hM, intensity);
        } catch (e) { /* sound not ready */ }
      }
      this.lastFlashCount = st.flashes;
    }
  }

  _updateHud(t0) {
    if (!this.params.hud) return;
    if (t0 - this.lastHud < 250) return;
    this.lastHud = t0;
    const st = this.sim.getStats();
    const counts = st.perType;
    this.hud.textContent =
      `storm engine v1.1   t=${st.time.toFixed(0)}s   cpu=${this.cpuEma.toFixed(1)}ms` +
      `\nhydrometeors ${st.particles}  (cl${counts[0]} sc${counts[1]} ice${counts[2]} sn${counts[3]} gr${counts[4]} hail${counts[5]} rain${counts[6]})` +
      `\ncharge +${st.qPositive.toExponential(2)} / ${st.qNegative.toExponential(2)} C   E max ${st.maxField.toExponential(2)} V/m` +
      `\nflashes ${st.flashes}   ch.on ${st.channels}   ground ${st.qGround.toExponential(2)} C` +
      `\ntripole +${st.structure.upperPositive.toExponential(1)} / ${st.structure.mainNegative.toExponential(1)} / +${st.structure.lowerPositive.toExponential(1)}` +
      (this._demoT > 0 ? `\nDEMO STORM injecting ${this._demoT.toFixed(0)}s` : '');
  }

  _autoQuality() {
    const ema = this.cpuEma;
    let level = 0;
    if (ema > 10.0) level = 2; else if (ema > 5.5) level = 1;
    if (level !== this.qualityLevel) {
      this.qualityLevel = level;
      // stabilize: apply after a short delay implicitly via next frames
      const budgetScale = level === 0 ? 1.0 : level === 1 ? 0.6 : 0.35;
      this.sim.setParticleBudget(this.params.particleBudget * budgetScale);
    }
  }
}

const overlay = new StormOverlay();
window.stormOverlay = overlay;
console.log('[StormEngine v1.1] Show Charges toggle + charge-pattern lightning active');

})();
