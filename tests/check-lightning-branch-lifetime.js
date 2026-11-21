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
assert.match(shader, /1\.0 - smoothstep\(0\.68, 1\.10, time\)/);
assert.equal((shader.match(/artworkBranchCoverage\(artwork\.g, true\)/g) || []).length, 2);
assert.equal((shader.match(/artworkBranchCoverage\(artwork\.g, false\)/g) || []).length, 2);
assert.match(shader, /branchCore \*= branchFade;/);
assert.match(shader, /branchSum \* intensityRaw \* 1200\.0 \* branchFade/);
assert.match(shader, /extBranchGain \* intensityRaw \* 950\.0 \* branchFade/);
const fade = t => { let x = Math.max(0, Math.min(1, (t - .68) / .42)); return 1 - x*x*(3-2*x); };
assert.equal(fade(.65), 1); assert(fade(.9) > 0 && fade(.9) < 1); assert.equal(fade(1.1), 0);
console.log('Trunk/fork artwork, sparse positive forks and branch lifetime checks passed');
