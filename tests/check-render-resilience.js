// Render resilience harness.
//
// The black-screen-after-load failure class: texImage2D beyond
// MAX_TEXTURE_SIZE (or an otherwise unallocatable FBO) fails silently, and a
// draw loop that throws before re-queueing its frame stops forever. Both
// produce a black canvas with a "Simulation ready" nowhere in sight and no
// error anywhere. This suite pins the two guards that close that hole:
//
//   1. createHdrFBO() / createBloomFBOs() verify framebuffer completeness
//      and degrade instead of shipping a black composite: the HDR target
//      steps down a scale ladder, the bloom pyramid keeps its previous one,
//      bloom is turned off only as a last resort, and an exception with a
//      visible message is thrown only when no HDR target can exist at all.
//   2. The draw loop queues its next frame before doing any work, so an
//      exception inside one frame can never stop the loop; 120 consecutive
//      failing frames show a visible "stopped rendering" overlay.
//
// Usage:  node tests/check-render-resilience.js

'use strict';

const fs = require('fs');

const appSource = fs.readFileSync('app.js', 'utf8');

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('OK  ', name);
  } else {
    fail++;
    console.log('FAIL', name, detail === undefined ? '' : '- ' + detail);
  }
}

check('shared render-quality map is module level (FBO code needs it too)',
  /const RENDER_QUALITY_SCALES = \{[^}]*'150%': 1\.5, '200%': 2\.0\}/.test(appSource) &&
  /const renderQualityScales = RENDER_QUALITY_SCALES;/.test(appSource) &&
  (appSource.match(/const RENDER_QUALITY_SCALES = /g) || []).length === 1);

check('createHdrFBO verifies framebuffer completeness and steps down a ladder',
  /function createHdrFBO\(\)/.test(appSource) &&
  /const maxTextureSize = gl\.getParameter\(gl\.MAX_TEXTURE_SIZE\);/.test(appSource) &&
  /const ladder = \[\.\.\.new Set\(\[requested, \.\.\.\[1\.5, 1\.0, 0\.85, 0\.75, 0\.6, 0\.5, 0\.35, 0\.25\]/.test(appSource) &&
  /if \(gl\.checkFramebufferStatus\(gl\.FRAMEBUFFER\) == gl\.FRAMEBUFFER_COMPLETE\)/.test(appSource) &&
  /if \(width > maxTextureSize \|\| height > maxTextureSize\)\s*\n\s*continue;/.test(appSource));

check('createHdrFBO demotion snaps the GUI quality to the achieved scale and warns',
  /hdrRenderScale = scale;\s*\n\s*const label = renderQualityLabelForScale\(scale\);/.test(appSource) &&
  /guiControls\.hdrQuality = label;/.test(appSource));

check('createHdrFBO keeps the previous FBO when recreation fails (resize), throws only when none exists',
  /if \(hdrFBO\) \{\s*\n\s*\/\/ Resize could not recreate the target; the previous one still works\./.test(appSource) &&
  /throw new Error\('This graphics device cannot allocate the floating-point HDR target the display needs\.'\);/.test(appSource));

check('createHdrFBO disposes the old FBO only after a complete candidate exists',
  (() => {
    const body = appSource.slice(appSource.indexOf('function createHdrFBO()'), appSource.indexOf('function createBloomFBOs()'));
    const disposeAt = body.indexOf('hdrFBO.dispose()');
    const completeAt = body.indexOf('gl.checkFramebufferStatus');
    return disposeAt > completeAt && completeAt > 0;
  })());

check('createBloomFBOs builds a candidate pyramid, verifies completeness, keeps previous on failure',
  /const candidate = \[\];/.test(appSource) &&
  /for \(const fbo of candidate\) \{\s*\n\s*gl\.bindFramebuffer\(gl\.FRAMEBUFFER, fbo\.frameBuffer\);\s*\n\s*if \(gl\.checkFramebufferStatus\(gl\.FRAMEBUFFER\) != gl\.FRAMEBUFFER_COMPLETE\)\s*\n\s*complete = false;/.test(appSource) &&
  /bloomFBOs = candidate;/.test(appSource) &&
  /keeping the previous one\./.test(appSource));

check('bloom is turned off only when no pyramid ever worked (scene stays visible)',
  /if \(bloomFBOs\.length == 0\) \{\s*\n\s*\/\/ Never had a working pyramid: turning bloom off keeps the scene visible\.\s*\n\s*if \(guiControls\)\s*\n\s*guiControls\.bloomEnabled = false;/.test(appSource));

check('post pass guards the bloom sampler binding against an empty pyramid',
  /if \(bloomFBOs\.length\) \/\/ bloom may have been turned off if its target is not renderable\s*\n\s*gl\.bindTexture\(gl\.TEXTURE_2D, bloomFBOs\[0\]\.texture\);/.test(appSource));

check('draw loop re-queues the next frame before doing any work',
  (() => {
    const body = appSource.slice(appSource.indexOf('function draw()'), appSource.indexOf('updateDiagnosticOverlays();'));
    const rafAt = body.indexOf('requestAnimationFrame(draw);');
    const tryAt = body.indexOf('try {');
    return rafAt > 0 && tryAt > rafAt;
  })());

check('draw loop traps per-frame exceptions and stops only after 120 in a row, with a visible overlay',
  /let drawFrameErrorStreak = 0;/.test(appSource) &&
  /\} catch \(error\) \{\s*\n\s*drawFrameErrorStreak\+\+;\s*\n\s*console\.error\('draw\(\) failed \(consecutive frames: ' \+ drawFrameErrorStreak \+ '\)', error\);\s*\n\s*if \(drawFrameErrorStreak == 120\)\s*\n\s*showDrawLoopErrorOverlay\(\);\s*\n\s*\}/.test(appSource) &&
  /function showDrawLoopErrorOverlay\(\)/.test(appSource) &&
  /note\.id = 'drawLoopError';/.test(appSource));

check('a successful frame resets the streak',
  /frameNum\+\+;\s*\n\s*drawFrameErrorStreak = 0;/.test(appSource));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
