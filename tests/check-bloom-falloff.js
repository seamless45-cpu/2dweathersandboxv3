'use strict';
const assert = require('assert');
const fs = require('fs');
const bright = fs.readFileSync('shaders/fragment/isolateBrightPartsShader.frag', 'utf8');
const post = fs.readFileSync('shaders/fragment/postProcessingShader.frag', 'utf8');
assert.match(bright, /log2\(1\.0 \+ highlightPeak\) \/ max\(highlightPeak, 1e-6\)/);
assert.match(post, /bloom \* \(0\.7 \/ \(0\.7 \+ bloomPeak\)\)/);
assert.match(post, /if \(bloomEnabled\)/);
// Simulated blur weights for a bright channel at increasing distances. The
// old pipeline clips every sample to the same display value; the new bright
// pass and composite must retain a visible falloff and the source's RGB ratio.
const weights = [0.2, 0.08, 0.02, 0.005, 0.001];
const source = 20000 * 0.12;
const old = weights.map(w => Math.sqrt(Math.min(1, source * w)));
assert(old.every(v => v === 1), 'fixture must reproduce clipped plateau');
const compressed = Math.log2(1 + source);
const mapped = weights.map(w => {
  const peak = compressed * w;
  return Math.sqrt(peak * 0.7 / (0.7 + peak));
});
for (let i = 1; i < mapped.length; i++) assert(mapped[i] < mapped[i - 1]);
assert(mapped[0] < 1 && mapped[0] - mapped[4] > 0.3);
for (const p of [0.001, 1, 100, 7200]) {
  const rgb = [p, p * 0.45, p * 0.2];
  const gain = Math.log2(1 + p) / p;
  const b = rgb.map(x => x * gain);
  assert(Math.abs(b[1] / b[0] - .45) < 1e-12);
  assert(Math.abs(b[2] / b[0] - .2) < 1e-12);
}
console.log('Bloom clipping and falloff checks passed');
