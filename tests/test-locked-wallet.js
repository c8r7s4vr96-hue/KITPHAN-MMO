'use strict';
// Unit tests (offline mocks only): no network, no bank transfers, no Firebase.
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
const store={
 users:{adminkit:{balance:97300000, totalDeposited:100050000}},
 wallet_test:{adminkit:{classification:'simulation_only',legacyBalanceVnd:97300000,spendableInLive:false}},
 wallet_accounts:{},wallet_ledger:{},wallet_reconciliation:{}
};
const writes=[];
const copy=x=>JSON.parse(JSON.stringify(x));
const get=k=>k.split('/').reduce((v,p)=>v?.[p],store);
function set(k,v){writes.push(k); const parts=k.split('/');let obj=store;for(const p of parts.slice(0,-1)){obj[p]??={};obj=obj[p]};obj[parts.at(-1)]=v;}
function ref(k){return {
  async once(){const v=get(k);return{val:()=>v??null,exists:()=>v!==undefined&&v!==null}},
  async transaction(fn){let previous=get(k)??null;let result=fn(previous);if(result===undefined)return{committed:false,snapshot:{val:()=>previous}};set(k,result);return{committed:true,snapshot:{val:()=>result}}},
  limitToLast(){return ref(k)}
}}
let actor='admin';
const uid='uidAdminkitFake123';
function fakeIdentity(req,options={}){
 if(actor==='unauth')throw Object.assign(new Error('Unauthorized'),{status:401});
 if(options.adminOnly&&actor!=='admin')throw Object.assign(new Error('Forbidden'),{status:403});
 return {username:actor==='admin'?'adminkit':'tester',uid:actor==='admin'?uid:'fakeUser123',isAdmin:actor==='admin',db:{ref},profile:{balance:actor==='admin'?store.users.adminkit.balance:0}};
}
const realLoad=Module._load;
Module._load=function(req,parent,isMain){
 if(req==='../lib/secure-accounts'&&parent?.filename?.endsWith('/api/wallet.js'))
  return {identity:fakeIdentity,checkOrigin:()=>{},configuredAdminUsername:()=>'adminkit'};
 if(req==='../lib/shop-common'&&parent?.filename?.endsWith('/api/wallet.js'))
  return {jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message}),error:(msg,status)=>Object.assign(new Error(msg),{status})};
 if(req==='../lib/wallet-audit'&&parent?.filename?.endsWith('/api/wallet.js'))
  return {USERNAME:/^[a-z0-9_-]{3,60}$/,goodAmount:v=>Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null,str:(x,n)=>String(x||'').slice(0,n),summarize:()=>({})};
 return realLoad.apply(this,arguments);
};
const handler=require('../api/wallet');Module._load=realLoad;
const call=async(action,{method='POST',body={},who='admin'}={})=>{
 actor=who;let status=200,json;
 const res={setHeader(){},status(x){status=x;return this},json(x){json=x;return this}};
 await handler({method,headers:{},query:{action},body},res);return {status,data:json};
};
(async()=>{
 const body={confirmZeroVnd:true,confirmNoLegacyTransfer:true,observedLegacyBalanceVnd:97300000};
 let r=await call('init_locked',{method:'GET',body});assert.equal(r.status,405);
 r=await call('init_locked',{body,who:'unauth'});assert.equal(r.status,401);
 r=await call('init_locked',{body,who:'client'});assert.equal(r.status,403);
 r=await call('init_locked',{body:{...body,confirmZeroVnd:false}});assert.equal(r.status,422);
 r=await call('init_locked',{body:{...body,observedLegacyBalanceVnd:97300001}});assert.equal(r.status,409);
 assert.equal(Object.keys(store.wallet_accounts).length,0);
 r=await call('init_locked',{body});assert.equal(r.status,201);assert.equal(r.data.created,true);
 const a=copy(get('wallet_accounts/'+uid)),l=copy(get('wallet_ledger/'+uid+'/genesis_locked_v1'));
 assert.equal(a.availableVnd,0);assert.equal(a.heldVnd,0);assert.equal(a.status,'locked');assert.equal(a.paymentEnabled,false);
 assert.equal(a.legacyFundsImported,false);assert.equal(l.deltaVnd,0);assert.equal(l.status,'non_financial');
 r=await call('init_locked',{body});assert.equal(r.status,200);assert.equal(r.data.duplicate,true);
 assert.deepEqual(a,get('wallet_accounts/'+uid));assert.deepEqual(l,get('wallet_ledger/'+uid+'/genesis_locked_v1'));
 assert.equal(store.users.adminkit.balance,97300000);
 assert.equal(store.wallet_test.adminkit.legacyBalanceVnd,97300000);
 assert.equal(writes.filter(x=>x.startsWith('wallet_accounts/')).length,1);
 assert.equal(writes.filter(x=>x.startsWith('wallet_ledger/')).length,1);
 assert.ok(writes.every(x=>x.startsWith('wallet_accounts/')||x.startsWith('wallet_ledger/')),'no legacy or financial writes');
 // Ledger failure recovery: do not recreate or overwrite existing account.
 delete store.wallet_ledger[uid].genesis_locked_v1;
 r=await call('init_locked',{body});assert.equal(r.status,200);assert.equal(r.data.duplicate,true);
 assert.ok(get('wallet_ledger/'+uid+'/genesis_locked_v1'));
 r=await call('status',{method:'GET'});assert.equal(r.status,200);assert.equal(r.data.walletAccount.availableVnd,0);
 assert.equal(r.data.walletAccount.ledgerInitialized,true);assert.equal(r.data.checkoutEnabled,false);
 assert.equal(r.data.legacyWalletSpendable,false);
 // Existing non-zero/active wallet must not be overwritten.
 store.wallet_accounts[uid]={...store.wallet_accounts[uid],status:'active',availableVnd:100};
 r=await call('init_locked',{body});assert.equal(r.status,409);assert.equal(store.wallet_accounts[uid].availableVnd,100);
 // Misclassified label must block new wallets on a fresh UID.
 store.wallet_accounts={};store.wallet_ledger={};store.wallet_test.adminkit.classification='unverified';
 r=await call('init_locked',{body});assert.equal(r.status,409);assert.equal(Object.keys(store.wallet_accounts).length,0);
 console.log('Locked wallet tests passed: admin-only, 0 VND, idempotent, locked, recovery and no legacy writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
