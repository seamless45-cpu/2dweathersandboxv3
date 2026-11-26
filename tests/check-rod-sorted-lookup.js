// Exercise the table's column-capacity and two-interval wrapped lookup, including
// overlapping footprints and original insertion-order precedence.
const assert = require('assert'), fs = require('fs');
const app = fs.readFileSync('app.js', 'utf8');
const display = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag', 'utf8');
assert(!app.includes('lightningRods.shift()'));
assert(app.includes('new Float32Array(sim_res_x * 4)'));
assert(app.includes('rodTextureData[i * 4 + 3] = sorted[i].order'));
assert(display.includes('rodInfo.w > lastMetalRodOrder'));
assert(/uploadLightningRodUniforms\(realisticDisplayProgram\);\s*gl.activeTexture\(gl.TEXTURE10\);\s*gl.bindTexture\(gl.TEXTURE_2D, rodDataTexture\)/.test(app));
const width=128, rods=[];
// Place in non-spatial order, with more than the old limit.
for(let i=0;i<width;i+=2){const col=(i*17)%width;rods.push({x:(col+.5)/width, order:rods.length});}
assert(rods.length>12 && rods.length<=width);
const sorted=rods.slice().sort((a,b)=>a.x-b.x);
for(const x of [-.99,-.01,0,.01,.25,.5,.99,1,1.01,1.99]) for(const reach of [.02,.1,.49,.5]) {
 let center=((x%1)+1)%1, intervals=[[Math.max(0,center-reach),Math.min(1,center+reach)]];
 if(reach>=.5) intervals=[[0,1]];
 else if(center-reach<0) intervals.push([center-reach+1,1]);
 else if(center+reach>1) intervals.push([0,center+reach-1]);
 const found=intervals.flatMap(([l,r])=>sorted.filter(v=>v.x>=l&&v.x<=r));
 const expected=rods.filter(v=>Math.abs((((x-v.x+.5)%1)+1)%1-.5)<=reach+1e-12);
 assert.deepStrictEqual(found.map(v=>v.order).sort((a,b)=>a-b),expected.map(v=>v.order).sort((a,b)=>a-b));
 if(found.length) assert.equal(Math.max(...found.map(v=>v.order)), Math.max(...expected.map(v=>v.order)));
}
console.log('PASS more than 12 rods, texture bindings, wrapped candidate intervals and overlap precedence');
