'use strict';
// Former 12,000–16,000 K helper always had a unit blue maximum. Both
// historical super/hyper tints also had unit blue; colorization used only
// that maximum before restoring upstream RGB.
const assert=require('assert'),fs=require('fs');const shader=fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
for(let kelvin=12000;kelvin<=16000;kelvin+=10){const t=kelvin/100;const rgb=[329.698727446*Math.pow(t-60,-.1332047592),288.1221695283*Math.pow(t-60,-.0755148492),255].map(x=>Math.pow(Math.min(255,Math.max(0,x))/255,2.2));assert.equal(Math.max(...rgb),1);}
for(const c of [[.332,.469,1],[.25,.38,1],[.70,.57,1]])assert.equal(Math.max(...c),1);
assert.doesNotMatch(shader,/planckBlackbody\(/);assert.match(shader,/displayExternalLightning\(lightningPos, lightningMeta\.x, effectiveLightningTime, extCurve,\s*upstreamLightningColor,/);assert.match(shader,/upstreamColorize\(strikeChannel\)/);
console.log('All former external colors have unit peak, preserving upstream channel and bloom gain');
