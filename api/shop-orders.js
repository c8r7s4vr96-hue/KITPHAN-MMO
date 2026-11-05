'use strict';
const {firebase,usernameFromRequest,jsonError,error}=require('../lib/shop-common');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false});
  try{
    const username=await usernameFromRequest(req);const db=firebase().database();
    const raw=(await db.ref('shop_orders/'+username).limitToLast(35).once('value')).val()||{};
    const orders=Object.entries(raw).map(([id,o])=>({id,name:o.name,price:o.price,status:o.status,createdAt:o.createdAt,fulfilledAt:o.fulfilledAt})).sort((a,b)=>b.createdAt-a.createdAt);
    const requested=String(req.query?.orderId||'');
    let delivery=null;
    if(requested){
      if(!/^[a-zA-Z0-9_-]{8,90}$/.test(requested))throw error('Mã đơn không hợp lệ',400);
      const exact=(await db.ref('shop_orders/'+username+'/'+requested).once('value')).val();
      if(!exact)throw error('Không tìm thấy đơn hàng',404);
      if(exact.status==='completed') delivery=(await db.ref('shop_deliveries/'+username+'/'+requested).once('value')).val();
    }
    return res.status(200).json({ok:true,orders,delivery});
  }catch(e){return jsonError(res,e)}
};
