'use strict';
// Verify that an initial cached-null callback cannot reject a funded wallet
// or clear the remote ledger. No real Firebase, SePay or CanBoSo traffic.
const assert=require('node:assert/strict');
const c=require('../lib/wallet-commerce');
const uid='firebaseUid_confirmed_1234',username='adminkit';
const product={id:'kling_65',name:'Kling 65 Cre 1th BHF',costVnd:10000};
const requestId='v822_test_request_123456';
const initial={accounts:{[uid]:{uid,username,availableVnd:30000,totalDepositedVnd:30000}},orders:{},moneyJournal:{}};
const snap=value=>({val:()=>structuredClone(value),exists:()=>value!==null&&value!==undefined});
function mockedDb(initialValue,simulateNull=true){
 let remote=structuredClone(initialValue),firstNull=0;
 return {
  get remote(){return remote;}, get firstNull(){return firstNull;},
  ref(path){assert.equal(path,c.ROOT);return {
   once:async event=>{assert.equal(event,'value');return snap(remote);},
   async transaction(update){
    if(simulateNull){
      const stale=update(null); // cached local root: null, remote root: nonempty
      firstNull++;
      assert.equal(stale,null,'must not invent an empty wallet or throw');
      assert.deepEqual(remote,firstNull===1?initial:remote,'remote balance must remain unchanged before CAS retry');
    }
    const proposed=update(structuredClone(remote));
    if(proposed===undefined)return {committed:false,snapshot:snap(remote)};
    remote=proposed;return {committed:true,snapshot:snap(remote)};
   }
  };}
 };
}
(async()=>{
 const db=mockedDb(initial);
 const args={uid,username,requestId,product,price:24300,recipientEmail:''};
 const reserve=()=>c.transact(db,v=>c.reserveState(v,args),{requireExistingRoot:true});
 let result=await reserve();
 assert.equal(result.accounts[uid].availableVnd,5700);
 assert.equal(result.accounts[uid].heldVnd,24300);
 assert.equal(Object.keys(result.orders).length,1);
 result=await reserve(); // same requestId, must not take money twice
 assert.equal(result.accounts[uid].availableVnd,5700);
 assert.equal(result.accounts[uid].heldVnd,24300);
 assert.equal(Object.keys(result.orders).length,1);
 const id=c.orderKey(uid,requestId);
 const claim='claim00000000000000000000000';
 result=await c.transact(db,v=>c.markRequestingState(v,id,claim),{requireExistingRoot:true});
 assert.equal(result.orders[id].status,'requesting_supplier');
 result=await c.transact(db,v=>c.completeState(v,id,claim,{kind:'delivered',delivery:'mock-delivery'}),{requireExistingRoot:true});
 assert.equal(result.orders[id].status,'delivered');
 assert.equal(result.accounts[uid].availableVnd,5700);
 assert.equal(result.accounts[uid].heldVnd,0);
 assert.equal(Object.values(result.moneyJournal).filter(x=>x.kind==='purchase').length,1);
 assert.ok(db.firstNull>=4);
 const missing=mockedDb(null);
 await assert.rejects(c.transact(missing,v=>c.reserveState(v,args),{requireExistingRoot:true}), /Không đọc được dữ liệu ví thật/);
 assert.equal(missing.remote,null);
 console.log('PASS V8.2.2: initial null, 30k available, 24.3k reserved, delivered exactly once, empty-root fail-closed');
})().catch(e=>{console.error(e);process.exitCode=1});
