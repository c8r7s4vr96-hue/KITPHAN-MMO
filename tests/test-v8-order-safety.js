'use strict';
const assert=require('node:assert/strict');
const c=require('../lib/wallet-commerce');
const {classifyResponse}=require('../lib/shop-fulfillment');
const uid='firebaseUid_12345',username='tbao123',product={id:'capcut7d',name:'CapCut 7D',costVnd:9000},price=29000;
let s={accounts:{[uid]:{uid,username,availableVnd:50000,heldVnd:0,totalDepositedVnd:50000}},orders:{}};
const requestId='request_abcdefgh1234';const id=c.orderKey(uid,requestId);
s=c.reserveState(s,{uid,username,product,price,requestId,recipientEmail:''},100000);
assert.equal(s.accounts[uid].availableVnd,21000);assert.equal(s.accounts[uid].heldVnd,29000);
// Same client requestId must never deduct a second time.
let replay=c.reserveState(s,{uid,username,product,price,requestId,recipientEmail:''},100100);
assert.deepEqual(replay.accounts[uid],s.accounts[uid]);
assert.throws(()=>c.reserveState(s,{uid,username,product,price,requestId:'request_other123456',recipientEmail:''},100200),/đang chờ xử lý/);
s=c.markRequestingState(s,id,'claim_12345678901234567890123',100300);
let ambiguous=classifyResponse({success:true,status:'processing',data:{order_id:789,account:'hidden-secret'}});
assert.equal(ambiguous.kind,'pending');assert.equal(ambiguous.diagnostic.providerReference,'789');
s=c.completeState(s,id,'claim_12345678901234567890123',ambiguous,100400);
assert.equal(s.orders[id].status,'awaiting_delivery');assert.equal(s.orders[id].supplierDiagnostic.providerReference,'789');
assert.equal(s.orders[id].delivery,undefined);
// Cannot refund without independently verified evidence.
assert.throws(()=>c.resolveOrderState(s,{id,adminUid:'mainAdmin1234',action:'refund',reason:'Verified supplier not charged'}),/Cần xác nhận/);
s=c.resolveOrderState(s,{id,adminUid:'mainAdmin1234',action:'refund',confirmedNotCharged:true,reason:'Supplier confirms no charge and no order'},120000);
assert.equal(s.accounts[uid].availableVnd,50000);assert.equal(s.accounts[uid].heldVnd,0);
assert.equal(s.orders[id].status,'refunded');assert.equal(s.moneyJournal['refund_'+id].amountVnd,29000);
assert.throws(()=>c.resolveOrderState(s,{id,adminUid:'mainAdmin1234',action:'refund',confirmedNotCharged:true,reason:'Repeat refund is forbidden'}),/hoàn tất/);
// A purchase may now be created after the old order has been resolved.
s=c.reserveState(s,{uid,username,product,price,requestId:'request_another12345',recipientEmail:''},130000);
assert.equal(s.accounts[uid].availableVnd,21000);
// Explicit supplier rejection refunds, success with clear delivery settles.
const id2=c.orderKey(uid,'request_another12345');
s=c.markRequestingState(s,id2,'claim_22345678901234567890123',130100);
s=c.completeState(s,id2,'claim_22345678901234567890123',classifyResponse({success:false,status:'failed'}),130200);
assert.equal(s.accounts[uid].availableVnd,50000);assert.equal(s.accounts[uid].heldVnd,0);assert.equal(s.orders[id2].status,'refunded');
s=c.reserveState(s,{uid,username,product,price,requestId:'request_third123456',recipientEmail:''},140000);
const id3=c.orderKey(uid,'request_third123456');
s=c.markRequestingState(s,id3,'claim_32345678901234567890123',140100);
s=c.completeState(s,id3,'claim_32345678901234567890123',classifyResponse({success:true,data:{delivery:{account:'demo@invalid.test',password:'sample-secret'}}}),140200);
assert.equal(s.orders[id3].status,'delivered');assert.equal(s.accounts[uid].heldVnd,0);assert.equal(s.accounts[uid].availableVnd,21000);
console.log('PASS V8 order safety: replay, duplicate prevention, pending, evidence refund, settle, rejection');
