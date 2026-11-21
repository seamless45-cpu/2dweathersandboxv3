// Regression checks for opt-in defaults and the lightning rendering changes.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const shader = fs.readFileSync(path.join(root, 'shaders/fragment/realisticDisplayShader.frag'), 'utf8');
const assert = require('assert');
assert.match(app, /hdrQuality : '100%',/);
assert.match(app, /motionBlurEnabled : false,/);
// Loading overlays a saved choice onto defaults, rather than forcing either value.
assert.match(app, /guiControls = \{ \.\.\.guiControls_default, \.\.\.JSON\.parse\(strGuiControls\) \}/);
assert.doesNotMatch(app, /guiControls\.motionBlurEnabled = (?:true|false);/);
// The jet's cap has a lateral envelope, so it cannot light the whole width of its box.
assert.match(shader, /front \* fan \* 0\.3 \* fade/);
assert.match(shader, /float thickness = mix\(0\.8, 3\.5,/);
assert.match(shader, /float attachmentGlow = exp\(-length\(p\)/);
assert.doesNotMatch(shader, /float shockRing/);
// Vertical rejection must happen before the costly fractal for CG and IC.
const cg = shader.slice(shader.indexOf('vec3 displayLightning('), shader.indexOf('vec3 displayFlash('));
assert(cg.indexOf('if (lightningTexCoord.y < 0.01') < cg.indexOf('float boltJag ='));
for (const name of ['displayFlash', 'displayPositiveFlash']) {
  const body = shader.slice(shader.indexOf('vec3 ' + name + '('), shader.indexOf('vec3 ' + name + '(') + 4000);
  assert(body.indexOf('if (flashCoord.y < 0.004') < body.indexOf('flashLateralJag('));
}
// Each lane is rejected before node traversal; unformed nodes do no cloud fetches.
const crawler = shader.slice(shader.indexOf('vec3 drawAnvilCrawler('), shader.indexOf('vec3 spriteBody('));
assert(crawler.indexOf('p.x * side < -6.0') < crawler.indexOf('for (int i = 1; i <= 11; i++)'));
assert(crawler.indexOf('if (growth <= 0.0)') < crawler.indexOf('float nextCloud = texture'));
assert.match(crawler, /float laneCore = channelGlow\(p, previous, end, width\)/);
assert.match(shader, /if \(abs\(dx\) > 9\.0\)\s*return vec3\(0\.0\);/);
console.log('Lightning appearance, performance and defaults regression checks passed');
