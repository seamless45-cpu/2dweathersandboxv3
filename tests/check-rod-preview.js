'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const app=fs.readFileSync('app.js','utf8');
const start=app.indexOf('function lightningRodPreviewRadius('),end=app.indexOf('\n}',start)+2;
const ctx={Math,cellHeight:40,sim_res_x:1200,sim_res_y:300,sim_height:12000,SUPER_LIGHTNING_ROD_REACH_MULT:2.5,clamp:(v,a,b)=>Math.min(b,Math.max(a,v))};vm.createContext(ctx);vm.runInContext(app.slice(start,end),ctx);
function reference(superRod){let d=500+180*2.8, h=Math.min(720*(superRod?1.8:1),d);return Math.min(.5,Math.sqrt(2*d*h-h*h)*(superRod?2.5:1)/48000)}
assert(Math.abs(ctx.lightningRodPreviewRadius(false)-reference(false))<1e-12);assert(Math.abs(ctx.lightningRodPreviewRadius(true)-reference(true))<1e-12);
const first=ctx.lightningRodPreviewRadius(false);ctx.sim_res_x=2400;assert(Math.abs(ctx.lightningRodPreviewRadius(false)-first/2)<1e-12);
ctx.sim_res_y=600;ctx.cellHeight=20;assert(Math.abs(ctx.lightningRodPreviewRadius(false)-first)<1e-12);
console.log('Rod preview follows the simulated physical reach and grid/world dimensions');
