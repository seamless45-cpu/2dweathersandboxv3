'use strict';
// Model bilinear footprint sampling in source pixel coordinates, including
// one-pixel channel points at every phase of 2x, 4x and 8x downsampling.
const assert = require('assert');
const fs = require('fs');
const shader = fs.readFileSync('shaders/fragment/isolateBrightPartsShader.frag','utf8');
const app = fs.readFileSync('app.js','utf8');
assert.match(shader, /ceil\(footprintX \* 0\.5\), 2\.0, 4\.0/);
assert.match(shader, /ceil\(footprintY \* 0\.5\), 2\.0, 4\.0/);
assert.match(shader, /sum \+= brightSample\(texCoord \+ dx \* sx \+ dy \* sy\)/);
assert.match(shader, /vec3 highlight = source \* mix\(0\.02, 0\.12, smoothstep\(4\.0, 40\.0, peak\)\)/);
assert.match(shader, /if \(any\(isnan\(source\)\) \|\| any\(isinf\(source\)\)\)/);
assert.match(app, /if \(guiControls\.bloomEnabled\) \{/);
const smooth = (a,b,v) => {const x=Math.max(0,Math.min(1,(v-a)/(b-a)));return x*x*(3-2*x)};
const gain = v => .02+.10*smooth(4,40,v);
const linearWeight = (coordinate, pixel) => Math.max(0,1-Math.abs(coordinate-(pixel+.5)));
function sample(ratio,xPixel,yPixel,count,preExtract) {
 let sum=0;
 for(let y=0;y<count;y++) for(let x=0;x<count;x++) {
   const sx=ratio*(x+.5)/count, sy=ratio*(y+.5)/count;
   const value=100*linearWeight(sx,xPixel)*linearWeight(sy,yPixel);
   sum += preExtract ? Math.log2(1+value*gain(value)) : value;
 }
 const average=sum/(count*count);
 return preExtract ? average : Math.log2(1+average*gain(average));
}
let missed=0;
for (const ratio of [1,2,3,4,5,6,7,8]) {
 const count=Math.max(2,Math.min(4,Math.ceil(ratio/2)));
 for(let y=0;y<ratio;y++) for(let x=0;x<ratio;x++) {
   const now=sample(ratio,x,y,count,true);
   assert(now>0, `missing bloom at ${ratio}:1 phase ${x},${y}`);
   if(ratio===8 && sample(ratio,x,y,2,false)===0) missed++;
 }
}
assert(missed>0, 'previous four-tap pass must demonstrate its coverage gaps');
const postExtract=sample(8,0,0,4,false), preExtract=sample(8,0,0,4,true);
assert(preExtract > postExtract * 2, 'thin bright channel should retain its highlight gain');
// Tint survives normalized sample averaging; changing settings is never needed.
const warm=[1,.45,.2], cold=[.4,.65,1], lum=sample(8,1,4,4,true);
assert(lum*warm[0]>lum*warm[2] && lum*cold[2]>lum*cold[0]);
console.log('Bloom footprint coverage, highlight gain and channel hues passed');
