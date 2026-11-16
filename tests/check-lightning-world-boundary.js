'use strict';
const fs = require('fs');
const location = fs.readFileSync('shaders/fragment/lightningLocationShader.frag', 'utf8');
const display = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag', 'utf8');
const cursor = fs.readFileSync('shaders/commonDisplay.glsl', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
let failed = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
const chunk = (source, a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const ext = chunk(display, 'vec3 displayExternalLightning(', 'vec2 evalCcCubic(');
const cc = chunk(display, 'vec3 displayCloudToCloudLightning(', 'vec3 saturate(');
const crawler = chunk(display, 'vec3 drawAnvilCrawler(', '// Optical approximations');
const selector = chunk(location, 'float selectExternalStrikeTarget(', '// Estimate the upper cloud edge');
check('external selector samples only same-tile candidates and uses the physical maximum',
  /float available = side > 0\.0 \? 0\.999999 - originPos\.x : originPos\.x/.test(selector) &&
  /float maxDx = min\(maxMeters \/ widthMeters, available\)/.test(selector) &&
  /if \(maxDx < minDx\)/.test(selector) && !/fract\(/.test(selector));
check('rod eligibility is screened before selecting the nearest reachable rod',
  location.indexOf('if (rodRangeMeters < minRangeMeters || rodRangeMeters > maxRangeMeters)') <
  location.indexOf('if (normDist < bestNormalizedDist)') &&
  /float dx = lightningHorizontalDist\(strike.x, rodPositions\[i\].x\)/.test(location) &&
  /return abs\(a - b\)/.test(location));
// Invalid nearby candidates cannot hide a valid rod, and same-edge capture works.
function nearestValid(origin, target, rods, width, min, max, reach) {
  let best = -1, bestDistance = reach;
  rods.forEach((rod, i) => {
    const range = Math.abs(origin - rod) * width, distance = Math.abs(target - rod);
    if (range >= min && range <= max && distance < bestDistance) { best = i; bestDistance = distance; }
  });
  return best;
}
check('invalid, overly distant, and opposite-seam rods cannot override a valid external rod',
  nearestValid(0.1, 0.51, [0.53, 0.49, 0.99], 80000, 5500, 34000, 0.1) === 1 &&
  nearestValid(0.01, 0.08, [0.99], 80000, 5500, 34000, 0.2) === -1 &&
  nearestValid(0.01, 0.08, [0.09], 80000, 5500, 34000, 0.2) === 0);
// Unlike the wrapped background, display coordinates are left unwrapped by
// realDispShader.vert. Verify every entry point clips BEFORE it can draw, and
// the common event loop clips both channel contributions and illumination.
const vertex = fs.readFileSync('shaders/vertex/realDispShader.vert', 'utf8');
check('display keeps unwrapped tile coordinates and uses a half-open canonical tile',
  /texCoord = texCoordAdjusted \* texelSize/.test(vertex) &&
  /return texCoord\.x >= 0\.0 && texCoord\.x < 1\.0;/.test(display));
const variants = [
  ['CG and artificial CG', 'displayLightning', 'displayFlash'],
  ['negative intra-cloud', 'displayFlash', 'displayPositiveFlash'],
  ['positive intra-cloud', 'displayPositiveFlash', 'evalExtArc'],
  ['external positive CG and superbolt', 'displayExternalLightning', 'evalCcCubic'],
  ['both cloud-to-cloud polarities', 'displayCloudToCloudLightning', 'saturate'],
  ['upward ground-to-cloud', 'displayGroundToCloud', 'drawAnvilCrawler'],
  ['anvil crawler', 'drawAnvilCrawler', 'drawUpperAtmosphereLightning'],
  ['sprite, jet and elve', 'drawUpperAtmosphereLightning', 'computeAirColor'],
];
for (const [label, name, next] of variants) {
  const body = chunk(display, 'vec3 ' + name + '(', (next === 'evalExtArc' || next === 'evalCcCubic' ? 'vec2 ' : next === 'computeAirColor' ? 'vec4 ' : 'vec3 ') + next + '(');
  check(label + ' rejects fragments outside the world tile and never wraps x',
    /^vec3 [^{]+\{\s*if \(!inLightningWorldTile\(\)\)\s*return vec3\(0\.0\);/.test(body) &&
    !/fract\(texCoord\.x\)|mod\(texCoord\.x/.test(body) && /texCoord\.x - (?:pos|groundPos|targetPos|origin|data)\.x/.test(body));
}
const events = chunk(display, 'vec3 lightningBoltLight = vec3(0.0)', 'emittedLight += lightningBoltLight');
check('all channel dispatch and associated illumination are inside the clipped event loop',
  /for \(int slot = 0; slot < LIGHTNING_SLOTS; slot\+\+\) \{\s*if \(!inLightningWorldTile\(\)\)\s*break;/.test(events) &&
  variants.slice(0, 7).every(([, name]) => events.includes(name + '(')) &&
  !/fract\(texCoord\.x\)|mod\(texCoord\.x/.test(events) && events.includes('onLight +='));
check('rod capture flashes are clipped but ordinary rod and terrain wrapping remain',
  /abs\(strikeX - rodPositions\[i\]\.x\)/.test(display) &&
  /abs\(strikeData.x - rod.x\)/.test(display) && /Math.abs\(targetX - rod.x\)/.test(app) &&
  /cursorWrapHorizontally \? fract\(texCoord.x\) : texCoord.x/.test(cursor) &&
  /if \(!inLightningWorldTile\(\) \|\| abs\(texCoord\.x - rod\.x\) > 0\.5\)\s*break;/.test(display) &&
  /mod\(texCoord\.x - rod\.x \+ 0\.5, 1\.0\)/.test(display));
// Model exactly the shader's ownership predicate and unwrapped offset. Check
// both sides of both seams, normal and wide views, all variants and origin edges.
const inTile = x => x >= 0 && x < 1;
const samples = [-1.001, -1, -0.999, -0.001, 0, 0.001, 0.999, 1, 1.001, 1.999, 2];
for (const [label] of variants) {
  for (const origin of [0.001, 0.999]) {
    check(label + ' edge origin ' + origin + ' clips repeated tiles and retains unwrapped distance',
      samples.every(x => inTile(x) === (x >= 0 && x < 1)) &&
      !inTile(-0.001) && inTile(0) && inTile(0.999) && !inTile(1) &&
      Math.abs((1 - origin) - (-origin)) === 1 &&
      Math.abs((0.001 - origin) - (0.999 - origin)) > 0.99);
  }
}
check('non-wrapping single tile still includes both world edges', inTile(0) && inTile(1 - 1e-9));
if (failed) process.exitCode = 1;
