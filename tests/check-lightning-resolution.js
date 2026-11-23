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
check('IC and ground strikes use upstream base-level sampling and rod endpoint shear',
  /displayAdaptedFlash\(pos, lightningTime, currentLightningIntensity, false\)/.test(shader) &&
  /displayAdaptedFlash\(pos, lightningTime, currentLightningIntensity, true\)/.test(shader) &&
  /textureLod\(lightningTex, lightningTexCoord, 0\.0\)\.b/.test(shader) &&
  /textureLod\(lightningTex, vec2\(u, t\), 0\.0\)\.b/.test(shader) &&
  /originalBoltBottomU - 0\.5/.test(shader));
check('external and CC paths sample adapted original artwork rather than procedural cores',
  /vec2 c = evalExtArc\(t, Hw, V\)/.test(shader) && /vec2 c = evalCcCubic\(t, p0, p1, p2, p3\)/.test(shader) &&
  (shader.match(/adaptedUpstreamArtwork\(u, t\)/g) || []).length === 3);
check('mipmapped RGB8 bolt allocation is initialized safely before upload',
  /gl\.texImage2D\(gl\.TEXTURE_2D, 0, gl\.RGB8, 1, 1, 0, gl\.RGB, gl\.UNSIGNED_BYTE, emptyLightningTexturePixel\);\s*gl\.texParameteri\(gl\.TEXTURE_2D, gl\.TEXTURE_MIN_FILTER, gl\.LINEAR\)/.test(app) &&
  /gl\.generateMipmap\(gl\.TEXTURE_2D\);\s*gl\.texParameteri\(gl\.TEXTURE_2D, gl\.TEXTURE_MIN_FILTER, gl\.LINEAR_MIPMAP_LINEAR\)/.test(app));
// The original high threshold intentionally rejects dim pixels. Base-level
// sampling can miss a thin channel under minification; do not claim that mip
// averaging provides continuity when this renderer deliberately avoids it.
const coverage = x => Math.max(x - .95, 0) * 20;
check('upstream threshold preserves a full core while suppressing faint pixels',
  /textureLod\(lightningTex, vec2\(u, t\), 0\.0\)\.b - 0\.95/.test(shader) &&
  coverage(.8) === 0 && Math.abs(coverage(1) - 1) < 1e-12 && Math.abs(coverage(.975) - .5) < 1e-12);
if (failed) process.exitCode = 1;
