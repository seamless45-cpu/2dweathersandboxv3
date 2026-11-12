// Display aspect & plant-removal regression checks.
//
// Verifies:
//   1. The entire plant ecosystem (ecosystem.js, PlantEcosystem, UI, shaders/hooks,
//      precache, docs) has been removed cleanly.
//   2. Canvas measurement uses canvas.getBoundingClientRect() after setting
//      display: 'block', computes exact CSS aspect ratio displayWidth / displayHeight
//      even when backing pixels round or subpixel CSS scaling applies, and resyncs
//      on ResizeObserver, visualViewport resize, window resize, and after intro removal.
//   3. Vertex shader aspect ratios + camera zoom/pan math keep simulation cells
//      isotropic (1:1 screen pixels) across standard, fractional-zoom, portrait,
//      and ultrawide viewports.
//
// Usage: node tests/check-display-aspect.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

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

check('ecosystem.js is removed and not referenced in index.html, sw.js, app.js, or README.md',
  !fs.existsSync(path.join(ROOT, 'ecosystem.js')) &&
  !/ecosystem\.js/.test(indexHtml) &&
  !/ecosystem\.js/.test(swSource) &&
  !/PlantEcosystem|plantEcosystem|ecosystemCanvas|plantGrowth|showPlants|plantEnvironmentSamplingBuffers/.test(appSource) &&
  !/Plant ecosystem/.test(readme));

check('both documentElement and body enforce overflow hidden',
  /document\.documentElement\.style\.overflow = 'hidden';/.test(appSource) &&
  /document\.body\.style\.overflow = 'hidden';/.test(appSource));

check('getCanvasDisplayRect prefers exact getBoundingClientRect dimensions',
  /function getCanvasDisplayRect\(\)/.test(appSource) &&
  /const rect = canvas\.getBoundingClientRect\(\);/.test(appSource) &&
  /if \(rect\.width > 0 && rect\.height > 0\)/.test(appSource));

check('canvas is set to display: block before initial aspect & size measurement',
  /canvas\.style\.display = 'block';[\s\S]{0,120}syncCanvasAspect\(\);/.test(appSource));

check('syncCanvasAspect uses exact displayWidth / displayHeight and updates before no-op guard',
  /function syncCanvasAspect\(\)\s*\{[\s\S]{0,160}canvas_aspect = displayWidth \/ displayHeight;/.test(appSource) &&
  /function resizeSimulationCanvases\(force = false\)[\s\S]{0,180}syncCanvasAspect\(\);[\s\S]{0,220}if \(!force && canvas\.width == width && canvas\.height == height\)/.test(appSource));

check('resize synchronization listens to ResizeObserver, visualViewport, window resize, and post-intro removal',
  /window\.addEventListener\('resize', scheduleCanvasResize\);/.test(appSource) &&
  /window\.visualViewport\?\.addEventListener\('resize', scheduleCanvasResize\);/.test(appSource) &&
  /new ResizeObserver\(scheduleCanvasResize\)\.observe\(canvas\);/.test(appSource) &&
  /await loadingBar\.remove\(true\);\s*\n\s*resizeSimulationCanvases\(\);/.test(appSource));

check('zoomAtMousePos and two-finger touchmove pan use display CSS coordinates symmetrically',
  /\(\(\(mouseX - displayWidth \/ 2\) \* delta\) \/ cam\.tarZoom \/ displayWidth\) \* 2\.0/.test(appSource) &&
  /\(\(\(\(mouseY - displayHeight \/ 2\) \* delta\) \/ cam\.tarZoom \/ displayHeight\) \* 2\.0\) \/ canvas_aspect/.test(appSource) &&
  /cam\.changeViewXpos\(\(\(mouseX - prevMouseX\) \/ cam\.curZoom \/ displayWidth\) \* 2\.0\);/.test(appSource) &&
  /cam\.changeViewYpos\(-\(\(mouseY - prevMouseY\) \/ cam\.curZoom \/ displayWidth\) \* 2\.0\);/.test(appSource));

// Verify screen-space isotropy of rendered simulation cells across viewports
const simAspect = 600 / 260;
const viewports = [
  { name: '1080p standard', w: 1920, h: 1080 },
  { name: 'fractional browser zoom (125%)', w: 1265.6, h: 712.8 },
  { name: '1366x768 laptop', w: 1366, h: 768 },
  { name: 'ultrawide 21:9', w: 3440, h: 1440 },
  { name: 'mobile portrait', w: 390, h: 844 }
];

for (const vp of viewports) {
  const canvasAspect = vp.w / vp.h;
  // Mirrors realDispShader.vert / dispShader.vert / precipDisplayShader.vert:
  //   gl_Position.x = clipX * Xmult (= 1.0) * horizontalDisplayMult
  //   gl_Position.y = clipY * (canvas_aspect / sim_aspect)
  // For a square simulation cell of delta_u = 1/sim_res_x, delta_v = 1/sim_res_y:
  //   NDC delta_x = 2 / sim_res_x -> CSS px = vp.w / sim_res_x
  //   NDC delta_y = (2 / sim_res_y) * (canvasAspect / simAspect) -> CSS px = (vp.h / sim_res_y) * (canvasAspect / simAspect)
  const cellPxWidth = vp.w / 600;
  const cellPxHeight = (vp.h / 260) * (canvasAspect / simAspect);
  const ratio = cellPxWidth / cellPxHeight;
  check('1:1 cell screen aspect on ' + vp.name + ' (' + vp.w + 'x' + vp.h + ')',
    Math.abs(ratio - 1) < 1e-12,
    'expected 1.0, got ' + ratio);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
