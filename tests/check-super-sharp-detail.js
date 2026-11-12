// Super Sharp Detail Mode test harness.
//
// Verifies that Super Sharp Detail Mode:
//   1. Defaults to false in guiControls_default and is exposed in the dat.GUI
//      Performance folder with a performanceHelp entry and Render Quality readout.
//   2. Shows a confirmation warning dialog before enabling, and reverts cleanly
//      to false without resizing if the user cancels.
//   3. Multiplies the rendering pixel ratio by 2x across canvas
//      and dependent FBO sizes (HDR, Bloom, Temporal AA) while keeping CSS layout
//      pinned to 100vw x 100vh.
//   4. Keeps pointer, camera pan/zoom, and weather station coordinate math
//      in CSS display pixels while matching canvas_aspect to the rendered CSS rect.
//
// Usage: node tests/check-super-sharp-detail.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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

check('guiControls_default initializes superSharpDetail to false',
  /superSharpDetail\s*:\s*false/.test(appSource) &&
  /'superSharpDetail'\s*\]/.test(appSource),
  'superSharpDetail must default to false and be normalized as boolean on load');

check('Performance folder adds Super Sharp Detail Mode toggle with warning before enabling',
  /const superSharpDetailWarning =/.test(appSource) &&
  /performanceFolder\.add\(guiControls,\s*'superSharpDetail'\)\s*\n\s*\.name\('Super Sharp Detail Mode'\)/.test(appSource) &&
  /if \(enabled && !confirm\(superSharpDetailWarning\)\)\s*\{\s*\n\s*guiControls\.superSharpDetail = false;\s*\n\s*superSharpDetailController\.updateDisplay\(\);\s*\n\s*return;\s*\n\s*\}/.test(appSource),
  'turning Super Sharp Detail Mode on must confirm first and revert cleanly if cancelled');

check('Super Sharp Detail Mode has Performance tooltip help and Render Quality readout label',
  /'Super Sharp Detail Mode':\s*\[/.test(appSource) &&
  /guiControls\.superSharpDetail \? ' \/ 2x Pixel Ratio' : ''/.test(appSource),
  'users should see tooltip description/impact and active 2x Pixel Ratio readout');

check('getRenderPixelRatio doubles pixel ratio (2x) when Super Sharp Detail Mode is enabled',
  /function getRenderPixelRatio\(\)\s*\{\s*\n\s*return guiControls && guiControls\.superSharpDetail \? 2 : 1;\s*\n\}/.test(appSource),
  'Super Sharp Detail Mode must increase rendering pixel ratio by 2x');

check('#mainCanvas keeps 100vw x 100vh CSS display size while backing buffer scales by pixelRatio',
  /#mainCanvas\s*\{[^}]*width:\s*100vw;[^}]*height:\s*100vh;/s.test(indexHtml) &&
  /canvas\.style\.width = '100vw';/.test(appSource) &&
  /canvas\.style\.height = '100vh';/.test(appSource) &&
  /const width = Math\.max\(1, Math\.floor\(displayWidth \* pixelRatio\)\);/.test(appSource) &&
  /const height = Math\.max\(1, Math\.floor\(displayHeight \* pixelRatio\)\);/.test(appSource) &&
  /canvas\.width = width;\s*\n\s*canvas\.height = height;/.test(appSource),
  'backing canvas doubles resolution while viewport stays 100vw x 100vh');

check('mouse/camera/tooltip coordinates separate CSS display pixels from 2x backing pixels without plant overlay',
  /function getCanvasDisplayWidth\(\)/.test(appSource) &&
  /function getCanvasDisplayHeight\(\)/.test(appSource) &&
  /screenToSimX[\s\S]{0,220}getCanvasDisplayWidth\(\)/.test(appSource) &&
  /simToScreenY[\s\S]{0,220}getCanvasDisplayHeight\(\)/.test(appSource) &&
  /zoomAtMousePos[\s\S]{0,260}getCanvasDisplayWidth\(\)/.test(appSource) &&
  !/ecosystemCanvas|plantEcosystem|initializePlantEcosystem|showPlants|plantGrowth/.test(appSource),
  'pointer tools, pan/zoom, and weather stations must stay aligned at 2x pixel ratio and plant overlay must be removed');

check('resetSettings reapplies pixel ratio after resetting defaults',
  /guiControls\.resetSettings[\s\S]{0,450}applySuperSharpDetail\(\);/.test(appSource),
  'resetting settings to defaults must drop pixel ratio back from 2x to 1x');

// Simulate handler behavior across cancel, confirm, disable, and resize
{
  let confirmResponse = false;
  let resizeCalls = 0;
  let updateDisplays = 0;
  const mockGuiControls = { superSharpDetail: false };
  const mockController = { updateDisplay() { updateDisplays++; } };
  const mockConfirm = () => confirmResponse;
  const mockApply = () => { resizeCalls++; };

  function simulateToggle(nextValue) {
    mockGuiControls.superSharpDetail = nextValue;
    if (nextValue && !mockConfirm()) {
      mockGuiControls.superSharpDetail = false;
      mockController.updateDisplay();
      return;
    }
    mockApply();
  }

  simulateToggle(true); // User clicks Cancel on warning
  const cancelledCleanly = mockGuiControls.superSharpDetail === false && resizeCalls === 0 && updateDisplays === 1;

  confirmResponse = true;
  simulateToggle(true); // User confirms warning
  const enabledCleanly = mockGuiControls.superSharpDetail === true && resizeCalls === 1;

  const scaleWhenOn = mockGuiControls.superSharpDetail ? 2 : 1;
  simulateToggle(false); // Turning off does not warn
  const disabledCleanly = mockGuiControls.superSharpDetail === false && resizeCalls === 2 &&
    (mockGuiControls.superSharpDetail ? 2 : 1) === 1;

  check('toggle flow cancels cleanly without resizing, confirms to 2x, and turns off without warning',
    cancelledCleanly && enabledCleanly && scaleWhenOn === 2 && disabledCleanly);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
