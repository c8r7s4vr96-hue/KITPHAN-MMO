'use strict';
/** One Vercel Function for three secure wallet endpoints on Hobby.
 * action=audit: GET, admin-only; action=review: POST, admin-only;
 * action=status: GET, owner only. No wallet credit/debit here.
 */
const {identity,checkOrigin,configuredAdminUsername} = require('../lib/secure-accounts');
const {jsonError,error} = require('../lib/shop-common');
const {USERNAME,goodAmount,str,summarize} = require('../lib/wallet-audit');
const ID=/^[a-zA-Z0-9_-]{12,90}$/;
const crypto=require('node:crypto');
const {makeCode,goodTestAmount,validUid}=require('../lib/wallet-sandbox');
const {makeDraftCode,goodDraftAmount,isValidLiveAccount}=require('../lib/wallet-live-intake');
const {makePreviewCode,makePreviewId,goodPreviewAmount,validPreview,publicPreview,DURATION_MS}=require('../lib/wallet-live-previews');
const {buildAdminQrUrl,resolvePreview,validBankConfig,strictLockedWallet}=require('../lib/wallet-v55');
const {summarizeEvents}=require('../lib/wallet-v56');
const {evaluateLaunchSafety}=require('../lib/wallet-v57');
const {GENESIS,initializeCustomerZeroWallet}=require('../lib/wallet-v58');

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
  const [accountSnap,genesisSnap,customerGenesisSnap]=await Promise.all([
    ctx.db.ref('wallet_accounts/'+ctx.uid).once('value'),
    ctx.db.ref('wallet_ledger/'+ctx.uid+'/genesis_locked_v1').once('value'),
    ctx.db.ref('wallet_ledger/'+ctx.uid+'/'+GENESIS).once('value')
  ]);
  const wallet=accountSnap.val();
  const exists=accountSnap.exists();
  const walletLocked=!!(exists && wallet.uid===ctx.uid && wallet.username===ctx.username &&
    wallet.status==='locked' && wallet.availableVnd===0 && wallet.heldVnd===0 &&
    wallet.paymentEnabled===false && wallet.legacyFundsImported===false);
  return res.status(200).json({ok:true,username:ctx.username,
    legacyBalanceVnd:ctx.profile.balance,verifiedSpendableBalanceVnd:null,
    legacyWalletSpendable:false,automaticCreditsEnabled:false,checkoutEnabled:false,
    walletAccount:{exists,status:exists?String(wallet.status||'unknown'):'not_initialized',
      availableVnd:walletLocked?0:null,heldVnd:walletLocked?0:null,
      ledgerInitialized:genesisSnap.exists()||customerGenesisSnap.exists(),spendable:false},
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

/** Strong sandbox gate: a single configured Firebase Auth UID and the legacy Admin username.
 * Never accept user-supplied usernames, profile role or browser-controlled admin flags.
 */
function requireExclusiveSandboxAdmin(ctx){
  const allowedUid=String(process.env.MAIN_ADMIN_GOOGLE_UID||'').trim();
  if(!validUid(allowedUid) || ctx.uid!==allowedUid || ctx.isAdmin!==true ||
     ctx.username!=='adminkit' || configuredAdminUsername()!=='adminkit')
    throw error('Chỉ Google Admin adminkit được sử dụng SePay Sandbox.',403);
}

/** Admin-only sandbox test. Creating an instruction NEVER credits money. No live account is touched. */
async function sandboxPrepare(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  checkOrigin(req);
  const ctx=await identity(req,{adminOnly:true});
  if(process.env.WALLET_SANDBOX_ENABLED!=='true')throw error('Chế độ mô phỏng đang tắt.',423);
  requireExclusiveSandboxAdmin(ctx);
  const amount=req.body?.amountVnd;
  if(!goodTestAmount(amount)||req.body?.confirmSimulationOnly!==true)throw error('Chọn số tiền thử hợp lệ và xác nhận không chuyển tiền thật.',422);
  const wallet=(await ctx.db.ref('wallet_accounts/'+ctx.uid).once('value')).val();
  const label=(await ctx.db.ref('wallet_test/'+ctx.username).once('value')).val();
  if(!wallet||wallet.status!=='locked'||wallet.availableVnd!==0||wallet.heldVnd!==0||wallet.paymentEnabled!==false||label?.classification!=='simulation_only')
    throw error('Ví thật phải khóa 0đ và tiền cũ phải được phân loại riêng trước khi thử.',409);
  const ref=ctx.db.ref('wallet_sandbox_active/'+ctx.uid);
  const timestamp=Date.now();
  const fresh={intentId:crypto.randomBytes(10).toString('hex'),code:makeCode(),amountVnd:amount,
    uid:ctx.uid,username:ctx.username,status:'awaiting_test_transfer',createdAt:timestamp,expiresAt:timestamp+30*60000};
  // Never overwrite another outstanding intent. One active test request per Admin.
  const tx=await ref.transaction(v=>{
    if(v&&v.status==='awaiting_test_transfer'&&v.expiresAt>timestamp)return undefined;
    return fresh;
  },undefined,false);
  const intent=tx.committed?fresh:(await ref.once('value')).val();
  if(!intent||intent.uid!==ctx.uid||intent.status!=='awaiting_test_transfer')throw error('Yêu cầu trước đang được xử lý; tải lại trạng thái.',409);
  // Reserve a code uniquely even if a request is retried after a partial failure.
  const codeRef=ctx.db.ref('wallet_sandbox_codes/'+intent.code);
  const claimed=await codeRef.transaction(v=>v===null?{uid:ctx.uid,intentId:intent.intentId,code:intent.code,createdAt:intent.createdAt}:undefined,undefined,false);
  if(!claimed.committed){
    const existing=(await codeRef.once('value')).val();
    if(!existing||existing.uid!==ctx.uid||existing.intentId!==intent.intentId)throw error('Mã mô phỏng đã bị giữ; không sử dụng, liên hệ Admin.',409);
  }
  return res.status(200).json({ok:true,sandboxOnly:true,creditedRealWallet:false,amountVnd:intent.amountVnd,
    expiresAt:intent.expiresAt,transferContent:'NAP '+intent.code,expectedCode:intent.code,
    message:'Chỉ dùng SePay Test mode, KHÔNG chuyển tiền thật.'});
}

async function sandboxStatus(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const ctx=await identity(req,{adminOnly:true});
  requireExclusiveSandboxAdmin(ctx);
  const enabled=process.env.WALLET_SANDBOX_ENABLED==='true';
  const [sim,active,real]=await Promise.all([
    ctx.db.ref('wallet_sandbox_accounts/'+ctx.uid).once('value'),
    ctx.db.ref('wallet_sandbox_active/'+ctx.uid).once('value'),
    ctx.db.ref('wallet_accounts/'+ctx.uid).once('value')
  ]);
  const v=sim.val(),a=active.val(),r=real.val();
  return res.status(200).json({ok:true,sandboxEnabled:enabled,sandboxBalanceVnd:Number.isSafeInteger(v?.availableVnd)?v.availableVnd:0,
    sandboxLedgerCount:Object.keys(v?.ledger||{}).length,
    activeIntent:a?{amountVnd:a.amountVnd,status:a.status,expiresAt:a.expiresAt,transferContent:'NAP '+a.code}:null,
    realWallet:{status:r?.status||'not_initialized',availableVnd:Number.isSafeInteger(r?.availableVnd)?r.availableVnd:null,paymentEnabled:r?.paymentEnabled===true},
    noRealCredits:true,noSupplierPurchases:true});
}

/** V5.3 Admin-only preflight. These checks only report configuration: they DO NOT
 * authorize receiving real funds, crediting money, or unblocking purchases.
 */
async function depositReadiness(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const ctx=await identity(req,{adminOnly:true});
  requireExclusiveSandboxAdmin(ctx);
  const [account,events]=await Promise.all([
    ctx.db.ref('wallet_accounts/'+ctx.uid).once('value'),
    ctx.db.ref('wallet_live_payment_events').limitToLast(12).once('value')
  ]);
  const w=account.val();
  const eventItems=Object.values(events.val()||{}).filter(v=>v&&typeof v==='object').slice(-12).map(v=>({
    transactionId:String(v.transactionId||'').slice(0,30),amountVnd:v.amountVnd,
    status:String(v.status||'').slice(0,60),draftMatch:String(v.draftMatch||'').slice(0,50),previewMatch:String(v.previewMatch||'').slice(0,50),
    credited:v.credited===true
  }));
  return res.status(200).json({ok:true,version:'5.5-preparation',
    sandboxEnabled:process.env.WALLET_SANDBOX_ENABLED==='true',
    liveWebhookRecordingEnabled:process.env.SEPAY_LIVE_RECORDING_ENABLED==='true',
    bankAccountConfigured:isValidLiveAccount(process.env.MB_BANK_ACCOUNT_NUMBER),
    liveHmacConfigured:typeof process.env.SEPAY_LIVE_WEBHOOK_SECRET==='string' && process.env.SEPAY_LIVE_WEBHOOK_SECRET.length>=16,
    realWalletLocked:!!(w&&w.status==='locked'&&w.availableVnd===0&&w.heldVnd===0&&w.paymentEnabled===false),
    liveDepositsOpen:false,automaticLiveCreditsEnabled:false,checkoutEnabled:false,
    latestEvents:eventItems,
    message:'CHƯA MỞ NẠP TIỀN THẬT. Webhook Live chỉ ghi nhận để đối soát, không tự cộng ví.'});
}

/** Admin-only dry-run reconciliation code, intentionally WITHOUT bank details/QR.
 * Never describe this code as payable. No customer can create a real deposit intent.
 */
async function depositDraft(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  checkOrigin(req);
  const ctx=await identity(req,{adminOnly:true});
  requireExclusiveSandboxAdmin(ctx);
  if(req.body?.confirmNotPayable!==true || !goodDraftAmount(req.body?.amountVnd))
    throw error('Chỉ tạo bản nháp 10.000–10.000.000đ, không chuyển khoản thật.',422);
  const real=(await ctx.db.ref('wallet_accounts/'+ctx.uid).once('value')).val();
  if(!real||real.status!=='locked'||real.availableVnd!==0||real.heldVnd!==0||real.paymentEnabled!==false)
    throw error('Ví thật phải ở trạng thái LOCKED 0đ.',409);
  // Create unique code first; a partial failure only reserves an unused code.
  const stamp=Date.now();let id,code,claimed;
  for(let i=0;i<3;i++){
    id=crypto.randomBytes(10).toString('hex');code=makeDraftCode();
    claimed=await ctx.db.ref('wallet_live_draft_codes/'+code).transaction(v=>v===null
      ?{code,uid:ctx.uid,draftId:id,createdAt:stamp}:undefined,undefined,false);
    if(claimed.committed)break;
  }
  if(!claimed?.committed)throw error('Không tạo được mã bản nháp duy nhất.',503);
  const draft={id,uid:ctx.uid,username:'adminkit',code,amountVnd:req.body.amountVnd,
    status:'draft_not_payable',createdAt:stamp,expiresAt:stamp+15*60*1000,
    payable:false,credited:false};
  const tx=await ctx.db.ref('wallet_live_drafts/'+ctx.uid+'/'+id)
    .transaction(v=>v===null?draft:undefined,undefined,false);
  if(!tx.committed)throw error('Không ghi được bản nháp đối soát.',503);
  return res.status(201).json({ok:true,draftOnly:true,payable:false,
    liveCreditsEnabled:false,amountVnd:draft.amountVnd,transferContent:'NAP '+code,
    expiresAt:draft.expiresAt,
    message:'MÃ BẢN NHÁP — KHÔNG CHUYỂN KHOẢN THẬT. Không có VietQR.'});
}


/** V5.4: authenticated customer creates ONLY a nonpayable preview (no bank details/QR).
 * Index and queue are stored for later reconciliation design. Client cannot set UID or username.
 * One active preview per UID limits abuse. All financial flags remain hard-coded off.
 */
async function depositPreviewCreate(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  checkOrigin(req);
  const ctx=await identity(req);
  if(req.body?.confirmNoPayment!==true || !goodPreviewAmount(req.body?.amountVnd))
    throw error('Chỉ tạo bản nháp 10.000–10.000.000đ; xác nhận KHÔNG thanh toán.',422);
  if(!/^[A-Za-z0-9_-]{4,160}$/.test(ctx.uid))throw error('UID không hợp lệ.',422);
  const t=Date.now();
  const activeRef=ctx.db.ref('wallet_live_preview_active/'+ctx.uid);
  const existing=(await activeRef.once('value')).val();
  if(existing && validPreview(existing) && existing.expiresAt>t){
    if(existing.amountVnd!==req.body.amountVnd)throw error('Đang có bản nháp khác. Hãy dùng bản nháp hiện tại đến khi hết hạn.',409);
    return res.status(200).json({ok:true,duplicate:true,previewOnly:true,request:publicPreview(existing),
      message:'Đây không phải yêu cầu thanh toán. Không chuyển tiền ngân hàng.'});
  }
  // Restrict number of new previews per day even if a client repeatedly expires/retries.
  const day=new Date(t).toISOString().slice(0,10).replace(/-/g,'');
  const rateRef=ctx.db.ref('wallet_live_preview_daily/'+ctx.uid+'/'+day);
  const limited=await rateRef.transaction(v=>{
    const count=Number.isSafeInteger(v?.count)?v.count:0;
    return count>=12?undefined:{count:count+1,lastAt:t};
  },undefined,false);
  if(!limited.committed)throw error('Đã đạt giới hạn 12 bản nháp mỗi ngày.',429);
  let draft,claim;
  for(let attempt=0;attempt<4;attempt++){
    draft={version:'5.4',id:makePreviewId(),code:makePreviewCode(),uid:ctx.uid,
      username:ctx.username,amountVnd:req.body.amountVnd,createdAt:t,expiresAt:t+DURATION_MS,
      status:'preview_not_payable',payable:false,credited:false};
    draft.historyKey=String(t).padStart(13,'0')+'_'+draft.id;
    claim=await ctx.db.ref('wallet_live_preview_codes/'+draft.code).transaction(v=>v===null
      ?{uid:ctx.uid,id:draft.id,historyKey:draft.historyKey,code:draft.code,createdAt:t}:undefined,undefined,false);
    if(claim.committed)break;
  }
  if(!claim?.committed)throw error('Không thể cấp mã đối soát duy nhất.',503);
  const changed=await activeRef.transaction(v=>{
    if(v && validPreview(v) && v.expiresAt>t)return undefined;
    return draft;
  },undefined,false);
  if(!changed.committed){
    const current=(await activeRef.once('value')).val();
    if(current && validPreview(current) && current.expiresAt>t && current.amountVnd===req.body.amountVnd)
      return res.status(200).json({ok:true,duplicate:true,previewOnly:true,request:publicPreview(current)});
    throw error('Đã có bản nháp đang hoạt động. Hãy tải lại trạng thái.',409);
  }
  // Separate queue writes are non-financial; failed writes never authorize a bank payment.
  const stored=await ctx.db.ref('wallet_live_previews/'+ctx.uid+'/'+draft.historyKey).transaction(v=>v===null?draft:undefined,undefined,false);
  if(!stored.committed)throw error('Không lưu được lịch sử bản nháp, hãy tải lại.',503);
  await ctx.db.ref('wallet_live_preview_admin_queue/'+draft.historyKey).transaction(v=>v===null
    ?{id:draft.id,uid:ctx.uid,username:ctx.username,code:draft.code,amountVnd:draft.amountVnd,
       createdAt:draft.createdAt,expiresAt:draft.expiresAt,status:draft.status,payable:false,credited:false}:undefined,
    undefined,false);
  return res.status(201).json({ok:true,previewOnly:true,liveDepositsOpen:false,
    request:publicPreview(draft),message:'MÃ NHÁP ĐỐI SOÁT. KHÔNG chuyển khoản hoặc dùng QR ngân hàng.'});
}

/** Authenticated owner can view only THEIR preview data. Never return bank details. */
async function depositPreviewStatus(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const ctx=await identity(req);
  const [active,history]=await Promise.all([
    ctx.db.ref('wallet_live_preview_active/'+ctx.uid).once('value'),
    ctx.db.ref('wallet_live_previews/'+ctx.uid).limitToLast(8).once('value')]);
  const items=Object.values(history.val()||{}).map(p=>publicPreview(p)).filter(Boolean)
    .sort((a,b)=>b.createdAt-a.createdAt).slice(0,8);
  return res.status(200).json({ok:true,version:'5.4',previewOnly:true,liveDepositsOpen:false,
    automaticLiveCreditsEnabled:false,bankDetailsAvailable:false,qrAvailable:false,
    activePreview:publicPreview(active.val()),recentPreviews:items});
}

/** Admin-only recent preview queue, not a reconciliation approval or money ledger. */
async function depositPreviewQueue(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const ctx=await identity(req,{adminOnly:true});
  const snap=await ctx.db.ref('wallet_live_preview_admin_queue').limitToLast(15).once('value');
  const previews=Object.values(snap.val()||{}).filter(v=>v && typeof v==='object')
    .map(v=>({username:String(v.username||'').slice(0,60),requestId:String(v.id||'').slice(0,30),
      amountVnd:v.amountVnd,createdAt:v.createdAt,expiresAt:v.expiresAt,
      status:v.expiresAt<=Date.now()?'expired_preview':'preview_not_payable',payable:false,credited:false}))
    .sort((a,b)=>b.createdAt-a.createdAt);
  return res.status(200).json({ok:true,version:'5.4',recentPreviews:previews,
    liveDepositsOpen:false,automaticLiveCreditsEnabled:false});
}


/** V5.5 Admin-only dry-run match: does NOT contact banks or write any Firebase nodes. */
async function v55ReconcileDryRun(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  checkOrigin(req);
  const ctx=await identity(req,{adminOnly:true});
  requireExclusiveSandboxAdmin(ctx);
  const code=String(req.body?.referenceCode||'').trim().toUpperCase();
  if(!goodPreviewAmount(req.body?.amountVnd) || req.body?.confirmNoPayment!==true)
    throw error('Chỉ kiểm tra đối soát giả lập, không chuyển tiền.',422);
  const result=await resolvePreview(ctx.db,code,req.body.amountVnd);
  // An HTTP 200 on a mismatch is misleading: the caller must not mistake a
  // located preview for a successful amount reconciliation.
  if(result.classification!=='preview_not_payable'){
    const explanations={
      preview_amount_mismatch:'TỪ CHỐI ĐỐI SOÁT: Số tiền nhập không khớp với số tiền của bản nháp.',
      expired_preview:'TỪ CHỐI ĐỐI SOÁT: Mã bản nháp đã hết hạn. Hãy tạo bản nháp mới.',
      unmatched_preview:'TỪ CHỐI ĐỐI SOÁT: Mã bản nháp không tồn tại hoặc không còn hợp lệ.',
      invalid_request:'TỪ CHỐI ĐỐI SOÁT: Mã bản nháp hoặc số tiền không hợp lệ.'
    };
    throw error(explanations[result.classification]||'TỪ CHỐI ĐỐI SOÁT: Bản nháp chưa hợp lệ.',422);
  }
  return res.status(200).json({ok:true,version:'5.5',dryRun:true,bankVerified:false,
    financialMutation:false,realWalletCredited:false,liveDepositsOpen:false,
    result:{classification:result.classification,matched:result.matched,
      username:result.username||null,previewId:result.previewId||null,
      amountVnd:result.amountVnd||null,expiresAt:result.expiresAt||null,
      payable:false,credited:false},
    message:'CHỈ MÔ PHỎNG ĐỐI SOÁT. Không có giao dịch ngân hàng hoặc cộng tiền.'});
}

/** V5.5 admin-only engineering preview; cannot be reached by customers.
 * A VietQR image is a REAL TRANSFER INSTRUMENT even if labelled "preview".
 * Disabled by default; explicit separate env and acknowledgment are both required.
 */
async function v55QrAdminPreview(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  checkOrigin(req);
  const ctx=await identity(req,{adminOnly:true});
  requireExclusiveSandboxAdmin(ctx);
  if(process.env.V55_ADMIN_QR_PREVIEW_ENABLED!=='true')
    throw error('QR kiểm tra của Admin đang TẮT. Không cấp QR cho khách.',403);
  if(req.body?.confirmNoPayment!==true || req.body?.acknowledgeRealTransferRisk!==true ||
     !goodPreviewAmount(req.body?.amountVnd))throw error('Chưa xác nhận nguy cơ QR có thể chuyển tiền thật.',422);
  const bank=process.env.MB_BANK_ACCOUNT_NUMBER;
  const name=process.env.MB_BANK_ACCOUNT_NAME;
  if(!validBankConfig(bank,name) || (process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER && bank===process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER))
    throw error('Chưa có cấu hình MB Bank Live riêng biệt và hợp lệ.',503);
  const account=(await ctx.db.ref('wallet_accounts/'+ctx.uid).once('value')).val();
  if(!strictLockedWallet(account))throw error('Ví Admin không còn LOCKED 0đ; ngừng kiểm tra.',409);
  const code=String(req.body?.referenceCode||'').trim().toUpperCase();
  const match=await resolvePreview(ctx.db,code,req.body.amountVnd);
  if(match.classification!=='preview_not_payable')
    throw error('Chỉ xem QR kiểm tra với mã nháp còn hạn và đúng số tiền.',422);
  const qrUrl=buildAdminQrUrl(bank,name,req.body.amountVnd,code);
  if(!qrUrl)throw error('Không dựng được QR MB Bank.',503);
  return res.status(200).json({ok:true,version:'5.5',adminOnly:true,
    engineeringPreviewOnly:true,qrUrl,bank:'MB',accountLast4:bank.slice(-4),
    accountName:name,amountVnd:req.body.amountVnd,referenceCode:code,
    realTransferPossible:true,bankVerified:false,payable:false,credited:false,
    liveDepositsOpen:false,automaticLiveCreditsEnabled:false,
    warning:'CẢNH BÁO: Ảnh VietQR này trỏ vào tài khoản MB Bank thật và CÓ THỂ CHUYỂN TIỀN. CHỈ Admin xem thử; KHÔNG quét hoặc chuyển khoản.'});
}

/** V5.5 configuration readout: never sends secrets, full bank number, or bank QR. */
async function v55Readiness(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const ctx=await identity(req,{adminOnly:true});
  requireExclusiveSandboxAdmin(ctx);
  const bank=process.env.MB_BANK_ACCOUNT_NUMBER||'';
  const wallet=(await ctx.db.ref('wallet_accounts/'+ctx.uid).once('value')).val();
  return res.status(200).json({ok:true,version:'5.5',bank:'MB',
    bankConfigured:validBankConfig(bank,process.env.MB_BANK_ACCOUNT_NAME),
    bankAccountLast4:/^[0-9]{6,25}$/.test(bank)?bank.slice(-4):null,
    hmacConfigured:typeof process.env.SEPAY_LIVE_WEBHOOK_SECRET==='string'&&process.env.SEPAY_LIVE_WEBHOOK_SECRET.length>=16,
    webhookRecordingEnabled:process.env.SEPAY_LIVE_RECORDING_ENABLED==='true',
    adminQrPreviewEnabled:process.env.V55_ADMIN_QR_PREVIEW_ENABLED==='true',
    realWalletLocked:strictLockedWallet(wallet),
    liveDepositsOpen:false,customerQrEnabled:false,automaticLiveCreditsEnabled:false,
    message:'V5.5: chỉ chuẩn bị VietQR và đối soát; khách không nhận QR, không cộng tiền thật.'});
}

/** V5.6: Admin-only read-only safety audit of SePay LIVE event records.
 * Does NOT certify real bank settlement or approve payment.
 * Does not write to wallet_accounts, ledger, users.balance or any other node.
 */
async function v56Audit(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const ctx=await identity(req,{adminOnly:true});
  requireExclusiveSandboxAdmin(ctx);
  const [walletSnap,eventsSnap]=await Promise.all([
    ctx.db.ref('wallet_accounts/'+ctx.uid).once('value'),
    ctx.db.ref('wallet_live_payment_events').limitToLast(25).once('value')
  ]);
  const summary=summarizeEvents(eventsSnap.val());
  return res.status(200).json({ok:true,version:'5.6',readOnly:true,
    realWalletLocked:strictLockedWallet(walletSnap.val()),
    customerPaymentsEnabled:false,liveCreditsEnabled:false,
    bankVerificationAvailable:false,bankVerifiedEventCount:0,
    scanned:summary.scanned,counts:summary.counts,
    integrityAlert:summary.integrityAlert,events:summary.events,
    message:'CHỈ KIỂM TOÁN WEBHOOK. Chữ ký SePay KHÔNG thay thế đối chiếu sao kê MB Bank. Không chuyển khoản để kiểm thử.'});
}

/** V5.7: Admin-only, strictly read-only preflight. This does not enable any live payment path.
 * Admin SDK is used ONLY to read the already isolated wallet and recorded event metadata.
 */
async function v57Preflight(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const ctx=await identity(req,{adminOnly:true});
  requireExclusiveSandboxAdmin(ctx);
  const [walletSnap,eventsSnap]=await Promise.all([
    ctx.db.ref('wallet_accounts/'+ctx.uid).once('value'),
    ctx.db.ref('wallet_live_payment_events').limitToLast(25).once('value')
  ]);
  const report=evaluateLaunchSafety({wallet:walletSnap.val(),events:eventsSnap.val(),environment:process.env});
  return res.status(200).json({ok:true,...report});
}

/** V5.8: owner-only bootstrap of a locked zero VND customer wallet. Not a payable deposit. */
async function v58CustomerWalletInit(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  checkOrigin(req);
  const ctx=await identity(req);
  if(ctx.isAdmin)throw error('Admin đã có quy trình khởi tạo ví riêng.',403);
  if(req.body?.confirmZeroLocked!==true || req.body?.confirmNoLegacyImport!==true ||
     req.body?.confirmNoPayments!==true)
    throw error('Phải đồng ý khởi tạo ví 0đ bị khóa, không nhập số dư cũ và không nhận thanh toán.',422);
  const result=await initializeCustomerZeroWallet(ctx.db,ctx.uid,ctx.username);
  return res.status(result.created?201:200).json({ok:true,version:'5.8',...result,
    message:'Ví khách đã được khởi tạo 0đ và vẫn LOCKED. KHÔNG nhận tiền thật, không thanh toán.'});
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
    if(action==='sandbox_prepare')return await sandboxPrepare(req,res);
    if(action==='sandbox_status')return await sandboxStatus(req,res);
    if(action==='deposit_readiness')return await depositReadiness(req,res);
    if(action==='deposit_draft')return await depositDraft(req,res);
    if(action==='deposit_preview_create')return await depositPreviewCreate(req,res);
    if(action==='deposit_preview_status')return await depositPreviewStatus(req,res);
    if(action==='deposit_preview_queue')return await depositPreviewQueue(req,res);
    if(action==='v56_audit')return await v56Audit(req,res);
    if(action==='v57_preflight')return await v57Preflight(req,res);
    if(action==='v58_customer_wallet_init')return await v58CustomerWalletInit(req,res);
    if(action==='v55_readiness')return await v55Readiness(req,res);
    if(action==='v55_dryrun')return await v55ReconcileDryRun(req,res);
    if(action==='v55_admin_qr_preview')return await v55QrAdminPreview(req,res);
    return res.status(404).json({ok:false,error:'Unknown wallet action'});
  } catch(e) {return jsonError(res,e)}
};
