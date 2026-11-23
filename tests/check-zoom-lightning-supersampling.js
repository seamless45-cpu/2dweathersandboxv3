'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const app=fs.readFileSync('app.js','utf8'),post=fs.readFileSync('shaders/fragment/postProcessingShader.frag','utf8');
const src=app.slice(app.indexOf('let zoomHdrFBO = null;'),app.indexOf('// Optional HDR attachment used only for lightning'));
let made=0,disposed=0,complete=true,max=4096;
class FakeFBO {constructor(w,h){made++;this.width=w;this.height=h;this.frameBuffer={};}dispose(){disposed++;}}
const gl={MAX_TEXTURE_SIZE:1,FRAMEBUFFER:2,FRAMEBUFFER_COMPLETE:3,RGBA16F:4,RGBA:5,HALF_FLOAT:6,LINEAR:7,getParameter:()=>max,bindFramebuffer:()=>{},checkFramebufferStatus:()=>complete?3:9};
const guiControls={hdrQuality:'100%',superSharpDetail:false},hdrFBO={width:400,height:300},canvas={width:400,height:300};
const c={FBO:FakeFBO,gl,canvas,guiControls,hdrFBO,hdrRenderScale:1,console:{warn:()=>{}}};vm.createContext(c);vm.runInContext(src,c);
assert.strictEqual(c.selectZoomHdrFBO(1,true),hdrFBO);
const high=c.selectZoomHdrFBO(.70,true);assert.notStrictEqual(high,hdrFBO);assert.equal(high.width,800);assert.equal(high.height,600);assert.equal(made,1);
assert.strictEqual(c.selectZoomHdrFBO(.8,true),high);assert.equal(made,1); // hysteresis
assert.strictEqual(c.selectZoomHdrFBO(.86,true),hdrFBO);assert.equal(disposed,1);
complete=false;assert.strictEqual(c.selectZoomHdrFBO(.6,true),hdrFBO);assert.equal(made,2);assert.strictEqual(c.selectZoomHdrFBO(.6,true),hdrFBO);assert.equal(made,2); // no repeated allocation
complete=true;canvas.width=500;assert.notStrictEqual(c.selectZoomHdrFBO(.6,true),hdrFBO);assert.equal(made,3);
assert.strictEqual(c.selectZoomHdrFBO(.6,false),hdrFBO);assert.equal(disposed,3);
max=100;assert.strictEqual(c.selectZoomHdrFBO(.6,true),hdrFBO);assert.equal(made,3);
max=10000;canvas.width=2000;canvas.height=2000;assert.strictEqual(c.selectZoomHdrFBO(.6,true),hdrFBO);assert.equal(made,3); // 128 MB exceeds cap
canvas.width=400;canvas.height=300;guiControls.superSharpDetail=true;assert.strictEqual(c.selectZoomHdrFBO(.6,true),hdrFBO);assert.equal(made,3);
guiControls.superSharpDetail=false;c.hdrRenderScale=2;assert.strictEqual(c.selectZoomHdrFBO(.6,true),hdrFBO);assert.equal(made,3);c.hdrRenderScale=1;
assert.equal(guiControls.hdrQuality,'100%');assert.equal(c.hdrRenderScale,1);
assert.match(app,/sceneHdrFBO = selectZoomHdrFBO\(cam\.curZoom/);
assert.match(app,/previousZoomSupersampleActive/);
assert.match(post,/if \(zoomSupersampleEnabled\)/);
assert.match(post,/outputCol = 0\.25 \* \(mappedColor/);
assert.match(post,/canvasTexelSize \* 0\.25/);
console.log('Zoom HDR lifecycle, fallback, hysteresis and saved-setting checks passed');
