'use strict';
// Lightning channels used to leave black fringes: the realistic display
// wrote unpremultiplied alpha with an SRC_ALPHA blend, so dim halo fragments
// multiplied the destination by (1 - a) without adding light back. The display
// now premultiplies its surface colour by coverage, adds the emitted light
// with alpha 0, and is drawn with (ONE, ONE_MINUS_SRC_ALPHA).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('app.js');
const display = read('shaders/fragment/realisticDisplayShader.frag');
const isolate = read('shaders/fragment/isolateBrightPartsShader.frag');
const postProcessing = read('shaders/fragment/postProcessingShader.frag');
let passed = 0, failed = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (ok) passed++; else failed++; }

check('realistic display premultiplies its surface colour by coverage and adds emitted light',
  /fragmentColor = vec4\(softHdrClamp\(max\(color \* finalLight \* opacity, 0\.0\) \+ emittedLight\), opacity\);/.test(display));
check('emitted light no longer inflates the coverage alpha',
  !/clamp\(opacity \+ length\(emittedLight\)/.test(display));
check('upper-atmosphere additive branch writes pure light with alpha 0',
  /fragmentColor = vec4\(softHdrClamp\(upperAtmosphereLight\), 0\.0\);/.test(display));
check('realistic display is drawn with premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA)',
  /gl\.enable\(gl\.BLEND\);\s*\n\s*\/\/ Premultiplied alpha[\s\S]{0,300}?gl\.blendFunc\(gl\.ONE, gl\.ONE_MINUS_SRC_ALPHA\);/.test(app) &&
  /\/\/ draw clouds and terrain/.test(app));
check('the old SRC_ALPHA blend no longer feeds the realistic display',
  !/gl\.enable\(gl\.BLEND\);\s*\n\s*gl\.blendFunc\(gl\.SRC_ALPHA, gl\.ONE_MINUS_SRC_ALPHA\);\s*\n\s*\n\s*\n\s*\/\/ draw clouds and terrain/.test(app));
check('bloom and tonemap consume only the HDR rgb channel',
  /texture\(hdrTex, texCoord\)\.rgb/.test(isolate) &&
  /texture\(hdrTex, uv\)\.rgb/.test(postProcessing) &&
  !/hdrTex[^\n]*\.a\b/.test(isolate) && !/hdrTex[^\n]*\.a\b/.test(postProcessing));
check('documentation explains the premultiplied contract for the blend site',
  /Premultiplied alpha/.test(app) && /premultiplied/.test(display));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
