'use strict';
/** All in memory: no API keys, no Firebase and no provider POST. */
const assert=require('node:assert/strict');
const Module=require('node:module'),native=Module._load;
Module._load=function(name,parent,main){if(name==='firebase-admin')return {apps:[]};return native.call(this,name,parent,main)};
const common=require('../lib/shop-common');const secure=require('../lib/secure-accounts');
Module._load=native;
const supplierCalls=[];
common.products=async fresh=>{supplierCalls.push('GET products');return [{id:'sku_test_1',name:'Digital demo product',available:true,costVnd:10000,price:30000}];};
common.callSupplier=async(path,opt)=>{
 supplierCalls.push((opt?.method||'GET')+' '+path);
 if(path.endsWith('/balance'))return {success:true,balance:200000};
 if(path.endsWith('/orders'))return {success:true,orders:[]};
 if(path.endsWith('/purchase')){
  assert.equal(opt.body.product_id,'sku_test_1');assert.equal(opt.body.quantity,1);
  assert.match(opt.idempotencyKey,/^ord_[a-f0-9]+$/,'checkout must use a stable supplier idempotency key');
  return {success:true,status:'completed',data:{delivery:{account:'demo@example.test',password:'demo-credential'}}};
 }
 throw Error('Unexpected mocked path '+path);
};
const adminUid='adminGoogleUid_1234',customerUid='customerFirebaseUid_1234';
const envKeys=['MAIN_ADMIN_GOOGLE_UID','CANBOSO_API_KEY','FIREBASE_SERVICE_ACCOUNT_JSON','SHOP_PURCHASES_ENABLED','SHOP_WALLET_RULES_SECURED','SHOP_SUPPLIER_PURCHASE_CONFIRMED','SHOP_PURCHASE_ALLOWED_UIDS','SHOP_HARD_DISABLE'];
const saved=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
Object.assign(process.env,{MAIN_ADMIN_GOOGLE_UID:adminUid,CANBOSO_API_KEY:'fake-test-key',FIREBASE_SERVICE_ACCOUNT_JSON:'test-only',
 SHOP_PURCHASES_ENABLED:'false',SHOP_WALLET_RULES_SECURED:'false',SHOP_SUPPLIER_PURCHASE_CONFIRMED:'false',SHOP_PURCHASE_ALLOWED_UIDS:adminUid,SHOP_HARD_DISABLE:'false'});
function snapshot(v){return {val:()=>v,exists:()=>v!==undefined&&v!==null};}
function makeDb(){
 const data={'live_deposits_v1':{accounts:{
  [adminUid]:{uid:adminUid,username:'adminkit',availableVnd:100000,heldVnd:0,totalDepositedVnd:100000},
  [customerUid]:{uid:customerUid,username:'customer123',availableVnd:60000,heldVnd:0,totalDepositedVnd:60000}
 }}};
 const get=path=>path.split('/').reduce((v,k)=>v?.[k],data);
 const set=(path,value)=>{const keys=path.split('/'),last=keys.pop();let v=data;for(const k of keys)v=v[k]||=( {} );v[last]=value};
 return {data,get,ref(path){const state={path,column:null,equals:null,limit:null};return {
   orderByChild(col){state.column=col;return this},equalTo(v){state.equals=v;return this},limitToLast(n){state.limit=n;return this},
   async once(){let result=get(path);if(state.column&&result&&typeof result==='object'){
    result=Object.fromEntries(Object.entries(result).filter(([,v])=>v?.[state.column]===state.equals).slice(-Number(state.limit||1e6)));
   }return snapshot(structuredClone(result??null));},
   async transaction(fn){
    const current=get(path)??null;
    if(path==='shop_checkout_control_v2'&&current?.mode==='pilot'){
     // Firebase sometimes invokes the updater with local null before reading
     // remote pilot. An undefined return would abort without server retry.
     const coldProposal=fn(null);
     if(coldProposal===undefined)return {committed:false,snapshot:snapshot(current)};
    }
    const updated=fn(structuredClone(current));
    if(updated===undefined)return {committed:false,snapshot:snapshot(current)};
    set(path,updated);return {committed:true,snapshot:snapshot(structuredClone(updated))};
   }
 }}};
}
const db=makeDb();
secure.identity=async(req,opts={})=>{
 if(!req.ctx)throw Object.assign(Error('Sign in required'),{status:401});
 if(opts.adminOnly&&!req.ctx.isAdmin)throw Object.assign(Error('Admin only'),{status:403});
 return {...req.ctx,db};
};
const settings=require('../api/shop-settings');
const checkout=require('../api/shop-checkout');
const {access}=require('../lib/shop-access');
const admin={uid:adminUid,username:'adminkit',isAdmin:true};const customer={uid:customerUid,username:'customer123',isAdmin:false};
const reply=()=>({statusCode:200,body:null,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(body){this.body=body;return this}});
async function call(fn,ctx,method,body={},query={}){const res=reply();await fn({ctx,method,body,query,headers:{host:'localhost:3000',origin:'http://localhost:3000'}},res);return res;}
async function test(){
 try{
  assert.equal((await access(db,customerUid)).enabled,false);
  assert.equal((await call(settings,customer,'POST',{action:'pilot'})).statusCode,403);
  assert.equal((await call(settings,admin,'POST',{action:'pilot',confirmRealWallet:true,confirmSupplierFunds:true})).statusCode,200);
  assert.equal((await access(db,customerUid)).enabled,false);
  assert.equal((await access(db,adminUid)).enabled,true);
  assert.equal((await call(checkout,customer,'POST',{productId:'sku_test_1',quotedPriceVnd:30000,requestId:'request_987654321000'})).statusCode,423);
  let res=await call(checkout,admin,'POST',{productId:'sku_test_1',quotedPriceVnd:30000,requestId:'request_987654321001'});
  assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(res.body.status,'delivered');
  assert.match(res.body.delivery,/demo-credential/);
  const pilotId=res.body.id;
  assert.equal(db.get('live_deposits_v1/accounts/'+adminUid+'/availableVnd'),70000);
  assert.equal(db.get('live_deposits_v1/accounts/'+adminUid+'/heldVnd'),0);
  assert.equal(db.get('live_deposits_v1/moneyJournal/settle_'+pilotId+'/source'),'supplier_delivered');
  res=await call(settings,admin,'POST',{action:'public',orderId:pilotId,confirmText:'MO BAN'});
  assert.equal(res.statusCode,422);
  res=await call(settings,admin,'POST',{action:'public',orderId:pilotId,confirmSupplierOrderChecked:true,confirmWalletLedgerChecked:true,confirmCustomerSupportReady:true,confirmText:'MO BAN'});
  assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(res.body.mode,'public');
  assert.equal((await access(db,customerUid)).enabled,true);
  const wrongQuote=await call(checkout,customer,'POST',{productId:'sku_test_1',quotedPriceVnd:29900,requestId:'request_wrong_quote_123456'});
  assert.equal(wrongQuote.statusCode,409);
  assert.equal(db.get('live_deposits_v1/accounts/'+customerUid+'/availableVnd'),60000);
  const before=supplierCalls.filter(s=>s.includes('POST')).length;
  res=await call(checkout,customer,'POST',{productId:'sku_test_1',quotedPriceVnd:30000,requestId:'request_987654321002'});
  assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(res.body.status,'delivered');
  assert.equal(db.get('live_deposits_v1/accounts/'+customerUid+'/availableVnd'),30000);
  assert.equal(db.get('live_deposits_v1/accounts/'+customerUid+'/heldVnd'),0);
  assert.equal(supplierCalls.filter(s=>s.includes('POST')).length,before+1);
  res=await call(checkout,customer,'POST',{productId:'sku_test_1',quotedPriceVnd:30000,requestId:'request_987654321002'});
  assert.equal(res.statusCode,200);assert.equal(supplierCalls.filter(s=>s.includes('POST')).length,before+1,'idempotent order, no duplicate supplier POST');
  assert.equal((await call(settings,admin,'POST',{action:'pause'})).statusCode,200);
  assert.equal((await access(db,customerUid)).enabled,false);
  process.env.SHOP_HARD_DISABLE='true';assert.equal((await access(db,adminUid)).enabled,false);
  assert.equal((await call(settings,admin,'POST',{action:'pilot',confirmRealWallet:true,confirmSupplierFunds:true})).statusCode,423);
  assert.equal(supplierCalls.filter(s=>s.includes('POST')).length,2);
  console.log('PASS V8.2: Admin-only controls, pilot buy, journal proof, public customer checkout, delivery, replay, pause and hard kill switch');
 }finally{for(const k of envKeys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
}
test().catch(e=>{console.error(e);process.exitCode=1});
