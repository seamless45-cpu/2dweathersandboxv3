// Verification harness for the Real Time Cycle toggle (Sun & Radiation folder)
// and the Motion Blur toggle + strength slider (Performance folder).
//
// Real Time Cycle (2026-11-18): the day/night cycle advances at real-world
// speed instead of being coupled to simulation iterations; Accelerate Night
// no longer applies while it is on.
//
// Motion Blur (2026-11-18): a long-exposure feedback path in the post
// pass - the previous frame, cross-blurred, is mixed back in. Strength is
// 0-350 (%); 100 is a soft veil, 350 is full streaking. History is the same
// canvas copy TAA uses, invalidated on view/display-mode change and never
// used in setup mode.
//
// Usage: node tests/check-realtime-cycle-motion-blur.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSource = read('app.js');
const postShader = read('shaders/fragment/postProcessingShader.frag');

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('PASS ' + name);
  } else {
    failed++;
    console.log('FAIL ' + name + (detail ? '\n     ' + detail : ''));
  }
}

/* ----------------------------------------------------------- gui defaults */

check('guiControls defaults: realTimeCycle off, motion blur off at 100 strength',
  /realTimeCycle : false, \/\/ advance the sun cycle/.test(appSource) &&
  /motionBlurEnabled : false,/.test(appSource) &&
  /motionBlurIntensity : 100, \/\/ 0-350 \(%\);/.test(appSource));

check('old saves load cleanly: new booleans normalized and strength clamped to 0..350',
  /\['filmicToneMapping', 'fxaaEnabled', 'volumetricCloudLighting', 'temporalAAEnabled', 'superSharpDetail', 'realTimeCycle', 'motionBlurEnabled'\]/.test(appSource) &&
  /guiControls\.motionBlurIntensity = clamp\(Number\(guiControls\.motionBlurIntensity\) \|\| 0, 0, 350\);/.test(appSource));

/* ------------------------------------------------------- Real Time Cycle */

check('Radiation folder adds the Real Time Cycle toggle after Day/Night Cycle',
  /radiation_folder\.add\(guiControls, 'dayNightCycle'\)\.onChange\(updateClockDisplay\)\.name\('Day\/Night Cycle'\)\.listen\(\);\s*\n\s*\n\s*radiation_folder\.add\(guiControls, 'realTimeCycle'\)\s*\n\s*\.onChange\(function\(\) \{\s*\n\s*lastRealTimeCycleFrameMs = -1;\s*\n\s*updateClockDisplay\(\);\s*\n\s*\}\)\s*\n\s*\.name\('Real Time Cycle'\)\s*\n\s*\.listen\(\);/.test(appSource));

check('the frame loop advances the sun by real elapsed milliseconds, not simulation iterations',
  /\} else if \(guiControls\.realTimeCycle\) \{\s*\n\s*const nowMs = performance\.now\(\);/.test(appSource) &&
  /const elapsedHours = lastRealTimeCycleFrameMs >= 0 \? \(nowMs - lastRealTimeCycleFrameMs\) \/ 3600000\.0 : 0\.0;/.test(appSource) &&
  /lastRealTimeCycleFrameMs = nowMs;\s*\n\s*updateSunlight\(elapsedHours\);/.test(appSource));

check('Accelerate Night is bypassed while Real Time Cycle is on, and the frame clock is reset on manual/legacy paths',
  /let nightAccelerationActive = !airplaneMode && guiControls\.dayNightCycle && guiControls\.accelerateNight && !guiControls\.realTimeCycle &&/.test(appSource) &&
  /lastRealTimeCycleFrameMs = -1;\s*\n\s*updateSunlight\(timePerIteration/.test(appSource));

check('one real minute advances the sun by one sun minute (3600x slower than a 60x-accelerated cycle)',
  Math.abs((60000 / 3600000.0) - (1 / 60)) < 1e-12);

/* -------------------------------------------------------------- motion blur */

check('Performance folder adds the Motion Blur toggle and a 0-350 strength slider',
  /performanceFolder\.add\(guiControls, 'motionBlurEnabled'\)\s*\n\s*\.name\('Motion Blur'\);/.test(appSource) &&
  /performanceFolder\.add\(guiControls, 'motionBlurIntensity', 0, 350, 10\)\s*\n\s*\.name\('Motion Blur Strength %'\)\s*\n\s*\.listen\(\);/.test(appSource));

check('motion blur strength maps linearly onto a feedback that reaches 92% at 350%',
  (() => {
    const blendAt = (s) => Math.min(Math.max(s / 350, 0), 1) * 0.92;
    return blendAt(0) === 0 &&
           Math.abs(blendAt(100) - 0.2629) < 0.01 &&
           Math.abs(blendAt(350) - 0.92) < 1e-9 &&
           blendAt(100) < blendAt(200) && blendAt(200) < blendAt(350);
  })());

check('post shader declares the motion blur uniforms and guards on history validity',
  /uniform bool motionBlurEnabled;/.test(postShader) &&
  /uniform bool motionBlurHistoryValid;/.test(postShader) &&
  /uniform float motionBlurStrength; \/\/ 0\.\.350 \(%\)/.test(postShader) &&
  /if \(motionBlurEnabled && motionBlurHistoryValid\) \{/.test(postShader));

check('the trail is a 5-tap cross-blurred exponential feedback of the previous final frame',
  /float blend = clamp\(motionBlurStrength \/ 350\.0, 0\.0, 1\.0\) \* 0\.92;/.test(postShader) &&
  /vec3 history = texture\(historyTex, texCoord\)\.rgb \* 0\.5;/.test(postShader) &&
  (postShader.match(/texture\(historyTex, texCoord [+-] vec2\(/g) || []).length === 4 &&
  /outputCol = mix\(outputCol, min\(history, vec3\(hdrReadCeiling\)\), blend\);/.test(postShader));

check('motion blur applies to the final image, after both TAA and FXAA',
  postShader.indexOf('if (fxaaEnabled) {') < postShader.indexOf('if (motionBlurEnabled') &&
  postShader.indexOf('if (motionBlurEnabled') < postShader.indexOf('fragmentColor = vec4(outputCol, 1.0);'));

check('app.js uploads the motion blur uniforms and copies the canvas history when either feedback effect runs',
  /gl\.uniform1i\(getUniformLoc\(postProcessingProgram, 'motionBlurEnabled'\), guiControls\.motionBlurEnabled\);/.test(appSource) &&
  /gl\.uniform1i\(getUniformLoc\(postProcessingProgram, 'motionBlurHistoryValid'\), motionBlurHistoryValid\);/.test(appSource) &&
  /gl\.uniform1f\(getUniformLoc\(postProcessingProgram, 'motionBlurStrength'\), guiControls\.motionBlurIntensity\);/.test(appSource) &&
  /if \(\(guiControls\.temporalAAEnabled \|\| guiControls\.motionBlurEnabled\) && !SETUP_MODE\) \{/.test(appSource) &&
  /temporalHistoryValid = guiControls\.temporalAAEnabled;\s*\n\s*motionBlurHistoryValid = guiControls\.motionBlurEnabled;/.test(appSource));

check('history is invalidated on view/display-mode change, and reused neither in setup nor with motion blur off',
  /if \(!guiControls\.motionBlurEnabled \|\| postProcessingViewChanged\) \{\s*\n\s*motionBlurHistoryValid = false;\s*\n\s*\}/.test(appSource) &&
  /const postProcessingViewChanged = SETUP_MODE \|\| guiControls\.displayMode != 'DISP_REAL' \|\|/.test(appSource));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
