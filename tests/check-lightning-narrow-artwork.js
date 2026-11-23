'use strict';
// Rasterize the real generator with identical seeds; only stroke width should
// change, not the random walk, fork choices, or upstream brightness function.
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const {installOffscreenCanvas}=require('./ic-canvas-stub');const restore=installOffscreenCanvas();
const source=fs.readFileSync('upstreamLightningGenerator.js','utf8');
function render(widthScale){let state=12345;const math=Object.create(Math);math.random=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296};const c={Math:math,OffscreenCanvas:global.OffscreenCanvas};vm.createContext(c);vm.runInContext(source,c);const img=c.generateUpstreamLightningBolt(250,500,1,widthScale);return {img,state}}
const old=render(1),narrow=render(.7);assert.equal(old.state,narrow.state,'width must not change random geometry');
let oldPixels=0,newPixels=0,rows=0,drift=0;
for(let y=0;y<500;y++){let oldCount=0,newCount=0,oldX=0,newX=0;for(let x=0;x<250;x++){let i=(y*250+x)*4;if(old.img.data[i]>242){oldPixels++;oldCount++;oldX+=x}if(narrow.img.data[i]>242){newPixels++;newCount++;newX+=x}}
 if(oldCount && newCount){drift+=Math.abs(oldX/oldCount-newX/newCount);rows++}}
assert(newPixels<oldPixels*.85 && newPixels>oldPixels*.45,`old ${oldPixels} new ${newPixels}`);
assert(rows>300 && drift/rows<1.5,`channel path shifted ${drift/rows}, rows ${rows}`);
assert.match(source,/Math\.pow\(lineWidth, 2\.0\)/);
assert.match(source,/ctx\.lineWidth = lineWidth \* channelWidthScale/);
assert.match(source,/ctx\.lineWidth = line_width \* channelWidthScale/);
const app=fs.readFileSync('app.js','utf8');
assert.match(app,/gl\.getParameter\(gl\.MAX_TEXTURE_SIZE\) >= 3200/);
assert.match(app,/width : 1600, height : 3200, logicalScale : 0\.64/);
assert.match(app,/width : 1250, height : 2500, logicalScale : 0\.5/);
restore();console.log('Narrower original bolt preserves the seeded path and brightness formula');
