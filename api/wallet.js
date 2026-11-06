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

/** Read-only view of a locked real wallet. Never treat users.balance as real money. */
async function status(req,res) {
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const ctx=await identity(req);
  const [accountSnap,genesisSnap]=await Promise.all([
    ctx.db.ref('wallet_accounts/'+ctx.uid).once('value'),
    ctx.db.ref('wallet_ledger/'+ctx.uid+'/genesis_locked_v1').once('value')
  ]);
  const wallet=accountSnap.val();
  const exists=accountSnap.exists();
  const walletLocked=!!(exists && wallet.status==='locked' && wallet.availableVnd===0 && wallet.heldVnd===0);
  return res.status(200).json({ok:true,username:ctx.username,
    legacyBalanceVnd:ctx.profile.balance,verifiedSpendableBalanceVnd:null,
    legacyWalletSpendable:false,automaticCreditsEnabled:false,checkoutEnabled:false,
    walletAccount:{exists,status:exists?String(wallet.status||'unknown'):'not_initialized',
      availableVnd:walletLocked?0:null,heldVnd:walletLocked?0:null,
      ledgerInitialized:genesisSnap.exists(),spendable:false},
    message:'Ví thật mới vẫn khóa. Số dư lịch sử không thể dùng thanh toán.'});
}

/** Idempotent admin-only creation of a ZERO-VND, permanently LOCKED starting wallet.
 * Does not fund, transfer, release, refund, purchase, or rewrite legacy balances.
 * An initial ledger event is also written (with a safe retry if first write partially succeeds).
 */
async function initLocked(req,res) {
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  checkOrigin(req);
  const ctx=await identity(req,{adminOnly:true});
  if (ctx.username!=='adminkit' || ctx.username!==configuredAdminUsername() ||
      req.body?.confirmZeroVnd!==true || req.body?.confirmNoLegacyTransfer!==true)
    throw error('Chỉ Admin adminkit được khởi tạo ví thật 0đ sau khi xác nhận.',422);
  if (!/^[A-Za-z0-9_-]{4,160}$/.test(ctx.uid)) throw error('Firebase UID không hợp lệ.',422);
  const testSnap=await ctx.db.ref('wallet_test/adminkit').once('value');
  const label=testSnap.val();
  if (!label || label.classification!=='simulation_only' || label.spendableInLive!==false ||
      goodAmount(label.legacyBalanceVnd)===null)
    throw error('Phải phân loại tiền thử nghiệm của adminkit trước.',409);
  const expected=goodAmount(req.body?.observedLegacyBalanceVnd);
  const legacySnap=await ctx.db.ref('users/adminkit/balance').once('value');
  const legacy=goodAmount(legacySnap.val());
  if (legacy===null || expected!==legacy || legacy!==label.legacyBalanceVnd)
    throw error('Số dư cũ không khớp nhãn thử nghiệm. Tải lại báo cáo.',409);
  const accountRef=ctx.db.ref('wallet_accounts/'+ctx.uid);
  const ts=Date.now();
  const fresh={uid:ctx.uid,username:'adminkit',currency:'VND',availableVnd:0,heldVnd:0,
    status:'locked',version:1,source:'zero_initialization',legacyFundsImported:false,
    paymentEnabled:false,createdBy:ctx.uid,createdAt:ts};
  const created=await accountRef.transaction(v=>v===null?fresh:undefined,undefined,false);
  if (!created.committed) {
    const existing=(await accountRef.once('value')).val();
    if(!existing || existing.uid!==ctx.uid || existing.username!=='adminkit' ||
       existing.currency!=='VND' || existing.status!=='locked' ||
       existing.availableVnd!==0 || existing.heldVnd!==0 ||
       existing.legacyFundsImported!==false || existing.source!=='zero_initialization' ||
       existing.paymentEnabled!==false || existing.version!==1)
      throw error('Ví đã tồn tại với trạng thái khác; không ghi đè. Yêu cầu kiểm tra thủ công.',409);
  }
  const ledgerRef=ctx.db.ref('wallet_ledger/'+ctx.uid+'/genesis_locked_v1');
  const entry={id:'genesis_locked_v1',uid:ctx.uid,type:'bootstrap_zero_locked',
    deltaVnd:0,availableAfterVnd:0,heldAfterVnd:0,status:'non_financial',
    externalTransactionId:null,createdAt:created.committed?ts:Date.now(),
    note:'Khởi tạo ví khóa 0đ. Không chuyển hoặc công nhận tiền lịch sử.'};
  const log=await ledgerRef.transaction(v=>v===null?entry:undefined,undefined,false);
  if(!log.committed) {
    const prior=(await ledgerRef.once('value')).val();
    if(!prior || prior.type!=='bootstrap_zero_locked' || prior.uid!==ctx.uid ||
       prior.deltaVnd!==0 || prior.availableAfterVnd!==0 || prior.heldAfterVnd!==0)
      throw error('Nhật ký khởi tạo ví không khớp, cần kiểm tra thủ công.',409);
  }
  return res.status(created.committed?201:200).json({ok:true,created:created.committed,
    duplicate:!created.committed,availableVnd:0,heldVnd:0,status:'locked',
    ledgerInitialized:true,legacyBalanceChanged:false,livePurchasesEnabled:false});
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
    if(action==='init_locked')return await initLocked(req,res);
    if(action==='label_test')return await labelTest(req,res);
    return res.status(404).json({ok:false,error:'Unknown wallet action'});
  } catch(e) {return jsonError(res,e)}
};
