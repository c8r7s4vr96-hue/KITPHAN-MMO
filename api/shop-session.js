'use strict';
const crypto=require('node:crypto');
const {firebase,signSession,digest,checkOrigin,jsonError,error}=require('../lib/shop-common');
function same(a,b){const x=Buffer.from(digest(a)),y=Buffer.from(digest(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(!['POST','DELETE'].includes(req.method))return res.status(405).json({ok:false});
  try{
    checkOrigin(req);
    const secure=String(req.headers['x-forwarded-proto']||'https')==='https';
    const attrs='Path=/api; HttpOnly; SameSite=Strict; '+(secure?'Secure; ':'');
    if(req.method==='DELETE'){
      res.setHeader('Set-Cookie','kp_shop_session=; '+attrs+'Max-Age=0');return res.json({ok:true});
    }
    const username=String(req.body?.username||'').trim().toLowerCase();
    const password=String(req.body?.password||'');
    if(!/^[a-z0-9_-]{3,60}$/.test(username)||password.length<8||password.length>256)throw error('Thông tin đăng nhập không hợp lệ',401);
    const db=firebase().database();
    const remote=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
    const limitRef=db.ref('shop_login_limits/'+digest(remote+':'+username).slice(0,36));
    const result=await limitRef.transaction(v=>{
      const now=Date.now();const row=v&&now-v.at<600000?v:{at:now,count:0};
      if(row.count>=8)return;
      return {at:row.at,count:row.count+1};
    },undefined,false);
    if(!result.committed)throw error('Thử đăng nhập quá nhiều lần. Vui lòng quay lại sau.',429);
    const snap=await db.ref('users/'+username).once('value');const person=snap.val();
    if(!person||!person.password||!same(person.password,password))throw error('Thông tin đăng nhập không chính xác',401);
    // Transitional compatibility for existing legacy accounts. Password migration recommended.
    const cookie=signSession(username);
    await limitRef.remove();
    res.setHeader('Set-Cookie','kp_shop_session='+cookie+'; '+attrs+'Max-Age=604800');
    return res.status(200).json({ok:true});
  }catch(e){return jsonError(res,e)}
};
