'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const {assessEvent,sanitizeEvent,summarizeEvents}=require('../lib/wallet-v56');
const UID='9UZ3fvz2yeawGr964zKvS9qfANh2';
const base={provider:'sepay_live',transactionId:'81236',amountVnd:10000,
 rawPayloadSha256:'a'.repeat(64),status:'pending_manual_reconciliation',
 bankVerified:false,credited:false,spendable:false,payable:false,
 draftMatch:'no_code',previewMatch:'preview_not_payable',createdAt:Date.now()};
let checks=0;function eq(a,b){assert.deepEqual(a,b);checks++;}
const cases={
 'nonpayable_preview':base,
 'amount_mismatch':{...base,transactionId:'81237',previewMatch:'preview_amount_mismatch'},
 'expired_reference':{...base,transactionId:'81238',previewMatch:'expired_preview'},
 'unassigned':{...base,transactionId:'81239',previewMatch:'no_preview_code'},
 'unmatched_reference':{...base,transactionId:'81240',previewMatch:'unmatched_preview'},
 'integrity_alert':{...base,transactionId:'81241',credited:true}
};
for(const [k,v] of Object.entries(cases))eq(assessEvent(v),k);
for(const changed of [{...base,bankVerified:true},{...base,spendable:true},
 {...base,payable:true},{...base,status:'settled'},{...base,rawPayloadSha256:'notsha'},
 {...base,transactionId:'invalid'},{...base,amountVnd:-1},null]){
 eq(assessEvent(changed),'integrity_alert');
}
const safe=sanitizeEvent({...base,secret:'must not expose',referenceCode:'CUSTOMER PRIVATE',code:'NEVER SHOW'});
eq(safe.bankIndependentlyVerified,false);eq(safe.approvedForCredit,false);
eq('secret' in safe,false);eq('referenceCode' in safe,false);eq('code' in safe,false);
const sum=summarizeEvents(cases);
eq(sum.scanned,6);eq(sum.counts.integrity_alert,1);eq(sum.integrityAlert,true);
const before=JSON.stringify(cases);summarizeEvents(cases);eq(JSON.stringify(cases),before);
const data={wallet_accounts:{[UID]:{uid:UID,status:'locked',availableVnd:0,heldVnd:0,paymentEnabled:false}},wallet_live_payment_events:{}};
Object.entries(cases).forEach(([k,v])=>data.wallet_live_payment_events['sepay_'+v.transactionId]=v);
const snap=x=>({val:()=>x??null,exists:()=>x!=null});
let writes=0;
const db={ref(path){let val=data;for(const piece of path.split('/'))val=val?.[piece];return{
  once:async()=>snap(val),limitToLast(){return this},transaction(){writes++;throw new Error('MUTATION BLOCKED')},
  set(){writes++;throw new Error('MUTATION BLOCKED')},update(){writes++;throw new Error('MUTATION BLOCKED')}
}}};
const fail=(m,status=500)=>Object.assign(new Error(m),{status});
const realLoad=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='../lib/shop-common' && /[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
  return {error:fail,jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message})};
 if(request==='../lib/secure-accounts' && /[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
  return {identity:async(req,{adminOnly}={})=>{
   const auth=req.headers?.authorization;
   if(!auth)throw fail('Not signed in',401);
   if(adminOnly&&auth!=='Bearer admin')throw fail('No access',403);
   return {uid:auth==='Bearer admin'?UID:'someOtherCustomer',username:auth==='Bearer admin'?'adminkit':'customer',isAdmin:auth==='Bearer admin',db};
  },checkOrigin:()=>{},configuredAdminUsername:()=> 'adminkit'};
 return realLoad.apply(this,arguments);
};
const handler=require('../api/wallet');Module._load=realLoad;
function response(){let status=200,body;return{res:{setHeader(){},status(n){status=n;return this},json(b){body=b;return this}},value(){return{status,body}}}}
async function call(auth='Bearer admin',method='GET'){
 const r=response();await handler({method,query:{action:'v56_audit'},headers:{authorization:auth}},r.res);return r.value();
}
(async()=>{
 process.env.MAIN_ADMIN_GOOGLE_UID=UID;process.env.MAIN_ADMIN_USERNAME='adminkit';
 let r=await call();eq(r.status,200);eq(r.body.version,'5.6');eq(r.body.readOnly,true);
 eq(r.body.scanned,6);eq(r.body.integrityAlert,true);eq(r.body.counts.amount_mismatch,1);
 eq(r.body.realWalletLocked,true);eq(r.body.bankVerificationAvailable,false);
 eq(r.body.liveCreditsEnabled,false);eq(r.body.customerPaymentsEnabled,false);
 eq(r.body.bankVerifiedEventCount,0);eq(r.body.events.length,6);
 eq(r.body.events.every(x=>x.bankIndependentlyVerified===false&&x.approvedForCredit===false),true);
 eq(r.body.events.some(x=>x.secret||x.code||x.referenceCode),false);
 eq((await call('Bearer customer')).status,403);
 eq((await call(null)).status,401);
 eq((await call('Bearer admin','POST')).status,405);
 process.env.MAIN_ADMIN_GOOGLE_UID='WRONG_UID';eq((await call()).status,403);
 process.env.MAIN_ADMIN_GOOGLE_UID=UID;
 data.wallet_live_payment_events={};r=await call();eq(r.status,200);eq(r.body.scanned,0);
 eq(r.body.integrityAlert,false);eq(writes,0);
 eq(data.wallet_accounts[UID].availableVnd,0);
 console.log('PASS V5.6 read-only HMAC intake audit: '+checks+' assertions; 0 Firebase writes');
})().catch(e=>{console.error(e);process.exitCode=1});
