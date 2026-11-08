'use strict';
/** Live checkout only. At-most-once supplier dispatch; ambiguous results keep a
 * hold for human reconciliation. No purchase ever uses users.balance. */
const crypto=require('node:crypto');
const {identity,checkOrigin}=require('../lib/secure-accounts');
const {products,callSupplier,jsonError}=require('../lib/shop-common');
const {pricedProducts}=require('../lib/shop-pricing');
const {classifyResponse}=require('../lib/shop-fulfillment');
const commerce=require('../lib/wallet-commerce');
const {enabled,allowed}=require('../lib/shop-flags');
function publicResult(order){
 return {ok:true,id:order.id,price:order.price,status:order.status,
   ...(order.status==='delivered'?{delivery:order.delivery}:{}),
   message:['needs_review','awaiting_delivery','requesting_supplier'].includes(order.status)
    ?'Đơn đã ghi nhận. Đừng mua lại; Admin sẽ đối chiếu nhà cung cấp trước khi xử lý tiếp.':undefined};
}
module.exports=async function checkout(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
 try{
  checkOrigin(req);
  if(!enabled())return res.status(423).json({ok:false,checkoutEnabled:false,reason:'LIVE_PURCHASES_DISABLED',
    error:'Mua hàng bằng ví thật chưa được bật sau kiểm thử và đối soát.'});
  const ctx=await identity(req);
  if(!allowed(ctx.uid))throw commerce.fail('Mua hàng chưa được mở cho tài khoản này.',403);
  const {productId,requestId}=req.body||{};
  const email=String(req.body?.recipientEmail||'').trim().toLowerCase();
  if(typeof productId!=='string'||typeof requestId!=='string'||!commerce.validId(requestId)||
     (email&&!/^[^\s@]{1,64}@[^\s@]{1,170}\.[^\s@]{2,}$/.test(email)))throw commerce.fail('Thông tin đặt hàng không hợp lệ.');
  // Replayed request IDs are handled BEFORE catalog fetch or supplier calls.
  const id=commerce.orderKey(ctx.uid,requestId);
  const prior=(await ctx.db.ref(commerce.ROOT+'/orders/'+id).once('value')).val();
  if(prior){
   if(prior.uid!==ctx.uid||prior.requestId!==requestId||prior.productId!==productId||prior.recipientEmail!==email)
     throw commerce.fail('Mã mua hàng đã dùng cho đơn khác.',409);
   return res.status(200).json(publicResult(prior));
  }
  // Never guess CanBoSo's recipient field: supplier schema differs by SKU.
  const emailField=String(process.env.CANBOSO_PURCHASE_EMAIL_FIELD||'').trim();
  if(email && !['recipient_email','customer_email','email'].includes(emailField))
    throw commerce.fail('Sản phẩm yêu cầu email nhưng CanBoSo chưa xác nhận tên trường API nhận email. Liên hệ Admin.',503);
  const rows=await pricedProducts(ctx.db,await products(true));
  const p=rows.find(item=>item.id===productId);
  if(!p||!p.available)throw commerce.fail('Sản phẩm đã hết hàng hoặc không thể xác nhận giá.',409);
  const price=p.price;
  const state=await commerce.transact(ctx.db,v=>commerce.reserveState(v,{
    uid:ctx.uid,username:ctx.username,product:p,price,recipientEmail:email,requestId}));
  let o=state.orders[id];
  if(o.status!=='reserved')return res.status(200).json(publicResult(o));
  // One irreversible claim before external call; concurrent requests never re-dispatch.
  const claim=crypto.randomBytes(20).toString('hex');
  try{
   const started=await commerce.transact(ctx.db,v=>commerce.markRequestingState(v,id,claim));
   o=started.orders[id];
  }catch(e){
   if(e.status===409){const existing=(await ctx.db.ref(commerce.ROOT+'/orders/'+id).once('value')).val();
    if(existing)return res.status(200).json(publicResult(existing));}
   throw e;
  }
  let outcome;
  try{
    const response=await callSupplier('/api/v2/telegram-buyer/purchase',{
      method:'POST',body:{product_id:productId,quantity:1,...(email?{[emailField]:email}:{})}});
    outcome=classifyResponse(response);
  }catch(e){
    // Transport errors and non-2xx responses may still have charged supplier.
    // Never auto-refund/retry without verified provider outcome.
    const code = e?.message === 'Supplier API is not configured' ? 'SUPPLIER_NOT_CONFIGURED'
      : e?.status === 504 ? 'SUPPLIER_TIMEOUT'
      : e?.status === 429 ? 'SUPPLIER_RATE_LIMIT'
      : Number.isInteger(e?.status) && e.status >= 400 && e.status < 500 ? 'SUPPLIER_HTTP_4XX'
      : Number.isInteger(e?.status) && e.status >= 500 ? 'SUPPLIER_HTTP_5XX'
      : 'SUPPLIER_NETWORK_ERROR';
    // Only persist a stable, non-sensitive failure category; never store key, response body or credentials.
    // A non-2xx POST may still have charged the supplier. Hold funds until independently reconciled.
    console.warn('[Shop purchase] pending supplier review:', JSON.stringify({orderId:id,code,httpStatus:Number.isInteger(e?.status)?e.status:null}));
    outcome={kind:'review',diagnostic:{code,httpStatus:Number.isInteger(e?.status)?e.status:null}};
  }
  const finished=await commerce.transact(ctx.db,v=>commerce.completeState(v,id,claim,outcome));
  return res.status(200).json(publicResult(finished.orders[id]));
 }catch(e){return jsonError(res,e)}
};
// Supplier calls and Firebase journal finalization may take several seconds.
module.exports.config={maxDuration:30};
