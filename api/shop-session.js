'use strict';
/** Legacy plaintext-password sessions have been disabled. Firebase Auth ID tokens are required. */
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method==='DELETE'){
    res.setHeader('Set-Cookie','kp_shop_session=; Path=/api; HttpOnly; SameSite=Strict; Secure; Max-Age=0');
    return res.status(200).json({ok:true});
  }
  return res.status(410).json({ok:false,error:'Legacy password sessions disabled. Please use Firebase Authentication.'});
};
