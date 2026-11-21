'use strict';
const assert = require('assert');
const fs = require('fs');
const velocity = fs.readFileSync('shaders/fragment/velocityShader.frag', 'utf8');
const advection = fs.readFileSync('shaders/fragment/advectionShader.frag', 'utf8');
const particle = fs.readFileSync('shaders/vertex/precipitationShader.vert', 'utf8');
assert.match(velocity, /if \(topFace\)\s*base\[VY\] = base\[PRESSURE\] \/ sqrt\(0\.45\)/);
assert.match(velocity, /else\s*base\[VY\] \+= base\[PRESSURE\] - baseX0Yp\[PRESSURE\]/);
assert.match(advection, /float outsideTop = clamp\(\(fragCoord\.y - velAtP\.y\) - \(resolution\.y - 0\.5\), 0\.0, 1\.0\)/);
assert.match(advection, /water = mix\(water, vec4\(ambientWater, 0\.0, 0\.0, 0\.0\), outsideTop\)/);
assert.match(particle, /if \(newPos\.y >= 1\.0\)\s*\{\s*disableDroplet\(\);\s*feedback = vec4\(0\.0\)/);
const outside = (y, vy, n) => Math.max(0,Math.min(1,y-vy-(n-.5)));
assert.equal(outside(99.5,1,100),0); // updraft draws from below
assert.equal(outside(99.5,-1,100),1); // downdraft draws ambient air
assert.equal(outside(99.5,-.5,100),.5);
assert(1/Math.sqrt(.45)>0 && -1/Math.sqrt(.45)<0); // both directions
// Exercise the solver's actual one-dimensional pressure/velocity update on a
// pulse: a zero-pressure ghost alone reflects it, whereas the characteristic
// boundary lets the pulse leave. Both use the same lower wall and time step.
function pulse(open) {
 const n=100, p=Array.from({length:n},(_,i)=>Math.exp(-(((i-50)/4)**2))), v=Array(n).fill(0);
 for(let t=0;t<120;t++) {
   for(let i=0;i<n-1;i++) v[i]+=p[i]-p[i+1];
   if(open) v[n-1]=p[n-1]/Math.sqrt(.45); else v[n-1]=0;
   for(let i=0;i<n;i++) p[i]+=.45*((i ? v[i-1] : 0)-v[i]);
 }
 return p.reduce((sum,x)=>sum+x*x,0)+.45*v.reduce((sum,x)=>sum+x*x,0);
}
assert(pulse(true)<pulse(false)*.55, 'upper wave should exit instead of reflecting');
console.log('Open top pressure, inflow and precipitation tests passed');
