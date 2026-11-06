'use strict';
const {firebase,usernameFromRequest,jsonError,error}=require('../lib/shop-common');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET')return res.status(405).json({ok:false});
  try{
    if(!String(req.headers.authorization||'').startsWith('Bearer ') && process.env.SHOP_ALLOW_LEGACY_DELIVERY_ACCESS!=='true')throw error('Để xem hàng riêng tư, vui lòng đăng nhập bằng Firebase Auth. Tài khoản mật khẩu cũ cần chuyển đổi bảo mật.',403);
    const username=await usernameFromRequest(req),db=firebase().database();
    const raw=(await db.ref('shop_orders/'+username).limitToLast(40).once('value')).val()||{};
    const orders=Object.entries(raw).map(([id,v])=>({id,name:v.name||v.productId||'Sản phẩm',price:v.price||0,status:v.status||'created',createdAt:v.createdAt,fulfilledAt:v.fulfilledAt,recipientEmail:v.recipientEmail||null})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    const orderId=String(req.query?.orderId||'');let delivery=null;
    if(orderId){
      if(!/^[a-zA-Z0-9_-]{12,90}$/.test(orderId))throw error('Mã đơn không hợp lệ',400);
      const target=(await db.ref('shop_orders/'+username+'/'+orderId).once('value')).val();
      if(!target)throw error('Không tìm thấy đơn hàng',404);
      if(target.status==='delivered'||target.status==='completed'){
        const saved=(await db.ref('shop_deliveries/'+username+'/'+orderId).once('value')).val();
        // The legacy V4 record can be an object; avoid returning arbitrary provider metadata.
        delivery=typeof saved==='string'?saved:typeof saved?.text==='string'?saved.text:null;
      }
    }
    return res.status(200).json({ok:true,orders,delivery});
  }catch(e){return jsonError(res,e)}
};
