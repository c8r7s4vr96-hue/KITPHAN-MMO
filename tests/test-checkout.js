'use strict';
/** Current V5.2.x policy test: all legacy checkout requests are blocked.
 * Old checkout tests that expected real debits are intentionally obsolete.
 */
const assert=require('node:assert/strict');
const checkout=require('../api/shop-checkout');
async function call(method){let status=200,body;const res={setHeader(){},status(v){status=v;return this},json(v){body=v;return this}};await checkout({method,headers:{},body:{requestId:'any',productId:'any'}},res);return{status,body}}
(async()=>{
 process.env.SHOP_PURCHASES_ENABLED='true'; // still fails closed even if someone misconfigures env
 process.env.SHOP_WALLET_RULES_SECURED='true';
 const r=await call('POST');
 assert.equal(r.status,423);assert.equal(r.body.checkoutEnabled,false);assert.equal(r.body.reason,'LEGACY_WALLET_BLOCKED');
 const invalid=await call('GET');assert.equal(invalid.status,405);
 console.log('PASS legacy checkout permanently locked: even with unsafe env values');
})().catch(e=>{console.error(e);process.exitCode=1});
