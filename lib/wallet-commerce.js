'use strict';
/** Canonical LIVE money state. Every mutation of account, holds and journal is a
 * single Firebase RTDB transaction at live_deposits_v1. Never uses users.balance.
 * All methods are pure and can be tested with synthetic state. */
const crypto=require('node:crypto');
const {ROOT}=require('./deposit-live');
const UID=/^[A-Za-z0-9_-]{4,160}$/;
const USERNAME=/^[a-z0-9_-]{3,60}$/;
const ID=/^[a-zA-Z0-9_-]{12,90}$/;
const PRODUCT=/^[a-zA-Z0-9_:.\-]{1,90}$/;
const MAX=1000000000;
const fail=(message,status=422)=>Object.assign(new Error(message),{status});
const clone=v=>structuredClone(v||{});
const positive=n=>Number.isSafeInteger(n)&&n>0&&n<=MAX;
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX;
const total=(a,b)=>Number.isSafeInteger(a+b)&&a+b<=MAX;
const validId=s=>typeof s==='string'&&ID.test(s);
function accountOf(state,uid,username){
 if(!UID.test(uid)||!USERNAME.test(username))throw fail('Tài khoản không hợp lệ.');
 state.accounts ||= {};
 let a=state.accounts[uid];
 if(!a){a={uid,username,availableVnd:0,heldVnd:0,totalDepositedVnd:0,createdAt:Date.now()};state.accounts[uid]=a;}
 if(a.heldVnd===undefined)a.heldVnd=0;
 if(a.uid!==uid||a.username!==username||!nonnegative(a.availableVnd)||!nonnegative(a.heldVnd)||
    !nonnegative(a.totalDepositedVnd))throw fail('Ví đang có dữ liệu không hợp lệ, cần đối soát.',409);
 a.heldVnd ||= 0;
 return a;
}
function addJournal(s,entry){s.moneyJournal ||= {};s.moneyJournal[entry.id]=entry;}
function adjustState(current,{uid,username,adminUid,requestId,kind,amountVnd,reason},now=Date.now()){
 if(!UID.test(String(adminUid))||!validId(requestId)||!['credit','debit'].includes(kind)||
    !positive(amountVnd)||typeof reason!=='string'||reason.trim().length<12||reason.length>300)throw fail('Thiếu thông tin điều chỉnh hợp lệ.');
 const s=clone(current);s.adminAdjustments ||= {};
 const existing=s.adminAdjustments[requestId];
 if(existing){
   if(existing.uid!==uid||existing.kind!==kind||existing.amountVnd!==amountVnd||existing.reason!==reason.trim()||existing.adminUid!==adminUid)
     throw fail('Mã yêu cầu đã dùng cho điều chỉnh khác.',409);
   return s;
 }
 const a=accountOf(s,uid,username);
 if(kind==='debit'&&a.availableVnd<amountVnd)throw fail('Số dư khả dụng không đủ để trừ.',409);
 if(kind==='credit'&&!total(a.availableVnd,amountVnd))throw fail('Vượt giới hạn số dư.',409);
 const before=a.availableVnd;
 a.availableVnd+=kind==='credit'?amountVnd:-amountVnd;
 const entry={id:'admin_'+requestId,requestId,uid,username,adminUid,kind,amountVnd,reason:reason.trim(),beforeVnd:before,afterVnd:a.availableVnd,createdAt:now,source:'manual_admin_adjustment'};
 s.adminAdjustments[requestId]=entry;
 addJournal(s,entry);
 return s;
}
function orderKey(uid,requestId){return 'ord_'+crypto.createHash('sha256').update(uid+':'+requestId).digest('hex').slice(0,36);}
function reserveState(current,{uid,username,requestId,product,price,recipientEmail},now=Date.now()){
 if(!validId(requestId)||!PRODUCT.test(String(product?.id||''))||!positive(price)||
    typeof recipientEmail!=='string'||recipientEmail.length>254)throw fail('Đơn hàng không hợp lệ.');
 const s=clone(current);s.orders ||= {};
 const id=orderKey(uid,requestId);const previous=s.orders[id];
 if(previous){
   if(previous.uid!==uid||previous.requestId!==requestId||previous.productId!==product.id||previous.price!==price||previous.recipientEmail!==recipientEmail)
     throw fail('Mã mua hàng đã được sử dụng cho đơn khác.',409);
   return s;
 }
 const a=accountOf(s,uid,username);
 if(a.availableVnd<price)throw fail('Số dư ví thật không đủ.',409);
 if(!total(a.heldVnd,price))throw fail('Số tiền giữ vượt giới hạn.',409);
 if(a.lastPurchaseAt && now-a.lastPurchaseAt<1500)throw fail('Chờ một chút trước khi tạo đơn tiếp theo.',429);
 a.availableVnd-=price;a.heldVnd+=price;a.lastPurchaseAt=now;
 s.orders[id]={id,uid,username,requestId,productId:product.id,name:product.name,price,
   costVnd:product.costVnd,recipientEmail,status:'reserved',createdAt:now,updatedAt:now};
 addJournal(s,{id:'reserve_'+id,uid,username,kind:'reserve',amountVnd:price,orderId:id,createdAt:now,
   afterVnd:a.availableVnd});
 return s;
}
function markRequestingState(current,id,claim,now=Date.now()){
 const s=clone(current),o=s.orders?.[id];
 if(!o||o.status!=='reserved'||typeof claim!=='string'||claim.length<20)throw fail('Đơn đã được xử lý, không gửi mua lại.',409);
 o.status='requesting_supplier';o.claim=claim;o.updatedAt=now;return s;
}
function completeState(current,id,claim,outcome,now=Date.now()){
 const s=clone(current),o=s.orders?.[id];
 if(!o||o.status!=='requesting_supplier'||o.claim!==claim)throw fail('Trạng thái đơn đã thay đổi.',409);
 const a=accountOf(s,o.uid,o.username);
 if(a.heldVnd<o.price)throw fail('Số tiền đang giữ không khớp.',409);
 if(outcome?.kind==='rejected'){
   if(!total(a.availableVnd,o.price))throw fail('Không thể hoàn giữ tiền.',409);
   a.heldVnd-=o.price;a.availableVnd+=o.price;o.status='refunded';o.refundedAt=now;
   addJournal(s,{id:'refund_'+id,uid:o.uid,username:o.username,kind:'refund',orderId:id,
     amountVnd:o.price,afterVnd:a.availableVnd,source:'supplier_explicit_rejection',createdAt:now});
 }else if(outcome?.kind==='delivered'&&typeof outcome.delivery==='string'&&outcome.delivery.trim().length){
   a.heldVnd-=o.price;o.status='delivered';o.fulfilledAt=now;o.delivery=outcome.delivery.slice(0,8500);
   addJournal(s,{id:'settle_'+id,uid:o.uid,username:o.username,kind:'purchase',orderId:id,
     amountVnd:o.price,afterVnd:a.availableVnd,source:'supplier_delivered',createdAt:now});
 }else {o.status=outcome?.kind==='pending'?'awaiting_delivery':'needs_review';}
 o.updatedAt=now;
 delete o.claim;
 return s;
}
function resolveOrderState(current,{id,adminUid,action,delivery='',reason='',confirmedNotCharged=false},now=Date.now()){
 if(!UID.test(String(adminUid)))throw fail('Admin không hợp lệ.',403);
 const s=clone(current),o=s.orders?.[id];
 if(!o)throw fail('Không tìm thấy đơn.',404);
 if(['delivered','refunded'].includes(o.status))throw fail('Đơn đã hoàn tất.',409);
 // If serverless died after the irreversible supplier claim, never re-dispatch:
 // after 2 minutes Admin may resolve ONLY on independently verified evidence.
 const stale=now-Number(o.updatedAt||0)>=120000;
 if(!['awaiting_delivery','needs_review'].includes(o.status)&&
    !(stale&&['reserved','requesting_supplier'].includes(o.status)))
    throw fail('Đơn chưa sẵn sàng xử lý thủ công.',409);
 const a=accountOf(s,o.uid,o.username);
 if(a.heldVnd<o.price)throw fail('Số tiền đang giữ không khớp.',409);
 if(action==='refund'){
   if(!confirmedNotCharged||typeof reason!=='string'||reason.trim().length<15)throw fail('Cần xác nhận chứng từ nhà cung cấp chưa thu hoặc đã hoàn tiền, cùng lý do.',422);
   if(!total(a.availableVnd,o.price))throw fail('Không thể hoàn giữ tiền.',409);
   a.availableVnd+=o.price;a.heldVnd-=o.price;o.status='refunded';o.refundedAt=now;
   addJournal(s,{id:'refund_'+id,uid:o.uid,username:o.username,kind:'refund',orderId:id,
     adminUid,reason:reason.trim().slice(0,300),amountVnd:o.price,afterVnd:a.availableVnd,createdAt:now});
 }else if(action==='deliver'){
   if(typeof delivery!=='string'||delivery.trim().length<3||delivery.length>8500)throw fail('Cần cung cấp nội dung giao hàng hợp lệ.',422);
   a.heldVnd-=o.price;o.status='delivered';o.delivery=delivery.trim();o.fulfilledAt=now;
   addJournal(s,{id:'settle_'+id,uid:o.uid,username:o.username,kind:'purchase',orderId:id,
     adminUid,amountVnd:o.price,source:'manual_supplier_verified_delivery',afterVnd:a.availableVnd,createdAt:now});
 }else throw fail('Hành động không hợp lệ.');
 o.reviewedBy=adminUid;o.updatedAt=now;return s;
}
async function transact(db,updater){
 const tx=await db.ref(ROOT).transaction(updater,undefined,false);
 if(!tx.committed)throw fail('Không lưu được giao dịch, thử lại hoặc kiểm tra lịch sử.',503);
 return tx.snapshot.val();
}
module.exports={ROOT,validId,accountOf,adjustState,orderKey,reserveState,markRequestingState,completeState,resolveOrderState,transact,fail,positive};
