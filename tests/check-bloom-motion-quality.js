'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const shader = fs.readFileSync(path.join(root, 'shaders/fragment/realisticDisplayShader.frag'), 'utf8');
const post = fs.readFileSync(path.join(root, 'shaders/fragment/postProcessingShader.frag'), 'utf8');
const bright = fs.readFileSync(path.join(root, 'shaders/fragment/isolateBrightPartsShader.frag'), 'utf8');
assert.match(shader, /peak \/ 24000\.0/);
assert.match(shader, /vec3 c = max\(radiance, vec3\(0\.0\)\) \* 18\.0;/);
assert.match(bright, /outputCol \*= 0\.02/);
assert.match(post, /return clamp\(pow\(max\(color, vec3\(0\.0\)\), ONE_OVER_GAMMA\), 0\.0, 1\.0\)/);
assert.match(post, /color \*= mappedPeak \/ max\(peak, 1e-6\)/);
const mapped = post.slice(post.indexOf('vec3 mappedColor(vec2 uv)'));
assert(mapped.indexOf('texture(bloomTex, uv)') < mapped.indexOf('float peak ='));
const emit = c => c.map(v => v * 18 / (1 + Math.max(...c) * 18 / 24000));
const previous = c => c.map(v => v * 6 / (1 + Math.max(...c) * 6 / 4000));
for (const brightness of [0.1, 1, 10, 100, 1000, 100000]) {
  const c = [brightness * .4, brightness * .7, brightness];
  assert(emit(c)[2] > previous(c)[2] * 1.99, `insufficient boost at ${brightness}`);
}
// With filmic off, each exposed component clips independently, like the
// upstream canvas: a bright core becomes white, while a dim halo keeps hue.
const display = c => c.map(v => Math.min(1, Math.pow(Math.max(v, 0), 1/2.2)));
assert.deepStrictEqual(display([70,57,100]), [1,1,1]);
const dim = display([.07,.057,.1]);
assert(dim[2] > dim[0] && dim[0] > dim[1]);
assert(Math.max(...emit([250,500,1000])) * .02 > 1);
assert.match(post, /const int TAPS = 16;/);
assert.match(post, /vec2 sampleUV = texCoord - trail \* t/);
assert.match(post, /acc \+= mappedColor\(sampleUV\)/);
assert.doesNotMatch(post.slice(post.indexOf('if (motionBlurEnabled && motionBlurHistoryValid)')), /texture\(historyTex/);
console.log('Bloom, highlight hue and shutter sampling regressions passed');
