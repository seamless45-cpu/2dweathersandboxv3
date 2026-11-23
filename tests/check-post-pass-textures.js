// Post-processing pass texture-binding harness.
//
// The black-screen-after-load failure this pins down: GL draw-time sampler
// validation checks every statically used sampler of a program, not just the
// ones the current frame actually taps. The HDR display path binds the
// signed-integer wall texture (RGBA8I) to texture unit 2 for the display
// shader's isampler2D. The post-processing pass binds unit 2 to
// `historyTex` — a plain sampler2D — but only when a temporal-history
// texture exists (temporal anti-aliasing or motion blur, both off by
// default). Without it, the float sampler kept pointing at the RGBA8I wall
// texture: GL_INVALID_OPERATION ("Mismatch between texture format and
// sampler type"), the fullscreen draw to the canvas was discarded every
// frame, and the user was left with an opaque black canvas and a working
// simulation behind it.
//
// Same story for unit 1 (`bloomTex`) when every bloom target is
// unallocatable on a device: no binding at all left whatever the previous
// pass had bound there.
//
// The fix binds a float texture (hdrFBO) as the fallback on both units, and
// this suite pins:
//
//   1. The wall texture really is signed-integer (the hazard exists).
//   2. The HDR pass binds it to unit 2 (the stale binding really happens).
//   3. postProcessingShader.frag declares hdrTex/bloomTex/historyTex/velocityTex
//      as sampler2D (a float sampler against an integer texture is the hard error).
//   4. The post pass always binds a sampler2D-compatible texture to units
//      1 and 2, in the else branch of the optional bindings.
//   5. The #dropletInfoCanvas overlay starts hidden and pointer-events:none,
//      and the app only shows it while a droplet is followed — it used to be
//      an always-on, invisible, click-eating 90x50 box dead centre over the
//      canvas, which silently swallowed the click that starts the simulation.
//
// Usage:  node tests/check-post-pass-textures.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSource = read('app.js');
const htmlSource = read('index.html');
const postShader = read('shaders/fragment/postProcessingShader.frag');

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, detail === undefined ? '' : '- ' + detail);
  }
}

// Post-pass section: from the lazy history-texture allocation to the draw to canvas.
const postPass = (() => {
  const start = appSource.indexOf('if ((guiControls.temporalAAEnabled || guiControls.motionBlurEnabled) && !temporalHistoryTexture)');
  const end = appSource.indexOf('gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to canvas', start);
  return start >= 0 && end > start ? appSource.slice(start, end) : '';
})();

check('wall textures are created as signed-integer RGBA8I (the stale-binding hazard)',
  (appSource.match(/gl\.texImage2D\(gl\.TEXTURE_2D, 0, gl\.RGBA8I, sim_res_x, sim_res_y, 0, gl\.RGBA_INTEGER, gl\.BYTE,/g) || []).length >= 2);

check('the HDR pass binds the signed-integer wall texture to texture unit 2',
  /gl\.activeTexture\(gl\.TEXTURE2\);\s*\n\s*gl\.bindTexture\(gl\.TEXTURE_2D, wallTexture_1\);/.test(appSource));

check('postProcessingShader.frag declares hdrTex/bloomTex/historyTex/velocityTex as float sampler2D',
  /uniform sampler2D hdrTex;/.test(postShader) &&
  /uniform sampler2D bloomTex;/.test(postShader) &&
  /uniform sampler2D historyTex;/.test(postShader) &&
  /uniform sampler2D velocityTex;/.test(postShader));

check('unit 1 always receives a texture: bloom pyramid when present, HDR fallback otherwise',
  /gl\.activeTexture\(gl\.TEXTURE1\);\s*\n\s*if \(bloomFBOs\.length\)[^\n]*\n\s*gl\.bindTexture\(gl\.TEXTURE_2D, bloomFBOs\[0\]\.texture\);\s*\n\s*else\s*\n\s*gl\.bindTexture\(gl\.TEXTURE_2D, sceneHdrFBO\.texture\);/.test(postPass));

check('unit 2 always receives a texture: history when it exists, HDR fallback otherwise',
  /gl\.activeTexture\(gl\.TEXTURE2\);\s*\n\s*if \(temporalHistoryTexture\)\s*\n\s*gl\.bindTexture\(gl\.TEXTURE_2D, temporalHistoryTexture\);\s*\n\s*else\s*\n\s*gl\.bindTexture\(gl\.TEXTURE_2D, sceneHdrFBO\.texture\);/.test(postPass));

check('the HDR fallback (float texture) is bound before the canvas is cleared and drawn',
  (() => {
    const fallback = postPass.indexOf('gl.bindTexture(gl.TEXTURE_2D, sceneHdrFBO.texture);');
    const canvasBound = postPass.indexOf('gl.bindFramebuffer(gl.FRAMEBUFFER, null); // null is canvas');
    return fallback >= 0 && canvasBound > fallback;
  })());

check('draw-time validation comment is present so the fallback is not "simplified" away later',
  /draw-time sampler validation covers every statically used sampler/.test(appSource));

check('#dropletInfoCanvas starts hidden and pointer-events:none (no invisible click-eating overlay)',
  /<canvas id="dropletInfoCanvas"[^>]*display: none[^>]*pointer-events: none/.test(htmlSource));

check('the app only shows #dropletInfoCanvas while following a droplet',
  (appSource.match(/dropletInfoCanvas\.style\.display = 'block'/g) || []).length === 1 &&
  /dropletInfoCanvas\.style\.display = 'block';\s*\n\s*\}/.test(appSource) &&
  /dropletInfoCanvas\.style\.display = 'none';/.test(appSource));

console.log('\\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
