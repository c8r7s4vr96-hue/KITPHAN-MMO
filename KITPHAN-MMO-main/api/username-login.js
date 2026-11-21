'use strict';
const {firebase,checkOrigin,jsonError,error}=require('../lib/shop-common');
const {configuredAdmin,configuredAdminUsername}=require('../lib/secure-accounts');
const {loginWithUsername,normalizeHost,DEFAULT_FIREBASE_WEB_API_KEY}=require('../lib/username-login');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    checkOrigin(req);
    const contentType=String(req.headers['content-type']||'');
    if(!contentType.startsWith('application/json'))throw error('Dữ liệu đăng nhập không hợp lệ.',415);
    const body=req.body||{};
    const sdk=firebase();
    const hostname=normalizeHost(req.headers.host);
    if(!hostname)throw error('Tên miền yêu cầu không hợp lệ.',400);
    const forwardedIp=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
    const result=await loginWithUsername({
      username:body.username,password:body.password,turnstileToken:body.turnstileToken,
      hostname,remoteip:forwardedIp,sdk,db:sdk.database(),adminUid:configuredAdmin(),
      adminUsername:configuredAdminUsername(),turnstileSecret:process.env.TURNSTILE_SECRET_KEY,
      webApiKey:process.env.FIREBASE_WEB_API_KEY||DEFAULT_FIREBASE_WEB_API_KEY
    });
    return res.status(200).json({ok:true,customToken:result.customToken});
  }catch(e){return jsonError(res,e);}
};
