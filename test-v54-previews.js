'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Module=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
const realLoad=Module._load;
const {makePreviewCode,makePreviewId,extractPreviewCode,goodPreviewAmount,publicPreview,classifyPreview,buildVietQrUrl}=require('../lib/wallet-live-previews');
const uidA='9UZ3fvz2yeawGr964zKvS9qfANh2';
const uidB='9UZ3fvz2yeawGr964zKvS9qfANh3';
let checks=0;function eq(a,b,msg){assert.deepEqual(a,b,msg);checks++;}
function yes(v,msg){assert(v,msg);checks++}
const dataStore={users:{adminkit:{balance:97300000},alice:{balance:0},bob:{balance:0}},
 wallet_accounts:{[uidA]:{uid:uidA,availableVnd:0,heldVnd:0,status:'locked',paymentEnabled:false}},
 wallet_ledger:{[uidA]:{genesis_locked_v1:{deltaVnd:0}}}};
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function find(key,create=false){const ks=key.split('/').filter(Boolean);let o=dataStore;for(const k of ks.slice(0,-1)){if(create&&o&&!o[k])o[k]={};o=o?.[k]}return[o,ks.at(-1)]}
function ref(key){return{
 once:async()=>{const[o,k]=find(key);const v=clone(o?.[k]);return{val:()=>v??null,exists:()=>v!==undefined&&v!==null}},
 transaction:async fn=>{const[o,k]=find(key,true),old=clone(o?.[k])??null,newVal=fn(old);if(newVal===undefined)return{committed:false,snapshot:{val:()=>old}};o[k]=clone(newVal);return{committed:true,snapshot:{val:()=>clone(newVal)}}},
 limitToLast:()=>ref(key)
}}
const db={ref};
const fail=(message,status=500)=>Object.assign(new Error(message),{status});
Module._load=function(request,parent,isMain){
 if(request==='../lib/shop-common' && /[\\/]api[\\/](wallet|sepay-live-webhook)\.js$/.test(parent?.filename||''))
  return{firebase:()=>({database:()=>db}),error:fail,jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message})};
 if(request==='../lib/secure-accounts' && /[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
  return{identity:async(req,{adminOnly}={})=>{
    const who=req.headers.authorization;
    if(who!=='Bearer a'&&who!=='Bearer b'&&who!=='Bearer admin')throw fail('Login required',401);
    if(adminOnly&&who!=='Bearer admin')throw fail('Forbidden',403);
    const uid=who==='Bearer b'?uidB:uidA;
    return{uid,username:who==='Bearer b'?'bob':who==='Bearer admin'?'adminkit':'alice',isAdmin:who==='Bearer admin',db,profile:{balance:0}};
   },checkOrigin:()=>{},configuredAdminUsername:()=> 'adminkit'};
 return realLoad.apply(this,arguments);
};
const wallet=require('../api/wallet');const webhook=require('../api/sepay-live-webhook');Module._load=realLoad;
function response(){let status=200,body;return{res:{setHeader(){},status(n){status=n;return this},json(b){body=b;return this}},value:()=>({status,body})}}
async function call(action,auth='Bearer a',body){const r=response();await wallet({query:{action},method:body?'POST':'GET',headers:{authorization:auth},body},r.res);return r.value()}
async function sendWebhook(content,opts={}){
 const data={id:opts.id||70121,accountNumber:opts.accountNumber||'123456789012',transferType:'in',transferAmount:opts.amount||10000,
  content,gateway:'MB',transactionDate:'2026-11-06 17:00:00',referenceCode:'TEST'};
 const raw=Buffer.from(JSON.stringify(data)),ts=String(Math.floor(Date.now()/1000));
 const signature='sha256='+crypto.createHmac('sha256',process.env.SEPAY_LIVE_WEBHOOK_SECRET).update(ts+'.').update(raw).digest('hex');
 const request={method:'POST',headers:{'x-sepay-signature':opts.badSignature?'sha256='+'0'.repeat(64):signature,'x-sepay-timestamp':ts},async *[Symbol.asyncIterator](){yield raw}};
 const r=response();await webhook(request,r.res);return r.value();
}
(async()=>{
 process.env.MAIN_ADMIN_GOOGLE_UID=uidA;process.env.MAIN_ADMIN_USERNAME='adminkit';
 process.env.SEPAY_LIVE_WEBHOOK_SECRET='this-is-just-a-test-hmac-live-secret';process.env.MB_BANK_ACCOUNT_NUMBER='123456789012';
 process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER='0000000001';process.env.SEPAY_LIVE_RECORDING_ENABLED='false';
 eq(goodPreviewAmount(10000),true);eq(goodPreviewAmount(10001),false);eq(goodPreviewAmount('10000'),false);
 yes(/^KP54P[A-F0-9]{20}$/.test(makePreviewCode()));yes(/^[a-f0-9]{24}$/.test(makePreviewId()));
 eq(extractPreviewCode('bank text NAP '+makePreviewCode())?.startsWith('KP54P'),true);
 eq(extractPreviewCode('NAP KP54PAAAAAAAAAAAAAAAAAAAA NAP KP54PBBBBBBBBBBBBBBBBBBBB'),null);
 const url=buildVietQrUrl('123456789012',10000,'NAP AAAAAAAA');yes(url.startsWith('https://vietqr.app/img?'));
 eq(buildVietQrUrl('not-an-account',10000,'NAP AAAA'),null);
 let x=await call('deposit_preview_status','Bearer missing');eq(x.status,401);
 x=await call('deposit_preview_create','Bearer a',{amountVnd:10000});eq(x.status,422);
 x=await call('deposit_preview_create','Bearer a',{amountVnd:11111,confirmNoPayment:true});eq(x.status,422);
 x=await call('deposit_preview_create','Bearer a',{amountVnd:10000,confirmNoPayment:true});eq(x.status,201);
 const first=x.body.request;eq(first.payable,false);eq(first.credited,false);eq(first.qrAvailable,false);
 eq('qrUrl' in x.body,false);eq('accountNumber' in x.body,false);eq('transferContent' in x.body,false);
 yes(first.referenceCode.startsWith('KP54P'));eq(dataStore.wallet_live_previews[uidA][dataStore.wallet_live_preview_codes[first.referenceCode].historyKey].username,'alice');
 x=await call('deposit_preview_create','Bearer a',{amountVnd:10000,confirmNoPayment:true});eq(x.body.duplicate,true);eq(x.body.request.id,first.id);
 x=await call('deposit_preview_create','Bearer a',{amountVnd:20000,confirmNoPayment:true});eq(x.status,409);
 x=await call('deposit_preview_create','Bearer b',{amountVnd:20000,confirmNoPayment:true});eq(x.status,201);
 const second=x.body.request;yes(second.id!==first.id);yes(second.referenceCode!==first.referenceCode);
 x=await call('deposit_preview_status','Bearer a');eq(x.body.activePreview.id,first.id);eq(x.body.recentPreviews.length,1);
 x=await call('deposit_preview_status','Bearer b');eq(x.body.activePreview.id,second.id);eq(x.body.recentPreviews.length,1);
 eq(x.body.recentPreviews[0].referenceCode,second.referenceCode);
 x=await call('deposit_preview_queue','Bearer a');eq(x.status,403);
 x=await call('deposit_preview_queue','Bearer admin');eq(x.status,200);eq(x.body.recentPreviews.length,2);
 // Expired previews never become payable, even when the amount matches.
 const stored=dataStore.wallet_live_previews[uidA][dataStore.wallet_live_preview_codes[first.referenceCode].historyKey];eq(classifyPreview(stored,10000),'preview_not_payable');
 eq(classifyPreview(stored,20000),'preview_amount_mismatch');
 eq(classifyPreview(stored,10000,stored.expiresAt+1),'expired_preview');
 eq(publicPreview({...stored,payable:true}),null);
 const disabled=await sendWebhook('NAP '+first.referenceCode);eq(disabled.status,503);eq(dataStore.wallet_live_payment_events,undefined);
 process.env.SEPAY_LIVE_RECORDING_ENABLED='true';
 const forged=await sendWebhook('NAP '+first.referenceCode,{badSignature:true});eq(forged.status,401);
 const paid=await sendWebhook('NAP '+first.referenceCode);eq(paid.status,200);eq(paid.body.recorded,true);
 eq(paid.body.previewMatch,'preview_not_payable');eq(paid.body.liveCreditsEnabled,false);
 eq(dataStore.wallet_live_payment_events.sepay_70121.previewCode,first.referenceCode);
 eq(dataStore.wallet_live_payment_events.sepay_70121.credited,false);
 eq(dataStore.wallet_live_payment_events.sepay_70121.status,'pending_manual_reconciliation');
 const replay=await sendWebhook('NAP '+first.referenceCode);eq(replay.body.duplicate,true);
 const different=await sendWebhook('NAP '+first.referenceCode,{amount:20000});eq(different.body.bodyMismatch,true);
 const mismatch=await sendWebhook('NAP '+second.referenceCode,{id:70122,amount:10000});eq(mismatch.body.previewMatch,'preview_amount_mismatch');
 const missing=await sendWebhook('NAP KP54PAAAAAAAAAAAAAAAAAAAA',{id:70123});eq(missing.body.previewMatch,'unmatched_preview');
 eq(dataStore.wallet_accounts[uidA].availableVnd,0);eq(dataStore.wallet_ledger[uidA].genesis_locked_v1.deltaVnd,0);
 eq(dataStore.users.adminkit.balance,97300000);
 // Security invariant: no bank account or QR shown in customer deposit HTML.
 const page=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 yes(page.includes('kp-v54-create') && page.includes('deposit_preview_create'));
 yes(page.includes('VietQR đang tắt'));eq(page.includes('img.vietqr.io/image/MB-'),false);
 const fsNode=fs.readdirSync(path.join(__dirname,'..','api')).filter(n=>n.endsWith('.js'));
 eq(fsNode.length,12,'keep within existing Vercel Hobby functions budget');
 console.log('PASS V5.4 nonpayable owner-scoped deposit previews: '+checks+' assertions, no real wallet credit or live QR');
})().catch(e=>{console.error(e);process.exitCode=1});
