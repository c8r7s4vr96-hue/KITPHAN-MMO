'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const {safeAmount,codeFromContent,assessTransfer,applyPostingToWallet,offlineSelfTest}=require('../lib/wallet-v60-core');
let count=0;
function eq(a,b){assert.deepEqual(a,b);count++;}
function yes(a){assert(a);count++;}
const code='KP60P'+'A'.repeat(24),uid='UIDaliceSynthetic123456',account='0000000000',now=1700000200000;
const intent={type:'verified_live_payment_intent_v60',status:'awaiting_bank_transfer',payable:true,credited:false,
  uid,code,accountNumber:account,amountVnd:10000,createdAt:now-60000,expiresAt:now+60000};
const webhook={transactionId:'777777',transferType:'in',accountNumber:account,amountVnd:10000,
  content:'NAP '+code,rawPayloadSha256:'a'.repeat(64)};
const statement={transactionId:'777777',transferType:'in',accountNumber:account,amountVnd:10000,
  content:'NAP '+code,source:'independent_bank_statement',proofSha256:'b'.repeat(64),transferredAt:now-1000};
const call=(patch={})=>assessTransfer({intent,webhook,statement,expectedAccount:account,now,...patch});
(async()=>{
 eq(safeAmount(10000),true);eq(safeAmount(10000000),true);eq(safeAmount(20001),false);
 eq(safeAmount('10000'),false);eq(safeAmount(0),false);eq(safeAmount(20000000),false);
 eq(codeFromContent('NAP '+code),code);
 eq(codeFromContent('gioi thieu NAP '+code+' end'),code);
 eq(codeFromContent('NAP KP59D'+'A'.repeat(24)),null);
 eq(codeFromContent('NAP '+code+' NAP '+code),null);
 eq(codeFromContent('NAP '+code+'XYZ'),null);
 eq(codeFromContent('NAP '+code+' '.repeat(600)),null);
 let r=call();eq(r.ok,true);eq(r.canCredit,false);eq(r.bankVerified,false);
 eq(r.reason,'matching_candidate_requires_external_verification');
 eq(r.candidate.txId,'777777');
 eq(call({intent:{...intent,status:'draft_unpayable',payable:false}}).reason,'no_payable_intent');
 eq(call({intent:{...intent,code:'KP59D'+'B'.repeat(24)}}).reason,'no_payable_intent');
 eq(call({intent:{...intent,uid:'bad uid'}}).reason,'no_payable_intent');
 eq(call({intent:{...intent,amountVnd:20000}}).reason,'amount_mismatch');
 eq(call({intent:{...intent,accountNumber:'123456'}}).reason,'account_mismatch');
 eq(call({webhook:{...webhook,transferType:'out'}}).reason,'unverified_webhook_shape');
 eq(call({webhook:{...webhook,rawPayloadSha256:'bad'}}).reason,'unverified_webhook_shape');
 eq(call({webhook:{...webhook,amountVnd:20000}}).reason,'amount_mismatch');
 eq(call({webhook:{...webhook,content:'NAP NOEXIST'}}).reason,'reference_mismatch');
 eq(call({webhook:{...webhook,content:'NAP '+code+' NAP '+code}}).reason,'reference_mismatch');
 eq(call({statement:null}).reason,'independent_bank_evidence_missing');
 eq(call({statement:{...statement,proofSha256:'bad'}}).reason,'independent_bank_evidence_missing');
 eq(call({statement:{...statement,transactionId:'5'}}).reason,'transaction_mismatch');
 eq(call({statement:{...statement,amountVnd:20000}}).reason,'amount_mismatch');
 eq(call({statement:{...statement,content:'NAP WRONG'}}).reason,'reference_mismatch');
 eq(call({statement:{...statement,transferredAt:now+60001}}).reason,'outside_intent_window');
 eq(call({statement:{...statement,transferredAt:now-60001}}).reason,'outside_intent_window');
 eq(call({now:now-3000}).reason,'clock_invalid');
 const wallet={uid,currency:'VND',status:'active',paymentEnabled:true,
   source:'reconciled_live_wallet_v60',legacyFundsImported:false,
   version:2,availableVnd:0,heldVnd:0};
 const ins={uid,txId:'777777',intentCode:code,amountVnd:10000,fingerprint:r.fingerprint,
   authorizedBy:'independent_bank_reconciler',postedAt:now};
 eq(applyPostingToWallet({...wallet,status:'locked',paymentEnabled:false},ins).reason,'wallet_not_reconciled_or_locked');
 eq(applyPostingToWallet({...wallet,legacyFundsImported:true},ins).reason,'wallet_not_reconciled_or_locked');
 eq(applyPostingToWallet({...wallet,source:'customer_zero_initialization_v58'},ins).reason,'wallet_not_reconciled_or_locked');
 eq(applyPostingToWallet(wallet,{...ins,authorizedBy:'user'}).reason,'authorization_required');
 eq(applyPostingToWallet(wallet,{...ins,uid:'different'}).reason,'authorization_required');
 eq(applyPostingToWallet(wallet,{...ins,txId:'bad/id'}).reason,'authorization_required');
 let a=applyPostingToWallet(wallet,ins);yes(a.ok);eq(a.duplicate,false);
 eq(a.wallet.availableVnd,10000);eq(wallet.availableVnd,0);
 eq(a.wallet.postedTransfers.sepay_777777.deltaVnd,10000);
 eq(a.wallet.postedTransfers.sepay_777777.availableAfterVnd,10000);
 let b=applyPostingToWallet(a.wallet,ins);eq(b.ok,true);eq(b.duplicate,true);
 eq(b.wallet.availableVnd,10000);
 eq(applyPostingToWallet(a.wallet,{...ins,amountVnd:20000}).reason,'provider_transaction_conflict');
 const ins2={...ins,txId:'777778'};
 b=applyPostingToWallet(a.wallet,ins2);eq(b.ok,true);eq(b.wallet.availableVnd,20000);
 eq(Object.keys(b.wallet.postedTransfers).length,2);
 eq(applyPostingToWallet({...wallet,availableVnd:999999999},ins).reason,'balance_limit');
 eq(offlineSelfTest().passed,true);
 // The Admin route is read-only, never changes any Firebase path.
 const saved=Module._load;
 let reads=0,writes=0;
 const db={ref(path){if(path!==('wallet_accounts/UIDadminSynthetic12345'))throw Error('Unexpected path: '+path);
   return {once:async()=>{reads++;return{val:()=>({uid:'UIDadminSynthetic12345',
     status:'locked',availableVnd:0,heldVnd:0,paymentEnabled:false})}},
     transaction:()=>{writes++;throw Error('Financial write attempted')}}}};
 Module._load=function(name,parent,isMain){
   if(name==='../lib/secure-accounts'&&/[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
     return{identity:async(req,{adminOnly}={})=>{
       if(req.headers.authorization!=='Bearer admin')throw Object.assign(Error('Denied'),{status:401});
       return{db,uid:'UIDadminSynthetic12345',username:'adminkit',isAdmin:true};
     },checkOrigin:()=>{},configuredAdminUsername:()=> 'adminkit'};
   if(name==='../lib/shop-common'&&/[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
     return{jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message}),error:(x,status)=>Object.assign(Error(x),{status})};
   return saved.apply(this,arguments);
 };
 let api;try{api=require('../api/wallet');}finally{Module._load=saved;}
 process.env.MAIN_ADMIN_GOOGLE_UID='UIDadminSynthetic12345';
 async function run({method='GET',token='admin'}={}){
   const req={method,query:{action:'v60_offline_selftest'},headers:{authorization:'Bearer '+token}};
   let status=200,data;const res={setHeader(){},status(s){status=s;return this},json(x){data=x;return this}};
   await api(req,res);return{status,data};
 }
 let response=await run();eq(response.status,200);eq(response.data.readOnly,true);
 eq(response.data.syntheticCoreTestsPass,true);eq(response.data.productionWalletTouched,false);
 eq(response.data.automaticLiveCreditsEnabled,false);eq(response.data.walletStillLocked,true);
 eq(response.data.independentBankReconciliationConnected,false);eq(response.data.missingBeforeLive.length,6);
 response=await run({method:'POST'});eq(response.status,405);
 response=await run({token:'ordinary'});eq(response.status,401);
 eq(reads,1);eq(writes,0);
 console.log('V6.0 offline core PASS:',count,'checks. No bank, no Firebase writes.');
})().catch(err=>{console.error(err);process.exitCode=1});
