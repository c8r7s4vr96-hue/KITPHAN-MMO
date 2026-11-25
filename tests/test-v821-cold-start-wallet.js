'use strict';
/**
 * Regression: a Vercel cold worker must load Firebase RTDB state before
 * attempting the purchase reservation. No Firebase or CanBoSo network calls.
 */
const assert=require('node:assert/strict');
const commerce=require('../lib/wallet-commerce');
const uid='customerFirebaseUid_1234';
const username='customer123';
const product={id:'kling-65',name:'Kling 65 Cre 1th BHF',price:24300,costVnd:4300};
const requestId='request_cold_start_1234567';
const initial={accounts:{[uid]:{uid,username,availableVnd:30000,heldVnd:0,totalDepositedVnd:30000}},orders:{}};
const snapshot=v=>({val:()=>structuredClone(v),exists:()=>v!==null&&v!==undefined});
function dbWithColdCache(remote){
 let cachePrimed=false,transactionCount=0,readCount=0,initialNullCallbacks=0;
 return {
  get remote(){return remote},
  get transactionCount(){return transactionCount},
  get readCount(){return readCount},
  get initialNullCallbacks(){return initialNullCallbacks},
  ref(path){
   assert.equal(path,commerce.ROOT);
   return {
    async once(event){assert.equal(event,'value');cachePrimed=true;readCount++;return snapshot(remote)},
    async transaction(updater){
      transactionCount++;
      // RTDB can call the handler with null before remote state is cached.
      // This is what caused a false zero-VND balance in the old version.
      if(!cachePrimed){initialNullCallbacks++;updater(null);}
      const next=updater(structuredClone(remote));
      if(next===undefined)return {committed:false,snapshot:snapshot(remote)};
      remote=next;
      cachePrimed=false; // emulate the next cold worker
      return {committed:true,snapshot:snapshot(remote)};
    }
   };
  }
 };
}
(async()=>{
 const db=dbWithColdCache(structuredClone(initial));
 const orderInput={uid,username,product,price:24300,requestId,recipientEmail:''};
 let state=await commerce.transact(db,v=>commerce.reserveState(v,orderInput));
 assert.equal(db.initialNullCallbacks,0,'Must not treat a cold-cache null as a zero balance');
 assert.equal(state.accounts[uid].availableVnd,5700);
 assert.equal(state.accounts[uid].heldVnd,24300);
 assert.equal(Object.keys(state.orders).length,1);
 const id=commerce.orderKey(uid,requestId);
 assert.equal(state.orders[id].status,'reserved');
 // Idempotent replay never charges again even across a fresh worker.
 state=await commerce.transact(db,v=>commerce.reserveState(v,orderInput));
 assert.equal(db.initialNullCallbacks,0);
 assert.equal(state.accounts[uid].availableVnd,5700);
 assert.equal(state.accounts[uid].heldVnd,24300);
 assert.equal(Object.keys(state.orders).length,1);
 assert.equal(db.transactionCount,2);
 assert.equal(db.readCount,2);
 assert.equal(state.accounts[uid].totalDepositedVnd,30000);
 console.log('PASS V8.2.1: cold Firebase cache, 30k wallet, 24.3k hold, 5.7k balance, idempotent replay');
})().catch(e=>{console.error(e);process.exitCode=1});
