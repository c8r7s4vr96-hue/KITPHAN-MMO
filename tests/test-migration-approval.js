'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
const target=path.resolve(__dirname,'../api/account-admin.js');
function clone(v){return v===undefined?undefined:structuredClone(v)}
function makeDb(initial){
  const state=clone(initial);
  const get=(p)=>p.split('/').filter(Boolean).reduce((v,k)=>v?.[k],state);
  const put=(p,v)=>{const parts=p.split('/').filter(Boolean);let node=state;for(const part of parts.slice(0,-1))node=node[part]??={};if(v===null)delete node[parts.at(-1)];else node[parts.at(-1)]=clone(v)};
  const snap=(v)=>({exists:()=>v!==null&&v!==undefined,val:()=>clone(v)});
  const db={
    ref:(p='')=>({
      once:async()=>snap(get(p)),
      update:async changes=>{
        for(const [k,v] of Object.entries(changes)){
          if(!p && k.includes('/'))put(k,v);
          else if(p)put(p+'/'+k,v);
          else put(k,v);
        }
      },
      transaction:async update=>{
        // Model Firebase transactions for initial empty / existing username claims.
        // Whole-record user transactions are intentionally banned: these can
        // abort on the initial uncached null value, as in the production bug.
        assert.ok(!p.startsWith('users/'),'Unexpected unsafe whole-record transaction');
        const previous=get(p)??null;
        const next=update(clone(previous));
        if(next===undefined)return {committed:false,snapshot:snap(previous)};
        put(p,next);return {committed:true,snapshot:snap(next)};
      },
      limitToLast:()=>({once:async()=>snap(get(p))})
    })
  };
  return {db,state,get};
}
async function invoke(initial,{identityChecked=true,balanceChecked=true,uid='requester-uid'}={}){
  const {db,state,get}=makeDb(initial);
  const sdk={auth:()=>({getUser:async id=>({uid:id,email:'owner@example.test',emailVerified:true})})};
  const mockSecure={
    identity:async()=>({db,sdk,uid:'admin-uid',username:'adminkit'}),
    verifiedIdentity:async()=>{},
    checkOrigin:()=>{},
    USERNAME:/^[a-z0-9_-]{3,60}$/,
    now:()=>1762400000000,
    amount:()=>{},
    error:(msg,status=500)=>Object.assign(new Error(msg),{status})
  };
  const common={jsonError:(res,e)=>res.status(e.status||500).json({ok:false,error:e.message})};
  const loader=Module._load;
  Module._load=function(req,parent,isMain){if(parent?.filename===target){if(req==='../lib/secure-accounts')return mockSecure;if(req==='../lib/shop-common')return common;}return loader.apply(this,arguments)};
  delete require.cache[target];
  let handler;
  try{handler=require(target)}finally{Module._load=loader}
  let statusCode=200,json;
  const res={setHeader:()=>{},status(n){statusCode=n;return this},json(x){json=x;return this}};
  await handler({method:'POST',headers:{authorization:'Bearer admin-token'},body:{action:'approve_migration',uid,identityChecked,balanceChecked}},res);
  return {statusCode,json,state,get};
}
function fixture(overrides={}){
  return {
    users:{testlegacy:{username:'testlegacy',email:'owner@example.test',password:'OLD_SECRET',balance:150000,totalDeposited:200000,role:'Thành viên',...overrides.user}},
    account_migration_requests:{'requester-uid':{uid:'requester-uid',email:'owner@example.test',username:'testlegacy',status:'pending'}},
    auth_username_uids:overrides.claim?{testlegacy:overrides.claim}:{},
    auth_bindings:overrides.binding?{'requester-uid':overrides.binding}:{}
  };
}
(async()=>{
  const ok=await invoke(fixture());
  assert.equal(ok.statusCode,200);assert.equal(ok.state.users.testlegacy.authUid,'requester-uid');
  assert.equal(ok.state.users.testlegacy.balance,150000);assert.equal(ok.state.users.testlegacy.totalDeposited,200000);
  assert.equal(ok.state.users.testlegacy.password,undefined);assert.equal(ok.state.auth_bindings['requester-uid'].username,'testlegacy');
  assert.equal(ok.state.account_migration_requests['requester-uid'].status,'approved');

  // Old implementation can leave a claimed username but a still-pending request.
  const retry=await invoke(fixture({claim:'requester-uid'}));
  assert.equal(retry.statusCode,200);

  const conflict=await invoke(fixture({claim:'different-uid'}));
  assert.equal(conflict.statusCode,409);assert.equal(conflict.state.users.testlegacy.password,'OLD_SECRET');
  assert.equal(conflict.state.users.testlegacy.authUid,undefined);

  const linked=await invoke(fixture({user:{authUid:'different-uid'}}));
  assert.equal(linked.statusCode,409);assert.equal(linked.state.users.testlegacy.authUid,'different-uid');

  const misBound=await invoke(fixture({binding:{username:'anotheruser'}}));
  assert.equal(misBound.statusCode,409);assert.equal(misBound.state.users.testlegacy.authUid,undefined);

  const audit=await invoke(fixture(),{balanceChecked:false});
  assert.equal(audit.statusCode,422);assert.equal(audit.state.users.testlegacy.password,'OLD_SECRET');

  console.log('PASS 6 cases: success, retry pending claim, username conflict, pre-linked record, UID binding conflict, missing audit approval. All balances preserved.');
})().catch(err=>{console.error(err);process.exit(1)});
