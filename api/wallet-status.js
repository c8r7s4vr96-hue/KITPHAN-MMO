'use strict';
/** Authenticated user wallet status: historical balance is displayed only, not spendable. */
const {identity} = require('../lib/secure-accounts');
const {jsonError} = require('../lib/shop-common');
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET')return res.status(405).json({ok:false});
  try{
    const ctx=await identity(req);
    return res.status(200).json({ok:true,username:ctx.username,
      legacyBalanceVnd:ctx.profile.balance,verifiedSpendableBalanceVnd:null,
      status:'locked_pending_reconciliation',automaticCreditsEnabled:false,
      checkoutEnabled:false,message:'Số dư lịch sử chưa được xác minh với ngân hàng. Tạm ngừng giao dịch.'});
  }catch(e){return jsonError(res,e)}
};
