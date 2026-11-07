'use strict';
// Tests the real API against a local in-memory Firebase mock. No network/bank/data access.
const assert=require('node:assert/strict');
const Module=require('node:module');
const {validCustomerLocked,validGenesis,initializeCustomerZeroWallet,GENESIS}=require('../lib/wallet-v58');
const store={users:{alice:{balance:777777}},wallet_accounts:{},wallet_ledger:{}};
const writes=[];
const uidA='UIDaliceVerified12345';
const uidB='UIDbobVerified123456';
const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function at(path){return path.split('/').reduce((a,key)=>a?.[key],store)}
function write(path,val){writes.push(path);let o=store;const ks=path.split('/');for(const k of ks.slice(0,-1)){o[k]??={};o=o[k]};o[ks.at(-1)]=copy(val)}
let failLedger=false;
const db={ref(path){return{
  async once(){const v=copy(at(path));return{val:()=>v??null,exists:()=>v!==undefined&&v!==null}},
  async transaction(fn){if(failLedger && path.startsWith('wallet_ledger/'))throw Error('simulated ledger outage');
    const before=copy(at(path))??null;const next=fn(before);
    if(next===undefined)return{committed:false,snapshot:{val:()=>before}};
    write(path,next);return{committed:true,snapshot:{val:()=>copy(next)}}},
  limitToLast(){return this}
}}};
const raise=(message,status=500)=>Object.assign(new Error(message),{status});
const original=Module._load;
Module._load=function(name,parent,isMain){
  if(name==='../lib/shop-common' && /[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
    return{error:raise,jsonError:(r,e)=>r.status(e.status||500).json({ok:false,error:e.message})};
  if(name==='../lib/secure-accounts' && /[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
    return{identity:async(req,{adminOnly}={})=>{
      const who=req.headers?.authorization;
      if(!who)throw raise('Login required',401);
      if(adminOnly&&who!=='Bearer admin')throw raise('No admin',403);
      if(who==='Bearer admin')return{uid:'UIDadmin00000',username:'adminkit',isAdmin:true,db,profile:{balance:0}};
      if(who==='Bearer alice')return{uid:uidA,username:'alice',isAdmin:false,db,profile:{balance:777777}};
      if(who==='Bearer bob')return{uid:uidB,username:'bob',isAdmin:false,db,profile:{balance:0}};
      throw raise('Invalid token',401);
    },checkOrigin:()=>{},configuredAdminUsername:()=> 'adminkit'};
  return original.apply(this,arguments);
};
const handler=require('../api/wallet');Module._load=original;
function request(action,{method='POST',authorization='Bearer alice',body={}}={}){
  const r={method,query:{action},headers:authorization?{authorization}:{},body};
  let code=200,result;
  const res={setHeader(){},status(v){code=v;return this},json(v){result=v;return this}};
  return handler(r,res).then(()=>({code,result}));
}
let checks=0;
function eq(a,b,msg){assert.deepEqual(a,b,msg);checks++}
function yes(b,msg){assert(b,msg);checks++}
(async()=>{
  for(const key of ['ACCOUNT_WALLET_RECONCILED','SHOP_PURCHASES_ENABLED','SEPAY_LIVE_RECORDING_ENABLED','WALLET_SANDBOX_ENABLED'])process.env[key]='false';
  const body={confirmZeroLocked:true,confirmNoLegacyImport:true,confirmNoPayments:true};
  eq((await request('v58_customer_wallet_init',{method:'GET'})).code,405);
  eq((await request('v58_customer_wallet_init',{authorization:null,body})).code,401);
  eq((await request('v58_customer_wallet_init',{authorization:'Bearer admin',body})).code,403);
  eq((await request('v58_customer_wallet_init',{body:{...body,confirmNoLegacyImport:false}})).code,422);
  eq(Object.keys(store.wallet_accounts).length,0);
  let r=await request('v58_customer_wallet_init',{body});
  eq(r.code,201);eq(r.result.created,true);eq(r.result.paymentEnabled,false);
  let a=at('wallet_accounts/'+uidA),gen=at('wallet_ledger/'+uidA+'/'+GENESIS);
  yes(validCustomerLocked(a,uidA,'alice'));yes(validGenesis(gen,uidA));
  eq(a.availableVnd,0);eq(a.heldVnd,0);eq(a.legacyFundsImported,false);
  eq(gen.deltaVnd,0);eq(at('users/alice/balance'),777777);
  const first=copy(a);r=await request('v58_customer_wallet_init',{body});
  eq(r.code,200);eq(r.result.duplicate,true);eq(at('wallet_accounts/'+uidA),first);
  r=await request('status',{method:'GET'});
  eq(r.code,200);eq(r.result.walletAccount.ledgerInitialized,true);
  eq(r.result.walletAccount.availableVnd,0);eq(r.result.verifiedSpendableBalanceVnd,null);
  // A mismatched existing wallet must never be overwritten (even if it's funded).
  store.wallet_accounts[uidA]={...first,availableVnd:5000,status:'active'};
  r=await request('v58_customer_wallet_init',{body});eq(r.code,409);
  eq(at('wallet_accounts/'+uidA+'/availableVnd'),5000);
  store.wallet_accounts[uidA]=copy(first);
  // If genesis step fails, a repeat can recover WITHOUT recreating the wallet.
  delete store.wallet_ledger[uidA][GENESIS];failLedger=true;
  r=await request('v58_customer_wallet_init',{body});eq(r.code,500);
  eq(at('wallet_accounts/'+uidA),first);failLedger=false;
  r=await request('v58_customer_wallet_init',{body});eq(r.code,200);
  yes(validGenesis(at('wallet_ledger/'+uidA+'/'+GENESIS),uidA));
  // Another verified customer's wallet is independently scoped.
  r=await request('v58_customer_wallet_init',{authorization:'Bearer bob',body});
  eq(r.code,201);yes(validCustomerLocked(at('wallet_accounts/'+uidB),uidB,'bob'));
  eq(at('wallet_accounts/'+uidA).username,'alice');
  // Financial feature flags always fail closed.
  for(const key of ['ACCOUNT_WALLET_RECONCILED','SHOP_PURCHASES_ENABLED','SEPAY_LIVE_RECORDING_ENABLED','WALLET_SANDBOX_ENABLED']){
    process.env[key]='true';r=await request('v58_customer_wallet_init',{body});eq(r.code,503);process.env[key]='false';
  }
  eq(await initializeCustomerZeroWallet(db,'bad!', 'alice').then(()=>0,e=>e.status),403);
  yes(writes.every(s=>s.startsWith('wallet_accounts/')||s.startsWith('wallet_ledger/')),'never write legacy or transactions');
  eq(at('wallet_live_payment_events'),undefined);eq(at('wallet_sandbox_accounts'),undefined);
  eq(at('users/alice/balance'),777777);
  console.log('PASS V5.8 verified customer wallet bootstrap: '+checks+' assertions; only zero-amount locked wallets/ledger, no money mutation');
})().catch(e=>{console.error(e);process.exitCode=1});
