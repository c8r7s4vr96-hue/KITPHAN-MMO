'use strict';
/** Stages a human reconciliation attestation. NEVER writes users.balance, deposits, orders or payment events. */
const {identity,checkOrigin} = require('../lib/secure-accounts');
const {jsonError,error} = require('../lib/shop-common');
const {USERNAME,goodAmount,str} = require('../lib/wallet-audit');
const ID=/^[a-zA-Z0-9_-]{12,90}$/;
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    checkOrigin(req);
    const ctx=await identity(req,{adminOnly:true});
    const username=String(req.body?.username||'').trim().toLowerCase();
    const requestId=String(req.body?.requestId||'').trim();
    const verifiedBalance=goodAmount(req.body?.verifiedBalanceVnd);
    const observedBalance=goodAmount(req.body?.observedLegacyBalanceVnd);
    const note=str(req.body?.note,250);
    if(!USERNAME.test(username)||!ID.test(requestId)||verifiedBalance===null||observedBalance===null||note.length<15)
      throw error('Thiếu thông tin đối soát hợp lệ.',422);
    if(req.body?.bankChecked!==true||req.body?.ordersChecked!==true||req.body?.ownershipChecked!==true)
      throw error('Cần đối chiếu ngân hàng, lịch sử đơn và quyền sở hữu.',422);
    const snap=await ctx.db.ref('users/'+username).once('value');
    if(!snap.exists())throw error('Không thấy tài khoản.',404);
    const latestBalance=goodAmount(snap.val()?.balance);
    if(latestBalance===null||latestBalance!==observedBalance)throw error('Số dư Firebase đã thay đổi. Tải lại báo cáo.',409);
    const record={id:requestId,username,status:'reviewed_not_activated',
      verifiedBalanceVnd:verifiedBalance,legacyBalanceAtReview:observedBalance,
      note,bankChecked:true,ordersChecked:true,ownershipChecked:true,
      reviewedBy:ctx.uid,reviewedAt:Date.now(),spendable:false};
    const ref=ctx.db.ref('wallet_reconciliation/'+username+'/'+requestId);
    const tx=await ref.transaction(v=>v===null?record:undefined,undefined,false);
    if(!tx.committed)return res.status(200).json({ok:true,duplicate:true,status:'reviewed_not_activated',balanceChanged:false});
    return res.status(201).json({ok:true,recorded:true,status:'reviewed_not_activated',balanceChanged:false});
  }catch(e){return jsonError(res,e)}
};
