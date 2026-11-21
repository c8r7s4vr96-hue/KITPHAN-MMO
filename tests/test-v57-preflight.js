'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const {evaluateLaunchSafety}=require('../lib/wallet-v57');
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
const UID='9UZ3fvz2yeawGr964zKvS9qfANh2';
const wallet={uid:UID,status:'locked',availableVnd:0,heldVnd:0,paymentEnabled:false};
const env={MB_BANK_ACCOUNT_NUMBER:'000000000001',MB_BANK_ACCOUNT_NAME:'TEST ONLY',
 SEPAY_LIVE_WEBHOOK_SECRET:'LOCAL_TEST_SECRET_1234567890',SEPAY_LIVE_RECORDING_ENABLED:'false',
 WALLET_SANDBOX_ENABLED:'false',SHOP_PURCHASES_ENABLED:'false',ACCOUNT_WALLET_RECONCILED:'false',
 V55_ADMIN_QR_PREVIEW_ENABLED:'false'};
const event={provider:'sepay_live',transactionId:'123456',amountVnd:10000,
 rawPayloadSha256:'a'.repeat(64),status:'pending_manual_reconciliation',
 bankVerified:false,credited:false,spendable:false,payable:false,
 draftMatch:'no_code',previewMatch:'preview_not_payable',createdAt:Date.now()};
const data={wallet_accounts:{[UID]:wallet},wallet_live_payment_events:{sepay_123456:event}};
let r=evaluateLaunchSafety({wallet,events:data.wallet_live_payment_events,environment:env});
eq(r.version,'5.7');eq(r.readOnly,true);eq(r.bankConfigured,true);eq(r.hmacConfigured,true);
eq(r.realWalletLocked,true);eq(r.eventsScanned,1);eq(r.integrityAlert,false);
eq(r.safeDevelopmentState,true);eq(r.canAcceptLiveDeposits,false);eq(r.canCreditWallet,false);
eq(r.canPurchase,false);eq(r.bankSettlementVerified,false);eq(r.launchBlockersCount>=7,true);
eq(r.safetyChecks.every(x=>x.pass),true);
for(const unsafe of [
  {wallet:{...wallet,availableVnd:1}},
  {environment:{...env,SEPAY_LIVE_RECORDING_ENABLED:'true'}},
  {environment:{...env,SHOP_PURCHASES_ENABLED:'true'}},
  {environment:{...env,ACCOUNT_WALLET_RECONCILED:'true'}},
  {environment:{...env,WALLET_SANDBOX_ENABLED:'true'}},
  {events:{sepay_123456:{...event,credited:true}}}
]){r=evaluateLaunchSafety({wallet,events:data.wallet_live_payment_events,environment:env,...unsafe});eq(r.safeDevelopmentState,false);eq(r.canCreditWallet,false);}
const fail=(m,status=500)=>Object.assign(new Error(m),{status});
const realLoad=Module._load;
let writes=0;
const db={ref(path){let v=data;for(const x of path.split('/'))v=v?.[x];return{
  once:async()=>({val:()=>v??null}),limitToLast(){return this},
  set(){writes++;throw Error('mutation')},update(){writes++;throw Error('mutation')},
  transaction(){writes++;throw Error('mutation')}
}}};
Module._load=function(request,parent){
 if(request==='../lib/shop-common'&&/[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
   return{error:fail,jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message})};
 if(request==='../lib/secure-accounts'&&/[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
   return{identity:async(req,{adminOnly}={})=>{
     const a=req.headers?.authorization;
     if(!a)throw fail('No session',401);
     if(adminOnly&&a!=='Bearer admin')throw fail('Forbidden',403);
     return{uid:a==='Bearer admin'?UID:'other-user',username:a==='Bearer admin'?'adminkit':'customer',isAdmin:a==='Bearer admin',db};
   },checkOrigin:()=>{},configuredAdminUsername:()=> 'adminkit'};
 return realLoad.apply(this,arguments);
};
const handler=require('../api/wallet');Module._load=realLoad;
function mockRes(){let status=200,body;return{res:{setHeader(){},status(n){status=n;return this},json(b){body=b;return this}},data:()=>({status,body})}}
async function call(auth='Bearer admin',method='GET'){const t=mockRes();await handler({method,headers:{authorization:auth},query:{action:'v57_preflight'}},t.res);return t.data();}
(async()=>{
 Object.assign(process.env,env,{MAIN_ADMIN_GOOGLE_UID:UID,MAIN_ADMIN_USERNAME:'adminkit'});
 let a=await call();eq(a.status,200);eq(a.body.ok,true);eq(a.body.readOnly,true);
 eq(a.body.canAcceptLiveDeposits,false);eq(a.body.canCreditWallet,false);
 eq(a.body.safetyChecks.every(x=>x.pass),true);eq(a.body.launchBlockersCount>=7,true);
 eq((await call('Bearer customer')).status,403);eq((await call(null)).status,401);
 eq((await call('Bearer admin','POST')).status,405);
 process.env.MAIN_ADMIN_GOOGLE_UID='NOT_ADMIN';eq((await call()).status,403);
 process.env.MAIN_ADMIN_GOOGLE_UID=UID;
 eq(writes,0);eq(data.wallet_accounts[UID].availableVnd,0);
 console.log('PASS V5.7 read-only launch preflight: '+checks+' assertions; 0 writes');
})().catch(e=>{console.error(e);process.exitCode=1});
