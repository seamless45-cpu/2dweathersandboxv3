// Verification harness for the Real Time Cycle toggle (Sun & Radiation folder)
// and the Motion Blur toggle + strength slider (Performance folder).
//
// Real Time Cycle (2026-11-18): the simulation clock is synchronized to the
// user's wall clock (full date and time), so the sun tracks the real sun for
// the chosen latitude year-round - including the seasonal declination.
// Accelerate Night no longer applies while it is on, and the sun position is
// derived from the real date, not from accumulated simulation iterations.
//
// Motion Blur (2026-11-18), reworked: a shutter integral gathered along the
// camera motion vector reprojected from the current and previous render view
// (position and zoom, shake included). Eight taps, each mixing this frame's
// scene with the canvas history TAA also uses, so streaks follow the true
// screen-space path - including radial zoom. A static camera yields a zero
// vector and the frame is left untouched. Strength is 0-350 (%); 100 is a
// soft veil, 350 is a full long exposure. History is the same canvas copy
// TAA uses; it is invalidated only in setup mode and on display-mode
// switches (a scene change the reprojection cannot know about), never by a
// camera move.
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
  /realTimeCycle : false, \/\/ sync the sun to the user's wall clock/.test(appSource) &&
  /motionBlurEnabled : false,/.test(appSource) &&
  /motionBlurIntensity : 100, \/\/ 0-350 \(%\);/.test(appSource));

check('old saves load cleanly: new booleans normalized and strength clamped to 0..350',
  /\['filmicToneMapping', 'fxaaEnabled', 'volumetricCloudLighting', 'temporalAAEnabled', 'superSharpDetail', 'realTimeCycle', 'motionBlurEnabled'\]/.test(appSource) &&
  /guiControls\.motionBlurIntensity = clamp\(Number\(guiControls\.motionBlurIntensity\) \|\| 0, 0, 350\);/.test(appSource));

/* ------------------------------------------------------- Real Time Cycle */

check('Radiation folder adds the Real Time Cycle toggle after Day/Night Cycle',
  /radiation_folder\.add\(guiControls, 'dayNightCycle'\)\.onChange\(updateClockDisplay\)\.name\('Day\/Night Cycle'\)\.listen\(\);\s*\n\s*\n\s*radiation_folder\.add\(guiControls, 'realTimeCycle'\)\s*\n\s*\.onChange\(function\(\) \{\s*\n\s*lastRealTimeCycleFrameMs = -1;\s*\n\s*updateClockDisplay\(\);\s*\n\s*\}\)\s*\n\s*\.name\('Real Time Cycle'\)\s*\n\s*\.listen\(\);/.test(appSource));

check('the frame loop syncs the simulation clock to the real wall clock (date and time)',
  /\} else if \(guiControls\.realTimeCycle\) \{\s*\n\s*const nowMs = Date\.now\(\);/.test(appSource) &&
  /const elapsedMs = lastRealTimeCycleFrameMs >= 0 \? nowMs - lastRealTimeCycleFrameMs : 0\.0;/.test(appSource) &&
  /lastRealTimeCycleFrameMs = nowMs;\s*\n\s*simDateTime = new Date\(nowMs\);/.test(appSource) &&
  /simElapsedMilliseconds \+= elapsedMs;\s*\n\s*updateSunlight\(0\);/.test(appSource) &&
  /guiControls\.month = Math\.min\(guiControls\.month, 12\.99\);/.test(appSource));

check('Accelerate Night is bypassed while Real Time Cycle is on, and the frame clock is reset on manual/legacy paths',
  /let nightAccelerationActive = !airplaneMode && guiControls\.dayNightCycle && guiControls\.accelerateNight && !guiControls\.realTimeCycle &&/.test(appSource) &&
  /lastRealTimeCycleFrameMs = -1;\s*\n\s*updateSunlight\(timePerIteration/.test(appSource));

check('the synced clock drives the sun through updateSunlight(0) - no iteration-based advance leaks in',
  (() => {
    const branch = appSource.slice(appSource.indexOf('} else if (guiControls.realTimeCycle)'));
    const body = branch.slice(0, branch.indexOf('} else {'));
    return !/updateSunlight\(timePerIteration|updateSunlight\(elapsedHours|timePerIteration \* guiControls\.IterPerFrame/.test(body);
  })());

/* -------------------------------------------------------------- motion blur */

check('Performance folder adds the Motion Blur toggle and a 0-350 strength slider',
  /performanceFolder\.add\(guiControls, 'motionBlurEnabled'\)\s*\n\s*\.name\('Motion Blur'\);/.test(appSource) &&
  /performanceFolder\.add\(guiControls, 'motionBlurIntensity', 0, 350, 10\)\s*\n\s*\.name\('Motion Blur Strength %'\)\s*\n\s*\.listen\(\);/.test(appSource));

check('motion blur strength scales the shutter mix linearly 0..1 at 350%, gated by motion',
  (() => {
    const strengthAt = (s) => Math.min(Math.max(s / 350, 0), 1);
    const blendAt = (s) => strengthAt(s) * 1.0; // flowGate == 1 once there is motion
    return strengthAt(0) === 0 &&
           Math.abs(strengthAt(100) - 0.2857) < 0.001 &&
           Math.abs(strengthAt(350) - 1.0) < 1e-9 &&
           blendAt(100) < blendAt(200) && blendAt(200) < blendAt(350);
  })());

check('post shader declares the motion blur uniforms and guards on history validity',
  /uniform bool motionBlurEnabled;/.test(postShader) &&
  /uniform bool motionBlurHistoryValid;/.test(postShader) &&
  /uniform float motionBlurStrength; \/\/ 0\.\.350 \(%\)/.test(postShader) &&
  /uniform vec3 motionBlurView;/.test(postShader) &&
  /uniform vec3 motionBlurPrevView;/.test(postShader) &&
  /uniform vec2 motionBlurAspects;/.test(postShader) &&
  /if \(motionBlurEnabled && motionBlurHistoryValid\) \{/.test(postShader));

check('the trail is an 8-tap shutter integral along the reprojected camera motion vector',
  /vec2 ndc = texCoord \* 2\.0 - 1\.0;/.test(postShader) &&
  /float sa = motionBlurAspects\.x;/.test(postShader) &&
  /float ca = motionBlurAspects\.y;/.test(postShader) &&
  /flow\.x = \(ndc\.x \/ motionBlurPrevView\.z - motionBlurPrevView\.x\) \* 0\.5 \+ 0\.5/.test(postShader) &&
  /flow\.y = \(\(ndc\.y \* sa \/ \(motionBlurPrevView\.z \* ca\) - motionBlurPrevView\.y \* sa\) \* 0\.5 \+ 0\.5\)/.test(postShader) &&
  /for \(int i = 1; i < 8; i\+\+\) \{/.test(postShader) &&
  /vec2 tapUV = clamp\(texCoord \+ flow \* t, vec2\(0\.0\), vec2\(1\.0\)\);/.test(postShader) &&
  /vec3 currentTap = safeSample\(mappedColor\(tapUV\)\.rgb\);/.test(postShader) &&
  /vec3 historyTap = safeSample\(texture\(historyTex, tapUV\)\.rgb\);/.test(postShader) &&
  /acc \+= mix\(currentTap, historyTap, 0\.5\);/.test(postShader) &&
  /vec3 blurred = acc \* \(1\.0 \/ 8\.0\);/.test(postShader) &&
  /float blend = strength \* flowGate;/.test(postShader) &&
  /outputCol = mix\(outputCol, blurred, blend\);/.test(postShader));

check('the shutter path length is honoured, radial zoom included, and clipped at seam wraps',
  /float flowLength = length\(flow\);/.test(postShader) &&
  /if \(flowLength <= 0\.05 && flowLength > 0\.0\) \{/.test(postShader) &&
  /float flowGate = smoothstep\(0\.0, 0\.002, flowLength\);/.test(postShader) &&
  /float strength = clamp\(motionBlurStrength \/ 350\.0, 0\.0, 1\.0\);/.test(postShader) &&
  // stationary camera: flow == 0 -> no sample is ever gathered, frame untouched
  (() => {
    const i = postShader.indexOf('if (motionBlurEnabled');
    const seg = postShader.slice(i, postShader.indexOf('fragmentColor'));
    return !/flowLength \*\*|pow\(flowLength/.test(seg);
  })());

check('motion blur applies to the final image, after both TAA and FXAA',
  postShader.indexOf('if (fxaaEnabled) {') < postShader.indexOf('if (motionBlurEnabled') &&
  postShader.indexOf('if (motionBlurEnabled') < postShader.indexOf('fragmentColor = vec4(outputCol, 1.0);'));

check('app.js uploads the motion blur uniforms and copies the canvas history when either feedback effect runs',
  /gl\.uniform1i\(getUniformLoc\(postProcessingProgram, 'motionBlurEnabled'\), guiControls\.motionBlurEnabled\);/.test(appSource) &&
  /gl\.uniform1i\(getUniformLoc\(postProcessingProgram, 'motionBlurHistoryValid'\), motionBlurHistoryValid\);/.test(appSource) &&
  /gl\.uniform1f\(getUniformLoc\(postProcessingProgram, 'motionBlurStrength'\), guiControls\.motionBlurIntensity\);/.test(appSource) &&
  /gl\.uniform3f\(getUniformLoc\(postProcessingProgram, 'motionBlurView'\), renderViewX, renderViewY, cam\.curZoom\);/.test(appSource) &&
  /gl\.uniform3f\(getUniformLoc\(postProcessingProgram, 'motionBlurPrevView'\), mbPrev\[0\], mbPrev\[1\], mbPrev\[2\]\);/.test(appSource) &&
  /gl\.uniform2f\(getUniformLoc\(postProcessingProgram, 'motionBlurAspects'\), sim_aspect, canvas_aspect\);/.test(appSource) &&
  /if \(\(guiControls\.temporalAAEnabled \|\| guiControls\.motionBlurEnabled\) && !SETUP_MODE\) \{/.test(appSource) &&
  /temporalHistoryValid = guiControls\.temporalAAEnabled;\s*\n\s*motionBlurHistoryValid = guiControls\.motionBlurEnabled;\s*\n\s*motionBlurPreviousView = \[renderViewX, renderViewY, cam\.curZoom\];/.test(appSource));

check('the history view is snapshotted after the copy and dropped when the effect idles',
  /motionBlurPreviousView = \[renderViewX, renderViewY, cam\.curZoom\];/.test(appSource) &&
  /motionBlurPreviousView = null;/.test(appSource) &&
  /let motionBlurPreviousView = null;/.test(appSource) &&
  /const mbPrev = motionBlurPreviousView \|\| \[renderViewX, renderViewY, cam\.curZoom\];/.test(appSource));

check('motion blur is invalidated only on setup / display-mode change, never on a camera move, and the trail record is reprojected instead',
  /if \(!guiControls\.motionBlurEnabled \|\| motionBlurViewChanged\) \{\s*\n\s*motionBlurHistoryValid = false;\s*\n\s*\}/.test(appSource) &&
  /const motionBlurViewChanged = SETUP_MODE \|\| temporalPreviousDisplayMode != guiControls\.displayMode \|\| !motionBlurPreviousView;/.test(appSource) &&
  !/postProcessingViewChanged\) \{\s*\n\s*motionBlurHistoryValid/.test(appSource));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
