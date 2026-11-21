'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Module=require('node:module');
const realLoad=Module._load;
const {makeDraftCode,extractLiveCode,classificationForDraft}=require('../lib/wallet-live-intake');
const uid='9UZ3fvz2yeawGr964zKvS9qfANh2';
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
let checks=0;const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++;};
const store={users:{adminkit:{balance:97300000}},wallet_accounts:{[uid]:{uid,username:'adminkit',status:'locked',availableVnd:0,heldVnd:0,paymentEnabled:false}},wallet_ledger:{[uid]:{genesis_locked_v1:{deltaVnd:0}}}};
const find=(path,create=false)=>{const parts=path.split('/').filter(Boolean);let cur=store;
 for(const k of parts.slice(0,-1)){if(create&&!cur[k])cur[k]={};cur=cur?.[k];}return [cur,parts.at(-1)];};
const ref=key=>({
 once:async()=>{const [o,k]=find(key);const value=clone(o?.[k]);return{val:()=>value??null,exists:()=>value!==undefined&&value!==null}},
 transaction:async fn=>{const [o,k]=find(key,true);const prev=clone(o?.[k])??null;const value=fn(prev);if(value===undefined)return{committed:false};o[k]=clone(value);return{committed:true,snapshot:{val:()=>clone(value)}}},
 update:async patch=>{const [o,k]=find(key,true);o[k]={...(o[k]||{}),...clone(patch)}},
 limitToLast:()=>ref(key)
});
const db={ref};const fakeFirebase=()=>({database:()=>db});
const fail=(message,status=500)=>Object.assign(new Error(message),{status});
Module._load=function(request,parent,isMain){
 if(request==='../lib/shop-common' && /[\\/]api[\\/](wallet|sepay-live-webhook)\.js$/.test(parent?.filename||''))
  return{firebase:fakeFirebase,error:fail,jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message})};
 if(request==='../lib/secure-accounts' && /[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
  return{identity:async req=>{if(req.headers.authorization!=='Bearer admin')throw fail('Forbidden',403);return{uid,username:'adminkit',isAdmin:true,db}},
   checkOrigin:()=>{},configuredAdminUsername:()=> 'adminkit'};
 return realLoad.apply(this,arguments);
};
const wallet=require('../api/wallet'), webhook=require('../api/sepay-live-webhook');
Module._load=realLoad;
const response=()=>{let code=200,body;return{res:{setHeader(){},status(n){code=n;return this},json(obj){body=obj;return this}},get(){return{status:code,body}}}};
async function walletCall(action,body,auth='Bearer admin'){
 const r=response();await wallet({query:{action},method:body?'POST':'GET',headers:{authorization:auth},body},r.res);return r.get();
}
async function send(data,{sign=true}={}){
 const raw=Buffer.from(JSON.stringify(data));const ts=String(Math.floor(Date.now()/1000));
 const sig='sha256='+crypto.createHmac('sha256',process.env.SEPAY_LIVE_WEBHOOK_SECRET).update(ts+'.').update(raw).digest('hex');
 const req={method:'POST',headers:{'x-sepay-signature':sign?sig:'sha256='+'0'.repeat(64),'x-sepay-timestamp':ts},async *[Symbol.asyncIterator](){yield raw}};
 const r=response();await webhook(req,r.res);return r.get();
}
(async()=>{
 process.env.MAIN_ADMIN_GOOGLE_UID=uid;process.env.MAIN_ADMIN_USERNAME='adminkit';
 process.env.MB_BANK_ACCOUNT_NUMBER='123456789012';process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER='0000000001';
 process.env.SEPAY_LIVE_WEBHOOK_SECRET='example-test-only-live-hmac-secret-32';
 process.env.SEPAY_LIVE_RECORDING_ENABLED='false';
 eq(extractLiveCode('NAP '+makeDraftCode())?.startsWith('KPLIVE'),true);
 eq(extractLiveCode('NAP KPLIVEAAAAAAAAAAAAAAAAAAAA NAP KPLIVEBBBBBBBBBBBBBBBBBBBB'),null,'ambiguous codes rejected');
 const deny=await walletCall('deposit_draft',{amountVnd:10000,confirmNotPayable:true},'Bearer guest');eq(deny.status,403);
 const preflight=await walletCall('deposit_readiness');eq(preflight.status,200);eq(preflight.body.liveDepositsOpen,false);eq(preflight.body.automaticLiveCreditsEnabled,false);
 const badAmount=await walletCall('deposit_draft',{amountVnd:999,confirmNotPayable:true});eq(badAmount.status,422);
 const draft=await walletCall('deposit_draft',{amountVnd:10000,confirmNotPayable:true});eq(draft.status,201);eq(draft.body.payable,false);
 const code=draft.body.transferContent.split(' ')[1];
 eq(store.wallet_live_draft_codes[code].uid,uid);
 const livePayload={id:90003,accountNumber:'123456789012',transferType:'in',transferAmount:10000,
  content:draft.body.transferContent,gateway:'MB',transactionDate:'2026-11-06 11:00:00',referenceCode:'MBTEST'};
 const disabled=await send(livePayload);eq(disabled.status,503);eq(store.wallet_live_payment_events,undefined);
 process.env.SEPAY_LIVE_RECORDING_ENABLED='true';
 const forgery=await send(livePayload,{sign:false});eq(forgery.status,401);eq(store.wallet_live_payment_events,undefined);
 const wrong=await send({...livePayload,accountNumber:'999999999999'});eq(wrong.body.ignored,true);eq(store.wallet_live_payment_events,undefined);
 const incoming=await send(livePayload);eq(incoming.status,200);eq(incoming.body.recorded,true);
 eq(incoming.body.draftMatch,'draft_not_payable');eq(incoming.body.liveCreditsEnabled,false);
 eq(store.wallet_live_payment_events.sepay_90003.credited,false);
 eq(store.wallet_live_payment_events.sepay_90003.status,'pending_manual_reconciliation');
 eq(store.wallet_accounts[uid].availableVnd,0,'live must not increase real wallet');
 eq(store.wallet_ledger[uid].genesis_locked_v1.deltaVnd,0);
 eq(store.users.adminkit.balance,97300000,'must not change legacy');
 const same=await send(livePayload);eq(same.body.duplicate,true);eq(Object.keys(store.wallet_live_payment_events).length,1);
 const modified=await send({...livePayload,transferAmount:11000});eq(modified.body.bodyMismatch,true);
 eq(store.wallet_live_payment_events.sepay_90003.amountVnd,10000,'duplicate must not mutate amount');
 const unmatched=await send({...livePayload,id:90004,content:'NO REFERENCE'});eq(unmatched.body.draftMatch,'no_code');
 const wrongAmount=await send({...livePayload,id:90005,transferAmount:20000});eq(wrongAmount.body.draftMatch,'amount_mismatch_draft');
 const outgoing=await send({...livePayload,id:90006,transferType:'out'});eq(outgoing.body.ignored,true);
 eq(Object.keys(store.wallet_live_payment_events).length,3);
 const codeRef=store.wallet_live_drafts[uid][store.wallet_live_draft_codes[code].draftId];
 codeRef.expiresAt=Date.now()-1000;
 eq(classificationForDraft(codeRef,10000),'expired_draft');
 process.env.MB_BANK_ACCOUNT_NUMBER='0000000001';
 const wrongEnvironment=await send(livePayload);eq(wrongEnvironment.status,503,'test and live account collision denied');
 eq(store.wallet_accounts[uid].availableVnd,0);
 console.log('PASS V5.3 live webhook record-only: '+checks+' mocked assertions, no real money or network');
})().catch(e=>{console.error(e);process.exitCode=1});
