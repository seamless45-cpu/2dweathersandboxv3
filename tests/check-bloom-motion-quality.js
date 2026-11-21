'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const shader = fs.readFileSync(path.join(root, 'shaders/fragment/realisticDisplayShader.frag'), 'utf8');
const post = fs.readFileSync(path.join(root, 'shaders/fragment/postProcessingShader.frag'), 'utf8');
const bright = fs.readFileSync(path.join(root, 'shaders/fragment/isolateBrightPartsShader.frag'), 'utf8');
assert.match(shader, /peak \/ 4000\.0/);
assert.match(shader, /vec3 c = max\(radiance, vec3\(0\.0\)\) \* 6\.0;/);
assert.match(bright, /outputCol \*= 0\.02;/);
assert.match(post, /color \/= max\(1\.0, peak\)/);
assert.match(post, /color \*= mappedPeak \/ max\(peak, 1e-6\)/);
assert(post.indexOf('texture(bloomTex, uv)') < post.indexOf('float peak ='));
const emit = c => c.map(v => v * 6 / (1 + Math.max(...c) * 6 / 4000));
const previous = c => c.map(v => v / (1 + Math.max(...c) / 80));
for (const brightness of [0.1, 1, 10, 100, 1000, 100000]) {
  const c = [brightness * .4, brightness * .7, brightness];
  assert(emit(c)[2] > previous(c)[2] * 2, `insufficient boost at ${brightness}`);
}
const display = c => c.map(v => Math.pow(v / Math.max(1, ...c), 1/2.2));
const cold = display(emit([250,500,1000]));
const warm = display(emit([800,900,1000]));
assert(cold[0] < warm[0] - .15);
assert(Math.max(...emit([250,500,1000])) * .02 > 1); // bloom gets substantial HDR energy
assert.match(post, /const int TAPS = 24;/);
assert.match(post, /vec2 currentUV = texCoord - flow \* \(t \* exposureSpan\)/);
assert.match(post, /vec2 historyUV = texCoord \+ flow \* \(\(1\.0 - t\) \* exposureSpan\)/);
assert.match(post, /historyTap = clamp\(historyTap, max\(currentTap - vec3\(0\.35\)/);
assert.doesNotMatch(post, /historyTap = clamp\([^\n]*neighborhoodMin/);
assert.match(post, /currentInside \? w \* \(1\.0 - t\) : 0\.0/);
assert.match(post, /historyInside \? w \* t : 0\.0/);
console.log('Bloom, highlight hue and shutter sampling regressions passed');
