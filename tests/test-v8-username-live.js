'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');const original=Module._load;
Module._load=function(name,parent,main){if(name==='firebase-admin')return {apps:[]};return original.call(this,name,parent,main)};
const {signInLinkedUsername,GENERIC}=require('../lib/username-auth');
const {hasMainAdminGoogleAuth}=require('../lib/secure-accounts');
const {checkIntegrations,localSePay,probeCanBoSo,readProductionEvidence}=require('../lib/integration-health');
Module._load=original;
const uid='someFirebaseUid_98765';const username='kitcustomer';const email='user@example.test';
function snapshot(value){return {val:()=>value,exists:()=>value!=null};}
function fixture({linked=true,admin=false,accountUid=uid,provider='password'}={}){
  const values={['users/'+username]:{email,authUid:linked?uid:null},
    ['auth_bindings/'+uid]:{username},['auth_username_uids/'+username]:uid,
    'users/adminkit':{authUid:'admin_uid',email:'admin@example.test'}};
  const counts=new Map(), writes=[];
  const db={ref(path){return {
    async once(){return snapshot(values[path]??null)},
    async transaction(fn){const curr=counts.get(path)||null;const next=fn(curr);if(next===undefined)return {committed:false};counts.set(path,next);writes.push(path);return {committed:true,snapshot:snapshot(next)}}
  }}};
  const sdk={database:()=>db,auth:()=>({
    async getUser(id){return {uid:id,email:id==='admin_uid'?'admin@example.test':email,emailVerified:true,disabled:false}},
    async createCustomToken(id){return 'mock-custom-'+id},
    async verifyIdToken(){return {uid:admin?'admin_uid':uid,firebase:{sign_in_provider:provider}}}
  })};
  const req={headers:{host:'kitphanmmo.vercel.app',origin:'https://kitphanmmo.vercel.app',
    'x-forwarded-for':'203.0.113.10','sec-fetch-site':'same-origin'},
    body:{username:admin?'adminkit':username,password:'strong-firebase-password'}};
  const traffic={posts:0};
  const fetcher=async(_url,options)=>{traffic.posts++;const sent=JSON.parse(options.body);assert.equal(sent.email,email);assert.equal(sent.password,req.body.password);
    return {ok:true,json:async()=>({localId:accountUid,idToken:'signed-test-token'})}};
  return {sdk,db,req,fetcher,traffic,writes,counts,values};
}
async function testUsername(){
  const old=process.env.MAIN_ADMIN_GOOGLE_UID;
  process.env.MAIN_ADMIN_GOOGLE_UID='admin_uid';
  try{
    const f=fixture();const result=await signInLinkedUsername(f.req,{firebase:()=>f.sdk,fetcher:f.fetcher});
    assert.equal(result.customToken,'mock-custom-'+uid);assert.equal(f.traffic.posts,1);
    assert(!JSON.stringify(result).includes(email));assert(!JSON.stringify(result).includes(f.req.body.password));
    assert(f.writes.every(p=>p.startsWith('auth_login_attempts_v8/')));
    const unbound=fixture({linked:false});
    await assert.rejects(()=>signInLinkedUsername(unbound.req,{firebase:()=>unbound.sdk,fetcher:unbound.fetcher}),/khôi phục/);
    assert.equal(unbound.traffic.posts,0);
    const mismatched=fixture({accountUid:'attacker_uid'});
    await assert.rejects(()=>signInLinkedUsername(mismatched.req,{firebase:()=>mismatched.sdk,fetcher:mismatched.fetcher}),/khôi phục/);
    const adm=fixture({admin:true});
    await assert.rejects(()=>signInLinkedUsername(adm.req,{firebase:()=>adm.sdk,fetcher:adm.fetcher}),/Google/);
    assert.equal(adm.traffic.posts,0);
    const bad=fixture();bad.req.headers.origin='https://evil.example';
    await assert.rejects(()=>signInLinkedUsername(bad.req,{firebase:()=>bad.sdk,fetcher:bad.fetcher}),/origin/);
    assert.equal(bad.traffic.posts,0);
    const abused=fixture();
    for(let i=0;i<10;i++)await signInLinkedUsername(abused.req,{firebase:()=>abused.sdk,fetcher:abused.fetcher,now:1700000000000});
    await assert.rejects(()=>signInLinkedUsername(abused.req,{firebase:()=>abused.sdk,fetcher:abused.fetcher,now:1700000000000}),e=>e.status===429);
    assert.equal(abused.traffic.posts,10);
    const pwBad=fixture();
    await assert.rejects(()=>signInLinkedUsername(pwBad.req,{firebase:()=>pwBad.sdk,fetcher:async()=>({ok:false,json:async()=>({error:{message:'INVALID_PASSWORD'}})})}),e=>e.status===401&&e.message===GENERIC);
    assert(!JSON.stringify(pwBad.writes).includes('password'));
  }finally{if(old===undefined)delete process.env.MAIN_ADMIN_GOOGLE_UID;else process.env.MAIN_ADMIN_GOOGLE_UID=old;}
}
function testGoogleAdminOnly(){
  const prev=process.env.MAIN_ADMIN_GOOGLE_UID;process.env.MAIN_ADMIN_GOOGLE_UID='admin_uid';
  try{
    assert.equal(hasMainAdminGoogleAuth({uid:'admin_uid',token:{firebase:{sign_in_provider:'google.com'}}}),true);
    assert.equal(hasMainAdminGoogleAuth({uid:'admin_uid',token:{firebase:{sign_in_provider:'password'}}}),false);
    assert.equal(hasMainAdminGoogleAuth({uid:'admin_uid',token:{firebase:{sign_in_provider:'custom'}}}),false);
    assert.equal(hasMainAdminGoogleAuth({uid:'other',token:{firebase:{sign_in_provider:'google.com'}}}),false);
  }finally{if(prev===undefined)delete process.env.MAIN_ADMIN_GOOGLE_UID;else process.env.MAIN_ADMIN_GOOGLE_UID=prev;}
}
async function testHealth(){
  const env={MB_BANK_ACCOUNT_NUMBER:'1234567890',SEPAY_LIVE_WEBHOOK_SECRET:'0123456789abcdef0123456789abcdef',
    SEPAY_LIVE_RECORDING_ENABLED:'true',LIVE_DEPOSITS_ENABLED:'false',CANBOSO_API_KEY:'mock-key',
    SHOP_PURCHASES_ENABLED:'false',SHOP_WALLET_RULES_SECURED:'false',SHOP_SUPPLIER_PURCHASE_CONFIRMED:'false'};
  assert.equal(localSePay(env).localHmacSelfTest,true);
  const called=[];
  const report=await checkIntegrations({env,sepayChecker:async()=>({connected:true,transactionReadAccess:true,accountLast4:'7890'}),
    productCall:async fresh=>{assert(fresh);called.push('products');return [{id:'sku'}]},
    supplierCall:async url=>{called.push(url);assert(/\/(balance|orders)$/.test(url));return url.endsWith('/orders')?{orders:[]}: {balance:50000}}});
  assert.equal(report.ok,true);assert.equal(report.liveTransactionTested,false);assert.equal(report.actualCanBoSoPurchaseTested,false);
  assert.equal(report.flags.customerDeposits,false);
  assert(called.includes('/api/v2/telegram-buyer/orders'));assert(called.includes('/api/v2/telegram-buyer/balance'));
  assert(!called.some(v=>v.includes('/purchase')));
  const failed=await probeCanBoSo({env,supplierCall:async()=>{throw Object.assign(Error('API KEY SECRET'),{status:401})},productCall:async()=>[]});
  assert.equal(failed.buyerBalance.status,'failed');assert(!JSON.stringify(failed).includes('API KEY SECRET'));
  const evidence=await readProductionEvidence({ref(path){return {limitToLast(){return this},async once(){return snapshot(path.includes('wallet_live')?{a:{provider:'sepay_live',createdAt:100}}:{b:{verificationSource:'sepay_read_api_v1',status:'credited',credited:true,recordedAt:110}})}}}});
  assert.equal(evidence.last25SignedWebhookEvents,1);
  assert.equal(evidence.last25ReadApiReconciledEvents,1);
  assert.equal(evidence.last25VerifiedCreditEvents,1);
  const unconfigured=await probeCanBoSo({env:{},supplierCall:async()=>{throw Error('Should not call')}});
  assert.equal(unconfigured.configured,false);
}
(async()=>{await testUsername();testGoogleAdminOnly();await testHealth();console.log('PASS V8 username Firebase login, rate limits, provider failures, read-only integration probes');})().catch(e=>{console.error(e);process.exitCode=1});
