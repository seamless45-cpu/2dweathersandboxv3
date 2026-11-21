'use strict';
// Guard against per-component framebuffer clipping erasing variant hue, and
// against saved / queued variants silently reverting to ordinary CG.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const shader = read('shaders/fragment/realisticDisplayShader.frag');
const app = read('app.js');
const source = app.match(/const artificialVariantUniforms = (\{[\s\S]*?\});/)[1];
const variants = vm.runInNewContext('(' + source + ')');
for (const name of ['ordinary_cg','ground_to_cloud','anvil_crawler','blue_jet','red_sprite','elve'])
  assert(Object.prototype.hasOwnProperty.call(variants, name), name);
assert.match(app, /hasOwnProperty\.call\(artificialVariantUniforms, guiControls\.artificialLightningVariant\)/);
assert.match(app, /variant : guiControls\.artificialLightningVariant/);
assert.match(app, /artificialVariantUniforms\[manualStrike \? manualStrike\.variant : guiControls\.artificialLightningVariant\]/);
assert.match(shader, /return c \/ \(1\.0 \+ peak \/ 0\.65\);/);
assert.match(shader, /displayLightningRadiance\(lightningBoltLight \/ \(1\. \+ cloudDensity \* 100\.0\)\)/);
assert.match(shader, /emittedLight \+= displayLightningRadiance\(drawUpperAtmosphereLightning\(\)\)/);
assert.match(shader, /vec3 upperAtmosphereLight = displayLightningRadiance\(drawUpperAtmosphereLightning\(\)\)/);
assert.match(shader, /float growthMask = smoothstep\(growthFront/);
// Emulate the actual helper at high radiance: it preserves channel ratios and
// keeps default-exposure emission below the canvas clipping threshold.
const map = c => { const p = Math.max(...c); return c.map(v => v / (1 + p / 0.65)); };
for (const c of [[620,800,1000], [850,900,1000], [1000,55,35], [300,380,1000]]) {
  const out = map(c);
  assert(Math.max(...out) < 0.65);
  assert(Math.abs(out[0] / out[2] - c[0] / c[2]) < 1e-12);
}
assert(map([620,800,1000])[0] < map([850,900,1000])[0]);
console.log('Lightning hue, effect-domain and variant persistence checks passed');
