'use strict';
const {firebase,products,callSupplier,usernameFromRequest,checkOrigin,jsonError,error,safeText,digest}=require('../lib/shop-common');
const {classifyResponse}=require('../lib/shop-fulfillment');
const {alertShop}=require('../lib/shop-alerts');
const ACCEPTED_ID=/^[a-zA-Z0-9_-]{12,90}$/;
const PRODUCT_ID=/^[a-zA-Z0-9_\-:.]{1,90}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function enabled(){return process.env.SHOP_PURCHASES_ENABLED==='true'&&process.env.SHOP_WALLET_RULES_SECURED==='true'&&process.env.SHOP_SUPPLIER_PURCHASE_CONFIRMED==='true'}
const cleanOrder=o=>({status:o.status,orderId:o.id,price:o.price||null,message:({delivered:'Đã giao hàng',awaiting_delivery:'Nhà cung cấp nhận đơn; đang chờ thông tin giao hàng',needs_review:'Đơn cần Admin kiểm tra; không đặt lại',refunded:'Đơn bị từ chối; tiền đã hoàn về ví',failed:'Không thể đặt hàng'})[o.status]||'Đơn đã được ghi nhận'});
async function sendAlert(status,order){try{await alertShop(status,order)}catch(e){console.warn('[shop alert]',e.message)}}
async function enqueueReview(db,order,reason){
  const key=digest(order.username+':'+order.id).slice(0,42);
  try{await db.ref('shop_review_queue/'+key).set({id:order.id,username:order.username,name:order.name||order.productId||'Sản phẩm',price:order.price||0,recipientEmail:order.recipientEmail||null,status:order.status,reason,at:Date.now()});}catch(e){console.error('[shop review queue]',e.message)}
}
async function refundOnce(customerRef,requestId,price){
  const result=await customerRef.transaction(user=>{
    const debit=user?.shopDebits?.[requestId];
    if(!debit||debit.status!=='charged'||Number(debit.amount)!==price)return;
    if(!Number.isSafeInteger(Number(user.balance)))return;
    return {...user,balance:Number(user.balance)+price,shopDebits:{...(user.shopDebits||{}),[requestId]:{...debit,status:'refunded',refundedAt:Date.now()}}};
  },undefined,false);
  return result.committed;
}
async function debitOnce(customerRef,requestId,price){
  const result=await customerRef.transaction(user=>{
    if(!user||!Number.isSafeInteger(Number(user.balance))||Number(user.balance)<price||user.shopDebits?.[requestId])return;
    return {...user,balance:Number(user.balance)-price,shopDebits:{...(user.shopDebits||{}),[requestId]:{amount:price,status:'charged',at:Date.now()}}};
  },undefined,false);
  return result.committed;
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  let orderRef=null, order=null, customerRef=null, debited=false, supplierRequested=false;
  try{
    checkOrigin(req);
    if(!enabled())throw error('Thanh toán chưa được mở. Cần hoàn tất kiểm tra ví và API nhà cung cấp.',503);
    // Until legacy passwords are migrated, only Google Firebase Auth ID tokens are accepted by default.
    if(!String(req.headers.authorization||'').startsWith('Bearer ')&&process.env.SHOP_ALLOW_LEGACY_CHECKOUT!=='true')throw error('Mua hàng cần xác thực Firebase Auth. Tài khoản thường cần được chuyển đổi bảo mật trước.',403);
    const username=await usernameFromRequest(req);
    const requestId=String(req.body?.requestId||'');const productId=String(req.body?.productId||'');
    if(!ACCEPTED_ID.test(requestId)||!PRODUCT_ID.test(productId))throw error('Yêu cầu đặt hàng không hợp lệ',400);
    const email=String(req.body?.recipientEmail||'').trim().toLowerCase();
    if(email&&(!EMAIL.test(email)||email.length>200))throw error('Email nhận hàng không hợp lệ',400);
    const sdk=firebase(),db=sdk.database();customerRef=db.ref('users/'+username);
    if(!(await customerRef.once('value')).exists())throw error('Tài khoản không tồn tại',401);
    orderRef=db.ref('shop_orders/'+username+'/'+requestId);
    const claimed=await orderRef.transaction(v=>v===null?{id:requestId,username,productId,recipientEmail:email||null,status:'created',createdAt:Date.now()}:undefined,undefined,false);
    if(!claimed.committed){
      const existing=(await orderRef.once('value')).val();
      return res.status(200).json({ok:true,duplicate:true,...cleanOrder(existing||{id:requestId,status:'needs_review'})});
    }
    order={id:requestId,username,productId,recipientEmail:email||null,status:'created'};
    const product=(await products(true)).find(p=>p.id===productId);
    if(!product||!product.available)throw error('Sản phẩm hiện không có hàng hoặc đã ngừng bán',409);
    const price=product.price;
    if(!Number.isSafeInteger(price)||price<=0)throw error('Giá sản phẩm không hợp lệ',422);
    const needsEmail=/\b(slot|invite|join|family)\b/i.test(product.name+' '+product.category);
    if(needsEmail&&!email)throw error('Sản phẩm Slot cần email để hỗ trợ kích hoạt/giao hàng',400);
    order={...order,name:product.name,price,status:'created'};
    await orderRef.update({name:product.name,price,needsEmail,recipientEmail:email||null,status:'awaiting_payment'});
    const paid=await debitOnce(customerRef,requestId,price);
    if(!paid)throw error('Số dư không đủ hoặc ví đang được xử lý. Vui lòng kiểm tra lại.',402);
    debited=true;
    await orderRef.update({status:'reserved',debitedAt:Date.now()});
    // Persist request boundary before supplier call. If interrupted from now on: manual review, never auto retry.
    await orderRef.update({status:'requesting_supplier',requestedAt:Date.now()});
    supplierRequested=true;
    const upstreamId=/^\d+$/.test(productId)&&Number.isSafeInteger(Number(productId))?Number(productId):productId;
    const body={product_id:upstreamId};
    // NEVER forward undocumented fields. Enable only after verifying the seller's PurchaseRequest schema.
    const recipientField=String(process.env.CANBOSO_PURCHASE_EMAIL_FIELD||'');
    if(email&&['customer_email','recipient_email','email'].includes(recipientField))body[recipientField]=email;
    let supplier;
    try{
      supplier=await callSupplier('/api/v2/telegram-buyer/purchase',{method:'POST',body});
    }catch(upstreamError){
      // A final 4xx validation/balance/stock rejection is safely refundable. For 429, timeout or 5xx,
      // the upstream outcome is ambiguous; retain the order for manual reconciliation.
      if([400,401,402,403,404,409,422].includes(upstreamError.status)){
        const refunded=await refundOnce(customerRef,requestId,price);
        if(refunded){
          debited=false;order.status='refunded';
          await orderRef.update({status:'refunded',refundedAt:Date.now()});
          await sendAlert('refunded',order);
          return res.status(409).json({ok:false,orderId:requestId,status:'refunded',error:'Nhà cung cấp từ chối đơn. Số dư đã được hoàn.'});
        }
      }
      throw upstreamError;
    }
    const outcome=classifyResponse(supplier);
    if(outcome.kind==='rejected'){
      const refunded=await refundOnce(customerRef,requestId,price);
      if(refunded){debited=false;order.status='refunded';await orderRef.update({status:'refunded',refundedAt:Date.now()});await sendAlert('refunded',order);return res.status(409).json({ok:false,orderId:requestId,status:'refunded',error:'Nhà cung cấp từ chối đơn, đã hoàn tiền vào ví.'});}
      order.status='needs_review';await orderRef.update({status:'needs_review',reviewAt:Date.now()});await enqueueReview(db,order,'refund_failed');await sendAlert('needs_review',order);
      return res.status(202).json({ok:true,...cleanOrder(order)});
    }
    if(outcome.kind==='delivered'){
      // Save delivery to server-only RTDB node before marking fulfilled.
      await db.ref('shop_deliveries/'+username+'/'+requestId).set({text:outcome.delivery,deliveredAt:Date.now()});
      order.status='delivered';await orderRef.update({status:'delivered',fulfilledAt:Date.now()});
      await sendAlert('delivered',order);
      return res.status(200).json({ok:true,...cleanOrder(order),delivery:outcome.delivery});
    }
    // Success without content or async result is not yet delivery; do not claim finished.
    order.status='awaiting_delivery';
    await orderRef.update({status:'awaiting_delivery',supplierAcceptedAt:Date.now(),reviewAt:Date.now()});
    await enqueueReview(db,order,'delivery_missing');
    await sendAlert('awaiting_delivery',order);
    return res.status(202).json({ok:true,...cleanOrder(order)});
  }catch(e){
    if(orderRef){
      try{
        const previous=(await orderRef.once('value')).val();
        if(previous&&!['delivered','refunded','awaiting_delivery'].includes(previous.status)){
          if(supplierRequested||debited){
            // Ambiguous result: supplier might have charged. No automatic retry or refund.
            await orderRef.update({status:'needs_review',reviewAt:Date.now(),errorKind:'uncertain_supplier_outcome'});
            if(order)await enqueueReview(firebase().database(),{...order,status:'needs_review'},'uncertain_supplier_outcome');
            if(order)await sendAlert('needs_review',{...order,status:'needs_review'});
          }else{
            await orderRef.update({status:'failed',errorKind:'pre_purchase_validation',failedAt:Date.now()});
          }
        }
      }catch(audit){console.error('[shop checkout audit]',audit.message)}
    }
    return jsonError(res,e);
  }
};
