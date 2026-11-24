'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const Module=require('node:module');
const path=require('node:path');
const {buildAdminQrUrl,resolvePreview,strictLockedWallet,validBankConfig}=require('../lib/wallet-v55');
const {makePreviewCode}=require('../lib/wallet-live-previews');
const uidAdmin='9UZ3fvz2yeawGr964zKvS9qfANh2';
const uidCustomer='9UZ3fvz2yeawGr964zKvS9qfANh3';
let assertions=0;
function eq(a,b,m){assert.deepEqual(a,b,m);assertions++}
function yes(a,m){assert(a,m);assertions++}
const ds={users:{adminkit:{balance:97300000},customer:{balance:0}},
 wallet_accounts:{[uidAdmin]:{uid:uidAdmin,availableVnd:0,heldVnd:0,status:'locked',paymentEnabled:false}},
 wallet_ledger:{[uidAdmin]:{genesis_locked_v1:{deltaVnd:0}}}};
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function traverse(key,create){let x=ds;const a=key.split('/').filter(Boolean);for(const k of a.slice(0,-1)){if(create&&!x[k])x[k]={};x=x?.[k]}return [x,a.at(-1)]}
function ref(key){return{
 once:async()=>{const [a,k]=traverse(key);const v=clone(a?.[k]);return {val:()=>v??null,exists:()=>v!==undefined&&v!==null}},
 transaction:async cb=>{const [a,k]=traverse(key,true),old=clone(a?.[k])??null,nv=cb(old);
  if(nv===undefined)return{committed:false};a[k]=clone(nv);return{committed:true,snapshot:{val:()=>clone(nv)}}},
 limitToLast:()=>ref(key)
}}
const db={ref};
const fail=(message,status=500)=>Object.assign(new Error(message),{status});
const load=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='../lib/shop-common' && /[\\/]api[\\/](wallet|sepay-live-webhook)\.js$/.test(parent?.filename||''))
  return {firebase:()=>({database:()=>db}),error:fail,jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message})};
 if(request==='../lib/secure-accounts' && /[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
  return {identity:async(req,{adminOnly}={})=>{
    const token=req.headers.authorization;
    if(token!=='Bearer customer'&&token!=='Bearer admin')throw fail('Unauthorized',401);
    if(adminOnly&&token!=='Bearer admin')throw fail('Forbidden',403);
    return {uid:token==='Bearer admin'?uidAdmin:uidCustomer,username:token==='Bearer admin'?'adminkit':'customer',isAdmin:token==='Bearer admin',db,profile:{balance:0}};
   },checkOrigin:()=>{},configuredAdminUsername:()=> 'adminkit'};
 return load.apply(this,arguments);
};
const handler=require('../api/wallet');
const webhook=require('../api/sepay-live-webhook');
Module._load=load;
function resp(){let status=200,body;return{res:{setHeader(){},status(n){status=n;return this},json(o){body=o;return this}},get:()=>({status,body})}}
async function call(action,token='Bearer admin',body){const r=resp();await handler({query:{action},method:body?'POST':'GET',headers:{authorization:token},body},r.res);return r.get()}
async function webhookSend(id,code,{amount=10000,account='123456789012',bad=false}={}){
 const obj={id,accountNumber:account,transferType:'in',transferAmount:amount,content:'NAP '+code,gateway:'MB',transactionDate:'2026-11-06 18:00:00'};
 const raw=Buffer.from(JSON.stringify(obj)),stamp=String(Math.floor(Date.now()/1000));
 const hmac='sha256='+crypto.createHmac('sha256',process.env.SEPAY_LIVE_WEBHOOK_SECRET).update(stamp+'.').update(raw).digest('hex');
 const req={method:'POST',headers:{'x-sepay-timestamp':stamp,'x-sepay-signature':bad?'sha256='+('0'.repeat(64)):hmac},async *[Symbol.asyncIterator](){yield raw}};
 const r=resp();await webhook(req,r.res);return r.get();
}
(async()=>{
 process.env.MAIN_ADMIN_GOOGLE_UID=uidAdmin;
 process.env.MAIN_ADMIN_USERNAME='adminkit';
 process.env.MB_BANK_ACCOUNT_NUMBER='123456789012';
 process.env.MB_BANK_ACCOUNT_NAME='KIT PHAN MMO';
 process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER='0000000001';
 process.env.SEPAY_LIVE_WEBHOOK_SECRET='test-hmac-secret-must-be-long';
 process.env.SEPAY_LIVE_RECORDING_ENABLED='false';
 process.env.V55_ADMIN_QR_PREVIEW_ENABLED='false';
 eq(validBankConfig('123456789012','KIT PHAN MMO'),true);
 eq(validBankConfig('123456789012',''),false);
 eq(validBankConfig('123456789012','a\nb'),false);
 eq(buildAdminQrUrl('1','KIT PHAN MMO',10000,makePreviewCode()),null);
 const code=makePreviewCode(),t=Date.now(),id='a'.repeat(24),key=String(t).padStart(13,'0')+'_'+id;
 const qr=buildAdminQrUrl('123456789012','KIT PHAN MMO',10000,code);
 yes(qr.startsWith('https://img.vietqr.io/image/970422-123456789012-compact2.png?'));
 eq(new URL(qr).searchParams.get('amount'),'10000');
 eq(new URL(qr).searchParams.get('addInfo'),'NAP '+code);
 eq(strictLockedWallet(ds.wallet_accounts[uidAdmin]),true);
 eq(strictLockedWallet({...ds.wallet_accounts[uidAdmin],availableVnd:1}),false);
 eq((await resolvePreview(db,code,10000)).classification,'unmatched_preview');
 let x=await call('deposit_preview_create','Bearer customer',{amountVnd:10000,confirmNoPayment:true});eq(x.status,201);
 const customerCode=x.body.request.referenceCode,claim=ds.wallet_live_preview_codes[customerCode];
 eq(claim.uid,uidCustomer);
 x=await call('v55_readiness','Bearer customer');eq(x.status,403);
 x=await call('v55_dryrun','Bearer customer',{referenceCode:customerCode,amountVnd:10000,confirmNoPayment:true});eq(x.status,403);
 x=await call('v55_admin_qr_preview','Bearer customer',{referenceCode:customerCode,amountVnd:10000,confirmNoPayment:true,acknowledgeRealTransferRisk:true});eq(x.status,403);
 x=await call('v55_readiness');eq(x.status,200);eq(x.body.customerQrEnabled,false);
 eq(x.body.automaticLiveCreditsEnabled,false);eq(x.body.adminQrPreviewEnabled,false);
 eq('bankAccountNumber' in x.body,false);
 x=await call('v55_dryrun','Bearer admin',{referenceCode:customerCode,amountVnd:10000,confirmNoPayment:true});eq(x.status,200);
 eq(x.body.result.classification,'preview_not_payable');eq(x.body.result.username,'customer');eq(x.body.realWalletCredited,false);
 x=await call('v55_dryrun','Bearer admin',{referenceCode:customerCode,amountVnd:20000,confirmNoPayment:true});eq(x.status,422);yes(x.body.error.includes('không khớp'));eq(x.body.ok,false);
 x=await call('v55_dryrun','Bearer admin',{referenceCode:customerCode.slice(0,-1),amountVnd:10000,confirmNoPayment:true});eq(x.status,422);yes(x.body.error.includes('không hợp lệ'));
 x=await call('v55_dryrun','Bearer admin',{referenceCode:customerCode,amountVnd:10000});eq(x.status,422);
 x=await call('v55_admin_qr_preview','Bearer admin',{referenceCode:customerCode,amountVnd:10000,confirmNoPayment:true,acknowledgeRealTransferRisk:true});eq(x.status,403);
 process.env.V55_ADMIN_QR_PREVIEW_ENABLED='true';
 x=await call('v55_admin_qr_preview','Bearer admin',{referenceCode:customerCode,amountVnd:10000,confirmNoPayment:true});eq(x.status,422);
 x=await call('v55_admin_qr_preview','Bearer admin',{referenceCode:customerCode,amountVnd:10000,confirmNoPayment:true,acknowledgeRealTransferRisk:true});eq(x.status,200);
 eq(new URL(x.body.qrUrl).searchParams.get('addInfo'),'NAP '+customerCode);
 eq(x.body.realTransferPossible,true);eq(x.body.liveDepositsOpen,false);eq(x.body.credited,false);
 process.env.MB_BANK_ACCOUNT_NUMBER=process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER;
 x=await call('v55_admin_qr_preview','Bearer admin',{referenceCode:customerCode,amountVnd:10000,confirmNoPayment:true,acknowledgeRealTransferRisk:true});eq(x.status,503);
 process.env.MB_BANK_ACCOUNT_NUMBER='123456789012';
 const matched=await resolvePreview(db,customerCode,10000);eq(matched.classification,'preview_not_payable');eq(matched.uid,uidCustomer);
 eq((await resolvePreview(db,customerCode,20000)).classification,'preview_amount_mismatch');
 eq((await resolvePreview(db,customerCode,10000,t+31*60000)).classification,'expired_preview');
 const p=ds.wallet_live_previews[uidCustomer][claim.historyKey];
 const created=p.createdAt,expires=p.expiresAt;
 p.createdAt=created-45*60000;p.expiresAt=p.createdAt+30*60000;
 x=await call('v55_dryrun','Bearer admin',{referenceCode:customerCode,amountVnd:10000,confirmNoPayment:true});eq(x.status,422);yes(x.body.error.includes('hết hạn'));
 p.createdAt=created;p.expiresAt=expires;
 p.payable=true;
 eq((await resolvePreview(db,customerCode,10000)).classification,'unmatched_preview');p.payable=false;
 const off=await webhookSend(7711,customerCode);eq(off.status,503);
 process.env.SEPAY_LIVE_RECORDING_ENABLED='true';
 const forged=await webhookSend(7711,customerCode,{bad:true});eq(forged.status,401);
 const real=await webhookSend(7711,customerCode);eq(real.status,200);eq(real.body.previewMatch,'preview_not_payable');
 eq(ds.wallet_live_payment_events.sepay_7711.matchedCustomerUid,uidCustomer);
 eq(ds.wallet_live_payment_events.sepay_7711.reconciliationVersion,'5.5');
 eq(ds.wallet_live_payment_events.sepay_7711.bankVerified,false);
 eq(ds.wallet_live_payment_events.sepay_7711.credited,false);
 const dup=await webhookSend(7711,customerCode);eq(dup.body.duplicate,true);
 const bodyMismatch=await webhookSend(7711,customerCode,{amount:20000});eq(bodyMismatch.body.bodyMismatch,true);
 eq(ds.wallet_live_payment_events.sepay_7711.amountVnd,10000);
 eq(ds.users.adminkit.balance,97300000);eq(ds.users.customer.balance,0);
 eq(ds.wallet_accounts[uidAdmin].availableVnd,0);
 eq(ds.wallet_ledger[uidAdmin].genesis_locked_v1.deltaVnd,0);
 eq(ds.wallet_accounts[uidCustomer],undefined);
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 yes(html.includes('VietQR đang tắt'));yes(!html.includes('img.vietqr.io/image/970422-'));
 const api=fs.readdirSync(path.join(__dirname,'..','api')).filter(x=>x.endsWith('.js'));
 eq(api.length,12);
 console.log('PASS V5.5 admin-only VietQR & record-only SePay: '+assertions+' assertions, zero real-wallet mutations');
})().catch(e=>{console.error(e);process.exitCode=1});
