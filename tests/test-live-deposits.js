'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const live=require('../lib/deposit-live');
const Module=require('node:module');
const originalLoad=Module._load;
const clone=v=>v===undefined?null:structuredClone(v);
let data={},revision=0,checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
function ref(path,filter={}) {
  const parts=path.split('/');
  const read=()=>parts.reduce((value,key)=>value?.[key],data)??null;
  const write=value=>{let parent=data;for(const part of parts.slice(0,-1))parent=parent[part]||=( {} );parent[parts.at(-1)]=clone(value);revision++;};
  function snap(value){
    let result=clone(value);
    if(filter.child && filter.value!==undefined)result=Object.fromEntries(Object.entries(result||{}).filter(([,v])=>v[filter.child]===filter.value));
    return {val:()=>clone(result),exists:()=>result!==null};
  }
  return {
    once:async()=>snap(read()),
    orderByChild:child=>ref(path,{...filter,child}),
    equalTo:value=>ref(path,{...filter,value}),
    limitToLast:()=>ref(path,filter),
    async transaction(fn){
      // Yield before commit and retry on concurrent writes, like optimistic transactions.
      for(let attempt=0;attempt<30;attempt++){
        const version=revision;const result=fn(clone(read()));
        if(result===undefined)return {committed:false,snapshot:snap(read())};
        await Promise.resolve();
        if(version!==revision)continue;
        write(result);return {committed:true,snapshot:snap(result)};
      }
      throw Error('transaction retries exhausted');
    }
  };
}
const db={ref};
const uid='customer_alpha',other='customer_beta';
const env={LIVE_DEPOSITS_ALLOWED_UIDS:'*',LIVE_DEPOSITS_ENABLED:'true',SEPAY_LIVE_RECORDING_ENABLED:'true',
 MB_BANK_ACCOUNT_NUMBER:'123456789012',MB_BANK_ACCOUNT_NAME:'TEST ACCOUNT',
 SEPAY_READ_API_TOKEN:'test-token',SEPAY_LIVE_WEBHOOK_SECRET:'test-secret-32-characters-long-12345'};
Object.assign(process.env,env);
const response=()=>{let status=200,body;return {setHeader(){},status(n){status=n;return this},json(v){body=v;return this},get:()=>({status,body})};};
Module._load=function(name,parent){
 if(name==='../lib/secure-accounts'&&parent?.filename.endsWith('/api/wallet.js'))return {
   identity:async(req,{adminOnly=false}={})=>{
     const token=req.headers.authorization;
     if(!['Bearer customer','Bearer admin'].includes(token))throw Object.assign(Error('Unauthorized'),{status:401});
     if(adminOnly&&token!=='Bearer admin')throw Object.assign(Error('Forbidden'),{status:403});
     return {db,uid,username:'alice',isAdmin:token==='Bearer admin'};
   },checkOrigin:req=>{if(req.headers.origin==='https://evil.test')throw Object.assign(Error('Origin'),{status:403});},
   configuredAdminUsername:()=> 'adminkit'
 };
 if(name==='../lib/shop-common'&&/api\/(wallet|sepay-live-webhook)\.js$/.test(parent?.filename||''))return {
   firebase:()=>({database:()=>db}),error:(message,status)=>Object.assign(Error(message),{status}),
   jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message})
 };
 return originalLoad.apply(this,arguments);
};
const wallet=require('../api/wallet'),webhook=require('../api/sepay-live-webhook');
Module._load=originalLoad;
async function call(action,body,auth='Bearer customer',origin){
 const res=response();await wallet({method:body?'POST':'GET',query:{action},body,headers:{authorization:auth,origin}},res);return res.get();
}
const date=ms=>new Date(ms+7*3600000).toISOString().slice(0,19).replace('T',' ');
let records={};
global.fetch=async(url,options)=>{
 eq(options.headers.Authorization,'Bearer test-token');
 eq(options.redirect,'error');
 const id=url.split('/').at(-1);
 return {ok:true,json:async()=>({status:200,messages:{success:true},transaction:records[id],transactions:Object.values(records)})};
};
function record(id,intent,changes={}){
 return {id:String(id),bank_brand_name:'MBBank',account_number:env.MB_BANK_ACCOUNT_NUMBER,
 amount_in:String(intent.amountVnd)+'.00',amount_out:'0.00',
 transaction_content:intent.code,transaction_date:date(intent.createdAt+1000),reference_number:'REF'+id,...changes};
}
async function send(row,valid=true) {
 const body={id:Number(row.id),accountNumber:row.account_number,transferType:'in',
 transferAmount:Number(row.amount_in),content:row.transaction_content,gateway:'MBBank'};
 const raw=Buffer.from(JSON.stringify(body));const timestamp=String(Math.floor(Date.now()/1000));
 const signature='sha256='+crypto.createHmac('sha256',env.SEPAY_LIVE_WEBHOOK_SECRET).update(timestamp+'.').update(raw).digest('hex');
 const req={method:'POST',headers:{'x-sepay-timestamp':timestamp,'x-sepay-signature':valid?signature:'sha256='+'0'.repeat(64)},
 async *[Symbol.asyncIterator](){yield raw;}};
 const res=response();await webhook(req,res);return res.get();
}
(async()=>{
 eq((await call('live_deposit_create',{amountVnd:10000},'Bearer guest')).status,401);
 eq((await call('live_deposit_reconcile',{transactionId:'1'})).status,403);
 eq((await call('live_deposit_create',{amountVnd:10000},'Bearer customer','https://evil.test')).status,403);
 eq((await call('live_deposit_create',{amountVnd:999})).status,422);
 process.env.LIVE_DEPOSITS_ENABLED='false';
 eq((await call('live_deposit_create',{amountVnd:10000})).status,503);
 process.env.LIVE_DEPOSITS_ENABLED='true';
 const [a,b]=await Promise.all([call('live_deposit_create',{amountVnd:10000}),call('live_deposit_create',{amountVnd:10000})]);
 eq(a.status,200);eq(a.body.intent.code,b.body.intent.code);
 eq(Object.keys(data[live.ROOT].intents).length,1);
 eq(data[live.ROOT].accounts[uid].dailyCount,1);
 eq((await call('live_deposit_create',{amountVnd:20000})).status,409);
 const intent=data[live.ROOT].intents[a.body.intent.code];
 records['100']=record(100,intent);
 eq((await send(records['100'],false)).status,401);
 eq(data[live.ROOT].accounts[uid].availableVnd,0);
 const [first,second]=await Promise.all([send(records['100']),send(records['100'])]);
 eq(first.status,200);eq(second.status,200);
 eq(data[live.ROOT].accounts[uid].availableVnd,10000);
 eq(Object.keys(data[live.ROOT].ledger).length,1);
 eq(data[live.ROOT].intents[intent.code].status,'paid');
 eq((await call('live_deposit_status')).body.availableVnd,10000);
 records['101']=record(101,intent);
 eq((await send(records['101'])).body.status,'extra_transfer');
 eq(data[live.ROOT].accounts[uid].availableVnd,10000);
 records['100']={...records['100'],amount_in:'20000.00'};
 eq((await send(records['100'])).status,409);
 eq(data[live.ROOT].accounts[uid].availableVnd,10000);
 const beta=await live.createIntent(db,other,'bob',20000,env);
 const betaIntent=data[live.ROOT].intents[beta.code];
 records['102']=record(102,betaIntent,{amount_in:'10000.00'});
 eq((await send(records['102'])).body.status,'amount_mismatch');
 eq(data[live.ROOT].accounts[other].availableVnd,0);
 records['103']=record(103,betaIntent,{transaction_date:date(betaIntent.createdAt-1000)});
 eq((await send(records['103'])).body.status,'outside_window');
 records['104']=record(104,betaIntent);
 eq((await live.reconcileId(db,'104',env)).credited,true);
 eq(data[live.ROOT].accounts[other].availableVnd,20000);
 const customerStatus=(await call('live_deposit_status')).body;
 eq(customerStatus.intents.some(i=>i.code===beta.code),false);
 eq((await call('live_deposit_check',{code:beta.code})).status,404);
 eq((await call('live_deposit_queue',undefined,'Bearer customer')).status,403);
 eq((await call('live_deposit_queue',undefined,'Bearer admin')).status,200);
 await assert.rejects(()=>live.reconcileId(db,'999',env,async()=>{throw Error('network');}),/Chưa đọc/);
 eq(data[live.ROOT].accounts[uid].availableVnd,10000);
 const proof=live.normalize(record(200,betaIntent),env.MB_BANK_ACCOUNT_NUMBER);
 const before=clone(data[live.ROOT]);
 live.settleState(before,proof);eq(before,data[live.ROOT]);
 eq(live.extractCode('KP59D'+'A'.repeat(24)),null);
 eq(live.extractCode(intent.code+' '+beta.code),null);
 eq(data.users,undefined);eq(data.wallet_accounts,undefined);

 const next=await live.createIntent(db,uid,'alice',50000,env);
 const pending=data[live.ROOT].intents[next.code];
 records['300']=record(300,pending);
 const recovered=await call('live_deposit_check',{code:next.code});
 eq(recovered.status,200);
 eq(data[live.ROOT].accounts[uid].availableVnd,60000);
 eq((await call('live_deposit_check',{code:next.code})).status,429);
 Module._load=function(name,parent){
   if(name==='./shop-common'&&parent?.filename.endsWith('/lib/secure-accounts.js')){
     return {firebase:()=>({database:()=>db}),checkOrigin(){},error:(message,status)=>Object.assign(Error(message),{status})};
   }
   return originalLoad.apply(this,arguments);
 };
 const {dashboardData}=require('../lib/secure-accounts');
 Module._load=originalLoad;
 const dashboard=await dashboardData({db,uid,username:'alice',isAdmin:false,profile:{balance:999999999}});
 eq(dashboard.profile.balance,60000);
 eq(dashboard.profile.totalDeposited,60000);
 eq(dashboard.deposits.length,2);
 eq(dashboard.deposits.every(d=>d.user==='alice'),true);
 const newCustomer=await dashboardData({db,uid:'new_customer',username:'newuser',isAdmin:false,profile:{balance:999999}});
 eq(newCustomer.profile.balance,0);
 console.log('PASS live deposits '+checks+' assertions: authenticated routes, HMAC, API proof, concurrent retries, atomic balance/ledger, owner isolation, conflicts and legacy preservation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
