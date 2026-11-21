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
// Both cloud networks reject out-of-tile fragments before texture sampling
// and no longer apply a high-frequency secondary warp to the artwork.
for (const name of ['displayFlash', 'displayPositiveFlash']) {
  const start = shader.indexOf('vec3 ' + name + '(');
  const body = shader.slice(start, shader.indexOf('\n}', start));
  assert(body.indexOf('if (flashCoord.y < 0.004') < body.indexOf('textureGrad('));
  assert.doesNotMatch(body, /flashLateralJag|flashCoord\.x \+=/);
}
assert.doesNotMatch(shader, /drawUpperAtmosphereLightning|drawAnvilCrawler|displayGroundToCloud/);
console.log('Lightning appearance, performance and defaults regression checks passed');
