'use strict';
/** Prevent Vercel Hobby function-limit regression and preserve legacy session cleanup. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const api = path.join(root,'api');
const apiEntries = fs.readdirSync(api,{withFileTypes:true});
const deployed = apiEntries.filter(e=>e.isFile()&&e.name.endsWith('.js')).map(e=>e.name).sort();
assert.equal(deployed.length,12,`Expected exactly 12 Vercel Functions; got ${deployed.length}: ${deployed.join(', ')}`);
assert(!deployed.includes('shop-session.js'));
assert(deployed.includes('shop-orders.js'));
const ignoreLines=fs.readFileSync(path.join(root,'.vercelignore'),'utf8').split(/\r?\n/).map(x=>x.trim());
assert(ignoreLines.includes('api/*'),'Old routes must be ignored in web UI upload workflows');
for(const entry of deployed)assert(ignoreLines.includes('!api/'+entry),'Missing required API route from deployment allowlist: '+entry);
assert(!ignoreLines.includes('!api/shop-session.js'),'Retired legacy route must not be deployed');
for(const crucial of ['shop-checkout.js','wallet.js','sepay-live-webhook.js','sepay-webhook.js','shop-settings.js']){
  assert(deployed.includes(crucial),`${crucial} must remain deployed`);
}
const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
assert(config.rewrites.some(r=>r.source==='/api/shop-session' && r.destination==='/api/shop-orders?__legacySession=1'),
  'Vercel rewrite must maintain old /api/shop-session URL');
const Module=require('node:module'),oldLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='firebase-admin')return {apps:[]};
  return oldLoad.call(this,request,parent,isMain);
};
const orders=require('../api/shop-orders');
Module._load=oldLoad;
function reply(){return {
  headers:{},statusCode:200,body:null,
  setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(o){this.body=o;return this}
};}
async function run(){
  const r1=reply();
  await orders({method:'DELETE',query:{__legacySession:'1'},headers:{}},r1);
  assert.equal(r1.statusCode,200);
  assert.deepEqual(r1.body,{ok:true});
  assert.match(r1.headers['Set-Cookie'],/^kp_shop_session=; Path=\/api; HttpOnly; SameSite=Strict; Secure; Max-Age=0$/);
  const r2=reply();
  await orders({method:'GET',query:{__legacySession:'1'},headers:{}},r2);
  assert.equal(r2.statusCode,410);
  const r3=reply();
  await orders({method:'POST',query:{},headers:{}},r3);
  assert.equal(r3.statusCode,405,'Non-legacy shop orders does not gain login/logout privilege');
  console.log('PASS Vercel Hobby <=12 functions, legacy session rewrite, cookie cleanup, retired auth route');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
