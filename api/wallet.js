'use strict';
/** One Vercel Function for three secure wallet endpoints on Hobby.
 * action=audit: GET, admin-only; action=review: POST, admin-only;
 * action=status: GET, owner only. No wallet credit/debit here.
 */
const {identity,checkOrigin,configuredAdminUsername} = require('../lib/secure-accounts');
const {jsonError,error} = require('../lib/shop-common');
const {USERNAME,goodAmount,str,summarize} = require('../lib/wallet-audit');
const ID=/^[a-zA-Z0-9_-]{12,90}$/;

async function audit(req,res) {
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const ctx=await identity(req,{adminOnly:true});
  const username=String(req.query?.username||'').trim().toLowerCase();
  if(!USERNAME.test(username))throw error('Nhập đúng tên tài khoản cần đối soát.',422);
  const db=ctx.db;
  const snaps=await Promise.all([
    db.ref('users/'+username).once('value'),
    db.ref('deposits').limitToLast(500).once('value'),
    db.ref('orders').limitToLast(500).once('value'),
    db.ref('shop_orders/'+username).limitToLast(500).once('value'),
    db.ref('payment_webhook_events').limitToLast(500).once('value'),
    db.ref('wallet_reconciliation/'+username).limitToLast(15).once('value'),
    db.ref('wallet_test/'+username).once('value')
  ]);
  if(!snaps[0].exists())throw error('Không thấy tài khoản.',404);
  const report=summarize(username,snaps[0].val(),snaps[1].val(),snaps[2].val(),snaps[3].val(),snaps[4].val());
  const reviews=Object.values(snaps[5].val()||{}).filter(x=>x&&typeof x==='object')
    .map(x=>({id:str(x.id,90),status:str(x.status,55),reviewedAt:Number(x.reviewedAt)||0,
      verifiedBalanceVnd:x.verifiedBalanceVnd,legacyBalanceAtReview:x.legacyBalanceAtReview,
      note:str(x.note,240)})).sort((a,b)=>b.reviewedAt-a.reviewedAt).slice(0,15);
  const testSnapshot=snaps[6].val();
  const testClassification=(testSnapshot && typeof testSnapshot==='object')?{
    legacyBalanceVnd:testSnapshot.legacyBalanceVnd,
    classification:testSnapshot.classification,
    spendableInLive:false,
    labeledAt:testSnapshot.labeledAt
  }:null;
  return res.status(200).json({ok:true,report,reviews,testClassification});
}

async function review(req,res) {
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
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
}

async function status(req,res) {
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const ctx=await identity(req);
  return res.status(200).json({ok:true,username:ctx.username,
    legacyBalanceVnd:ctx.profile.balance,verifiedSpendableBalanceVnd:null,
    legacyWalletSpendable:false,
    status:'locked_pending_reconciliation',automaticCreditsEnabled:false,
    checkoutEnabled:false,message:'Số dư lịch sử chưa được xác minh với ngân hàng. Tạm ngừng giao dịch.'});
}


/** Labels a historical balance as simulation-only; DOES NOT create wallet_accounts or touch users.balance. */
async function labelTest(req,res) {
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  checkOrigin(req);
  const ctx=await identity(req,{adminOnly:true});
  const username=String(req.body?.username||'').trim().toLowerCase();
  const expected=goodAmount(req.body?.observedLegacyBalanceVnd);
  if(username!==configuredAdminUsername() || expected===null || req.body?.confirmTestFunds!==true)
    throw error('Chỉ được phân loại số dư thử nghiệm của Admin đã xác nhận.',422);
  const snap=await ctx.db.ref('users/'+username).once('value');
  if(!snap.exists())throw error('Hồ sơ Admin không tồn tại.',404);
  const current=goodAmount(snap.val()?.balance);
  if(current===null||expected!==current)throw error('Số dư đã thay đổi, hãy xem lại báo cáo trước khi phân loại.',409);
  const ref=ctx.db.ref('wallet_test/'+username);
  const record={username,legacyBalanceVnd:current,classification:'simulation_only',
    spendableInLive:false,labeledAt:Date.now(),labeledBy:ctx.uid,
    note:'Metadata only. Legacy balance never becomes spendable real funds.'};
  const result=await ref.transaction(v=>v===null?record:undefined,undefined,false);
  if(!result.committed){
    const old=(await ref.once('value')).val();
    if(old && old.classification==='simulation_only' && old.spendableInLive===false && old.legacyBalanceVnd===current)
      return res.status(200).json({ok:true,duplicate:true,legacyBalanceChanged:false,spendableInLive:false});
    throw error('Đã có nhãn khác hoặc số dư không khớp. Không tự thay đổi.',409);
  }
  return res.status(201).json({ok:true,recorded:true,legacyBalanceChanged:false,spendableInLive:false});
}

module.exports=async function wallet(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  try {
    const action=String(req.query?.action||'');
    if(action==='audit')return await audit(req,res);
    if(action==='review')return await review(req,res);
    if(action==='status')return await status(req,res);
    if(action==='label_test')return await labelTest(req,res);
    return res.status(404).json({ok:false,error:'Unknown wallet action'});
  } catch(e) {return jsonError(res,e)}
};
