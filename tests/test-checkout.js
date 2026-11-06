'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const commonPath=require.resolve('../lib/shop-common');
let records={},supplierCalls=0,purchaseResult={success:true,data:{delivery:{email:'demo@example.test',password:'only-for-test'}}},purchaseError=null,catalog=[{id:'product-1',name:'Spotify Premium',category:'account',price:30400,available:true}];
function clone(v){return v===undefined?undefined:structuredClone(v)}
const snap=v=>({val:()=>clone(v),exists:()=>v!==undefined&&v!==null});
const db={ref:(key)=>({
  once:async()=>snap(records[key]),
  transaction:async(fn)=>{const old=records[key]===undefined?null:clone(records[key]);const newValue=fn(old);if(newValue===undefined)return {committed:false,snapshot:snap(old)};records[key]=clone(newValue);return {committed:true,snapshot:snap(newValue)};},
  update:async(v)=>{records[key]={...(records[key]||{}),...clone(v)}},
  set:async(v)=>{records[key]=clone(v)},remove:async()=>{delete records[key]},limitToLast:()=>({once:async()=>snap(records[key])})
})};
const common={
 firebase:()=>({database:()=>db}),products:async()=>catalog,
 callSupplier:async()=>{supplierCalls++;if(purchaseError)throw purchaseError;return clone(purchaseResult)},
 usernameFromRequest:async()=> 'demo',checkOrigin:()=>{},digest:(v)=>require('node:crypto').createHash('sha256').update(v).digest('hex'),
 error:(m,status=500)=>Object.assign(new Error(m),{status}),safeText:String,
 jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message})
};
require.cache[commonPath]={id:commonPath,filename:commonPath,loaded:true,exports:common};
const handler=require('../api/shop-checkout');
const requestId=n=>'req_example_test_'+n+'_12345';
const req=(id,email='')=>({method:'POST',headers:{authorization:'Bearer mock-only'},body:{requestId:id,productId:'product-1',recipientEmail:email}});
async function run(input){let status=200,json=null;const res={setHeader:()=>{},status(n){status=n;return this},json(data){json=data;return {status,data}}};await handler(input,res);return {status,data:json}}
function reset(){records={'users/demo':{balance:100000,name:'Demo'}},supplierCalls=0,purchaseError=null,purchaseResult={success:true,data:{delivery:{email:'demo@example.test',password:'only-for-test'}}};catalog=[{id:'product-1',name:'Spotify Premium',category:'account',price:30400,available:true}];}
(async()=>{
 process.env.SHOP_PURCHASES_ENABLED='true';process.env.SHOP_WALLET_RULES_SECURED='true';process.env.SHOP_SUPPLIER_PURCHASE_CONFIRMED='true';
 reset();
 const first=await run(req(requestId('1')));
 assert.equal(first.status,200);assert.equal(first.data.status,'delivered');
 assert.equal(records['users/demo'].balance,69600);
 assert.equal(records['shop_orders/demo/'+requestId('1')].status,'delivered');
 assert.match(records['shop_deliveries/demo/'+requestId('1')].text,/only-for-test/);
 const duplicate=await run(req(requestId('1')));
 assert.equal(duplicate.data.duplicate,true);assert.equal(supplierCalls,1);assert.equal(records['users/demo'].balance,69600);
 reset();purchaseResult={success:true,status:'processing',data:{order_id:'t100'}};
 const pending=await run(req(requestId('2')));assert.equal(pending.status,202);assert.equal(pending.data.status,'awaiting_delivery');assert.equal(records['users/demo'].balance,69600);assert.equal(records['shop_deliveries/demo/'+requestId('2')],undefined);
 reset();purchaseError=Object.assign(new Error('Insufficient supplier stock'),{status:409});
 const rejected=await run(req(requestId('3')));assert.equal(rejected.data.status,'refunded');assert.equal(records['users/demo'].balance,100000);assert.equal(records['users/demo'].shopDebits[requestId('3')].status,'refunded');
 reset();purchaseError=Object.assign(new Error('Supplier timeout'),{status:504});
 const uncertain=await run(req(requestId('4')));assert.equal(uncertain.status,504);assert.equal(records['users/demo'].balance,69600);assert.equal(records['shop_orders/demo/'+requestId('4')].status,'needs_review');
 reset();records['users/demo'].balance=1000;
 const insufficient=await run(req(requestId('5')));assert.equal(insufficient.status,402);assert.equal(supplierCalls,0);assert.equal(records['users/demo'].balance,1000);
 reset();catalog=[{id:'product-1',name:'Slot Canva Pro',category:'slot',price:30400,available:true}];
 const withoutEmail=await run(req(requestId('6')));assert.equal(withoutEmail.status,400);assert.equal(supplierCalls,0);
 reset();process.env.SHOP_PURCHASES_ENABLED='false';
 const disabled=await run(req(requestId('7')));assert.equal(disabled.status,503);assert.equal(supplierCalls,0);
 console.log('PASS checkout: delivered, idempotent, pending, refund, ambiguous, insufficient, slot email, disabled');
})().catch(e=>{console.error(e);process.exit(1)});
