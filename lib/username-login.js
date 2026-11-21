'use strict';
/**
 * Secure username alias for Firebase EMAIL/PASSWORD accounts.
 * No RTDB/legacy passwords are ever inspected or accepted.
 * Identity Toolkit validates the password; both username->UID bindings are checked
 * before minting a short-lived Firebase custom sign-in token for that SAME UID.
 */
const USERNAME=/^[a-z0-9_-]{3,60}$/;
const UID=/^[A-Za-z0-9_-]{10,160}$/;
const DEFAULT_FIREBASE_WEB_API_KEY='AIzaSyA5yA1Wc_KrRPVnGsYsKF_FnY901ApfB_E'; // Public Firebase web configuration, NOT a secret.

function loginError(message,status=401){const e=new Error(message);e.status=status;return e;}
const generic=()=>loginError('Tên tài khoản hoặc mật khẩu Firebase không đúng, hoặc chưa liên kết. Nếu chỉ đăng nhập bằng Google, hãy dùng nút Google.');
function normalizeHost(host){
  try{return new URL('https://'+String(host||'')).hostname.toLowerCase();}catch{return '';}
}
function authUid(binding){return typeof binding==='string'?binding:binding?.username;}

async function verifyTurnstile({token,hostname,remoteip,secret,fetchFn}){
  if(!secret)throw loginError('Chưa cấu hình TURNSTILE_SECRET_KEY trên Vercel để bật đăng nhập bằng tên tài khoản.',503);
  if(typeof token!=='string'||token.length<20||token.length>4096)throw loginError('Hãy hoàn tất xác minh Cloudflare trước khi đăng nhập.',400);
  const body=new URLSearchParams({secret,response:token});
  if(remoteip && /^[0-9a-fA-F:.]{3,45}$/.test(remoteip))body.set('remoteip',remoteip);
  let response;
  try{response=await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString(),signal:AbortSignal.timeout(8000)
  });}catch{throw loginError('Không thể xác minh Cloudflare lúc này. Hãy thử lại.',503);}
  if(!response.ok)throw loginError('Không thể xác minh Cloudflare lúc này. Hãy thử lại.',503);
  let data;
  try{data=await response.json();}catch{throw loginError('Phản hồi Cloudflare không hợp lệ.',503);}
  if(data.success!==true || !hostname || !data.hostname || String(data.hostname).toLowerCase()!==hostname)
    throw loginError('Xác minh Cloudflare không hợp lệ hoặc đã hết hạn. Hãy thử lại.',403);
}

async function loginWithUsername({username,password,turnstileToken,hostname,remoteip,sdk,db,
  adminUid,adminUsername='adminkit',turnstileSecret,webApiKey=DEFAULT_FIREBASE_WEB_API_KEY,fetchFn=fetch}){
  const name=String(username||'').trim().toLowerCase();
  if(!USERNAME.test(name)||typeof password!=='string'||!password||password.length>512)throw generic();
  if(!UID.test(String(adminUid||'')))throw loginError('Thiếu MAIN_ADMIN_GOOGLE_UID trong cấu hình máy chủ.',503);
  if(!webApiKey||!/^[A-Za-z0-9_-]{20,80}$/.test(webApiKey))throw loginError('Cấu hình Firebase Web API key chưa hợp lệ.',503);
  await verifyTurnstile({token:turnstileToken,hostname,remoteip,secret:turnstileSecret,fetchFn});

  const isAdmin=name===adminUsername;
  let uid;
  if(isAdmin){
    uid=adminUid;
  }else{
    const record=(await db.ref('users/'+name).once('value')).val();
    uid=record?.authUid;
    // A historical username is NOT proof that its password belongs to the owner.
    // Require verified, bidirectional Firebase account linking before authenticating.
    if(!UID.test(String(uid||''))||uid===adminUid)throw generic();
    const binding=(await db.ref('auth_bindings/'+uid).once('value')).val();
    if(authUid(binding)!==name)throw generic();
  }
  let user;
  try{user=await sdk.auth().getUser(uid);}catch{throw generic();}
  if(!user||user.disabled||!user.emailVerified||!user.email)throw generic();

  let response;
  try{
    response=await fetchFn('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(webApiKey),{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:user.email,password,returnSecureToken:true}),
      signal:AbortSignal.timeout(10000)
    });
  }catch{throw loginError('Không kết nối được Firebase Authentication. Hãy thử lại.',503);}
  if(!response.ok){
    // Never return whether the username exists, its email, or the Firebase API error.
    if(response.status===429)throw loginError('Quá nhiều lần thử đăng nhập. Vui lòng thử lại sau.',429);
    throw generic();
  }
  let result;
  try{result=await response.json();}catch{throw loginError('Firebase Authentication trả về phản hồi không hợp lệ.',503);}
  if(!result||result.localId!==uid||!result.idToken)throw generic();
  // Double-check Google-signed ID token rather than trusting only a JSON localId.
  let checked;
  try{checked=await sdk.auth().verifyIdToken(result.idToken,true);}catch{throw generic();}
  if(checked.uid!==uid||checked.firebase?.sign_in_provider!=='password')throw generic();
  return {customToken:await sdk.auth().createCustomToken(uid),username:name};
}
module.exports={loginWithUsername,verifyTurnstile,normalizeHost,DEFAULT_FIREBASE_WEB_API_KEY};
