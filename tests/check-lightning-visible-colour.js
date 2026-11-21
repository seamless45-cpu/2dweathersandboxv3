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
assert.match(shader, /return c \/ \(1\.0 \+ peak \/ 12000\.0\);/);
assert.match(shader, /displayLightningRadiance\(lightningBoltLight \/ \(1\. \+ cloudDensity \* 100\.0\)\)/);
assert.match(shader, /emittedLight \+= displayLightningRadiance\(drawUpperAtmosphereLightning\(\)\)/);
assert.match(shader, /vec3 upperAtmosphereLight = displayLightningRadiance\(drawUpperAtmosphereLightning\(\)\)/);
assert.match(shader, /float growthMask = smoothstep\(growthFront/);
// Emulate the actual helper at high radiance: it preserves channel ratios and
// keeps default-exposure emission HDR-bright enough for bloom. Display mapping preserves their hue.
const map = c => { const p = Math.max(...c) * 12; return c.map(v => v * 12 / (1 + p / 12000.0)); };
for (const c of [[620,800,1000], [850,900,1000], [1000,55,35], [300,380,1000]]) {
  const out = map(c);
  assert(Math.max(...out) < 12000 && Math.max(...out) > 3000);
  assert(Math.abs(out[0] / out[2] - c[0] / c[2]) < 1e-12);
}
assert(map([620,800,1000])[0] < map([850,900,1000])[0]);
const post = read('shaders/fragment/postProcessingShader.frag');
assert.match(post, /color \/= max\(1\.0, peak\);/);
assert.match(post, /color \*= mappedPeak \/ max\(peak, 1e-6\);/);
assert.match(shader, /rgb = pow\(rgb, vec3\(2\.2\)\);/);
const display = c => { const peak = Math.max(...c); return c.map(v => v / Math.max(1, peak)); };
const a = display(map([620, 800, 1000])), b = display(map([850, 900, 1000]));
assert(a[0] < b[0] && a[2] === b[2]);
assert(Math.max(...map([620,800,1000])) * 0.02 > 1.0);
// Parse the shipped class palette and evaluate its tint through the HDR and
// display transforms. This guards dispatch and colour separation, not just
// the presence of colour-related shader strings.
const palette = [...shader.matchAll(/if \(kind == (\d+)\) return vec3\(([\d.]+), ([\d.]+), ([\d.]+)\)/g)]
  .map(m => [Number(m[1]), ...m.slice(2).map(Number)]);
assert.deepStrictEqual(palette.map(p => p[0]), [0,1,2,3,4,5,6,7,8]);
const fallback = shader.match(/return vec3\(([\d.]+), ([\d.]+), ([\d.]+)\);\s*\/\/ hyperbolt/);
assert(fallback); palette.push([9,...fallback.slice(1).map(Number)]);
assert.match(shader, /isGroundToCloud \? 7 : isHyperbolt \? 9 : isSuperbolt \? 6/);
assert.match(shader, /isExternalPositive \? 5 : isCloudToCloud \? \(isPositiveCC \? 4 : 3\)/);
assert.match(shader, /isFlash \? \(isPositiveIC \? 2 : 1\) : 0/);
assert.match(shader, /apparentChannelColor\(strikeChannel, lightningIlluminationTint\)/);
assert.match(shader, /apparentLightningTint\(8, lightningData\.xy, lightningStartIterNum\)/);
assert.match(shader, /onLight \+= crawlerLight \* 0\.0001/);
assert.match(shader, /onLight \+= lightningIlluminationTint \* \(lightningOnLightBrightness \* 1\.4/);
const tintHelper = shader.match(/vec3 apparentLightningTint\([\s\S]*?\n}/)[0];
assert.match(tintHelper, /mod\(startIteration, 4096\.0\)/);
assert.doesNotMatch(tintHelper, /texCoord|lightningTime/);
assert.match(shader, /mix\(vec3\(peak\), radiance, 0\.12\) \* tint/);
const hues = palette.map(([id,...tint]) => {
  const intrinsic = [.5,.7,1], seed = .5;
  const filter = [1,.97,.93].map((v,i) => v*(1-seed)+[.96,.99,1][i]*seed);
  const channel = tint.map((v,i)=> v * filter[i] * (.88 + .12*intrinsic[i]) * 1000);
  return display(map(channel)).map(v => Math.pow(v, 1/2.2));
});
for (let i=0;i<hues.length;i++) for (let j=i+1;j<hues.length;j++)
  assert(Math.hypot(...hues[i].map((v,k)=>v-hues[j][k])) > .01, `indistinct classes ${i} and ${j}`);
assert(hues[0][0] > hues[0][2]); // ordinary CG is not fixed blue
assert(hues[6][0] > .9 * hues[6][2]); // superbolt is not deep blue
assert.match(shader, /vec3 red = vec3\(1\.0, 0\.055, 0\.035\)/); // sprite
assert.match(shader, /vec3\(0\.30, 0\.38, 1\.0\)/); // blue jet
assert.match(shader, /hasOpticalEffect\(meta\.w, 8\.0\)/); // elve is separate
assert.match(shader, /light \+= spriteLight \* opticalTint/);
assert.match(shader, /light \+= opticalTint \* vec3\(0\.30, 0\.38, 1\.0\)/);
assert.match(shader, /light \+= opticalTint \* vec3\(1\.0, 0\.13, 0\.08\)/);
console.log('Lightning hue, effect-domain and variant persistence checks passed');
