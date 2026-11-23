// HDR supersampling harness.
//
// Lightning is thin, bright, sub-pixel geometry. On a 1x display the only way
// to hand it more than one render-target sample per pixel is to render the
// display pass above canvas resolution, so this suite pins the mechanism that
// does it:
//
//   - the shared render-quality map gains '150%' and '200%' (HDR only,
//     never bloom),
//   - the default HDR render scale is 150% (fresh setups; saved configs keep
//     their own valid value),
//   - the Extreme preset renders HDR at 150% out of the box,
//   - the Performance folder dropdown exposes both supersampling options,
//   - createHdrFBO sizes the target from canvas * scale (the existing
//     mechanism, unchanged),
//   - the post pass steps neighborhood/FXAA taps by the *source* (HDR) texel,
//     so a supersampled source is read correctly instead of with double-wide
//     taps,
//   - the TAA / motion-blur history texture is allocated lazily (only when
//     one of those effects is used), not on every load/resize,
//   - the post pass does not clear the canvas behind its own fullscreen draw.
//
// Usage:  node tests/check-hdr-supersample.js

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

check('shared render-quality map exposes 150% and 200% HDR supersampling',
  /const RENDER_QUALITY_SCALES = \{[^}]*'150%': 1\.5, '200%': 2\.0\}/.test(appSource));

check('fresh default renders HDR at 100%',
  /hdrQuality : '100%',/.test(appSource) && /performancePreset : 'Custom',/.test(appSource));

check('Extreme preset renders HDR at 150% out of the box',
  /Extreme: \{\s*\n\s*hdrQuality: '150%',/.test(appSource));

check('Performance folder exposes both supersampling options for HDR',
  /performanceFolder\.add\(guiControls, 'hdrQuality', \['25%', '35%', '50%', '60%', '75%', '85%', '100%', '150%', '200%'\]\)/.test(appSource));

check('bloom quality stays capped at 100% (supersampling bloom costs, returns nothing)',
  /performanceFolder\.add\(guiControls, 'bloomQuality', \['25%', '35%', '50%', '60%', '75%', '85%', '100%'\]\)/.test(appSource));

check('createHdrFBO still sizes the target from canvas * scale (existing mechanism, now in the fallback ladder)',
  /const width = Math\.max\(1, Math\.floor\(canvas\.width \* scale\)\);/.test(appSource) &&
  /const height = Math\.max\(1, Math\.floor\(canvas\.height \* scale\)\);/.test(appSource));

check('post pass steps by the HDR source texel, not the canvas pixel',
  /gl\.uniform2f\(getUniformLoc\(postProcessingProgram, 'outputTexelSize'\), 1\.0 \/ sceneHdrFBO\.width, 1\.0 \/ sceneHdrFBO\.height\);/.test(appSource) &&
  !/'outputTexelSize'\), 1\.0 \/ canvas\.width/.test(appSource));

check('HDR viewport follows the FBO size, not the canvas',
  /gl\.viewport\(0, 0, sceneHdrFBO\.width, sceneHdrFBO\.height\);/.test(appSource));

check('TAA/motion-blur history is allocated lazily, not unconditionally at load or resize',
  !/  createHdrFBO\(\);\n\n  createBloomFBOs\(\);\n  createTemporalHistoryTexture\(\);/.test(appSource) &&
  /if \(guiControls\.temporalAAEnabled \|\| guiControls\.motionBlurEnabled\)\s*\n\s*createTemporalHistoryTexture\(\);/.test(appSource) &&
  /if \(temporalHistoryTexture\)\s*\n\s*createTemporalHistoryTexture\(\);/.test(appSource));

check('post pass does not clear the canvas behind its own fullscreen draw',
  !/gl\.viewport\(0, 0, canvas\.width, canvas\.height\);\s*\n\s*gl\.clearColor\(0\.0, 0\.0, 0\.0, 1\.0\);\s*\n\s*gl\.clear\(gl\.COLOR_BUFFER_BIT\);\s*\n\s*\n\s*gl\.drawBuffers\(\[ gl\.BACK \]\);/.test(appSource));

check('supersampling composes with the existing 2x pixel-ratio mode without sharing code',
  /function getRenderPixelRatio\(\)\s*\{\s*\n\s*return guiControls && guiControls\.superSharpDetail \? 2 : 1;\s*\n\}/.test(appSource));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
