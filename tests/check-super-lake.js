// Verification harness for the super lake.
//
// Spec (2026-11-18): a brush tool AND a deeper water color; 10x more sensitive
// to evaporation than an ordinary lake; 10x more sensitive to heat, so it
// produces storms faster than anything else in the simulation.
//
// The super lake is a new wall type (WALLTYPE_SUPER_LAKE = 7) that behaves
// exactly like a lake everywhere ordinary lake logic lives, with the
// evaporation and heat-exchange coefficients multiplied by 5. It is painted
// with the Super Lake tool (inputType 24); lakes made by the world generator
// stay ordinary lakes.
//
// Usage: node tests/check-super-lake.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSource = read('app.js');
const common = read('shaders/common.glsl');
const advection = read('shaders/fragment/advectionShader.frag');
const boundary = read('shaders/fragment/boundaryShader.frag');
const realistic = read('shaders/fragment/realisticDisplayShader.frag');
const lighting = read('shaders/fragment/lightingShader.frag');
const humidity = read('shaders/fragment/humidityDisplayShader.frag');
const cape = read('shaders/fragment/capeDisplayShader.frag');
const reflectivity = read('shaders/fragment/reflectivityDisplayShader.frag');
const setup = read('shaders/fragment/setupShader.frag');

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

/* --------------------------------------------------------------- wall type */

check('common.glsl defines WALLTYPE_SUPER_LAKE 7 (fits the Int8 wall texture)',
  /#define WALLTYPE_SUPER_LAKE 7 \/\/ super lake/.test(common));

/* ------------------------------------------------------------- brush tool */

check('User Interaction tool dropdown exposes Super Lake after Lake / Sea',
  /'Lake \/ Sea' : 'TOOL_WALL_SEA',\s*\n\s*'Super Lake' : 'TOOL_SUPER_LAKE',/.test(appSource));

check('super lake brush paints inputType 24 and shares the lake brush constraints',
  /else if \(guiControls\.tool == 'TOOL_SUPER_LAKE'\)\s*\n\s*inputType = 24;/.test(appSource) &&
  /\(guiControls\.tool == 'TOOL_WALL_SEA' \|\| guiControls\.tool == 'TOOL_SUPER_LAKE'\) && leftMousePressed/.test(appSource));

check('advectionShader turns inputType 24 into WALLTYPE_SUPER_LAKE and anchors it to the lake temperature',
  /case 24:\s*\n\s*wall\[TYPE\] = WALLTYPE_SUPER_LAKE;/.test(advection) &&
  /else if \(wall\[TYPE\] == WALLTYPE_WATER \|\| wall\[TYPE\] == WALLTYPE_SUPER_LAKE\) \{ \/\/ water surface/.test(advection) &&
  /\(wall\[TYPE\] == WALLTYPE_WATER \|\| wall\[TYPE\] == WALLTYPE_SUPER_LAKE\) \? 1002\.0 : 1001\.0/.test(advection) &&
  /if \(wall\[TYPE\] == WALLTYPE_WATER \|\| wall\[TYPE\] == WALLTYPE_SUPER_LAKE\) \{\s*\n\s*water\[TOTAL\] = 1002\./.test(advection));

check('soil moisture brush refuses to paint onto a super lake either',
  /case 20:[\s\S]{0,300}wall\[TYPE\] != WALLTYPE_SUPER_LAKE/.test(advection));

/* ------------------------------------------- 10x evaporation, 10x heat (air) */

check('air above a super lake exchanges heat and water at 10x the lake rate',
  /case WALLTYPE_SUPER_LAKE: \/\/ super lake: fall through with 10x the exchange rates/.test(boundary) &&
  /float waterMult = wall\[TYPE\] == WALLTYPE_SUPER_LAKE \? 10\.0 : 1\.0;/.test(boundary) &&
  /waterHeatExchangeRate \* waterMult/.test(boundary) &&
  /waterEvaporation \* waterMult \/ influenceDevider/.test(boundary));

check('the 10x factor is exactly ten, applied to evaporation and heat exchange, not to the water temperature copy',
  (() => {
    const match = boundary.match(/float waterMult = wall\[TYPE\] == WALLTYPE_SUPER_LAKE \? ([0-9.]+) : 1\.0;/);
    return match && Number(match[1]) === 10.0;
  })());

/* ------------------------------------------- 10x evaporation, 10x heat (body) */

check('the super lake body runs its entire heat budget at 10x (air exchange, evaporative cooling, sun, IR)',
  /float waterMult = wall\[TYPE\] == WALLTYPE_SUPER_LAKE \? 10\.0 : 1\.0;/.test(boundary) &&
  /waterHeatExchangeRate \* waterMult/.test(boundary) &&
  /waterEvaporation \* waterMult/.test(boundary) &&
  /netWaterHeating \+= lightPower \* waterMult; \/\/ sun heating water/.test(boundary) &&
  /lightAboveSurface\[NET_HEATING\] \* waterMult; \/\/ IR heating\/cooling effect/.test(boundary));

check('neighbour-temperature smoothing, dykes and land-fill treat a super lake as water',
  /if \(wallXmY0\[TYPE\] == WALLTYPE_WATER \|\| wallXmY0\[TYPE\] == WALLTYPE_SUPER_LAKE\) \{ \/\/ left is water\n            totalNeighborTemp/.test(boundary) &&
  /if \(wallXmY0\[TYPE\] == WALLTYPE_WATER \|\| wallXmY0\[TYPE\] == WALLTYPE_SUPER_LAKE\) \{ \/\/ if left is water, build a dyke/.test(boundary) &&
  /if \(wallXpY0\[TYPE\] == WALLTYPE_WATER \|\| wallXpY0\[TYPE\] == WALLTYPE_SUPER_LAKE\) \{ \/\/ if right is water, build a dyke/.test(boundary) &&
  /\(!allowCaves \|\| wallX0Yp\[TYPE\] == WALLTYPE_WATER \|\| wallX0Yp\[TYPE\] == WALLTYPE_SUPER_LAKE\)/.test(boundary));

check('a super lake is an opaque IR-opaque water surface: no IR bonus to the air directly above it',
  /if \(wall\[TYPE\] != WALLTYPE_WATER && wall\[TYPE\] != WALLTYPE_SUPER_LAKE\)\s*\n\s*base\[TEMPERATURE\] \+= light\[NET_HEATING\];/.test(boundary));

check('IR emission above a super lake uses the lake surface path',
  /case WALLTYPE_SUPER_LAKE: \/\/ super lake: same IR surface behaviour as a lake\s*\n\s*case WALLTYPE_WATER:/.test(lighting) &&
  /if \(wall\[TYPE\] == WALLTYPE_WATER \|\| wall\[TYPE\] == WALLTYPE_SUPER_LAKE\) \/\/ water\s*\n\s*light = vec4\(sunlight \* 0\.90, 0, 0, 0\);/.test(lighting));

/* ------------------------------------------------------ deeper water color */

check('the realistic display renders a super lake as much deeper water than a lake',
  /case WALLTYPE_SUPER_LAKE: \/\/ super lake: same sea, noticeably deeper water color/.test(realistic) &&
  /color = wall\[TYPE\] == WALLTYPE_SUPER_LAKE \? vec3\(0\.0, 0\.13, 0\.34\) : vec3\(0, 0\.5, 1\.0\);/.test(realistic));

check('super lake slopes keep the opaque terrain-foreground treatment of ordinary lakes',
  (realistic.match(/WALLTYPE_SUPER_LAKE/g) || []).length >= 6);

check('humidity, CAPE and reflectivity displays render a super lake as water, CAPE/reflectivity deeper',
  /case WALLTYPE_SUPER_LAKE: \/\/ super lake: shows the water temperature like a lake/.test(humidity) &&
  /#define WALLTYPE_SUPER_LAKE 7/.test(cape) && /vec4\(0\.01, 0\.09, 0\.22, 1\.0\)/.test(cape) &&
  /#define WALLTYPE_SUPER_LAKE 7/.test(reflectivity) && /vec4\(0\.01, 0\.09, 0\.22, 1\.0\)/.test(reflectivity));

check('world generator (setupShader) was not asked to conjure super lakes',
  !/SUPER_LAKE/.test(setup));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
