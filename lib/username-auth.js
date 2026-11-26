'use strict';
/** Authenticate a linked username with its FIREBASE password, never legacy users.password.
 * Identity Toolkit verifies the password; Firebase Admin verifies the exact linked UID.
 * We return only a short-lived custom Firebase token, NEVER the user's email/password.
 */
const crypto=require('node:crypto');
const {error,checkOrigin}=require('./shop-common');
const {verifiedIdentity,USERNAME,configuredAdmin,configuredAdminUsername}=require('./secure-accounts');
// Firebase Web API key is a PUBLIC project identifier, also present in index.html.
// Override when changing Firebase project. Never use an Admin SDK private key here.
const PUBLIC_FIREBASE_API_KEY='AIzaSyA5yA1Wc_KrRPVnGsYsKF_FnY901ApfB_E';
const GENERIC='Tên đăng nhập hoặc mật khẩu Firebase không đúng, hoặc tài khoản chưa được liên kết. Nếu là tài khoản cũ, hãy khôi phục bằng email đã xác minh.';
const WINDOW_MS=15*60*1000;
async function charge(ref, limit, now){
  const tx=await ref.transaction(v=>{
    const active=v&&Number.isSafeInteger(v.startedAt)&&now>=v.startedAt&&now-v.startedAt<WINDOW_MS;
    const count=active&&Number.isSafeInteger(v.count)?v.count:0;
    if(count>=limit)return undefined;
    return {startedAt:active?v.startedAt:now,count:count+1,expiresAt:now+WINDOW_MS};
  },undefined,false);
  if(!tx.committed){const e=error('Có quá nhiều lần đăng nhập. Vui lòng thử lại sau 15 phút.',429);e.retryAfter='900';throw e;}
}
function ipFrom(req){
  const forwarded=String(req.headers?.['x-forwarded-for']||'').split(',')[0].trim();
  return (forwarded||String(req.headers?.['x-real-ip']||req.socket?.remoteAddress||'unknown')).slice(0,90);
}
async function rateLimit(db, req, username, now=Date.now()){
  // Never store raw IP, username, or password in rate-limit records.
  const salt=String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'kitphan-local');
  const hash=s=>crypto.createHmac('sha256',salt).update(s).digest('hex');
  const ip=ipFrom(req);
  await charge(db.ref('auth_login_attempts_v8/ip_'+hash(ip)),30,now);
  await charge(db.ref('auth_login_attempts_v8/pair_'+hash(ip+'\0'+username)),10,now);
}
async function signInLinkedUsername(req, {firebase,fetcher=fetch,now=Date.now()}={}){
  checkOrigin(req);
  if(req.headers?.['sec-fetch-site'] && !['same-origin','none'].includes(String(req.headers['sec-fetch-site'])))throw error('Invalid request origin',403);
  const username=String(req.body?.username||'').trim().toLowerCase();
  const password=req.body?.password;
  if(!USERNAME.test(username)||typeof password!=='string'||password.length<1||password.length>1024)throw error(GENERIC,401);
  const sdk=firebase();const db=sdk.database();
  await rateLimit(db,req,username,now);
  // Main admin privileges are exclusively via the configured Google UID.
  if(username===configuredAdminUsername())throw error('Admin chính phải đăng nhập bằng nút Google.',403);
  const record=(await db.ref('users/'+username).once('value')).val();
  if(!record || !record.authUid || typeof record.email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email.trim()))throw error(GENERIC,401);
  const apiKey=String(process.env.FIREBASE_WEB_API_KEY||PUBLIC_FIREBASE_API_KEY).trim();
  if(!/^[A-Za-z0-9_-]{15,150}$/.test(apiKey))throw error('Firebase Auth chưa được cấu hình trên máy chủ.',503);
  let response;
  try{
    response=await fetcher('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(apiKey),{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:record.email.trim(),password,returnSecureToken:true}),
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(9000)});
  }catch{throw error('Dịch vụ xác thực Firebase tạm thời không khả dụng.',503);}
  let verified;
  try{verified=await response.json()}catch{throw error('Dịch vụ xác thực Firebase tạm thời không khả dụng.',503);}
  if(!response.ok || typeof verified?.idToken!=='string' || typeof verified?.localId!=='string')throw error(GENERIC,401);
  const uid=verified.localId;
  if(uid===configuredAdmin()||record.authUid!==uid)throw error(GENERIC,401);
  const [binding,claim,user]=await Promise.all([
    db.ref('auth_bindings/'+uid).once('value'),
    db.ref('auth_username_uids/'+username).once('value'),
    sdk.auth().getUser(uid)
  ]);
  const linked=binding.val();
  if((typeof linked==='string'?linked:linked?.username)!==username ||
    (claim.exists()&&claim.val()!==uid)||user.disabled||
    String(user.email||'').trim().toLowerCase()!==record.email.trim().toLowerCase())throw error(GENERIC,401);
  // No legacy plaintext-password matching, account reassignment or database write.
  const customToken=await sdk.auth().createCustomToken(uid,{login_method:'linked_username'});
  return {ok:true,customToken,method:'linked_firebase_username'};
}
module.exports={signInLinkedUsername,rateLimit,GENERIC};
