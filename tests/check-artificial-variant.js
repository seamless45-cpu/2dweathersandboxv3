'use strict';
// Artificial lightning variant picker: the in-page option list in the User
// Interaction folder decides which event the Artificial Lightning tool
// queues. The UI stores a stable key; the slot pass maps it to the numeric
// selector the slot-manager shader dispatches on.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('app.js');
const html = read('index.html');
const locationShader = read('shaders/fragment/lightningLocationShader.frag');
const common = read('shaders/common.glsl');
let passed = 0, failed = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (ok) passed++; else failed++; }

// The two option tables in app.js, lifted out and executed for real: every
// option label must map to a key and every key to a unique variant index 0-12.
function extractConst(name) {
  const match = app.match(new RegExp('const ' + name + ' = (\\{[\\s\\S]*?\\});'));
  return match ? vm.runInNewContext('(' + match[1] + ')', {}) : null;
}
const options = extractConst('artificialVariantOptions');
const uniforms = extractConst('artificialVariantUniforms');
check('option table holds exactly 13 unique in-page options in UI order',
  options && Object.keys(options).length === 13 && new Set(Object.values(options)).size === 13 &&
  Object.keys(options)[0] === 'Ordinary Cloud-to-Ground' &&
  Object.keys(options)[7] === 'Ground-to-cloud (Upward)' &&
  Object.keys(options)[11] === 'Elve' &&
  Object.keys(options)[12] === 'Hyperbolt');
check('every UI option maps to a unique shader variant index 0..12',
  uniforms && options &&
  Object.values(options).every(key => Number.isInteger(uniforms[key]) && uniforms[key] >= 0 && uniforms[key] <= 12) &&
  new Set(Object.keys(options).map(label => uniforms[options[label]])).size === 13);
check('option order matches shader variant dispatch order',
  uniforms && uniforms.ordinary_cg === 0 && uniforms.intra_cloud === 1 && uniforms.positive_ic === 2 &&
  uniforms.cc_negative === 3 && uniforms.cc_positive === 4 && uniforms.positive_cg === 5 &&
  uniforms.superbolt === 6 && uniforms.ground_to_cloud === 7 && uniforms.anvil_crawler === 8 &&
  uniforms.blue_jet === 9 && uniforms.red_sprite === 10 && uniforms.elve === 11 &&
  uniforms.hyperbolt === 12);

check('GUI control is an immediate in-page option list with a README-required listen()',
  /\.add\(guiControls, 'artificialLightningVariant', artificialVariantOptions\)\s*\n\s*\.name\('Artificial Lightning Variant'\)\s*\n\s*\.listen\(\)/.test(app));
check('saved settings validate the variant key and fall back to ordinary cloud-to-ground',
  /hasOwnProperty\.call\(artificialVariantUniforms, guiControls\.artificialLightningVariant\)/.test(app) &&
  /guiControls\.artificialLightningVariant = 'ordinary_cg';/.test(app));
check('default settings pick the ordinary cloud-to-ground variant',
  /artificialLightningVariant : 'ordinary_cg',/.test(app));
check('slot pass uploads the numeric variant and the rod-tip height for ground-to-cloud',
  /gl\.uniform1f\(getUniformLoc\(lightningLocationProgram, 'artificialStrikeVariant'\),\s*\n\s*artificialVariantUniforms\[manualStrike \? manualStrike\.variant : guiControls\.artificialLightningVariant\] \?\? 0\)/.test(app) &&
  /gl\.uniform1f\(getUniformLoc\(lightningLocationProgram, 'artificialStrikeTipY'\)/.test(app));
check('queued clicks remember the terrain surface height for the ground-to-cloud variant',
  /tipY : \(surfaceCell \+ 1\) \/ sim_res_y, variant : guiControls\.artificialLightningVariant/.test(app) &&
  /const manualStrike = !artificialAttemptedThisFrame && iterNum > 0 \? pendingArtificialLightning\[0\] : null/.test(app));

check('slot-manager shader declares both uniforms and dispatches on the variant selector',
  /uniform float artificialStrikeVariant;/.test(locationShader) &&
  /uniform float artificialStrikeTipY;/.test(locationShader) &&
  /float variant = artificialStrikeVariant;/.test(locationShader) &&
  /ground-to-cloud \(upward leader\)[\s\S]{0,220}artificialStrikeTipY \+ 0\.05/.test(locationShader));
check('ground-striking artificial variants still capture lightning rods',
  (locationShader.match(/artData = attractToRod\(artData\);/g) || []).length >= 4 &&
  /\/\/ positive cloud-to-ground[\s\S]{0,120}attractToRod/.test(locationShader) &&
  /\/\/ superbolt[\s\S]{0,200}attractToRod/.test(locationShader) &&
  /\/\ hyperbolt \(720,000 K positive CG\)[\s\S]{0,220}attractToRod/.test(locationShader) &&
  /\/\/ red sprite \(\+CG \+ sprite effect\)[\s\S]{0,120}attractToRod/.test(locationShader) &&
  /\/\/ elve \(energetic CG \+ elve effect\)[\s\S]{0,120}attractToRod/.test(locationShader));
check('artificial heights are stored with the 10-unit offset and disambiguated in common.glsl',
  /bool artificialMeta\(float metaZ\)/.test(common) &&
  /float artificialMetaRawZ\(float metaZ\)/.test(common) &&
  /return metaZ >= 10\.0 \? metaZ - 10\.0 : metaZ;/.test(common) &&
  /metaZ < -0\.5 \|\| metaZ >= 10\.0/.test(common));
check('superbolt variant raises integer meta.w for the full-width camera shake path',
  /artMeta = vec4\(originX, 1\.0, -1\.0, 1\.0\); \/\/ integer meta\.w = 1 superbolt, 2 hyperbolt/.test(locationShader));
check('hyperbolt variant raises integer meta.w 2 for its own camera shake path',
  /variant > 11\.5 && variant < 12\.5[\s\S]{0,200}artMeta = vec4\(originX, 1\.0, -1\.0, 2\.0\); \/\/ integer meta\.w = 2 hyperbolt flag/.test(locationShader));
check('optical-effect variants carry fract-friendly optical bits in meta.w',
  /10\.0 \+ clamp\(cloudTop, 0\.0, 0\.99\), 1\.0 \/ 32\.0\)/.test(locationShader) && // anvil crawler -> bit 1
  /10\.0 \+ clamp\(cloudTop, 0\.0, 0\.99\), 4\.0 \/ 32\.0\)/.test(locationShader) && // blue jet -> bit 4
  /-1\.0, 2\.0 \/ 32\.0\)/.test(locationShader) &&                                    // red sprite -> bit 2
  /-1\.0, 8\.0 \/ 32\.0\)/.test(locationShader));                                    // elve -> bit 8
check('natural optical-effect enrichment never re-flags an artificial strike',
  /if \(row == 1 && !artificialMeta\(result\.z\)\) \{/.test(locationShader));
check('help text documents the variant option and its thirteen choices',
  /Artificial Lightning Variant/.test(html) && /superbolt, hyperbolt/.test(html) && /ground-to-cloud, anvil crawler, blue jet, red sprite or elve/.test(html));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
