/*
 * Complex charge separation system — host-side GPU driver.
 *
 * This module implements the "non-inductive graupel–ice" electrification
 * model for the 2D weather sandbox and owns everything the simulation needs
 * to run it:
 *
 *   - the persistent charge-state textures (ping-ponged RGBA16F):
 *       R  charge carried by ice crystals (signed, lofted)
 *       G  charge carried by graupel (signed, settling)
 *       B  breakdown reservoir (negative right after a flash: -intensity)
 *       A  flash cooldown (1 = just discharged, decays toward 0)
 *   - the 1×1 "strike feedback" texture the slot manager consumes — each
 *     initiating cell adds (uv, 1, intensity) into it with additive blending,
 *     which is exactly the encoding the precipitation pass uses for droplets,
 *     so storms that flash in several cells in one iteration average into one
 *     strike instead of being dropped;
 *   - the two passes per iteration (the per-cell update, then a grid-scan
 *     point pass that re-emits only flashing cells into the feedback texel).
 *
 * The model itself lives in physics/chargeSeparationShader.frag; this file
 * is the driver and the tuning. The system is created once at simulation
 * start, but it only *runs* when the Physics > Complex Charge Separation
 * toggle in the UI is enabled (it is off by default, and the legacy
 * cloud-density lightning trigger is in charge until then).
 *
 * Everything here is dependency-free (no DOM except the global this attaches
 * to) so it can be unit-tested in Node with a stubbed WebGL2 context.
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  // Tunables for the reduced physical model. The GLSL mirrors these where the
  // math must happen in-shader; keep the two in sync (tests/check-charge-separation.js
  // pins the relationship between the JS mirrors here and the shader source).
  var TUNING = Object.freeze({
    SECONDS_PER_ITERATION: 0.288,   // 0.00008 h, same step the simulation counts
    CRYSTAL_FALL_MS: 0.6,           // small ice crystals settle slowly
    GRAUPEL_FALL_MS: 4.0,           // graupel settles fast through crystals
    CHARGE_ENERGY_COEFFICIENT: 0.0016, // separation work per collision (collisionPower)
    BREAKDOWN_RESERVOIR: 4.0,       // reservoir units needed to flash
    RESERVOIR_GAIN: 3.0,            // separation work -> reservoir units
    FLASH_CHARGE_FRACTION: 0.12,    // separated charge left after a flash
    COOLDOWN_DECAY: 0.985,          // per iteration
    COOLDOWN_FLASH_MIN: 0.15,       // ready-to-flash cooldown ceiling
    WET_NEUTRAL_TAU_SECONDS: 150.0, // ion attachment inside a dense cloud
    DRY_NEUTRAL_TAU_SECONDS: 8.0    // ion attachment in clear air
  });

  // ---------------------------------------------------------------------
  // Pure model helpers (mirrors of the GLSL; used by tests and diagnostics)
  // ---------------------------------------------------------------------
  function clamp(value, minValue, maxValue) {
    return Math.min(Math.max(value, minValue), maxValue);
  }

  function gaussianBand(value, centre, width) {
    var d = (value - centre) / width;
    return Math.exp(-d * d);
  }

  // Takahashi-style reversal temperature (°C). More liquid water shifts the
  // reversal warmer, so warm maritime cores charge in the graupel-negative
  // regime that builds the classic tripole.
  function reversalTemperatureC(liquidWaterContent) {
    return -20.0 + 12.0 * clamp((clamp(liquidWaterContent, 0, Infinity) - 0.5) / 3.5, 0, 1);
  }

  // Graupel sign below/above the reversal line: -1 = graupel charges negative
  // (classic thunderstorm), +1 = inverted regime.
  function graupelSign(temperatureC, liquidWaterContent) {
    return temperatureC < reversalTemperatureC(liquidWaterContent) ? -1 : 1;
  }

  // Supercooled mixed-phase weighting, 0..1; peaks near -15 °C.
  function mixedPhaseWeight(temperatureC) {
    return gaussianBand(temperatureC, -15.0, 11.0) *
      clamp(-temperatureC / 4.0, 0, 1) *
      clamp((temperatureC + 38.0) / 4.0, 0, 1);
  }

  function separationEfficiency(updraftMs) {
    return clamp((updraftMs - 0.2) / 3.0, 0, 1.25);
  }

  // Discharge intensity from the collision power at breakdown, 0.78..4.38.
  // <= 1.0 renders as an intra-cloud flash; above it as a CG return stroke.
  function flashIntensityForCollisionPower(collisionPower) {
    var power = clamp(collisionPower / 3.0, 0, 1);
    return 0.78 + 3.6 * Math.pow(power, 1.6);
  }

  // ---------------------------------------------------------------------
  // Feedback emitter shaders (kept here: they are the glue between the
  // update pass and the slot manager, not part of the physics).
  // ---------------------------------------------------------------------
  var EMIT_VERTEX_SOURCE = [
    '#version 300 es',
    'precision highp float;',
    'precision highp sampler2D;',
    'precision highp int;',
    '// One vertex per cell in the grid; cells whose reservoir channel holds the',
    '// negative "flashing" sentinel re-emit into the single feedback texel with',
    '// additive blending, exactly like the precipitation pass emits droplets.',
    'uniform sampler2D chargeTex;',
    'uniform vec2 resolution;',
    'out vec2 flashUv;',
    'out float flashIntensity;',
    'void main() {',
    '  int id = gl_VertexID;',
    '  ivec2 cell = ivec2(id % int(resolution.x), id / int(resolution.x));',
    '  vec4 state = texelFetch(chargeTex, cell, 0);',
    '  float stored = state.b;',
    '  if (stored >= -0.001) {',
    '    gl_Position = vec4(2.0, 2.0, 0.0, 1.0); // clipped away',
    '    gl_PointSize = 1.0;',
    '    flashUv = vec2(0.0);',
    '    flashIntensity = 0.0;',
    '    return;',
    '  }',
    '  flashUv = (vec2(cell) + vec2(0.5)) / resolution;',
    '  flashIntensity = -stored;',
    '  gl_Position = vec4(0.0, 0.0, 0.0, 1.0); // the single feedback texel (1×1 viewport)',
    '  gl_PointSize = 1.0;',
    '}'
  ].join('\n');

  var EMIT_FRAGMENT_SOURCE = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 flashUv;',
    'in float flashIntensity;',
    'layout(location = 0) out vec4 feedback;',
    'void main() {',
    '  feedback = vec4(flashUv, 1.0, flashIntensity);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------------
  // Program helpers
  // ---------------------------------------------------------------------
  function compileShader(gl, type, source, name) {
    var shader = gl.createShader(type);
    if (!shader)
      throw new Error('Unable to allocate shader: ' + name);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(name + ' COMPILATION ' + log);
    }
    return shader;
  }

  function linkProgram(gl, vertexShader, fragmentShader, name) {
    var program = gl.createProgram();
    if (!program)
      throw new Error('Unable to allocate a WebGL program for ' + name);
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(name + ' LINK ' + log);
    }
    return program;
  }

  // locate + cache uniform locations (missing uniforms are tolerated: the
  // driver sets what it finds, like the rest of the app)
  function locateUniforms(gl, program, names) {
    var locations = {};
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      try {
        locations[name] = gl.getUniformLocation(program, name);
      } catch (error) {
        locations[name] = null;
      }
    }
    return locations;
  }

  var STATE_UNIFORMS = [
    'baseTex', 'waterTex', 'chargeTex', 'resolution', 'texelSize', 'dryLapse',
    'secondsPerIteration', 'velocityToMs', 'crystalFallRaw', 'graupelFallRaw',
    'wrapHorizontally', 'chargeEnergyCoefficient', 'breakdownReservoir'
  ];
  var EMIT_UNIFORMS = ['chargeTex', 'resolution'];

  // ---------------------------------------------------------------------
  // createSystem(options)
  //
  // options:
  //   gl                 WebGL2 context (required)
  //   vertexShader       already-compiled simShader.vert object (fullscreen triangle)
  //   fragSource         the charge separation fragment shader source (text)
  //   simResX, simResY   grid size in cells
  //   cellHeightM        cell size in meters (vertical == horizontal)
  //   secondsPerIteration simulation budget step (TUNING.SECONDS_PER_ITERATION by default)
  //   dryLapse           potential-temperature lapse over the full column
  //   timePerIterationHours  scene step in hours (for the raw-velocity scale)
  //   compactFeedback    true => no EXT_float_blend; feedback uses RGBA16F + counts
  //
  // returns an object with step(), dispose() and the tuning in .tuning.
  // ---------------------------------------------------------------------
  function createSystem(options) {
    var gl = options.gl;
    if (!gl)
      throw new Error('ComplexChargeSeparation.createSystem: a WebGL2 context is required');
    var width = options.simResX | 0;
    var height = options.simResY | 0;
    if (!(width >= 50) || !(height >= 50))
      throw new Error('ComplexChargeSeparation.createSystem: implausible grid ' + width + 'x' + height);

    var compact = !!options.compactFeedback;
    var secondsPerIteration = Number.isFinite(options.secondsPerIteration)
      ? options.secondsPerIteration
      : TUNING.SECONDS_PER_ITERATION;
    var dryLapse = Number.isFinite(options.dryLapse) ? options.dryLapse : 10.0;
    var timePerIterationHours = Number.isFinite(options.timePerIterationHours)
      ? options.timePerIterationHours
      : 0.00008;
    var cellHeightM = Number.isFinite(options.cellHeightM) ? options.cellHeightM : 40.0;

    // raw velocity (cells/iteration) -> m/s
    var velocityToMs = cellHeightM / (timePerIterationHours * 3600.0);
    // carrier fall speeds in raw cells/iteration
    var crystalFallRaw = TUNING.CRYSTAL_FALL_MS * 3600.0 * timePerIterationHours / cellHeightM;
    var graupelFallRaw = TUNING.GRAUPEL_FALL_MS * 3600.0 * timePerIterationHours / cellHeightM;

    // ---- programmes ------------------------------------------------------
    var stateFragment = compileShader(gl, gl.FRAGMENT_SHADER, options.fragSource,
                                      'physics/chargeSeparationShader.frag');
    var stateProgram = linkProgram(gl, options.vertexShader, stateFragment, 'chargeSeparation');

    var emitVertex = compileShader(gl, gl.VERTEX_SHADER, EMIT_VERTEX_SOURCE, 'chargeFeedbackShader.vert');
    var emitFragment = compileShader(gl, gl.FRAGMENT_SHADER, EMIT_FRAGMENT_SOURCE, 'chargeFeedbackShader.frag');
    var emitProgram = linkProgram(gl, emitVertex, emitFragment, 'chargeFeedback');

    var stateLoc = locateUniforms(gl, stateProgram, STATE_UNIFORMS);
    var emitLoc = locateUniforms(gl, emitProgram, EMIT_UNIFORMS);

    // ---- state textures (ping-pong) --------------------------------------
    function createStateTexture() {
      var texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    }
    var stateTextures = [createStateTexture(), createStateTexture()];
    var stateFramebuffers = stateTextures.map(function (texture) {
      var framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      var clear = new Float32Array([0, 0, 0, 0]);
      gl.clearBufferfv(gl.COLOR, 0, clear);
      return framebuffer;
    });

    // ---- 1×1 strike feedback ----------------------------------------------
    var feedbackTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, feedbackTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, compact ? gl.RGBA16F : gl.RGBA32F, 1, 1, 0, gl.RGBA,
                  compact ? gl.HALF_FLOAT : gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var feedbackFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, feedbackFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, feedbackTexture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (typeof gl.checkFramebufferStatus === 'function' &&
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('Complex charge separation feedback framebuffer is incomplete.');

    // ---- empty VAO for the gl_VertexID point scan (no attributes) ---------
    var emitVao = typeof gl.createVertexArray === 'function' ? gl.createVertexArray() : null;

    var zeroColor = new Float32Array([0, 0, 0, 0]);
    var stateSource = 0; // index of the texture holding the previous state

    function step(stepOptions) {
      stepOptions = stepOptions || {};
      var dst = 1 - stateSource;
      var wrap = stepOptions.wrapHorizontally ? 1.0 : 0.0;

      // -- pass 1: per-cell model update ----------------------------------
      gl.viewport(0, 0, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, stateFramebuffers[dst]);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.useProgram(stateProgram);
      gl.uniform1i(stateLoc.baseTex, 0);
      gl.uniform1i(stateLoc.waterTex, 1);
      gl.uniform1i(stateLoc.chargeTex, 2);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, stepOptions.baseTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, stepOptions.waterTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, stateTextures[stateSource]);
      gl.uniform2f(stateLoc.resolution, width, height);
      gl.uniform2f(stateLoc.texelSize, 1 / width, 1 / height);
      gl.uniform1f(stateLoc.dryLapse, dryLapse);
      gl.uniform1f(stateLoc.secondsPerIteration, secondsPerIteration);
      gl.uniform1f(stateLoc.velocityToMs, velocityToMs);
      gl.uniform1f(stateLoc.crystalFallRaw, crystalFallRaw);
      gl.uniform1f(stateLoc.graupelFallRaw, graupelFallRaw);
      gl.uniform1f(stateLoc.wrapHorizontally, wrap);
      gl.uniform1f(stateLoc.chargeEnergyCoefficient, TUNING.CHARGE_ENERGY_COEFFICIENT);
      gl.uniform1f(stateLoc.breakdownReservoir, TUNING.BREAKDOWN_RESERVOIR);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // -- clear the 1×1 feedback, then re-emit flashing cells --------------
      gl.bindFramebuffer(gl.FRAMEBUFFER, feedbackFramebuffer);
      gl.viewport(0, 0, 1, 1);
      gl.clearBufferfv(gl.COLOR, 0, zeroColor);

      gl.useProgram(emitProgram);
      gl.uniform1i(emitLoc.chargeTex, 0);
      gl.uniform2f(emitLoc.resolution, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, stateTextures[dst]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // accumulate every flashing cell into the texel
      if (emitVao) gl.bindVertexArray(emitVao);
      gl.drawArrays(gl.POINTS, 0, width * height);
      if (emitVao) gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      // the new state becomes the source for the next iteration
      stateSource = dst;
      gl.viewport(0, 0, width, height);
      return true;
    }

    function dispose() {
      for (var i = 0; i < stateTextures.length; i++) {
        gl.deleteTexture(stateTextures[i]);
        gl.deleteFramebuffer(stateFramebuffers[i]);
      }
      gl.deleteTexture(feedbackTexture);
      gl.deleteFramebuffer(feedbackFramebuffer);
      if (emitVao && gl.deleteVertexArray) gl.deleteVertexArray(emitVao);
      gl.deleteProgram(stateProgram);
      gl.deleteProgram(emitProgram);
    }

    return {
      version: VERSION,
      tuning: TUNING,
      step: step,
      dispose: dispose,
      feedbackTexture: feedbackTexture,
      stateTextures: stateTextures,
      compactFeedback: compact,
      width: width,
      height: height
    };
  }

  var api = {
    VERSION: VERSION,
    TUNING: TUNING,
    reversalTemperatureC: reversalTemperatureC,
    graupelSign: graupelSign,
    gaussianBand: gaussianBand,
    mixedPhaseWeight: mixedPhaseWeight,
    separationEfficiency: separationEfficiency,
    flashIntensityForCollisionPower: flashIntensityForCollisionPower,
    createSystem: createSystem,
    EMIT_VERTEX_SOURCE: EMIT_VERTEX_SOURCE,
    EMIT_FRAGMENT_SOURCE: EMIT_FRAGMENT_SOURCE
  };

  global.ComplexChargeSeparation = api;
  if (typeof module !== 'undefined' && module.exports)
    module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
