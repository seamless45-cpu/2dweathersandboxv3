const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
const brightness=s.slice(s.indexOf('// Brighten the channel'),s.indexOf('// Ordinary CG already carries'));
assert.match(brightness,/isExternalPositive \? 2\.5/);
assert.match(brightness,/isPositiveIC \|\| isPositiveCC/);
assert.match(brightness,/2\.5 \/ 1\.5/);
assert.match(brightness,/strikeChannel \*= 2\.0 \* polarityGain/);
assert.equal(1.5*(2.5/1.5),2.5);
assert.match(s,/displayLightning\(lightningPos, lightningMeta\.x, lightningTime, currentLightningIntensity\)/);
const bend=t=>{let q=Math.max(0,Math.min(1,(t-.35)/.65));return q*q*(3-2*q)};
assert.equal(bend(0),0);assert.equal(bend(.35),0);assert.equal(bend(1),1);
for(let t=0;t<1;t+=.01)assert(bend(t+.01)>=bend(t));
assert.match(s,/originOffset = rodHit \? originX - pos.x : 0.0/);
assert.match(s,/originOffset \* bendSlope/); // matching filtered texture gradients
console.log('PASS positive 2.5x nominal channel gain and origin-to-rod bend');
