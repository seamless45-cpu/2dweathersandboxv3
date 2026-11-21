'use strict';
const assert = require('assert');
const fs = require('fs');
const shader = fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
assert.match(shader, /float coverage = peak \/ max\(coreReference, 1e-6\)/);
assert.match(shader, /float whiteCore = 0\.86 \* smoothstep\(0\.08, 0\.55, coverage\)/);
assert.match(shader, /return mix\(colored, vec3\(peak\), whiteCore\)/);
for (const expected of [/3000\.0 \* extCurve \* \(isSuperbolt \? strokeBrightnessMult : 1\.0\)/, /900\.0 \* currentLightningIntensity \* ccIntensityGain \* ccTailFade/, /\(isPositiveIC \? 3600\.0 : 2400\.0\) \* currentLightningIntensity/, /1500\.0 \* currentLightningIntensity/]) assert.match(shader,expected);
const smooth = x => {const t=Math.max(0,Math.min(1,(x-.08)/(.55-.08)));return t*t*(3-2*t);};
const render = (tint, coverage) => {
 const tintPeak = Math.max(...tint);
 const colored = tint.map(x => (x/tintPeak)**1.65 * tintPeak);
 const white = .86*smooth(coverage);
 return colored.map(v => (v*(1-white)+white)**(1/2.2));
};
for (const tint of [[1,.76,.54],[.65,.82,1],[1,.67,.78],[.7,.62,1],[1,.64,.46],[1,.84,.45],[.97,.98,1],[.57,1,.86]]) {
 const edge=render(tint,.05), core=render(tint,.8);
 assert(Math.min(...core)>.93,'core must be near white on display');
 assert(Math.min(...core)>=Math.min(...edge),'core must be whiter than its edge');
 assert.equal(core.indexOf(Math.max(...core)),edge.indexOf(Math.max(...edge)),'hue family must remain');
}
const edges = [render([1,.64,.46],.05),render([.7,.62,1],.05)];
assert(edges[0][0] > edges[0][2] && edges[1][2] > edges[1][0], 'edge hues remain distinct');
console.log('White-hot lightning cores retain variant-coloured edges');
