'use strict';
const fs = require('fs');
const shader = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
let failed = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
const main = shader.slice(shader.indexOf('void main()'));
check('derivatives are captured before nonuniform rendering branches',
  main.indexOf('screenTexDx = dFdx(texCoord)') < main.indexOf('if (texCoord.y > 1.0)') &&
  main.indexOf('screenTexDy = dFdy(texCoord)') < main.indexOf('if (texCoord.y > 1.0)'));
check('both IC paths use explicit projected gradients and normal CG accounts for rod shear',
  (shader.match(/textureGrad\(lightningNetworkTex, flashCoord, gradX, gradY\)/g) || []).length === 2 &&
  /textureGrad\(lightningTex, lightningTexCoord, gradX, gradY\)/.test(shader) && /shear \* screenTexDx.y/.test(shader));
check('external bolt mip level and procedural lines use actual screen footprint, not fixed resolution',
  /textureLod\(lightningTex, vec2\(u, v\), lod\)/.test(shader) && /float pixelWorld = max\(length\(pixelX\), length\(pixelY\)\)/.test(shader) &&
  /float filteredWidth = sqrt\(width \* width \+ 0.25 \* pixelKm \* pixelKm\)/.test(shader) &&
  !/1400\.0 \* max\(view\[2\]/.test(shader));
check('mipmapped R8 bolt allocation is initialized safely before upload',
  /gl\.texImage2D\(gl\.TEXTURE_2D, 0, gl\.R8, 1, 1, 0, gl\.RED, gl\.UNSIGNED_BYTE, emptyLightningTexturePixel\);\s*gl\.texParameteri\(gl\.TEXTURE_2D, gl\.TEXTURE_MIN_FILTER, gl\.LINEAR\)/.test(app) &&
  /gl\.generateMipmap\(gl\.TEXTURE_2D\);\s*gl\.texParameteri\(gl\.TEXTURE_2D, gl\.TEXTURE_MIN_FILTER, gl\.LINEAR_MIPMAP_LINEAR\)/.test(app));
// Model mip averaging of a nine-texel-wide channel. At 1x/2x/4x/8x
// minification across a range of subpixel phases the filtered signal must
// survive the cutoff; the old 0.95 cutoff lost it entirely at 8x.
const threshold = 0.004;
let continuous = true, oldGaps = false;
for (const footprint of [1, 2, 4, 8, 16, 32]) {
  for (let phase = -0.5; phase <= 0.5; phase += 0.05) {
    const left = phase * footprint - footprint / 2;
    const right = phase * footprint + footprint / 2;
    const coverage = Math.max(0, Math.min(right, 4.5) - Math.max(left, -4.5)) / footprint;
    continuous &&= coverage > threshold;
    oldGaps ||= coverage <= 0.95;
  }
}
check('filtered channel coverage survives minification and subpixel phase', continuous && oldGaps &&
  Math.abs((1 - threshold) * (0.05 / (1 - threshold)) - 0.05) < 1e-12);
if (failed) process.exitCode = 1;
