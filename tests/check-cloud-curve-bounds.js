// Conservative early culling must include all rotated, bent artwork, including
// endpoint shear. Exhaust representative angles, arches, skews and UV edges.
const assert=require('assert'),fs=require('fs');
const s=fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
const body=s.slice(s.indexOf('bool cloudCurveProjection('),s.indexOf('\n}',s.indexOf('bool cloudCurveProjection(')));
assert(!/for\s*\(/.test(body));
assert.match(s,/vec2 pad = vec2\(span \* 1\.1\)/);
assert.match(s,/lengthWorld \* 1\.7/);
let count=0;
for(let angle=-Math.PI;angle<=Math.PI;angle+=.1) for(const bow of [-1.05,-.65,.65,1.05]) for(const skew of [-.65,.65]) for(let t=.01;t<1;t+=.04) for(const u of [-.49,.5,1.49]) {
 let a=[Math.cos(angle),Math.sin(angle)],n=[-a[1],a[0]],offset=bow*t*(1-t)*(1+skew*(2*t-1))+(u-.5)*.5;
 let p=[t*a[0]+offset*n[0],t*a[1]+offset*n[1]];
 for(let i=0;i<2;i++) assert(p[i]>=Math.min(0,a[i])-1.1 && p[i]<=Math.max(0,a[i])+1.1);
 assert(Math.max(Math.abs(p[0]-.5*a[0]),Math.abs(p[1]-.5*a[1]))<1.7);
 count++;
}
console.log('PASS conservative cloud curve bounds:',count,'artwork-edge samples');
