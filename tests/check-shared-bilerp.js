const fs=require('fs'),assert=require('assert');const common=fs.readFileSync('shaders/common.glsl','utf8'),display=fs.readFileSync('shaders/commonDisplay.glsl','utf8'),advection=fs.readFileSync('shaders/fragment/advectionShader.frag','utf8'),realistic=fs.readFileSync('shaders/fragment/realisticDisplayShader.frag','utf8');
for(const [s,name] of [[common,'bilerpWallPair'],[display,'bilerpWallVisPair']]){let a=s.indexOf('void '+name+'('),fn=s.slice(a,s.indexOf('\n}',a)+2);assert(a>=0);assert.equal((fn.match(/texture\(wallTex,/g)||[]).length,4);assert.equal((fn.match(/texture\(firstTex,/g)||[]).length,4);assert.equal((fn.match(/texture\(secondTex,/g)||[]).length,4)}
assert.match(advection,/bilerpWallPair\(baseTex, waterTex, wallTex, fragCoord - velAtP/);
assert.equal((realistic.match(/bilerpWallVisPair\(baseTex, waterTex, wallTex/g)||[]).length,2);
assert.match(advection,/bilerpWall\(waterTex, wallTex, fragCoord - velAtP \+ vec2\(0, 0\.05\)\)/);
console.log('Shared wall-mask sampling wired to advection and realistic display');
