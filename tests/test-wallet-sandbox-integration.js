'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Module=require('node:module');
const path=require('node:path');
const realLoad=Module._load;
let assertions=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);assertions++};
const uid='9UZ3fvz2yeawGr964zKvS9qfANh2';
const storage={users:{adminkit:{balance:97300000}},wallet_test:{adminkit:{classification:'simulation_only',spendableInLive:false,legacyBalanceVnd:97300000}},wallet_accounts:{[uid]:{uid,status:'locked',availableVnd:0,heldVnd:0,paymentEnabled:false}}};
const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
function resolveKey(key,create=false){const parts=key.split('/').filter(Boolean);let n=storage;for(const k of parts.slice(0,-1)){if(create&&!n[k])n[k]={};n=n?.[k];}return [n,parts.at(-1)];}
function ref(key){return{
  once:async()=>{const [obj,k]=resolveKey(key);const v=clone(obj?.[k]);return{val:()=>v??null,exists:()=>v!==undefined&&v!==null}},
  transaction:async fn=>{const [obj,k]=resolveKey(key,true);const old=clone(obj?.[k])??null;const val=fn(old);if(val===undefined)return{committed:false,snapshot:{val:()=>old}};obj[k]=clone(val);return{committed:true,snapshot:{val:()=>clone(val)}}},
  update:async patch=>{const [obj,k]=resolveKey(key,true);obj[k]={...(obj[k]||{}),...clone(patch)}},
  limitToLast:()=>ref(key)
}}
const db={ref};
const err=(message,status)=>Object.assign(Error(message),{status});
const mockShopCommon={error:err,jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message})};
const mockIdentity=async(req,{adminOnly}={})=>{
  if(req.headers.authorization!=='Bearer admin')throw err('Not authorized',403);
  return{uid,username:'adminkit',isAdmin:true,db,record:storage.users.adminkit};
};
const mockAdmin={apps:[{}],database:()=>db};
mockAdmin.database.ServerValue={TIMESTAMP:987};
Module._load=function(request,parent,isMain){
  if(request==='firebase-admin')return mockAdmin;
  if(request==='../lib/secure-accounts'&&parent?.filename.endsWith('/api/wallet.js'))return{identity:mockIdentity,checkOrigin:()=>{},configuredAdminUsername:()=> 'adminkit'};
  if(request==='../lib/shop-common'&&parent?.filename.endsWith('/api/wallet.js'))return mockShopCommon;
  return realLoad.apply(this,arguments);
};
const wallet=require('../api/wallet');
const webhook=require('../api/sepay-webhook');
Module._load=realLoad;
const makeRes=()=>{let status=200,body;const res={setHeader(){},status(n){status=n;return this},json(x){body=x;return this}};return{res,get:()=>({status,body})}};
async function walletCall(action,{method='GET',body={},auth='Bearer admin'}={}){const r=makeRes();await wallet({method,headers:{authorization:auth},body,query:{action}},r.res);return r.get()}
async function webhookCall(data,{sign=true}={}){
 const raw=Buffer.from(JSON.stringify(data));const timestamp=String(Math.floor(Date.now()/1000));
 const signature='sha256='+crypto.createHmac('sha256',process.env.SEPAY_WEBHOOK_SECRET).update(timestamp+'.').update(raw).digest('hex');
 const req={method:'POST',headers:{'x-sepay-signature':sign?signature:'sha256='+'0'.repeat(64),'x-sepay-timestamp':timestamp},async *[Symbol.asyncIterator](){yield raw}};
 const r=makeRes();await webhook(req,r.res);return r.get();
}
(async()=>{
 process.env.WALLET_SANDBOX_ENABLED='true';
 process.env.SEPAY_WEBHOOK_SECRET='test_secret_32_characters_long_XXXX';
 process.env.SEPAY_RECEIVING_ACCOUNT_NUMBER='0000000001';
 process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER='0000000001';
 const denied=await walletCall('sandbox_prepare',{method:'POST',body:{amountVnd:10000,confirmSimulationOnly:true},auth:'Bearer stranger'});
 eq(denied.status,403,'non-admin denied');
 const prepare=await walletCall('sandbox_prepare',{method:'POST',body:{amountVnd:10000,confirmSimulationOnly:true}});
 eq(prepare.status,200);eq(prepare.body.sandboxOnly,true);eq(prepare.body.creditedRealWallet,false);
 const same=await walletCall('sandbox_prepare',{method:'POST',body:{amountVnd:10000,confirmSimulationOnly:true}});
 eq(same.body.expectedCode,prepare.body.expectedCode,'one outstanding code');
 let payload={id:81001,transferType:'in',transferAmount:10000,content:prepare.body.transferContent,
   accountNumber:'0000000001',gateway:'VPBank',referenceCode:'TEST-V5.2.3',transactionDate:'2026-11-06 12:00:00'};
 const bad=await webhookCall(payload,{sign:false});eq(bad.status,401);
 eq(storage.wallet_sandbox_accounts,undefined,'invalid HMAC does not create sandbox wallet');
 const other=await webhookCall({...payload,id:81002,accountNumber:'9999999999'});eq(other.body.ignored,true);
 const first=await webhookCall(payload);eq(first.status,200);eq(first.body.recorded,true);eq(first.body.sandboxCredited,true);
 eq(storage.wallet_sandbox_accounts[uid].availableVnd,10000);eq(Object.keys(storage.wallet_sandbox_accounts[uid].ledger).length,1);
 eq(storage.wallet_accounts[uid].availableVnd,0,'real money untouched');eq(storage.users.adminkit.balance,97300000,'legacy money untouched');
 eq(storage.payment_webhook_events.sepay_81001.credited,false,'event never considered live credited');
 const replay=await webhookCall(payload);eq(replay.status,200);eq(replay.body.duplicate,true);
 eq(storage.wallet_sandbox_accounts[uid].availableVnd,10000,'no double credit');
 const newTxSameIntent=await webhookCall({...payload,id:81003});eq(newTxSameIntent.body.sandbox,'expired_or_closed');
 eq(storage.wallet_sandbox_accounts[uid].availableVnd,10000,'one intent only one sandbox credit');
 const report=await walletCall('sandbox_status');eq(report.body.sandboxBalanceVnd,10000);eq(report.body.realWallet.availableVnd,0);
 console.log(assertions+' sandbox API + signed SePay webhook integration assertions passed (in-memory only)');
})().catch(e=>{console.error(e);process.exitCode=1});
