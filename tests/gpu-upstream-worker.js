// Optional browser integration test. Install playwright-core and @sparticuz/chromium.
// Run: node tests/gpu-upstream-worker.js
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const {chromium} = require('playwright-core');
const app=fs.readFileSync('app.js','utf8');
const astart=app.indexOf('function configureLightningAnisotropy(');
const anisotropy=app.slice(astart,app.indexOf('\n}',astart)+2);
(async () => {
  const files = new Set(['/lightningGenerator.js','/upstreamLightningGenerator.js']);
  const server = http.createServer((req,res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') {res.writeHead(200, {'Content-Type':'text/html'}); return res.end('<!doctype html>');}
    if (!files.has(path)) {res.writeHead(404); return res.end();}
    res.writeHead(200, {'Content-Type':'text/javascript'}); res.end(fs.readFileSync('.'+path));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const bin = (await import(require.resolve('@sparticuz/chromium'))).default;
    browser = await chromium.launch({executablePath:await bin.executablePath(),args:[...bin.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result=await page.evaluate(async(source)=>{
      const configure=new Function('return ('+source+')')();
      function run(payload){return new Promise((ok,fail)=>{const w=new Worker('/lightningGenerator.js');w.onerror=e=>{w.terminate();fail(Error(e.message));};w.onmessage=e=>{w.terminate();ok(e.data);};w.postMessage(payload);});}
      let bolts=[];
      for(const logicalScale of [1,.64,.5]) {
        const a=await run({width:200,height:400,logicalScale});
        const lit=[0,0]; for(let i=0;i<a.data.length;i++) if(a.data[i]>0) lit[i%2]++;
        const gl=document.createElement('canvas').getContext('webgl2');
        const texture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RG8,a.width,a.height,0,gl.RG,gl.UNSIGNED_BYTE,a.data);
        gl.generateMipmap(gl.TEXTURE_2D);
        configure(gl);
        const ext=gl.getExtension('EXT_texture_filter_anisotropic');
        const level=ext ? gl.getTexParameter(gl.TEXTURE_2D,ext.TEXTURE_MAX_ANISOTROPY_EXT) : null;
        bolts.push({length:a.data.length,lit,level,error:gl.getError()});
      }
      const network=await run({kind:'network',width:100,height:100});
      return {bolts,network:network.data.length};
    },anisotropy);
    for(const b of result.bolts){assert.equal(b.length,200*400*2);assert(b.lit.every(n=>n>0));assert.equal(b.error,0);if(b.level!==null)assert(b.level>=1&&b.level<=4);}
    assert.equal(result.network,100*100*2);
    console.log('Browser worker import, RG8 upload and bounded anisotropy passed', result.bolts.map(b=>b.level));
  } finally {if(browser) await browser.close(); await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exit(1)});
