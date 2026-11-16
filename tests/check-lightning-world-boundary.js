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
check('crawler, external, cloud-to-cloud and other channels use same-tile offsets',
  /fract\(texCoord.x\) - origin.x/.test(crawler) && !/mod\(texCoord.x - origin.x/.test(crawler) &&
  /fract\(texCoord.x\) - groundPos.x/.test(ext) && /originX - groundPos.x/.test(ext) &&
  /fract\(texCoord.x\) - targetPos.x/.test(cc) && /originPos.x - targetPos.x/.test(cc) &&
  /fract\(texCoord.x\) - pos.x/.test(display) && /fract\(texCoord.x\) - data.x/.test(display));
check('rod tip, capture counter and preview also avoid seam shortcuts',
  /abs\(strikeX - rodPositions\[i\].x\)/.test(display) &&
  /abs\(strikeData.x - rod.x\)/.test(display) && /Math.abs\(targetX - rod.x\)/.test(app) &&
  /cursorWrapHorizontally \? fract\(texCoord.x\) : texCoord.x/.test(cursor));
// A point just across the edge in the next tile must not be treated as a
// nearby offset of the current tile; true repeats still align with the origin.
const fract = n => n - Math.floor(n);
const tileOffset = (x, origin, width) => (fract(x) - origin) * width;
check('crawler edge samples do not teleport and repeat tiles remain aligned',
  tileOffset(0.01, 0.99, 80) < -78 && tileOffset(0.99, 0.01, 80) > 78 &&
  Math.abs(tileOffset(1.99, 0.99, 80)) < 1e-10 && Math.abs(tileOffset(-0.01, 0.99, 80)) < 1e-10);
if (failed) process.exitCode = 1;
