'use strict';
// Precipitation tool: painting the tool injects into the PRECIPITATION field
// (radar/reflectivity/cloud-dimming/decay) and directly releases inactive
// droplets inside the brush as rain or snow, regardless of cloud cover.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('app.js');
const html = read('index.html');
const advection = read('shaders/fragment/advectionShader.frag');
const precipVert = read('shaders/vertex/precipitationShader.vert');
let passed = 0, failed = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (ok) passed++; else failed++; }

check('tool dropdown exposes Precipitation as TOOL_PRECIPITATION',
  /'Precipitation' : 'TOOL_PRECIPITATION',/.test(app));
check('user input maps the tool to input type 23',
  /guiControls\.tool == 'TOOL_PRECIPITATION'\)\s*\n\s*inputType = 23;/.test(app));
check('advection pass injects the PRECIPITATION field for type 23, walls excluded',
  /userInputType == 23 && wall\[DISTANCE\] != 0\) \{\s*\/\/ precipitation/.test(advection) &&
  /water\[PRECIPITATION\] = max\(water\[PRECIPITATION\] \+ userInputValues\[BRUSH_INTENSITY\] \* 0\.5, 0\.0\);/.test(advection));
check('Ctrl reverses the injection to erase painted precipitation',
  /if \(ctrlPressed\) \{\s*\n\s*intensity \*= -1;\s*\n\s*\}/.test(app));

check('precipitation vertex shader declares the brush uniforms',
  /uniform vec4 precipBrush;/.test(precipVert) &&
  /uniform int precipBrushActive;/.test(precipVert) &&
  /uniform bool precipBrushWrap;/.test(precipVert));
check('inactive droplets inside the brush spawn directly without cloud cover',
  /bool painted = false;/.test(precipVert) &&
  /if \(precipBrushActive == 1 && base\[TEMPERATURE\] < 500\. && precipBrush\.w > 0\.0\)/.test(precipVert) &&
  /if \(painted\) \{/.test(precipVert) &&
  /newMass\[WATER\] = initalMass;\s*\/\/ rain/.test(precipVert) &&
  /newMass\[ICE\] = initalMass;\s*\/\/ snow/.test(precipVert));
check('painted freezing droplets fall as snow, the rest as rain',
  (() => {
    const painted = precipVert.indexOf('bool painted = false;');
    const natural = precipVert.indexOf('threshold = aboveZeroThreshold', painted);
    const block = precipVert.slice(painted, natural === -1 ? undefined : natural);
    return /if \(realTemp < CtoK\(0\.0\)\) \{[\s\S]{0,200}newMass\[ICE\] = initalMass;\s*\/\/ snow/.test(block) &&
           /\} else \{\s*\n\s*newMass\[WATER\] = initalMass;\s*\/\/ rain/.test(block);
  })());
check('painted droplets skip the cloud-density lightning feedback',
  (() => {
    const painted = precipVert.indexOf('if (painted) {');
    const natural = precipVert.indexOf('sound/feedback[START_ITERNUM]', painted); // sanity marker, absent
    const nextElse = precipVert.indexOf('} else {', painted);
    const paintedBlock = precipVert.slice(painted, nextElse);
    return painted !== -1 && nextElse !== -1 && !paintedBlock.includes('START_ITERNUM') && natural === -1;
  })());

check('painted droplets keep falling after the stroke: pass stays on for a full-column grace period',
  /let precipToolForcedUntil = 0;/.test(app) &&
  /const paintingPrecipNow = leftMousePressed && guiControls\.tool == 'TOOL_PRECIPITATION' && iterNum > 0;/.test(app) &&
  /if \(paintingPrecipNow\)\s*\n\s*precipToolForcedUntil = iterNum \+ 3600;/.test(app) &&
  /if \(guiControls\.enablePrecipitation \|\| iterNum <= precipToolForcedUntil\) \{/.test(app));
check('frame loop uploads brush position, radius, intensity and wrap to the precipitation program',
  /const precipToolPainting = leftMousePressed && guiControls\.tool == 'TOOL_PRECIPITATION' && iterNum > 0;/.test(app) &&
  /gl\.uniform4f\(getUniformLoc\(precipitationProgram, 'precipBrush'\)/.test(app) &&
  /gl\.uniform1i\(getUniformLoc\(precipitationProgram, 'precipBrushActive'\), precipToolPainting \? 1 : 0\)/.test(app) &&
  /gl\.uniform1i\(getUniformLoc\(precipitationProgram, 'precipBrushWrap'\)/.test(app));
check('brush x respects the wrap setting like the circular fluid brush',
  /const precipBrushX = guiControls\.wrapHorizontally \? mod\(mouseXinSim, 1\.0\) : clamp\(mouseXinSim, 0\.0, 1\.0\);/.test(app));
check('Ctrl painting passes a negative intensity so only the field is erased, no droplets spawn',
  /const precipBrushIntensity = ctrlPressed \? -guiControls\.brushIntensity : guiControls\.brushIntensity;/.test(app));

check('help text documents the Precipitation tool and its Ctrl inverter',
  /<b>Precipitation<\/b> paints rain or snow/.test(html));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
