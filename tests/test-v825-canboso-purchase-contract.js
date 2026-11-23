'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module'),original=Module._load;
Module._load=function(name,parent,main){if(name==='firebase-admin')return {apps:[]};return original.call(this,name,parent,main)};
const {callSupplier}=require('../lib/shop-common');
Module._load=original;
const oldFetch=global.fetch,oldKey=process.env.CANBOSO_API_KEY,oldScheme=process.env.CANBOSO_AUTH_SCHEME;
process.env.CANBOSO_API_KEY='tgb_UNIT_TEST_ONLY_SECRET';delete process.env.CANBOSO_AUTH_SCHEME;
const requests=[];
global.fetch=async(url,options)=>{
  requests.push({url,options});
  const isPurchase=url.endsWith('/purchase');
  const body=options.body?JSON.parse(options.body):null;
  if(isPurchase && body?.product_id==='bad_sku')return {ok:false,status:400,json:async()=>({code:'INVALID_PRODUCT_ID',message:'secret=DO_NOT_STORE'}),headers:{get:()=>null}};
  return {ok:true,status:200,json:async()=>({success:true,status:'completed',data:{delivery:{account:'test@example.invalid'}}}),headers:{get:()=>null}};
};
(async()=>{
 try {
  const intent='ord_abcdef01234567890123456789';
  await callSupplier('/api/v2/telegram-buyer/purchase',{method:'POST',idempotencyKey:intent,body:{product_id:'kling_demo',quantity:1}});
  const request=requests[0],body=JSON.parse(request.options.body);
  assert.equal(request.options.headers['Idempotency-Key'],intent);
  assert.equal(request.options.headers['X-API-Key'],'tgb_UNIT_TEST_ONLY_SECRET');
  assert.deepEqual(Object.keys(body).sort(),['key','product_id','quantity']);
  assert.equal(body.key,'tgb_UNIT_TEST_ONLY_SECRET');
  assert.equal(body.product_id,'kling_demo');assert.equal(body.quantity,1);
  // GET still uses the existing bearer/header auth, without purchase-only headers.
  await callSupplier('/api/v2/telegram-buyer/products');
  assert.equal(requests[1].options.headers['Idempotency-Key'],undefined);
  assert.equal(requests[1].options.body,undefined);
  await assert.rejects(callSupplier('/api/v2/telegram-buyer/purchase',{method:'POST',body:{product_id:'kling_demo',quantity:1}}),/idempotency/);
  assert.equal(requests.length,2,'missing idempotency must not contact supplier');
  await assert.rejects(callSupplier('/api/v2/telegram-buyer/purchase',{method:'POST',idempotencyKey:'ord_test_00000001',body:{product_id:'bad_sku',quantity:1}}),e=>e.status===400 && e.providerCode==='INVALID_PRODUCT_ID' && !JSON.stringify(e).includes('DO_NOT_STORE'));
  console.log('PASS V8.2.5: CanBoSo purchase body key, stable header, GET auth, reject invalid header, safe error code');
 }finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.CANBOSO_API_KEY;else process.env.CANBOSO_API_KEY=oldKey;if(oldScheme===undefined)delete process.env.CANBOSO_AUTH_SCHEME;else process.env.CANBOSO_AUTH_SCHEME=oldScheme;}
})().catch(e=>{console.error(e);process.exitCode=1});
