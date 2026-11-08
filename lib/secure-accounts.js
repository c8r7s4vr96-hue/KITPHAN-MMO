'use strict';
/** Account ownership is proven with Firebase Authentication, NEVER legacy RTDB passwords or a username from the browser. */
const { firebase, checkOrigin, error } = require('./shop-common');
const USERNAME = /^[a-z0-9_-]{3,60}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMIT = 500;
const now = () => Date.now();
const str = (v, n = 160) => String(v ?? '').trim().slice(0, n);
const clean = (v,n=160) => str(v,n).replace(/[\x00-\x1f<>"'`]/g,'');
const amount = n => Number.isSafeInteger(Number(n)) && Number(n) >= 0 ? Number(n) : 0;
const configuredAdmin = () => str(process.env.MAIN_ADMIN_GOOGLE_UID,128);
const configuredAdminUsername = () => str(process.env.MAIN_ADMIN_USERNAME || 'adminkit',60).toLowerCase();

function safeProfile(username, data, isAdmin = false) {
  const u = data || {};
  const avatar = typeof u.avatar === 'string' && /^https:\/\/[a-zA-Z0-9._~:/?&=#%+@-]{1,380}$/.test(u.avatar) ? u.avatar : 'https://placehold.co/100x100/27272a/ffffff?text=User';
  return { username, fullname:clean(u.fullname || username,90), email:clean(u.email,200),
    balance:amount(u.balance), totalDeposited:amount(u.totalDeposited),
    role:isAdmin?'Administrator':'Thành viên', isMainAdmin:isAdmin, avatar,
    walletVerified:process.env.ACCOUNT_WALLET_RECONCILED==='true' };
}
async function verifiedIdentity(req,allowUnverified=false){
  const bearer=String(req.headers.authorization||'');
  if (!bearer.startsWith('Bearer ')) throw error('Hãy đăng nhập bằng Firebase Authentication.',401);
  const sdk=firebase();
  const token=await sdk.auth().verifyIdToken(bearer.slice(7),true);
  const user=await sdk.auth().getUser(token.uid);
  if(!user || user.disabled) throw error('Tài khoản đã bị vô hiệu hóa.',403);
  if(!allowUnverified && !user.emailVerified) throw error('Hãy xác minh email trước khi sử dụng.',403);
  return {sdk, token, user, uid:token.uid, email:String(user.email||'').toLowerCase()};
}
async function identity(req,{allowUnmapped=false,adminOnly=false}={}){
  const auth=await verifiedIdentity(req);
  const db=auth.sdk.database();
  const isAdmin=!!configuredAdmin() && auth.uid===configuredAdmin();
  if(adminOnly && !isAdmin) throw error('Không có quyền Admin website chính.',403);
  let username;
  if(isAdmin){
    username=configuredAdminUsername();
    if(!USERNAME.test(username)) throw error('MAIN_ADMIN_USERNAME không hợp lệ.',503);
  }else{
    const bound=(await db.ref('auth_bindings/'+auth.uid).once('value')).val();
    username=typeof bound === 'string' ? bound : bound?.username;
    if(!USERNAME.test(String(username||''))) {
      if(allowUnmapped) return {...auth,db,isAdmin:false,username:null,profile:null};
      throw error('ACCOUNT_SETUP_REQUIRED',409);
    }
  }
  const snap=await db.ref('users/'+username).once('value');
  if(!snap.exists()) throw error('Tài khoản đã liên kết không tồn tại. Liên hệ Admin.',409);
  const record=snap.val();
  // Explicit admin allowlist alone grants ADMIN privileges; never legacy role or username input.
  if(!isAdmin && record.authUid !== auth.uid) throw error('Liên kết tài khoản chưa được xác minh.',403);
  return {...auth,db,username,isAdmin,record,profile:safeProfile(username,record,isAdmin)};
}
async function ensureUnlinked(auth){
  if(configuredAdmin() && auth.uid===configuredAdmin())throw error('Tài khoản Admin không được tự tạo hoặc nhận thêm username.',403);
  if((await auth.sdk.database().ref('auth_bindings/'+auth.uid).once('value')).exists())throw error('UID đã liên kết với một tài khoản khác.',409);
}
async function createAccount(auth,username,fullname){
  await ensureUnlinked(auth);
  if(!USERNAME.test(username) || username.startsWith('google_') || ['admin','administrator','root'].includes(username)) throw error('Tên đăng nhập không hợp lệ.',422);
  if(!EMAIL.test(auth.email)) throw error('Tài khoản Firebase thiếu email.',422);
  const db=auth.sdk.database();const claimRef=db.ref('auth_username_uids/'+username);
  const claim=await claimRef.transaction(v=>v===null||v===auth.uid?auth.uid:undefined,undefined,false);
  if(!claim.committed) throw error('Tên đăng nhập đã được sử dụng.',409);
  const userRef=db.ref('users/'+username);
  const fresh={username,fullname:clean(fullname,90)||username,email:auth.email,balance:0,totalDeposited:0,role:'Thành viên',authUid:auth.uid,createdAt:now(),avatar:'https://placehold.co/100x100/27272a/ffffff?text=User'};
  const added=await userRef.transaction(v=>v===null?fresh:v?.authUid===auth.uid?v:undefined,undefined,false);
  if(!added.committed){
    // Do not alter existing data on a collision; release only our reserved name.
    await claimRef.transaction(v=>v===auth.uid?null:undefined,undefined,false).catch(()=>{});
    throw error('Tên tài khoản đã tồn tại. Hãy chọn tên khác hoặc yêu cầu khôi phục.',409);
  }
  await db.ref('auth_bindings/'+auth.uid).set({username,linkedAt:now(),kind:'fresh_auth'});
  return safeProfile(username,added.snapshot.val(),false);
}
async function queueMigration(auth,username){
  await ensureUnlinked(auth);
  if(!USERNAME.test(username))throw error('Tên đăng nhập không hợp lệ.',422);
  const db=auth.sdk.database();
  const record=(await db.ref('users/'+username).once('value')).val();
  if(!record) throw error('Không tìm thấy tài khoản cũ. Liên hệ Admin để đối chiếu.',404);
  if(record.authUid) throw error('Tài khoản đã được liên kết.',409);
  if(username===configuredAdminUsername() || record.role==='Administrator') throw error('Tài khoản Admin chỉ được cấp quyền bởi quản trị viên xác thực.',403);
  if(!auth.email || auth.email!==String(record.email||'').trim().toLowerCase()) throw error('Email đã xác minh không trùng email tài khoản cũ. Hãy liên hệ Admin.',403);
  const ref=db.ref('account_migration_requests/'+auth.uid);
  const pending=await ref.transaction(v=>v && v.status==='pending' ? undefined : {uid:auth.uid,username,email:auth.email,status:'pending',requestedAt:now()},undefined,false);
  if(!pending.committed) throw error('Đã có yêu cầu khôi phục đang chờ duyệt.',409);
  return {pending:true,username};
}
function publicOrder(o){return {id:clean(o.id,100),user:clean(o.user,60),platform:clean(o.platform,60),service:clean(o.service,180),link:clean(o.link,350),qty:amount(o.qty),total:amount(o.total),status:clean(o.status,60),date:clean(o.date,50)}};
function publicDeposit(d){return {id:clean(d.id,100),user:clean(d.user,60),amount:amount(d.amount),syntax:clean(d.syntax,100),status:clean(d.status,60),date:clean(d.date,60)}};
function publicTicket(t){return {id:clean(t.id,100),user:clean(t.user,60),subject:clean(t.subject,150),message:clean(t.message,2000),status:clean(t.status,60),date:clean(t.date,60)}};
async function dashboardData(ctx){
  const db=ctx.db;
  const liveAccount=(await db.ref('live_deposits_v1/accounts/'+ctx.uid).once('value')).val();
  if(liveAccount && liveAccount.uid===ctx.uid && Number.isSafeInteger(liveAccount.availableVnd)){
    ctx.profile={...ctx.profile,balance:liveAccount.availableVnd,
      totalDeposited:liveAccount.totalDepositedVnd,walletBalanceSource:'live_deposits_v1'};
  }
  if(!liveAccount && process.env.LIVE_DEPOSITS_ENABLED==='true'){
    ctx.profile={...ctx.profile,balance:0,totalDeposited:0,walletBalanceSource:'live_deposits_v1'};
  }
  const data=await Promise.all([
    ctx.isAdmin?db.ref('users').limitToLast(LIMIT).once('value'):Promise.resolve(null),
    db.ref('orders').limitToLast(LIMIT).once('value'),
    db.ref('deposits').limitToLast(LIMIT).once('value'),
    db.ref('tickets').limitToLast(LIMIT).once('value'),
    liveAccount?db.ref('live_deposits_v1/ledger').orderByChild('uid').equalTo(ctx.uid).limitToLast(100).once('value'):Promise.resolve(null)
  ]);
  const own=(x)=>ctx.isAdmin || x.user===ctx.username;
  const list=(snapshot,fn)=>Object.values(snapshot?.val()||{}).filter(x=>x&&typeof x==='object').filter(own).map(fn).reverse();
  const users=ctx.isAdmin?Object.entries(data[0].val()||{}).filter(([username])=>USERNAME.test(username)).map(([username,val])=>safeProfile(username,val,username===configuredAdminUsername())):[];
  const liveDeposits=Object.values(data[4]?.val()||{}).map(entry=>publicDeposit({
    id:'SEPAY-'+entry.transactionId,user:ctx.username,amount:entry.amountVnd,
    syntax:entry.code,status:'Đã cộng số dư',date:new Date(entry.createdAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})
  }));
  return {ok:true,profile:ctx.profile, users,
    orders:list(data[1],publicOrder),deposits:liveDeposits.length||liveAccount?liveDeposits:list(data[2],publicDeposit),tickets:list(data[3],publicTicket),
    readOnly:process.env.ACCOUNT_WALLET_RECONCILED!=='true',
    legacyOrdersEnabled:false};
}
module.exports={firebase,checkOrigin,error,USERNAME,EMAIL,now,clean,amount,safeProfile,identity,verifiedIdentity,createAccount,queueMigration,dashboardData,configuredAdmin,configuredAdminUsername};
