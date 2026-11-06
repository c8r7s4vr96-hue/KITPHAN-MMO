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
      walletChangesEnabled:process.env.ACCOUNT_WALLET_RECONCILED==='true'&&process.env.ACCOUNT_ADMIN_WALLET_ENABLED==='true'});
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
    const updated=await recordRef.transaction(v=>{
      if(!v||v.authUid && v.authUid!==uid||String(v.email||'').trim().toLowerCase()!==String(email).toLowerCase())return;
      const next={...v,authUid:uid,migratedAt:now()};
      delete next.password; // Once ownership is proven, remove stored plaintext credentials.
      return next;
    },undefined,false);
    if(!updated.committed)throw error('Không thể cập nhật liên kết. Kiểm tra lại.',409);
    await db.ref('auth_bindings/'+uid).set({username,linkedAt:now(),kind:'approved_legacy',approvedBy:ctx.uid});
    await ref.update({status:'approved',reviewedBy:ctx.uid,reviewedAt:now()});
    return res.json({ok:true,status:'approved',username});
  }
  if(action==='adjust_wallet'){
    if(process.env.ACCOUNT_WALLET_RECONCILED!=='true'||process.env.ACCOUNT_ADMIN_WALLET_ENABLED!=='true')throw error('Ví chưa được đối soát. Chức năng chỉnh tiền đang khóa.',423);
    const username=String(req.body?.username||'').trim().toLowerCase();
    const delta=Number(req.body?.amount);const type=String(req.body?.type||'');
    const reason=String(req.body?.reason||'').trim().slice(0,300);
    const requestId=String(req.body?.requestId||'');
    if(!USERNAME.test(username)||!['ADD','SUB'].includes(type)||!Number.isSafeInteger(delta)||delta<=0||delta>100000000||reason.length<8||!REQ.test(requestId))throw error('Thông tin giao dịch hoặc lý do không hợp lệ.',422);
    const ref=db.ref('users/'+username);
    const result=await ref.transaction(u=>{
      if(!u||!Number.isSafeInteger(Number(u.balance))||Number(u.balance)<0||u.secureWalletChanges?.[requestId])return;
      const next=Number(u.balance)+(type==='ADD'?delta:-delta);
      if(!Number.isSafeInteger(next)||next<0)return;
      return {...u,balance:next,secureWalletChanges:{...(u.secureWalletChanges||{}),[requestId]:{amount:delta,type,reason,by:ctx.uid,at:now()}}};
    },undefined,false);
    if(!result.committed)throw error('Tài khoản không tồn tại, tiền không đủ hoặc yêu cầu đã xử lý.',409);
    await db.ref('wallet_audit_logs/'+requestId).set({username,amount:delta,type,reason,by:ctx.uid,at:now()});
    return res.json({ok:true,balance:result.snapshot.val().balance});
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
