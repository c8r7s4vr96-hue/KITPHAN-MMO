'use strict';
const {identity}=require('../lib/secure-accounts');
const {jsonError,error}=require('../lib/shop-common');
const {ROOT}=require('../lib/wallet-commerce');
const ID=/^[a-zA-Z0-9_-]{12,90}$/;
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false});
 try{
  const ctx=await identity(req);
  const live=(await ctx.db.ref(ROOT+'/orders').orderByChild('uid').equalTo(ctx.uid).limitToLast(60).once('value')).val()||{};
  // Legacy orders stay visible as historical records only; never debited again.
  const old=(await ctx.db.ref('shop_orders/'+ctx.username).limitToLast(40).once('value')).val()||{};
  const orders=[...Object.values(live),...Object.entries(old).map(([id,v])=>({id,...v,source:'legacy_history'}))]
   .filter(o=>o&&typeof o==='object')
   .map(o=>({id:o.id,name:o.name||o.productId||'Sản phẩm',price:o.price||0,
     status:o.status||'created',createdAt:o.createdAt,fulfilledAt:o.fulfilledAt,
     recipientEmail:o.recipientEmail||null,source:o.source||'live_wallet'}))
   .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,60);
  const orderId=String(req.query?.orderId||'');let delivery=null;
  if(orderId){
    if(!ID.test(orderId))throw error('Mã đơn không hợp lệ.',422);
    const o=live[orderId];
    if(o){if(o.status==='delivered')delivery=o.delivery||null;}
    else if(old[orderId]&&['completed','delivered'].includes(old[orderId].status)){
      const record=(await ctx.db.ref('shop_deliveries/'+ctx.username+'/'+orderId).once('value')).val();
      delivery=typeof record==='string'?record:typeof record?.text==='string'?record.text:null;
    }else throw error('Không tìm thấy đơn trong tài khoản.',404);
  }
  return res.status(200).json({ok:true,orders,delivery});
 }catch(e){return jsonError(res,e)}
};
