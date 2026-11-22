'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const post = fs.readFileSync(path.join(root, 'shaders/fragment/postProcessingShader.frag'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const halo = post.slice(post.indexOf('vec4 lightningContactHalo('), post.indexOf('vec3 mappedColor(vec2 uv, vec3 contactLight)'));
assert.strictEqual((halo.match(/texture\(lightningHaloTex/g) || []).length, 4);
assert.match(halo, /max\(canvasTexelSize, outputTexelSize\)/);
assert.match(halo, /if \(!hasLightningBloom\)/);
assert.match(halo, /smoothstep\(2\.0, 8\.0, peak\)/);
assert.match(halo, /light \/ \(1\.0 \+ peak \/ 4\.0\)/);
assert.match(post, /if \(bloomEnabled\) \{\s*vec4 contact = lightningContactHalo\(texCoord\);\s*vec3 withContact = mappedColor\(texCoord, contact\.rgb\)/);
assert.match(halo, /hasLightningBloom \? smoothstep\(0\.15, 8\.0, peak\) : 0\.0/);
assert.match(post, /mix\(outputCol, vec3\(1\.0\), whiteCenter\)/);
assert.match(post, /outputCol = clamp\(outputCol \+ contactIncrement/);
assert.match(app, /hasLightningBloom \? hdrFBO\.lightningBloomTexture : hdrFBO\.texture/);
assert.match(app, /'lightningHaloTex'\), 5/);
// Linear filtering of a one-pixel vertical channel: the neighbouring pixel
// receives a quarter of its source, while a pixel two or more away receives 0.
// The bounded RGB scale preserves hue and prevents energy growing without limit.
const haloAtNeighbor = rgb => {
  const avg = rgb.map(c => c / 4);
  const peak = Math.max(...avg);
  return avg.map(c => 0.32 * c / (1 + peak / 4));
};
for (const rgb of [[16,4,2], [2,4,16], [4,16,2]]) {
  const h = haloAtNeighbor(rgb);
  assert(h.every(Number.isFinite));
  assert(h[Math.max(...rgb) === rgb[0] ? 0 : rgb.indexOf(Math.max(...rgb))] > 0.1);
  assert(Math.abs(h[0] / h[1] - rgb[0] / rgb[1]) < 1e-9);
}
assert(haloAtNeighbor([1e8, 1e8, 1e8])[0] < 1.28);
console.log('Lightning contact halo checks passed');
