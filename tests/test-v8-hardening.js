'use strict';
// Self-contained regression coverage. No Firebase credentials, provider traffic or money writes.
const assert=require('node:assert/strict');
const Module=require('node:module');
const oldLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='firebase-admin')return {apps:[]};
  return oldLoad.call(this,request,parent,isMain);
};
const secure=require('../lib/secure-accounts');
const common=require('../lib/shop-common');
Module._load=oldLoad;
const snap=value=>({val:()=>value,exists:()=>value!==undefined&&value!==null});
function reply(){return {headers:{},statusCode:200,body:null,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}}}
const uid='firebaseUid_test_123456', username='sampleuser';
const fakeCtx=db=>({db,uid,username,isAdmin:false,profile:{username,balance:80000000,totalDeposited:60000000}});
async function dashboard(){
  function dbWith(account){
    return {ref(path){return {limitToLast(){return this},orderByChild(){return this},equalTo(){return this},async once(){
      if(path==='live_deposits_v1/accounts/'+uid)return snap(account);
      return snap(null);
    }}}};
  }
  // Legacy balances never appear as spendable, EVEN when the deposit toggle is off.
  const previous=process.env.LIVE_DEPOSITS_ENABLED;
  try{
    process.env.LIVE_DEPOSITS_ENABLED='false';
    const empty=await secure.dashboardData(fakeCtx(dbWith(null)));
    assert.equal(empty.profile.balance,0);
    assert.equal(empty.profile.totalDeposited,0);
    assert.equal(empty.profile.walletBalanceSource,'live_deposits_v1');
    assert.equal(empty.profile.legacyBalanceSpendable,false);
    const real=await secure.dashboardData(fakeCtx(dbWith({uid,username,availableVnd:27000,heldVnd:6000,totalDepositedVnd:50000})));
    assert.equal(real.profile.balance,27000);
    assert.equal(real.profile.totalDeposited,50000);
    await assert.rejects(()=>secure.dashboardData(fakeCtx(dbWith({uid:'foreign_uid',username,availableVnd:900,heldVnd:0,totalDepositedVnd:50000}))),/không khớp/);
  }finally{if(previous===undefined)delete process.env.LIVE_DEPOSITS_ENABLED;else process.env.LIVE_DEPOSITS_ENABLED=previous;}
}
function mockDb(table,filters={}){
  return {ref(path){
    const ref={_path:path,_eq:null,orderByChild(k){this._column=k;return this},equalTo(v){this._eq=v;return this},limitToLast(){return this},limitToFirst(){return this},async once(){
      if(this._column==='status')return snap(filters[this._eq]||{});
      return snap(table[this._path]??null);
    }};return ref;
  }};
}
async function orders(){
  const original=secure.identity;
  // The API captures the identity function when loaded, so provide the verified mock first.
  secure.identity=async req=>({uid,username,db:req._testDb});
  const handler=require('../api/shop-orders');
  const olderId='ord_0123456789abcdef0123456789abcdef0123';
  const otherId='ord_ffffffffffffffffffffffffffffffffffff';
  const legacyId='legacy_older_order_123';
  const table={
    'live_deposits_v1/orders':{},
    ['live_deposits_v1/orders/'+olderId]:{id:olderId,uid,status:'delivered',delivery:'demo buyer credentials'},
    ['live_deposits_v1/orders/'+otherId]:{id:otherId,uid:'someoneElse',status:'delivered',delivery:'MUST_NOT_LEAK'},
    ['shop_orders/'+username]:{},
    ['shop_orders/'+username+'/'+legacyId]:{id:legacyId,status:'completed'},
    ['shop_deliveries/'+username+'/'+legacyId]:'legacy account demo'
  };
  for(const [orderId,expectedStatus,expectedDelivery] of [
    [olderId,200,'demo buyer credentials'],[otherId,404,undefined],[legacyId,200,'legacy account demo']
  ]){
    const req={method:'GET',query:{orderId},_testDb:mockDb(table)},res=reply();
    await handler(req,res);
    assert.equal(res.statusCode,expectedStatus,orderId);
    if(expectedDelivery)assert.equal(res.body.delivery,expectedDelivery);
    else assert(!JSON.stringify(res.body).includes('MUST_NOT_LEAK'));
  }
  secure.identity=original;
}
async function adminQueue(){
  const original=secure.identity;
  const now=Date.now();
  const old={id:'ord_old',username,price:20000,status:'needs_review',name:'Pending old purchase',updatedAt:now-86400000};
  const oldClaim={id:'ord_reserved',username,price:30000,status:'reserved',name:'Crash before dispatch',updatedAt:now-86400000};
  const newClaim={id:'ord_new',username,price:20000,status:'reserved',name:'New request',updatedAt:now};
  const filters={needs_review:{a:old},awaiting_delivery:{},reserved:{b:oldClaim,c:newClaim},requesting_supplier:{}};
  secure.identity=async req=>({uid,username,db:req._testDb,isAdmin:true});
  const handler=require('../api/shop-admin-review');
  const res=reply();await handler({method:'GET',query:{},_testDb:mockDb({},filters)},res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.orders.length,2);
  assert(res.body.orders.some(o=>o.id==='ord_old'));
  assert(res.body.orders.some(o=>o.id==='ord_reserved'));
  assert(!res.body.orders.some(o=>o.id==='ord_new'));
  assert.equal(res.body.possiblyTruncated,false);
  secure.identity=original;
}
async function run(){
  await dashboard();await orders();await adminQueue();
  const {classifyResponse}=require('../lib/shop-fulfillment');
  assert.equal(classifyResponse({error:'timeout after provider accepted order'}).kind,'review');
  assert.equal(classifyResponse({success:false,error:'request timeout after dispatch'}).kind,'review');
  assert.equal(classifyResponse({success:false,status:'failed'}).kind,'rejected');
  console.log('PASS V8 hardening: canonical balance, old order lookup + ownership, unresolved admin queue, ambiguous supplier error');
}
run().catch(e=>{console.error(e);process.exitCode=1});
