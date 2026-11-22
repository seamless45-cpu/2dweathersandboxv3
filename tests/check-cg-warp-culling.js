'use strict';
// Ordinary CG samples the original artwork directly; special-variant jag
// functions remain available to their separate renderers.
const assert = require('assert');
const fs = require('fs');
const shader = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag', 'utf8');
const cg = shader.slice(shader.indexOf('vec3 displayLightning('), shader.indexOf('vec3 displayFlash('));
assert.doesNotMatch(cg, /fractalLateralJag|ccEvalBranch/);
assert.match(cg, /textureLod\(lightningTex, lightningTexCoord, 0\.0\)\.b/);
assert.match(cg, /originalBoltBottomU/);
assert(cg.indexOf('lightningTexCoord.x > 1.01') < cg.indexOf('textureLod('));
console.log('Original CG bounds and undistorted artwork checks passed');
