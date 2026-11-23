'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const app=fs.readFileSync('app.js','utf8');
const start=app.indexOf('function configureLightningAnisotropy(');
const source=app.slice(start,app.indexOf('\n}',start)+2);
const c={};vm.createContext(c);vm.runInContext(source,c);
function test(max,supported=true){let calls=[];const ext={MAX_TEXTURE_MAX_ANISOTROPY_EXT:8,TEXTURE_MAX_ANISOTROPY_EXT:9};const gl={TEXTURE_2D:4,getExtension:name=>{assert.equal(name,'EXT_texture_filter_anisotropic');return supported?ext:null},getParameter:name=>{assert.equal(name,8);return max},texParameterf:(...args)=>calls.push(args)};c.configureLightningAnisotropy(gl);return calls}
assert.deepStrictEqual(test(0,false),[]);assert.deepStrictEqual(test(1),[]);assert.deepStrictEqual(test(NaN),[]);assert.deepStrictEqual(test(2),[[4,9,2]]);assert.deepStrictEqual(test(16),[[4,9,4]]);
const upload=app.slice(app.indexOf('function generateLightningTexture('),app.indexOf('let lightningTexturesReady'));
assert.match(upload,/configureLightningAnisotropy\(gl\)/);
assert.match(upload,/gl\.RG8, artwork\.width, artwork\.height/);
assert.doesNotMatch(app,/lightningNetworkReady|lightningNetworkTexture/);
console.log('Bounded anisotropy, unsupported fallback and no network upload checks passed');
