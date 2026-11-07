'use strict';
/** End-to-end API tests against isolated in-memory Firebase mock. No network/bank. */
const assert=require('node:assert/strict');
const Module=require('node:module');
const {validDraft,goodAmount,publicDraft,readOwner,readAdminQueue,createDraft,TTL_MS}=require('../lib/wallet-v59');
const {GENESIS}=require('../lib/wallet-v58');
const uidA='UIDaliceVerified12345';
const uidB='UIDbobVerified123456';
const adminUid='UIDadminVerified12345';
const data={users:{alice:{balance:985000,authUid:uidA},bob:{balance:0,authUid:uidB}},wallet_accounts:{},wallet_ledger:{}};
const writes=[];
const copy=o=>o===undefined?undefined:JSON.parse(JSON.stringify(o));
function get(path){return path.split('/').reduce((o,k)=>o?.[k],data)}
function put(path,value){writes.push(path);const parts=path.split('/');let p=data;for(const k of parts.slice(0,-1)){p[k]??={};p=p[k];}p[parts.at(-1)]=copy(value)}
let breakHistory=false;
const db={ref(path){return{
  once:async()=>{const val=copy(get(path));return{val:()=>val??null,exists:()=>val!==undefined&&val!==null}},
  transaction:async fn=>{if(breakHistory && path.startsWith('wallet_deposit_v59_history/'))throw Object.assign(new Error('Storage unavailable'),{status:503});
    const before=copy(get(path))??null;const after=fn(before);
    if(after===undefined)return{committed:false,snapshot:{val:()=>before}};
    put(path,after);return{committed:true,snapshot:{val:()=>copy(after)}}},
  limitToLast(n){if(!Number.isInteger(n)||n<1)throw Error('invalid limit');return this}
}}};
const bad=(msg,status=500)=>Object.assign(new Error(msg),{status});
const oldLoad=Module._load;
Module._load=function(name,parent,isMain){
  if(name==='../lib/shop-common'&&/[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
    return {error:bad,jsonError:(r,e)=>r.status(e.status||500).json({ok:false,error:e.message})};
  if(name==='../lib/secure-accounts'&&/[\\/]api[\\/]wallet\.js$/.test(parent?.filename||''))
    return{identity:async(req,{adminOnly}={})=>{
      const a=req.headers?.authorization;
      if(!a)throw bad('Need login',401);
      if(adminOnly && a!=='Bearer admin')throw bad('Admin only',403);
      if(a==='Bearer admin')return{uid:adminUid,username:'adminkit',isAdmin:true,db,profile:{balance:0}};
      if(a==='Bearer alice')return{uid:uidA,username:'alice',isAdmin:false,db,profile:{balance:985000}};
      if(a==='Bearer bob')return{uid:uidB,username:'bob',isAdmin:false,db,profile:{balance:0}};
      throw bad('Bad login',401);
    },checkOrigin:()=>{},configuredAdminUsername:()=> 'adminkit'};
  return oldLoad.apply(this,arguments);
};
const handler=require('../api/wallet');Module._load=oldLoad;
async function api(action,{method='GET',user='alice',body={}}={}){
  const req={method,query:{action},headers:user?{authorization:'Bearer '+user}:{},body};
  let code=200,result;
  const res={setHeader(){},status(v){code=v;return this},json(v){result=v;return this}};
  await handler(req,res);return{code,result};
}
let assertions=0;
function eq(a,b,msg){assert.deepEqual(a,b,msg);assertions++;}
function yes(x,msg){assert(x,msg);assertions++;}
function setupWallet(uid,username){
  const now=Date.now();
  put('wallet_accounts/'+uid,{uid,username,currency:'VND',availableVnd:0,heldVnd:0,
    status:'locked',version:1,source:'customer_zero_initialization_v58',legacyFundsImported:false,
    paymentEnabled:false,createdAt:now});
  put('wallet_ledger/'+uid+'/'+GENESIS,{id:GENESIS,uid,type:'bootstrap_customer_zero_locked',
    deltaVnd:0,availableAfterVnd:0,heldAfterVnd:0,status:'non_financial',createdAt:now});
}
const body={amountVnd:10000,confirmNoBankTransfer:true,confirmNoCredits:true};
(async()=>{
  for(const k of ['ACCOUNT_WALLET_RECONCILED','ACCOUNT_ADMIN_WALLET_ENABLED','SHOP_PURCHASES_ENABLED',
    'SHOP_WALLET_RULES_SECURED','SHOP_SUPPLIER_PURCHASE_CONFIRMED','WALLET_SANDBOX_ENABLED',
    'SEPAY_LIVE_RECORDING_ENABLED','V55_ADMIN_QR_PREVIEW_ENABLED'])process.env[k]='false';
  process.env.MAIN_ADMIN_GOOGLE_UID=adminUid;
  eq(goodAmount(10000),true);eq(goodAmount(10000.4),false);eq(goodAmount('10000'),false);
  eq((await api('v59_draft_create',{method:'GET'})).code,405);
  eq((await api('v59_draft_create',{method:'POST',user:null,body})).code,401);
  eq((await api('v59_draft_create',{method:'POST',user:'admin',body})).code,403);
  eq((await api('v59_draft_create',{method:'POST',body:{...body,confirmNoCredits:false}})).code,422);
  eq((await api('v59_draft_create',{method:'POST',body})).code,409); // no V5.8 wallet
  eq(Object.keys(data.wallet_deposit_v59_active||{}).length,0);
  setupWallet(uidA,'alice');setupWallet(uidB,'bob');
  const initialWallet=copy(data.wallet_accounts);
  const initialLedger=copy(data.wallet_ledger);
  const initialLegacy=copy(data.users);
  const count0=writes.length;
  let r=await api('v59_draft_create',{method:'POST',body});
  eq(r.code,201);eq(r.result.created,true);eq(r.result.liveDepositsOpen,false);
  const draft=r.result.draft;
  eq(draft.amountVnd,10000);eq(draft.payable,false);eq(draft.bankVerified,false);
  eq(draft.credited,false);eq(draft.qrAvailable,false);eq(draft.transferContentAvailable,false);
  eq(draft.notForBankTransfer,true);yes(/^KP59D[A-F0-9]{24}$/.test(draft.draftReference));
  yes(!JSON.stringify(r.result).includes('accountNumber'));
  const current=get('wallet_deposit_v59_active/'+uidA);
  yes(validDraft(current));eq(current.uid,uidA);eq(current.username,'alice');
  eq(current.expiresAt-current.createdAt,TTL_MS);
  eq(get('wallet_deposit_v59_codes/'+current.code).payable,false);
  eq(get('wallet_deposit_v59_history/'+uidA+'/'+current.historyKey).id,current.id);
  eq(get('wallet_deposit_v59_admin_queue/'+current.historyKey).uid,uidA);
  yes(writes.slice(count0).every(x=>!x.startsWith('wallet_accounts/')&&
    !x.startsWith('wallet_ledger/')&&!x.startsWith('users/')&&
    !x.startsWith('wallet_live_payment_events/')&&!x.startsWith('deposits/')));
  eq(data.wallet_accounts,initialWallet);eq(data.wallet_ledger,initialLedger);eq(data.users,initialLegacy);
  r=await api('v59_draft_create',{method:'POST',body});eq(r.code,200);eq(r.result.duplicate,true);
  eq(r.result.draft.draftReference,draft.draftReference);
  r=await api('v59_draft_create',{method:'POST',body:{...body,amountVnd:20000}});eq(r.code,409);
  r=await api('v59_draft_status');eq(r.code,200);eq(r.result.activeDraft.draftReference,draft.draftReference);
  eq(r.result.recentDrafts.length,1);eq(r.result.liveDepositsOpen,false);
  r=await api('v59_draft_status',{user:'bob'});eq(r.result.activeDraft,null);eq(r.result.recentDrafts.length,0);
  r=await api('v59_draft_create',{method:'POST',user:'bob',body});eq(r.code,201);
  eq(r.result.draft.amountVnd,10000);yes(r.result.draft.draftReference!==draft.draftReference);
  r=await api('v59_draft_admin_queue',{user:'alice'});eq(r.code,403);
  r=await api('v59_draft_admin_queue',{user:'admin'});eq(r.code,200);
  eq(r.result.readOnly,true);eq(r.result.recentDrafts.length,2);
  yes(r.result.recentDrafts.some(x=>x.username==='alice'));
  // Fail closed on altered wallet or missing genesis and changes in config.
  data.wallet_accounts[uidA].availableVnd=999;
  r=await api('v59_draft_create',{method:'POST',body});eq(r.code,409);
  data.wallet_accounts[uidA]=copy(initialWallet[uidA]);
  delete data.wallet_ledger[uidA][GENESIS];
  r=await api('v59_draft_create',{method:'POST',body});eq(r.code,409);
  data.wallet_ledger[uidA][GENESIS]=copy(initialLedger[uidA][GENESIS]);
  process.env.SEPAY_LIVE_RECORDING_ENABLED='true';
  r=await api('v59_draft_create',{method:'POST',body});eq(r.code,503);
  process.env.SEPAY_LIVE_RECORDING_ENABLED='false';
  process.env.V55_ADMIN_QR_PREVIEW_ENABLED='true';
  r=await api('v59_draft_create',{method:'POST',body});eq(r.code,503);
  process.env.V55_ADMIN_QR_PREVIEW_ENABLED='false';
  // When history write fails, next request with identical amount repairs nonfinancial log.
  const rec=get('wallet_deposit_v59_active/'+uidA);
  delete data.wallet_deposit_v59_history[uidA][rec.historyKey];
  breakHistory=true;
  r=await api('v59_draft_create',{method:'POST',body});eq(r.code,503);
  breakHistory=false;
  r=await api('v59_draft_create',{method:'POST',body});eq(r.code,200);
  eq(get('wallet_deposit_v59_history/'+uidA+'/'+rec.historyKey).id,rec.id);
  // An expired draft is not payable and can be replaced by a fresh nonfinancial draft.
  const old=get('wallet_deposit_v59_active/'+uidA);
  old.createdAt=Date.now()-TTL_MS-1234;
  old.expiresAt=old.createdAt+TTL_MS;
  old.historyKey=String(old.createdAt).padStart(13,'0')+'_'+old.id;
  put('wallet_deposit_v59_active/'+uidA,old);
  eq(publicDraft(old).status,'expired_draft');
  r=await api('v59_draft_create',{method:'POST',body});eq(r.code,201);
  yes(r.result.draft.draftReference!==draft.draftReference);
  // A broken active draft must not be silently replaced.
  data.wallet_deposit_v59_active[uidA].status='paid';
  r=await api('v59_draft_create',{method:'POST',body});eq(r.code,409);
  eq(data.wallet_accounts,initialWallet);
  eq(data.wallet_ledger,initialLedger);
  eq(data.users,initialLegacy);
  // No GET endpoint allows modifying draft state.
  eq((await api('v59_draft_status',{method:'POST',body})).code,405);
  eq((await api('v59_draft_admin_queue',{method:'POST',user:'admin',body})).code,405);
  yes(Object.keys(data.wallet_deposit_v59_admin_queue).length>=2);
  console.log('V5.9 tests PASS:',assertions,'checks, no real wallet or bank mutation');
})().catch(e=>{console.error(e);process.exitCode=1});
