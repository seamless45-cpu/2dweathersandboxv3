'use strict';
const assert = require('assert');
const fs = require('fs');
const {installOffscreenCanvas} = require('./ic-canvas-stub');
const restore = installOffscreenCanvas();
const gen = require('../lightningGenerator');
const random = Math.random;
for (const [name, width, height] of [['generateLightningBolt', 500, 1000], ['generateLightningNetwork', 500, 250]]) {
  let trunk = 0, forks = 0, positiveForks = 0, forkOnly = 0;
  for (let seed = 800; seed < 805; seed++) {
    Math.random = gen.makeRng(seed);
    const art = gen[name](width, height);
    assert.equal(art.data.length, width * height * 2);
    for (let i = 0; i < art.data.length; i += 2) {
      if (art.data[i] > 2) trunk++;
      if (art.data[i+1] > 2) forks++;
      if (art.data[i+1] > 92) positiveForks++;
      if (art.data[i] <= 2 && art.data[i+1] > 2) forkOnly++;
    }
  }
  assert(trunk > 0 && forkOnly > 0 && positiveForks > 0, name);
  assert(positiveForks < forks * 0.5, `${name}: positive forks not sparse`);
}
Math.random = random; restore();
const shader = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag', 'utf8');
// Original forks are baked into the upstream tile; no separate procedural
// branch fade is applied. All special paths use the shared original artwork.
assert.match(shader, /textureLod\(lightningTex, vec2\(u, t\), 0\.0\)\.b - 0\.95/);
for (const name of ['displayAdaptedFlash', 'displayExternalLightning', 'displayCloudToCloudLightning']) {
  const start=shader.indexOf('vec3 '+name+'('), body=shader.slice(start,shader.indexOf('\n}',start));
  assert.match(body,/adaptedUpstreamArtwork\(u, t\)/);
  assert.doesNotMatch(body,/ccEvalBranch\(|extBranchGain/);
}
console.log('Generator fork data and original-artwork branch checks passed');
