'use strict';
/** Firebase Auth login audit: never accept legacy passwords or client-controlled Telegram messages. */
const crypto=require('node:crypto');
const {firebase,checkOrigin,error}=require('../lib/shop-common');
const {jsonError}=require('../lib/shop-common');
function clean(v,n=120){return String(v??'').replace(/[<>\x00-\x1f]/g,' ').slice(0,n)}
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false});
  let claimRef,claimed=false;
  try{
    checkOrigin(req);
    if(!['firebase_sign_in','google_sign_in'].includes(String(req.body?.event||'')))throw error('Unsupported login event',400);
    const bearer=String(req.headers.authorization||'');
    if(!bearer.startsWith('Bearer '))throw error('Firebase token required',401);
    const sdk=firebase();const userToken=await sdk.auth().verifyIdToken(bearer.slice(7),true);
    const user=await sdk.auth().getUser(userToken.uid);
    if(user.disabled||!user.emailVerified)throw error('Verified email required',403);
    const hourBucket=Math.floor(Date.now()/60000);
    const key=crypto.createHash('sha256').update('login:'+user.uid+':'+hourBucket).digest('hex');
    claimRef=sdk.database().ref('telegram_auth_events/'+key);
    const claim=await claimRef.transaction(v=>v&&(v.status==='sent'||(v.status==='sending'&&Date.now()-v.at<45000))?undefined:{status:'sending',at:Date.now()},undefined,false);
    if(!claim.committed)return res.status(200).json({ok:true,duplicate:true});
    claimed=true;
    const token=process.env.TELEGRAM_BOT_TOKEN,chat=process.env.TELEGRAM_CHAT_ID;
    if(!token||!chat)throw error('Telegram environment not configured',503);
    const text=['🔐 ĐĂNG NHẬP FIREBASE','📧 '+clean(user.email),'🔑 UID: '+clean(user.uid),'🕒 '+new Date().toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})].join('\n');
    const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text}),signal:AbortSignal.timeout(12000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)throw error('Telegram failed',502);
    await claimRef.set({status:'sent',at:Date.now()});
    return res.json({ok:true});
  }catch(e){
    if(claimed&&claimRef)await claimRef.set({status:'failed',at:Date.now()}).catch(()=>{});
    return jsonError(res,e);
  }
};
