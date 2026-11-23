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
// Both IC polarities share the clipped upstream-artwork renderer.
const adaptedStart = shader.indexOf('vec3 displayAdaptedFlash(');
const adapted = shader.slice(adaptedStart, shader.indexOf('\n}', adaptedStart));
assert.match(adapted, /if \(!inLightningWorldTile\(\)\) return vec3\(0\.0\)/);
assert.match(adapted, /adaptedUpstreamArtwork\(u, t\)/);
for (const positive of ['false', 'true'])
  assert(shader.includes(`displayAdaptedFlash(pos, lightningTime, currentLightningIntensity, ${positive})`));
const artStart = shader.indexOf('float adaptedUpstreamArtwork(');
const art = shader.slice(artStart, shader.indexOf('\n}', artStart));
assert(art.indexOf('if (u < 0.01') < art.indexOf('textureLod('));
assert.doesNotMatch(shader, /drawUpperAtmosphereLightning|drawAnvilCrawler|displayGroundToCloud/);
console.log('Lightning appearance, performance and defaults regression checks passed');
