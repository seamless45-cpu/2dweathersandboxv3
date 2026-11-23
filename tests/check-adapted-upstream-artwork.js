'use strict';
const assert = require('assert');
const fs = require('fs');
const s = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag', 'utf8');
const section = (a,b) => s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const artwork = section('float adaptedUpstreamArtwork(', '\n}\n');
assert.match(artwork, /originalBoltBottomU - 0\.5/);
assert.match(artwork, /textureGrad\(lightningTex, vec2\(u, t\), gradX, gradY\)\.r/);
const flash = section('vec3 displayAdaptedFlash(', '\n}\n');
assert.match(flash,/adaptedUpstreamArtwork\(u, t, gradX, gradY\)/);
assert.match(flash,/positive \? 3600\.0 : 2400\.0/);
assert.match(flash,/cloudChannelStage/);
for (const [name,end] of [['vec3 displayExternalLightning(', '// Adapt the original bolt'], ['vec3 displayCloudToCloudLightning(', 'float saturate']]) {
 const body = section(name,end);
 assert.match(body,/adaptedUpstreamArtwork\(u, t, gradX, gradY\)/);
 assert.doesNotMatch(body,/ccEvalBranch\(|fractalLateralJag\(|lightningNetworkTex/);
}
assert.match(s,/float endY = rodTipY >= 0\.0 \? rodTipY : 0\.0/);
assert.match(s,/isPositiveIC\) \{\s*strikeChannel \+= displayPositiveFlash/);
assert.match(s,/isFlash \? displayFlash/);
console.log('Adapted upstream artwork is wired into both IC polarities, CC and external ground strikes');
