'use strict';
const crypto=require('node:crypto');
const {identity,verifiedIdentity,checkOrigin,error,USERNAME,now,amount}=require('../lib/secure-accounts');
const {jsonError}=require('../lib/shop-common');
const REQ=/^[a-zA-Z0-9_-]{10,160}$/;
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false});
 try{
  if(req.method==='POST')checkOrigin(req);
  const ctx=await identity(req,{adminOnly:true});const db=ctx.db;
  if(req.method==='GET'){
    const raw=(await db.ref('account_migration_requests').limitToLast(100).once('value')).val()||{};
    return res.status(200).json({ok:true,pending:Object.values(raw).filter(v=>v?.status==='pending').map(v=>({uid:v.uid,username:v.username,email:v.email,requestedAt:v.requestedAt})),
      walletChangesEnabled:false});
  }
  const action=String(req.body?.action||'');
  if(action==='approve_migration'||action==='reject_migration'){
    const uid=String(req.body?.uid||'');if(!REQ.test(uid))throw error('UID không hợp lệ.',400);
    const ref=db.ref('account_migration_requests/'+uid);
    const request=(await ref.once('value')).val();
    if(!request||request.status!=='pending')throw error('Không có yêu cầu chờ duyệt.',409);
    if(action==='reject_migration'){
      await ref.update({status:'rejected',reviewedBy:ctx.uid,reviewedAt:now()});
      return res.json({ok:true,status:'rejected'});
    }
    if(req.body?.identityChecked!==true||req.body?.balanceChecked!==true)throw error('Phải đối chiếu danh tính và số dư/lịch sử từ bản sao lưu đáng tin cậy.',422);
    const {username,email}=request;
    if(!USERNAME.test(username))throw error('Tên tài khoản không hợp lệ.',400);
    const authUser=await ctx.sdk.auth().getUser(uid);
    if(!authUser.emailVerified||String(authUser.email||'').toLowerCase()!==String(email||'').toLowerCase())throw error('Email của người yêu cầu không còn hợp lệ.',409);
    const recordRef=db.ref('users/'+username);
    const before=(await recordRef.once('value')).val();
    if(!before||String(before.email||'').trim().toLowerCase()!==String(email).trim().toLowerCase()||before.role==='Administrator'||username===ctx.username)throw error('Dữ liệu gốc không khớp, cần đối soát thủ công.',409);
    const uidClaim=db.ref('auth_username_uids/'+username);
    const claim=await uidClaim.transaction(v=>v===null||v===uid?uid:undefined,undefined,false);
    if(!claim.committed)throw error('Tài khoản đã liên kết với UID khác.',409);
    // Firebase RTDB transactions can initially receive `null` even when a record exists.
    // The previous whole-record transaction aborted on that first `null` value,
    // leaving auth_username_uids claimed but the migration still pending.
    // We already exclusively reserved the username above. Recheck the record and
    // UID binding, then apply all dependent fields in ONE atomic multi-path update.
    const latest=(await recordRef.once('value')).val();
    if(!latest || (latest.authUid && latest.authUid!==uid) ||
       String(latest.email||'').trim().toLowerCase()!==String(email).trim().toLowerCase() ||
       latest.role==='Administrator' || username===ctx.username) {
      throw error('Hồ sơ đã thay đổi hoặc liên kết với UID khác. Chưa có dữ liệu nào được chuyển.',409);
    }
    const binding=(await db.ref('auth_bindings/'+uid).once('value')).val();
    const boundUsername=typeof binding==='string'?binding:binding?.username;
    if(boundUsername && boundUsername!==username) throw error('UID này đã liên kết với tài khoản khác.',409);
    const reviewedAt=now();
    await db.ref().update({
      [`users/${username}/authUid`]:uid,
      [`users/${username}/migratedAt`]:reviewedAt,
      [`users/${username}/password`]:null, // Remove plaintext password without replacing the wallet/profile.
      [`auth_bindings/${uid}`]:{username,linkedAt:reviewedAt,kind:'approved_legacy',approvedBy:ctx.uid},
      [`account_migration_requests/${uid}/status`]:'approved',
      [`account_migration_requests/${uid}/reviewedBy`]:ctx.uid,
      [`account_migration_requests/${uid}/reviewedAt`]:reviewedAt
    });
    return res.json({ok:true,status:'approved',username});
  }
  if(action==='adjust_wallet'){
    // V5.2.1 permanent guard: do not modify users.balance from the legacy admin action.
    throw error('Ví cũ đang bị cách ly, không được cộng/trừ tiền vào users.balance. Cần API ví thật dựa trên wallet_accounts + ledger.',423);
  }
  if(action==='complete_old_order'){
    const orderId=String(req.body?.orderId||'');
    if(!/^LCK-[0-9]{5}$/.test(orderId))throw error('Mã đơn không hợp lệ.',422);
    const ref=db.ref('orders/'+orderId);
    const result=await ref.transaction(o=>o && o.status==='Đang xử lý'?{...o,status:'Hoàn thành',reviewedBy:ctx.uid,reviewedAt:now()}:undefined,undefined,false);
    if(!result.committed)throw error('Đơn không tồn tại hoặc đã xử lý.',409);
    return res.json({ok:true});
  }
  throw error('Thao tác không hỗ trợ.',400);
 }catch(e){return jsonError(res,e)}
};
