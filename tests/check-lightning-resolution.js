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
check('IC and ground strikes filter coverage and retain raw leader and rod shear',
  /displayAdaptedFlash\(pos, lightningTime, currentLightningIntensity, false\)/.test(shader) &&
  /displayAdaptedFlash\(pos, lightningTime, currentLightningIntensity, true\)/.test(shader) &&
  /textureLod\(lightningTex, lightningTexCoord, 0\.0\)\.g/.test(shader) &&
  /textureGrad\(lightningTex, vec2\(u, t\), gradX, gradY\)\.r/.test(shader) &&
  /originalBoltBottomU - 0\.5/.test(shader));
check('external and CC paths sample adapted original artwork rather than procedural cores',
  /vec2 c = evalExtArc\(t, Hw, V\)/.test(shader) && /cloudCurveProjection\(start, end, bow, skew, u, t, gradX, gradY\)/.test(shader) &&
  (shader.match(/adaptedUpstreamArtwork\(u, t, gradX, gradY\)/g) || []).length === 3);
check('mipmapped RG8 bolt allocation is initialized safely before upload',
  /gl\.texImage2D\(gl\.TEXTURE_2D, 0, gl\.RG8, 1, 1, 0, gl\.RG, gl\.UNSIGNED_BYTE, emptyLightningTexturePixel\);\s*gl\.texParameteri\(gl\.TEXTURE_2D, gl\.TEXTURE_MIN_FILTER, gl\.LINEAR\)/.test(app) &&
  /gl\.generateMipmap\(gl\.TEXTURE_2D\);\s*gl\.texParameteri\(gl\.TEXTURE_2D, gl\.TEXTURE_MIN_FILTER, gl\.LINEAR_MIPMAP_LINEAR\)/.test(app));
// Threshold before mip filtering: faint source values remain excluded, but
// subpixel coverage contributes instead of being removed after averaging.
const coverage = x => Math.max(x - .95, 0) * 20;
check('original threshold is baked into filtered coverage',
  /textureGrad\(lightningTex, vec2\(u, t\), gradX, gradY\)\.r/.test(shader) &&
  coverage(.8) === 0 && Math.abs(coverage(1) - 1) < 1e-12 && Math.abs(coverage(.975) - .5) < 1e-12);
if (failed) process.exitCode = 1;
