'use strict';
const {firebase,products,callSupplier,usernameFromRequest,checkOrigin,jsonError,error,safeText}=require('../lib/shop-common');
async function notification(username,orderId,name,price){
  const token=process.env.TELEGRAM_BOT_TOKEN,chat=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chat)return;
  try{await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(5000),body:JSON.stringify({chat_id:chat,text:`🛍️ ĐƠN TÀI KHOẢN MỚI\nMã: ${orderId}\nKhách: ${username}\nSản phẩm: ${name}\nGiá: ${price.toLocaleString('vi-VN')} đ`})})}
  catch(e){console.warn('[shop notification]',e.message)}
}
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  let username,requestId,ref,charged=false,price=0,product;
  try{
    checkOrigin(req);
    if(process.env.SHOP_PURCHASES_ENABLED!=='true')throw error('Thanh toán thật chưa được bật. Liên hệ quản trị.',503);
    username=await usernameFromRequest(req);
    requestId=String(req.body?.requestId||'');const productId=String(req.body?.productId||'');
    if(!/^[a-zA-Z0-9_-]{12,90}$/.test(requestId)||!/^[a-zA-Z0-9_\-:.]{1,90}$/.test(productId))throw error('Mã yêu cầu hoặc sản phẩm không hợp lệ',400);
    const sdk=firebase(),db=sdk.database();
    const customerRef=db.ref('users/'+username);
    if(!(await customerRef.once('value')).exists())throw error('Tài khoản không tồn tại',401);
    ref=db.ref('shop_orders/'+username+'/'+requestId);
    const claim=await ref.transaction(v=>v===null?{status:'starting',productId,createdAt:Date.now()}:undefined,undefined,false);
    if(!claim.committed){
      const existing=(await ref.once('value')).val();
      return res.status(200).json({ok:true,duplicate:true,status:existing?.status||'processing',orderId:requestId,message:'Yêu cầu đã được ghi nhận, không đặt lại.'});
    }
    // Recheck stock and price immediately before charging; never trust frontend prices.
    product=(await products(true)).find(p=>p.id===productId);
    if(!product||!product.available)throw error('Sản phẩm đã hết hoặc không còn được bán',409);
    price=product.price;
    if(!Number.isSafeInteger(price)||price<=0)throw error('Giá bán không hợp lệ',422);
    await ref.update({name:product.name,price,status:'reserving'});
    const debit=await customerRef.transaction(v=>{
      if(!v||!Number.isSafeInteger(Number(v.balance))||Number(v.balance)<price)return;
      return {...v,balance:Number(v.balance)-price};
    },undefined,false);
    if(!debit.committed)throw error('Số dư tài khoản không đủ',402);
    charged=true;
    await ref.update({status:'processing',debitedAt:Date.now()});
    let result;
    try{
      // Swagger v2 purchase uses product_id; quantity defaults to one physical stock unit.
      // Adapt this request shape if the provider's live PurchaseRequest schema differs.
      const upstreamId=/^\d+$/.test(productId)&&Number.isSafeInteger(Number(productId))?Number(productId):productId;
      const buyBody=process.env.CANBOSO_PURCHASE_QUANTITY_ONE==='true'?{product_id:upstreamId,quantity:1}:{product_id:upstreamId};
      result=await callSupplier('/api/v2/telegram-buyer/purchase',{method:'POST',body:buyBody});
      if(result.success===false||result.ok===false||result.error)throw error('Nhà cung cấp từ chối mua hàng',409);
    }catch(e){
      // Only definitive 4xx rejections are safe to refund automatically. A timeout/5xx is ambiguous.
      if(e.status>=400&&e.status<500&&e.status!==429){
        const refund=await customerRef.transaction(v=>v?{...v,balance:Number(v.balance||0)+price}:undefined,undefined,false);
        if(refund.committed){charged=false;await ref.update({status:'refunded',refundedAt:Date.now()});}
      }
      if(charged){await ref.update({status:'needs_review',error:'Supplier outcome uncertain',reviewAt:Date.now()});}
      throw e;
    }
    // Sensitive fulfillment is kept separately from public RTDB nodes.
    const delivered=result.data??result.result??result;
    await db.ref('shop_deliveries/'+username+'/'+requestId).set(delivered);
    await ref.update({status:'completed',fulfilledAt:Date.now()});
    await notification(username,requestId,product.name,price);
    return res.status(200).json({ok:true,status:'completed',orderId:requestId,price,delivery:delivered});
  }catch(e){
    if(ref){
      try{const v=(await ref.once('value')).val();if(v?.status==='starting'||v?.status==='reserving')await ref.update({status:charged?'needs_review':'failed',error:'Checkout not completed'});}
      catch(writeError){console.error('[shop audit write]',writeError.message)}
    }
    return jsonError(res,e);
  }
};
