'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const loader=Module._load;
Module._load=function(request,parent,main){if(request==='firebase-admin')return {apps:[]};return loader.call(this,request,parent,main)};
const {createAccount}=require('../lib/secure-accounts');
const {signInLinkedUsername}=require('../lib/username-auth');
Module._load=loader;
const clone=v=>v===undefined?undefined:structuredClone(v);
function mockStore(state={}){
  const get=p=>p.split('/').reduce((v,k)=>v?.[k],state);
  const put=(p,val)=>{let node=state,parts=p.split('/');for(const k of parts.slice(0,-1)){if(!node[k])node[k]={};node=node[k]};if(val===null)delete node[parts.at(-1)];else node[parts.at(-1)]=clone(val)};
  const snap=v=>({val:()=>clone(v),exists:()=>v!==undefined&&v!==null});
  const db={ref:path=>({
    once:async()=>snap(get(path)),
    set:async v=>put(path,v),
    transaction:async fn=>{let before=get(path)??null;const after=fn(clone(before));if(after===undefined)return {committed:false,snapshot:snap(before)};put(path,after);return {committed:true,snapshot:snap(after)}}
  })};
  const sdk={database:()=>db,auth:()=>({
    async getUser(id){return {uid:id,email:id==='uid1'?'newcustomer@example.test':'other@example.test',emailVerified:true,disabled:false}},
    async createCustomToken(id){return 'test-token-'+id}
  })};
  const ctx=uid=>({sdk,uid,email:uid==='uid1'?'newcustomer@example.test':'other@example.test'});
  return {state,db,sdk,ctx};
}
(async()=>{
 const lastAdmin=process.env.MAIN_ADMIN_GOOGLE_UID;
 const lastName=process.env.MAIN_ADMIN_USERNAME;
 process.env.MAIN_ADMIN_GOOGLE_UID='administrator-uid';
 process.env.MAIN_ADMIN_USERNAME='adminkit';
 try{
  const f=mockStore();
  const saved=await createAccount(f.ctx('uid1'),'newcustomer_25','New Customer');
  assert.equal(saved.username,'newcustomer_25');
  assert.equal(saved.balance,0);
  assert.equal(f.state.auth_bindings.uid1.username,'newcustomer_25');
  assert.equal(f.state.auth_username_uids.newcustomer_25,'uid1');
  assert.equal(f.state.users.newcustomer_25.authUid,'uid1');
  assert.equal(f.state.users.newcustomer_25.password,undefined);
  const req={headers:{host:'kitphanmmo.vercel.app',origin:'https://kitphanmmo.vercel.app',
    'x-forwarded-for':'192.0.2.19','sec-fetch-site':'same-origin'},
    body:{username:'newcustomer_25',password:'password12345'}};
  let attempts=0;
  const signed=await signInLinkedUsername(req,{firebase:()=>f.sdk,fetcher:async(url,opts)=>{
    attempts++;
    assert(url.startsWith('https://identitytoolkit.googleapis.com/'));
    assert.deepEqual(JSON.parse(opts.body),{email:'newcustomer@example.test',password:'password12345',returnSecureToken:true});
    return {ok:true,json:async()=>({localId:'uid1',idToken:'mock-id-token'})};
  }});
  assert.equal(attempts,1);
  assert.equal(signed.customToken,'test-token-uid1');
  await assert.rejects(()=>createAccount(f.ctx('uid1'),'differentuser','New Customer'),/UID đã liên kết/);
  await assert.rejects(()=>createAccount(f.ctx('uid2'),'newcustomer_25','Other User'),/Tên đăng nhập đã được sử dụng/);
  assert.equal(f.state.users.newcustomer_25.authUid,'uid1');
  assert(!f.state.auth_bindings.uid2);
  await assert.rejects(()=>createAccount(f.ctx('uid2'),'adminkit','Other User'),/không hợp lệ/);
  await assert.rejects(()=>createAccount(f.ctx('administrator-uid'),'legituser','Other User'),/Admin/);
  assert.equal(f.state.users.newcustomer_25.balance,0);
  assert.equal(f.state.users.newcustomer_25.totalDeposited,0);
  console.log('PASS V8.2.6: new Firebase username claim, username/password login, duplicate and admin guards, no legacy password or wallet modifications');
 }finally{
  if(lastAdmin===undefined)delete process.env.MAIN_ADMIN_GOOGLE_UID;else process.env.MAIN_ADMIN_GOOGLE_UID=lastAdmin;
  if(lastName===undefined)delete process.env.MAIN_ADMIN_USERNAME;else process.env.MAIN_ADMIN_USERNAME=lastName;
 }
})().catch(err=>{console.error(err);process.exitCode=1});
