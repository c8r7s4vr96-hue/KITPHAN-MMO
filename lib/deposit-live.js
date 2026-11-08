'use strict';
const crypto = require('node:crypto');
const ROOT = 'live_deposits_v1';
const CODE = /^KPN[A-F0-9]{24}$/;
const UID = /^[A-Za-z0-9_-]{4,160}$/;
const fail = (message, status=422) => Object.assign(new Error(message), {status});
const amountValid = n => Number.isSafeInteger(n) && n >= 10000 && n <= 10000000 && n % 1000 === 0;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function config(env=process.env) {
  if (!/^[0-9]{6,25}$/.test(env.MB_BANK_ACCOUNT_NUMBER || '') ||
      !env.MB_BANK_ACCOUNT_NAME?.trim() || !env.SEPAY_READ_API_TOKEN?.trim() ||
      /[\r\n]/.test(env.SEPAY_READ_API_TOKEN) ||
      (env.SEPAY_LIVE_WEBHOOK_SECRET || '').length < 16) {
    throw fail('Cấu hình nạp tiền chưa đầy đủ.',503);
  }
  return {account:env.MB_BANK_ACCOUNT_NUMBER,name:env.MB_BANK_ACCOUNT_NAME.trim(),token:env.SEPAY_READ_API_TOKEN.trim()};
}
function enabled(env=process.env) { return env.LIVE_DEPOSITS_ENABLED === 'true'; }
function allowed(uid,env=process.env) {
  const configured=env.LIVE_DEPOSITS_ALLOWED_UIDS || env.MAIN_ADMIN_GOOGLE_UID || '';
  const users=configured.split(',').map(value=>value.trim()).filter(Boolean);
  return enabled(env) && (users.includes('*') || users.includes(uid));
}
// Public, non-secret diagnosis for the signed-in customer. Never return API tokens,
// bank account details, webhook secrets or the admin UID in status responses.
function readiness(uid,env=process.env) {
  if (!enabled(env)) return {ready:false,reason:'disabled',message:'LIVE_DEPOSITS_ENABLED chưa được bật trên Production.'};
  if (!allowed(uid,env)) return {ready:false,reason:'not_allowed',message:'Tài khoản Google này chưa được cấp quyền nạp Live. Kiểm tra MAIN_ADMIN_GOOGLE_UID hoặc LIVE_DEPOSITS_ALLOWED_UIDS.'};
  const missing=[];
  if (!/^[0-9]{6,25}$/.test(env.MB_BANK_ACCOUNT_NUMBER || '')) missing.push('MB_BANK_ACCOUNT_NUMBER');
  if (!env.MB_BANK_ACCOUNT_NAME?.trim()) missing.push('MB_BANK_ACCOUNT_NAME');
  if (!env.SEPAY_READ_API_TOKEN?.trim() || /[\r\n]/.test(env.SEPAY_READ_API_TOKEN)) missing.push('SEPAY_READ_API_TOKEN');
  if ((env.SEPAY_LIVE_WEBHOOK_SECRET || '').length < 16) missing.push('SEPAY_LIVE_WEBHOOK_SECRET');
  if (env.SEPAY_LIVE_RECORDING_ENABLED !== 'true') missing.push('SEPAY_LIVE_RECORDING_ENABLED');
  if (missing.length) return {ready:false,reason:'configuration_incomplete',message:'Thiếu hoặc chưa hợp lệ trên Vercel Production: '+missing.join(', ')+'.'};
  return {ready:true,reason:'ready',message:'Tài khoản được phép tạo QR. Chỉ chuyển khoản khi quy trình đối soát Live đã được kiểm chứng.'};
}
function extractCode(content) {
  if (typeof content !== 'string' || content.length > 2000) return null;
  const matches=[...content.toUpperCase().matchAll(/(?:^|[^A-Z0-9])(KPN[A-F0-9]{24})(?![A-Z0-9])/g)];
  return matches.length === 1 ? matches[0][1] : null;
}
function publicIntent(intent, env=process.env) {
  const payable = readiness(intent.uid,env).ready && intent.status === 'pending' && intent.expiresAt > Date.now();
  const view={code:intent.code,amountVnd:intent.amountVnd,createdAt:intent.createdAt,
    expiresAt:intent.expiresAt,status:intent.status === 'pending' && intent.expiresAt <= Date.now() ? 'expired' : intent.status,
    payable};
  if (payable) {
    const url=new URL('https://img.vietqr.io/image/970422-'+intent.account+'-compact2.png');
    url.searchParams.set('amount',String(intent.amountVnd));
    url.searchParams.set('addInfo',intent.code);
    url.searchParams.set('accountName',intent.accountName);
    Object.assign(view,{accountNumber:intent.account,accountName:intent.accountName,content:intent.code,qrUrl:url.toString()});
  }
  return view;
}
async function createIntent(db,uid,username,amount,env=process.env,now=Date.now()) {
  if (!allowed(uid,env)) throw fail('Nạp tiền chưa mở cho tài khoản này.',503);
  const cfg=config(env);
  if(env.SEPAY_LIVE_RECORDING_ENABLED!=='true')throw fail('Webhook nhận giao dịch chưa được bật trên máy chủ.',503);
  if (!UID.test(uid) || !amountValid(amount)) throw fail('Số tiền từ 10.000đ đến 10.000.000đ, theo bội số 1.000đ.');
  const code='KPN'+crypto.randomBytes(12).toString('hex').toUpperCase();
  const day=new Date(now+7*3600000).toISOString().slice(0,10);
  let chosen;
  const tx=await db.ref(ROOT).transaction(current=>{
    const state=current || {};
    state.intents ||= {};
    state.accounts ||= {};
    const account=state.accounts[uid] || {uid,username,availableVnd:0,totalDepositedVnd:0};
    const previous=state.intents[account.activeCode];
    if (previous?.status==='pending' && previous.expiresAt>now) {
      if (previous.amountVnd!==amount) throw fail('Bạn đang có yêu cầu còn hiệu lực. Hãy dùng yêu cầu đó hoặc chờ hết hạn.',409);
      chosen=previous;
      return state;
    }
    const count=account.day===day ? account.dailyCount || 0 : 0;
    if (count>=10) throw fail('Đã đạt giới hạn 10 yêu cầu mới hôm nay.',429);
    if (state.intents[code]) throw fail('Hãy thử tạo lại yêu cầu.',409);
    chosen={uid,username,code,amountVnd:amount,account:cfg.account,accountName:cfg.name,
      createdAt:Math.floor(now/1000)*1000,expiresAt:now+20*60000,status:'pending'};
    state.intents[code]=chosen;
    state.history ||= {};
    state.history[uid] ||= {};
    state.history[uid][String(now)+'_'+code]=code;
    state.accounts[uid]={...account,activeCode:code,day,dailyCount:count+1};
    return state;
  },undefined,false);
  if (!tx.committed) throw fail('Chưa lưu được yêu cầu. Hãy thử lại.',503);
  return publicIntent(chosen,env);
}
async function providerGet(path,cfg,fetcher=fetch) {
  try {
    const res=await fetcher('https://my.sepay.vn/userapi/'+path,{
      headers:{Authorization:'Bearer '+cfg.token,Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(8000)});
    if (!res.ok) throw Error('provider');
    const data=await res.json();
    if (data?.status!==200 || data?.messages?.success!==true || data.error) throw Error('provider');
    return data;
  } catch { throw fail('Chưa đọc được giao dịch SePay. Vui lòng thử lại.',503); }
}
function normalize(record,account) {
  if (!record || !/^[1-9][0-9]{0,15}$/.test(String(record.id)) ||
      String(record.account_number)!==account || !['MB','MBBank'].includes(record.bank_brand_name) ||
      !/^[0-9]+(?:\.0{1,2})?$/.test(String(record.amount_in)) ||
      !/^0(?:\.0{1,2})?$/.test(String(record.amount_out))) throw fail('Giao dịch không hợp lệ.');
  const amount=Number(record.amount_in);
  const date=record.transaction_date;
  if (!Number.isSafeInteger(amount) || amount<=0 || amount>1000000000 ||
      typeof date!=='string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) throw fail('Giao dịch không hợp lệ.');
  const time=Date.parse(date.replace(' ','T')+'+07:00');
  if (!Number.isSafeInteger(time) || new Date(time+7*3600000).toISOString().slice(0,19).replace('T',' ')!==date || time>Date.now()+300000) throw fail('Thời gian giao dịch không hợp lệ.');
  return {id:String(record.id),amount,account,code:extractCode(record.transaction_content),
    time,reference:String(record.reference_number || '').slice(0,150)};
}
// Claims, intent status, canonical balance and ledger commit at a single RTDB location.
function settleState(current,proof,now=Date.now()) {
  const state=structuredClone(current || {});
  state.events ||= {};
  const key='sepay_'+proof.id;
  const fingerprint=hash(proof);
  const existing=state.events[key];
  if (existing) {
    if (existing.fingerprint!==fingerprint) throw fail('Giao dịch trùng ID nhưng dữ liệu thay đổi. Cần đối soát.',409);
    return state;
  }
  const intent=state.intents?.[proof.code];
  let reason='unmatched';
  if (intent) {
    reason='account_mismatch';
    if (intent.account===proof.account) {
      reason='amount_mismatch';
      if (intent.amountVnd===proof.amount) {
        reason='outside_window';
        if (proof.time>=intent.createdAt && proof.time<=intent.expiresAt) {
          reason=intent.status==='paid' ? 'extra_transfer' : 'wallet_invalid';
          const account=state.accounts?.[intent.uid];
          if (intent.status==='pending' && account && account.uid===intent.uid &&
              Number.isSafeInteger(account.availableVnd) && account.availableVnd>=0 &&
              Number.isSafeInteger(account.totalDepositedVnd) && account.totalDepositedVnd>=0 &&
              account.availableVnd+proof.amount<=1000000000 &&
              Number.isSafeInteger(account.totalDepositedVnd+proof.amount)) {
            account.availableVnd+=proof.amount;
            account.totalDepositedVnd+=proof.amount;
            intent.status='paid';intent.paidAt=now;intent.transactionId=proof.id;
            state.ledger ||= {};
            state.ledger[key]={uid:intent.uid,username:intent.username,code:intent.code,amountVnd:proof.amount,
              availableAfterVnd:account.availableVnd,transactionId:proof.id,createdAt:now};
            reason='credited';
          }
        }
      }
    }
  }
  state.events[key]={...proof,fingerprint,status:reason,uid:intent?.uid || '',
    credited:reason==='credited',recordedAt:now,verificationSource:'sepay_read_api_v1'};
  return state;
}
async function reconcileId(db,id,env=process.env,fetcher=fetch,webhook=null) {
  if (!enabled(env)) throw fail('Nạp tiền đang tạm ngưng.',503);
  if (!/^[1-9][0-9]{0,15}$/.test(String(id))) throw fail('ID giao dịch không hợp lệ.');
  const cfg=config(env);
  const data=await providerGet('transactions/details/'+id,cfg,fetcher);
  const proof=normalize(data.transaction,cfg.account);
  if (proof.id!==String(id)) throw fail('ID giao dịch không khớp.',409);
  if (webhook && (webhook.transferType!=='in' || webhook.transferAmount!==proof.amount ||
      webhook.accountNumber!==proof.account || extractCode(webhook.content)!==proof.code)) {
    throw fail('Webhook chưa khớp API giao dịch.',409);
  }
  const result=await db.ref(ROOT).transaction(state=>settleState(state,proof),undefined,false);
  if (!result.committed) throw fail('Chưa ghi được giao dịch.',503);
  return result.snapshot.val().events['sepay_'+id];
}
async function status(db,uid,env=process.env) {
  const account=(await db.ref(ROOT+'/accounts/'+uid).once('value')).val();
  const history=(await db.ref(ROOT+'/history/'+uid).limitToLast(30).once('value')).val();
  const codes=[...new Set([...Object.values(history || {}),account?.activeCode].filter(Boolean))];
  const records=await Promise.all(codes.map(async code=>(await db.ref(ROOT+'/intents/'+code).once('value')).val()));
  const intents=records.filter(intent=>intent && intent.uid===uid);
  const gate=readiness(uid,env);
  return {enabled:gate.ready,readinessReason:gate.reason,readinessMessage:gate.message,availableVnd:account?.availableVnd || 0,
    totalDepositedVnd:account?.totalDepositedVnd || 0,
    intents:intents.sort((a,b)=>b.createdAt-a.createdAt).map(i=>publicIntent(i,env))};
}
async function checkOwner(db,uid,code,env=process.env,fetcher=fetch) {
  if (!CODE.test(code || '')) throw fail('Mã yêu cầu không hợp lệ.');
  const intent=(await db.ref(ROOT+'/intents/'+code).once('value')).val();
  if (!intent || intent.uid!==uid) throw fail('Không tìm thấy yêu cầu.',404);
  if (!enabled(env)) throw fail('Đối soát tự động đang tạm ngưng.',503);
  const now=Date.now();
  const throttle=await db.ref('live_deposit_checks/'+uid).transaction(last=>
    typeof last==='number' && now-last<15000 ? undefined : now,undefined,false);
  if (!throttle.committed) throw fail('Chờ 15 giây trước khi kiểm tra lại.',429);
  const cfg=config(env);
  const from=new Date(intent.createdAt+7*3600000).toISOString().slice(0,19).replace('T',' ');
  const to=new Date(intent.expiresAt+7*3600000).toISOString().slice(0,19).replace('T',' ');
  const query=new URLSearchParams({account_number:intent.account,transaction_date_min:from,
    transaction_date_max:to,limit:'100'});
  const data=await providerGet('transactions/list?'+query,cfg,fetcher);
  if (!Array.isArray(data.transactions)) throw fail('Phản hồi SePay chưa hợp lệ.',503);
  const matches=data.transactions.filter(row=>extractCode(row.transaction_content)===code);
  // Bound server runtime; admin may reconcile remaining IDs individually.
  for (const row of matches.slice(0,3)) await reconcileId(db,row.id,env,fetcher);
  return {...await status(db,uid,env),scanLimited:data.transactions.length>=100 || matches.length>3};
}
module.exports={ROOT,enabled,readiness,config,extractCode,createIntent,normalize,settleState,reconcileId,status,checkOwner};
