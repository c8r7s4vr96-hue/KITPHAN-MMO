'use strict';
/** Admin-only read-only audit. Never modifies balances or treats legacy data as verified funds. */
const {identity} = require('../lib/secure-accounts');
const {jsonError,error} = require('../lib/shop-common');
const {USERNAME,summarize,str} = require('../lib/wallet-audit');
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const ctx=await identity(req,{adminOnly:true});
    const username=String(req.query?.username||'').trim().toLowerCase();
    if(!USERNAME.test(username))throw error('Nhập đúng tên tài khoản cần đối soát.',422);
    const db=ctx.db;
    const paths=[
      db.ref('users/'+username).once('value'),
      db.ref('deposits').limitToLast(500).once('value'),
      db.ref('orders').limitToLast(500).once('value'),
      db.ref('shop_orders/'+username).limitToLast(500).once('value'),
      db.ref('payment_webhook_events').limitToLast(500).once('value'),
      db.ref('wallet_reconciliation/'+username).limitToLast(15).once('value')
    ];
    const snaps=await Promise.all(paths);
    if(!snaps[0].exists())throw error('Không thấy tài khoản.',404);
    const report=summarize(username,snaps[0].val(),snaps[1].val(),snaps[2].val(),snaps[3].val(),snaps[4].val());
    const reviews=Object.values(snaps[5].val()||{}).filter(x=>x&&typeof x==='object')
      .map(x=>({id:str(x.id,90),status:str(x.status,55),reviewedAt:Number(x.reviewedAt)||0,
        verifiedBalanceVnd:x.verifiedBalanceVnd, legacyBalanceAtReview:x.legacyBalanceAtReview,
        note:str(x.note,240)})).sort((a,b)=>b.reviewedAt-a.reviewedAt).slice(0,15);
    return res.status(200).json({ok:true,report,reviews});
  }catch(e){return jsonError(res,e)}
};
