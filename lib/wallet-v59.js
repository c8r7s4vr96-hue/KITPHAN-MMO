'use strict';
/** V5.9 non-payable, owner-bound deposit REQUEST DRAFTS ONLY.
 * No transfer instructions, bank coordinates, VietQR, webhook receipt, bank confirmation,
 * wallet accounting, ledger mutation or supplier purchase. Every draft is NOT payable.
 */
const crypto=require('node:crypto');
const {validCustomerLocked,validGenesis,GENESIS,blockedEnvironment}=require('./wallet-v58');
const CODE_RE=/^KP59D[A-F0-9]{24}$/;
const ID_RE=/^[a-f0-9]{24}$/;
const UID_RE=/^[A-Za-z0-9_-]{4,160}$/;
const USERNAME_RE=/^[a-z0-9_-]{3,60}$/;
const TTL_MS=20*60*1000;
const DAILY_LIMIT=5;
function problem(message,status){return Object.assign(new Error(message),{status});}
function goodAmount(n){return typeof n==='number' && Number.isSafeInteger(n) && n>=10000 && n<=10000000 && n%1000===0;}
function safeEnvironment(env=process.env){return !blockedEnvironment(env) &&
  env.ACCOUNT_ADMIN_WALLET_ENABLED!=='true' && env.V55_ADMIN_QR_PREVIEW_ENABLED!=='true' &&
  env.SHOP_WALLET_RULES_SECURED!=='true' && env.SHOP_SUPPLIER_PURCHASE_CONFIRMED!=='true';}
function validDraft(d){return !!(d && typeof d==='object' && d.version==='5.9' &&
  d.type==='deposit_request_draft' && d.status==='draft_unpayable' &&
  d.payable===false && d.credited===false && d.bankVerified===false &&
  d.walletStatus==='locked' && UID_RE.test(d.uid||'') && USERNAME_RE.test(d.username||'') &&
  ID_RE.test(d.id||'') && CODE_RE.test(d.code||'') && goodAmount(d.amountVnd) &&
  Number.isSafeInteger(d.createdAt) && d.createdAt>0 &&
  Number.isSafeInteger(d.expiresAt) && d.expiresAt===d.createdAt+TTL_MS &&
  d.historyKey===String(d.createdAt).padStart(13,'0')+'_'+d.id);
}
function publicDraft(d,now=Date.now()){
  if(!validDraft(d))return null;
  return {id:d.id,draftReference:d.code,amountVnd:d.amountVnd,
    createdAt:d.createdAt,expiresAt:d.expiresAt,
    status:now>=d.expiresAt?'expired_draft':'draft_unpayable',
    payable:false,credited:false,bankVerified:false,qrAvailable:false,
    bankAccountAvailable:false,transferContentAvailable:false,notForBankTransfer:true};
}
function newDraft(uid,username,amountVnd,now){
  const id=crypto.randomBytes(12).toString('hex');
  const code='KP59D'+crypto.randomBytes(12).toString('hex').toUpperCase();
  return {version:'5.9',type:'deposit_request_draft',status:'draft_unpayable',
    uid,username,id,code,amountVnd,createdAt:now,expiresAt:now+TTL_MS,
    historyKey:String(now).padStart(13,'0')+'_'+id,
    walletStatus:'locked',payable:false,credited:false,bankVerified:false};
}
async function requireZeroWallet(db,uid,username){
  const [wallet,genesis]=await Promise.all([
    db.ref('wallet_accounts/'+uid).once('value'),
    db.ref('wallet_ledger/'+uid+'/'+GENESIS).once('value')]);
  if(!validCustomerLocked(wallet.val(),uid,username)||!validGenesis(genesis.val(),uid))
    throw problem('Ví khách phải được khởi tạo 0đ, khóa và có nhật ký V5.8 hợp lệ trước.',409);
}
async function ensureDraftRecords(db,d){
  if(!validDraft(d))throw problem('Dự thảo không hợp lệ, từ chối ghi nhận.',409);
  const claim=(await db.ref('wallet_deposit_v59_codes/'+d.code).once('value')).val();
  if(!claim || claim.uid!==d.uid || claim.id!==d.id || claim.code!==d.code || claim.payable!==false)
    throw problem('Mã dự thảo chưa có xác nhận lưu trữ hợp lệ.',409);
  const historyRef=db.ref('wallet_deposit_v59_history/'+d.uid+'/'+d.historyKey);
  const history=await historyRef.transaction(v=>v===null?d:undefined,undefined,false);
  if(!history.committed){const old=(await historyRef.once('value')).val();
    if(!validDraft(old)||old.uid!==d.uid||old.id!==d.id||old.code!==d.code)
      throw problem('Lịch sử dự thảo không khớp.',409);
  }
  const q={id:d.id,uid:d.uid,username:d.username,code:d.code,amountVnd:d.amountVnd,
    createdAt:d.createdAt,expiresAt:d.expiresAt,status:'draft_unpayable',
    payable:false,credited:false,bankVerified:false};
  const queueRef=db.ref('wallet_deposit_v59_admin_queue/'+d.historyKey);
  const queue=await queueRef.transaction(v=>v===null?q:undefined,undefined,false);
  if(!queue.committed){const old=(await queueRef.once('value')).val();
    if(!old||old.uid!==d.uid||old.id!==d.id||old.code!==d.code||old.payable!==false)
      throw problem('Hàng chờ Admin không khớp.',409);
  }
}
async function createDraft(db,uid,username,amountVnd,{now=Date.now(),environment=process.env}={}){
  if(!UID_RE.test(uid)||!USERNAME_RE.test(username)||username==='adminkit')
    throw problem('Chỉ tài khoản khách đã xác thực được tạo dự thảo.',403);
  if(!safeEnvironment(environment))throw problem('Cờ thanh toán Live chưa an toàn; ngừng tạo bản nháp.',503);
  if(!goodAmount(amountVnd))throw problem('Số tiền phải từ 10.000 đến 10.000.000đ, chia hết cho 1.000.',422);
  await requireZeroWallet(db,uid,username);
  const activeRef=db.ref('wallet_deposit_v59_active/'+uid);
  const old=(await activeRef.once('value')).val();
  if(old){
    if(!validDraft(old)||old.uid!==uid||old.username!==username)throw problem('Dữ liệu yêu cầu hiện tại không hợp lệ.',409);
    if(old.expiresAt>now){
      if(old.amountVnd!==amountVnd)throw problem('Đang có dự thảo số tiền khác. Chờ hết hạn rồi tạo lại.',409);
      await ensureDraftRecords(db,old);
      return {created:false,duplicate:true,draft:publicDraft(old,now)};
    }
  }
  const day=new Date(now).toISOString().slice(0,10).replaceAll('-','');
  const rate=await db.ref('wallet_deposit_v59_daily/'+uid+'/'+day).transaction(v=>{
    const count=Number.isSafeInteger(v?.count)&&v.count>=0?v.count:0;
    return count>=DAILY_LIMIT?undefined:{count:count+1,lastAt:now};
  },undefined,false);
  if(!rate.committed)throw problem('Đã đạt giới hạn 5 dự thảo/ngày.',429);
  let draft,claimed;
  for(let i=0;i<4;i++){
    draft=newDraft(uid,username,amountVnd,now);
    claimed=await db.ref('wallet_deposit_v59_codes/'+draft.code).transaction(v=>v===null
      ?{uid,id:draft.id,code:draft.code,createdAt:now,payable:false}:undefined,undefined,false);
    if(claimed.committed)break;
  }
  if(!claimed?.committed)throw problem('Không đặt được mã dự thảo duy nhất.',503);
  const tx=await activeRef.transaction(v=>{
    if(v===null)return draft;
    if(!validDraft(v)||v.uid!==uid||v.username!==username||v.expiresAt>now)return undefined;
    return draft;
  },undefined,false);
  if(!tx.committed){
    const other=(await activeRef.once('value')).val();
    if(validDraft(other)&&other.uid===uid&&other.username===username&&other.expiresAt>now&&other.amountVnd===amountVnd){
      await ensureDraftRecords(db,other);
      return {created:false,duplicate:true,draft:publicDraft(other,now)};
    }
    throw problem('Đã có yêu cầu khác. Hãy tải lại trạng thái.',409);
  }
  await ensureDraftRecords(db,draft);
  return {created:true,duplicate:false,draft:publicDraft(draft,now)};
}
async function readOwner(db,uid,{now=Date.now()}={}){
  if(!UID_RE.test(uid))throw problem('UID không hợp lệ.',422);
  const [active,history]=await Promise.all([
    db.ref('wallet_deposit_v59_active/'+uid).once('value'),
    db.ref('wallet_deposit_v59_history/'+uid).limitToLast(10).once('value')]);
  const items=Object.values(history.val()||{}).filter(d=>d&&d.uid===uid).map(d=>publicDraft(d,now))
    .filter(Boolean).sort((a,b)=>b.createdAt-a.createdAt).slice(0,10);
  const a=active.val();
  return {activeDraft:a?.uid===uid?publicDraft(a,now):null,recentDrafts:items};
}
async function readAdminQueue(db,{now=Date.now()}={}){
  const snap=await db.ref('wallet_deposit_v59_admin_queue').limitToLast(20).once('value');
  return Object.values(snap.val()||{}).filter(q=>q&&UID_RE.test(q.uid||'')&&
      USERNAME_RE.test(q.username||'')&&ID_RE.test(q.id||'')&&CODE_RE.test(q.code||'')&&
      goodAmount(q.amountVnd)&&q.payable===false&&q.credited===false&&q.bankVerified===false&&
      Number.isSafeInteger(q.createdAt)&&Number.isSafeInteger(q.expiresAt))
    .map(q=>({username:q.username,customerUid:q.uid,amountVnd:q.amountVnd,
      draftReference:q.code,createdAt:q.createdAt,expiresAt:q.expiresAt,
      status:now>=q.expiresAt?'expired_draft':'draft_unpayable',payable:false,
      bankVerified:false,credited:false}))
    .sort((a,b)=>b.createdAt-a.createdAt).slice(0,20);
}
module.exports={TTL_MS,DAILY_LIMIT,goodAmount,safeEnvironment,validDraft,publicDraft,
  requireZeroWallet,createDraft,readOwner,readAdminQueue};
