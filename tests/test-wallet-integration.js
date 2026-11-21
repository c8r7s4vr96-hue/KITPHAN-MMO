'use strict';
const assert = require('node:assert/strict');
const Module=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
// Load handlers with mocked security/database modules: NEVER contact Firebase or SePay.
const base=path.resolve(__dirname,'..');
const realLoad=Module._load;
const db={store:{users:{tester:{balance:5000,totalDeposited:5000}},wallet_reconciliation:{}},calls:[]};
function ref(k){return {once:async()=>{let v=db.store;for(const part of k.split('/'))v=v?.[part];return{exists:()=>v!==undefined&&v!==null,val:()=>v??null}},
 transaction:async fn=>{db.calls.push(k);let obj=db.store;const parts=k.split('/');for(const p of parts.slice(0,-1))obj=obj[p]??(obj[p]={});const old=obj[parts.at(-1)]??null;const next=fn(old);if(next===undefined)return{committed:false};obj[parts.at(-1)]=next;return{committed:true,snapshot:{val:()=>next}}},
 limitToLast:()=>ref(k)};}
const identity=async(req,{adminOnly}={})=>{if(req.headers.authorization!=='Bearer admin')throw Object.assign(Error('Unauthorized'),{status:401});if(adminOnly===false)throw Error('expected admin');return{uid:'adminuid',db:{ref}}};
Module._load=function(request,parent,isMain){
 if(request==='../lib/secure-accounts'&&parent?.filename?.includes('/api/wallet-'))return{identity,checkOrigin:()=>{}};
 if(request==='../lib/shop-common'&&parent?.filename?.includes('/api/wallet-'))return{error:(s,status)=>Object.assign(Error(s),{status}),jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message})};
 return realLoad.apply(this,arguments);
};
const review=require('../api/wallet-review');
const audit=require('../api/wallet-audit');
Module._load=realLoad;
const call=async(fn,{method='POST',authorization='Bearer admin',body={},query={}}={})=>{
 let status=200,payload;const res={setHeader:()=>{},status(n){status=n;return this},json(v){payload=v;return this}};
 await fn({method,headers:{authorization},body,query},res);return{status,payload};
};
(async()=>{
 const body={username:'tester',requestId:'request_abc12345',verifiedBalanceVnd:4000,observedLegacyBalanceVnd:5000,note:'Bank statement checked offline',bankChecked:true,ordersChecked:true,ownershipChecked:true};
 let r=await call(review,{body});assert.equal(r.status,201);assert.equal(r.payload.balanceChanged,false);
 assert.equal(db.store.users.tester.balance,5000,'REVIEW MUST NOT CHANGE MONEY');
 r=await call(review,{body});assert.equal(r.payload.duplicate,true);assert.equal(Object.keys(db.store.wallet_reconciliation.tester).length,1);
 r=await call(review,{body:{...body,requestId:'request_abc12346',bankChecked:false}});assert.equal(r.status,422);
 r=await call(review,{authorization:'Bearer invalid',body});assert.equal(r.status,401);
 r=await call(review,{body:{...body,requestId:'request_abc12347',observedLegacyBalanceVnd:9000}});assert.equal(r.status,409);
 const g=await call(audit,{method:'GET',query:{username:'tester'}});assert.equal(g.status,200);assert.equal(g.payload.report.walletLocked,true);
 assert.equal(db.store.users.tester.balance,5000);
 console.log('7 mocked wallet API assertions passed (no external requests)');
})().catch(e=>{console.error(e);process.exitCode=1});
