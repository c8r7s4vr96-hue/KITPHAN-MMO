'use strict';
const assert=require('node:assert/strict');
const {classifyResponse,fulfillmentText}=require('../lib/shop-fulfillment');
const sample={success:true,lang:'en',order:{orderCode:'ORDER1A2B3C4D5E',status:'completed',productType:'account',quantity:1},
  payment:{balance:120000},delivery:{accounts:[{user:'account1@example.test',password:'FAKE-ONLY',verifyEmail:'recovery@example.test'}]}};
const result=classifyResponse(sample);
assert.equal(result.kind,'delivered');
assert.equal(result.delivery,'Tên đăng nhập: account1@example.test\nMật khẩu: FAKE-ONLY\nEmail xác minh: recovery@example.test');
assert(!result.delivery.includes('120000'));assert(!result.delivery.includes('ORDER1A2B3C4D5E'));
assert.equal(classifyResponse({success:true,order:{status:'processing'},delivery:{accounts:[{user:'someone',password:'FAKE'}]}}).kind,'pending');
const multi=classifyResponse({success:true,order:{status:'completed'},delivery:{accounts:[
 {user:'one@test.invalid',password:'P1',verifyEmail:'verify1@test.invalid'},
 {user:'two@test.invalid',password:'P2'}]}});
assert.equal(multi.kind,'delivered');
assert(multi.delivery.includes('Tài khoản #1'));assert(multi.delivery.includes('Tài khoản #2'));
assert(multi.delivery.includes('one@test.invalid'));assert(multi.delivery.includes('two@test.invalid'));
for(const invalid of [
 {success:true,order:{status:'completed',orderCode:'ORDER1'},delivery:{accounts:[{password:'only-password'}]}},
 {success:true,delivery:{accounts:[{user:'only-login'}]}},
 {success:true,delivery:{accounts:[]}},
 {success:true,delivery:{accounts:[{user:'a',password:'p'},{password:'missing-login'}]}},
]){
 const o=classifyResponse(invalid);
 assert.equal(o.kind,'review',JSON.stringify(invalid));
 assert.equal(o.delivery,null);
 assert.equal(o.diagnostic.code,'SUPPLIER_DELIVERY_INCOMPLETE');
 assert(!JSON.stringify(o.diagnostic).includes('only-password'));
}
assert.equal(classifyResponse({success:true,delivery:{items:['voucher-code']}}).kind,'delivered','non-account code delivery preserved');
assert.equal(classifyResponse({success:false,order:{status:'failed'},delivery:{accounts:[{user:'u',password:'p'}]}}).kind,'rejected');
assert.equal(fulfillmentText({order:{status:'completed'},delivery:{accounts:[{password:'only-password'}]}}),null);
console.log('PASS V8.2.7: Swagger account fields, multiple accounts, incomplete account safety, generic codes');
// Checkout journal regression: complete delivery settles once; incomplete data
// remains held for human review, without duplicate supplier dispatch or refund.
const commerce=require('../lib/wallet-commerce');
const uid='firebaseUser_ABC9876',username='customer_test',product={id:'kling_demo',name:'Kling account',costVnd:4300},price=24300;
function startOrder(requestId){
 let s={accounts:{[uid]:{uid,username,availableVnd:30000,heldVnd:0,totalDepositedVnd:30000}},orders:{}};
 s=commerce.reserveState(s,{uid,username,product,price,requestId,recipientEmail:''},2000);
 const id=commerce.orderKey(uid,requestId),claim='claim_abcd12345678901234567890';
 s=commerce.markRequestingState(s,id,claim,3000);
 return {s,id,claim};
}
let {s:okState,id:okId,claim:okClaim}=startOrder('request_v827_delivery_ok1');
okState=commerce.completeState(okState,okId,okClaim,classifyResponse(sample),4000);
assert.equal(okState.orders[okId].status,'delivered');
assert.equal(okState.accounts[uid].availableVnd,5700);
assert.equal(okState.accounts[uid].heldVnd,0);
assert.equal(okState.moneyJournal['settle_'+okId].amountVnd,24300);
assert.throws(()=>commerce.completeState(okState,okId,okClaim,classifyResponse(sample),5000),/Trạng thái đơn đã thay đổi/);
let {s:badState,id:badId,claim:badClaim}=startOrder('request_v827_delivery_bad');
badState=commerce.completeState(badState,badId,badClaim,classifyResponse({success:true,order:{status:'completed'},delivery:{accounts:[{password:'password-only'}]}}),4000);
assert.equal(badState.orders[badId].status,'needs_review');
assert.equal(badState.accounts[uid].heldVnd,24300);
assert.equal(badState.accounts[uid].availableVnd,5700);
assert.equal(badState.moneyJournal['settle_'+badId],undefined);
assert.equal(badState.orders[badId].supplierDiagnostic.code,'SUPPLIER_DELIVERY_INCOMPLETE');
console.log('PASS V8.2.7: ledger settles once for full account; partial credentials preserve funds for review');
