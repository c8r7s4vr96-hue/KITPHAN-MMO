'use strict';
/** Live checkout only. At-most-once supplier dispatch; ambiguous results keep a
 * hold for human reconciliation. No purchase ever uses users.balance. */
const crypto=require('node:crypto');
const {identity,checkOrigin}=require('../lib/secure-accounts');
const {products,callSupplier,jsonError,safeText}=require('../lib/shop-common');
const {pricedProducts}=require('../lib/shop-pricing');
const {classifyResponse}=require('../lib/shop-fulfillment');
const commerce=require('../lib/wallet-commerce');
const {access}=require('../lib/shop-access');
const {fetchLocketCatalogPackages,isLocketPackageCode}=require('../lib/locket-catalog');
const {createLocketOrder}=require('../lib/locket-provider');

function publicResult(order){
 return {ok:true,id:order.id,orderId:order.id,price:order.price,status:order.status,
   ...(order.service?{service:order.service}:{}),
   ...(order.locket?{locket:order.locket}:{}),
   ...(order.status==='delivered'?{delivery:order.delivery}:{}),
   message:['needs_review','awaiting_delivery','requesting_supplier'].includes(order.status)
    ?'Đơn đã ghi nhận. Đừng mua lại; Admin sẽ đối chiếu nhà cung cấp trước khi xử lý tiếp.':undefined};
}

function refundedResult(order,error){
 return {ok:false,id:order.id,orderId:order.id,price:order.price,status:'refunded',
   ...(order.service?{service:order.service}:{}),
   error:error||order.refundReason||'Kích hoạt Locket Gold thất bại. Tiền đã được hoàn lại vào ví.'};
}

async function reserveAndClaim(ctx,{id,product,price,recipientEmail,requestId,service,locketUsername}){
 // An Admin may pause the shop during a slow catalog refresh. Check again
 // before reserving customer money or claiming supplier dispatch.
 const latest=await access(ctx.db,ctx.uid);
 if(!latest.enabled)return {blocked:{status:423,body:{ok:false,reason:latest.reason,error:'Kho vừa tạm dừng mua hàng; chưa giữ tiền.'}}};
 // Customer-facing read-only preflight: the server must see the same canonical
 // wallet that /api/wallet uses for the signed-in Firebase UID. This is not
 // an authorization to spend: reserveState validates AGAIN atomically below.
 const currentWallet=(await ctx.db.ref(commerce.ROOT+'/accounts/'+ctx.uid).once('value')).val();
 if(!currentWallet)throw commerce.fail('Không tìm thấy ví thật của tài khoản đang mua. Hãy đăng nhập đúng tài khoản đã nạp tiền và kiểm tra lại.',409);
 if(currentWallet.uid!==ctx.uid||currentWallet.username!==ctx.username||
    !Number.isSafeInteger(currentWallet.availableVnd)||currentWallet.availableVnd<0)
   throw commerce.fail('Ví thật không khớp chủ sở hữu hoặc có dữ liệu không hợp lệ. Liên hệ Admin để đối soát.',409);
 if(currentWallet.availableVnd<price)
   throw commerce.fail('Máy chủ mua hàng ghi nhận ví khả dụng '+currentWallet.availableVnd.toLocaleString('vi-VN')+'đ, thấp hơn giá '+price.toLocaleString('vi-VN')+'đ. Vui lòng kiểm tra ví và lịch sử đơn.',409);
 const state=await commerce.transact(ctx.db,v=>commerce.reserveState(v,{
   uid:ctx.uid,username:ctx.username,product,price,recipientEmail,requestId,service,locketUsername}),{requireExistingRoot:true});
 const o=state.orders[id];
 if(o.status!=='reserved')return {existing:o};
 // One irreversible claim before external call; concurrent requests never re-dispatch.
 const claim=crypto.randomBytes(20).toString('hex');
 try{
  await commerce.transact(ctx.db,v=>commerce.markRequestingState(v,id,claim),{requireExistingRoot:true});
 }catch(e){
  if(e.status===409){const existing=(await ctx.db.ref(commerce.ROOT+'/orders/'+id).once('value')).val();
   if(existing)return {existing};}
  throw e;
 }
 return {claim};
}

async function handleLocketCheckout(ctx,res,{productId,requestId,quotedPriceVnd,id,prior}){
 const locketUsername=String(ctx.body?.locketUsername||ctx.body?.username||'').trim();
 if(!locketUsername||locketUsername.length>100||/[\x00-\x1f<>]/.test(locketUsername))
   throw commerce.fail('Vui lòng nhập username Locket hợp lệ.',422);
 if(prior){
   if(prior.uid!==ctx.uid||prior.requestId!==requestId||prior.productId!==productId||(prior.locket?.username||'')!==locketUsername)
     throw commerce.fail('Mã mua hàng đã dùng cho đơn khác.',409);
   if(prior.status==='refunded')return res.status(502).json(refundedResult(prior));
   return res.status(200).json(publicResult(prior));
 }
 let packages;
 try{ packages=await fetchLocketCatalogPackages(); }
 catch{ throw commerce.fail('Không tải được danh mục Locket Gold. Vui lòng thử lại sau.',503); }
 const pkg=packages.find(item=>item.code===productId||(item.packageId!=null&&String(item.packageId)===String(productId)));
 if(!pkg||!pkg.available||!Number.isSafeInteger(pkg.priceVnd)||pkg.priceVnd<=0)
   throw commerce.fail('Gói Locket chưa mở bán hoặc không tìm thấy.',409);
 if(!Number.isSafeInteger(quotedPriceVnd)||quotedPriceVnd!==pkg.priceVnd)
   throw commerce.fail('Giá gói Locket vừa thay đổi. Làm mới danh mục và xác nhận lại trước khi mua.',409);
 const product={id:pkg.code,name:`Locket Gold - ${pkg.name} (${pkg.code})`,price:pkg.priceVnd,costVnd:pkg.priceVnd};
 const prep=await reserveAndClaim(ctx,{id,product,price:pkg.priceVnd,recipientEmail:'',requestId,service:'locket',locketUsername});
 if(prep.blocked)return res.status(prep.blocked.status).json(prep.blocked.body);
 if(prep.existing){
   if(prep.existing.status==='refunded')return res.status(502).json(refundedResult(prep.existing));
   return res.status(200).json(publicResult(prep.existing));
 }
 const claim=prep.claim;
 let outcome,failStatus=502,failMessage='';
 try{
   const result=await createLocketOrder({username:locketUsername,packageId:pkg.packageId,packageCode:pkg.code});
   const dnsUrl=result.dnsUrl||null;
   const uidStr=typeof result.uid==='string'?result.uid:(result.uid?.uidString||result.uid?.uid||null);
   const locketData={
     uid:uidStr,
     username:result.username||locketUsername,
     packageId:result.packageId??pkg.packageId??null,
     packageCode:result.packageCode||pkg.code,
     packageName:result.packageName||pkg.name,
     activationCode:result.activationCode||null,
     status:'completed',
     expiresAt:result.expiresAt||null,
     dnsUrl,
     reused:Boolean(result.reused)
   };
   const deliveryText=[
     `Gói: ${locketData.packageName} (${locketData.packageCode})`,
     `Username Locket: ${locketData.username}`,
     locketData.activationCode?`Mã kích hoạt: ${locketData.activationCode}`:null,
     locketData.expiresAt?`Hết hạn: ${locketData.expiresAt}`:null,
     dnsUrl?`Link cài đặt DNS: ${dnsUrl}`:null,
     'Hướng dẫn: Mở link DNS bằng Safari trên iPhone để tải và cài đặt Profile DNS, sau đó mở lại Locket.'
   ].filter(Boolean).join('\n');
   outcome={kind:'delivered',delivery:deliveryText,locket:locketData};
 }catch(e){
   failStatus=(Number.isInteger(e?.status)&&e.status>=400&&e.status<500)?422:502;
   const reason=(e?.message==='Missing LOCKET_API_KEY'||e?.message==='Missing LOCKET_SECRET_KEY')
     ?'Hệ thống Locket chưa cấu hình khóa kết nối.'
     :safeText(e?.message||'Kích hoạt Locket Gold thất bại.',180);
   failMessage=`${reason} Tiền đã được hoàn lại vào ví.`;
   console.warn('[Locket checkout] provider failed, refunding hold:',JSON.stringify({orderId:id,httpStatus:Number.isInteger(e?.status)?e.status:null}));
   outcome={kind:'rejected',reason:failMessage};
 }
 const finished=await commerce.transact(ctx.db,v=>commerce.completeState(v,id,claim,outcome),{requireExistingRoot:true});
 const finalOrder=finished.orders[id];
 if(finalOrder.status==='refunded')return res.status(failStatus).json(refundedResult(finalOrder,failMessage));
 return res.status(200).json(publicResult(finalOrder));
}

module.exports=async function checkout(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
 try{
  checkOrigin(req);
  const ctx=await identity(req);
  const gate=await access(ctx.db,ctx.uid);
  if(!gate.enabled)return res.status(423).json({ok:false,checkoutEnabled:false,reason:gate.reason,
    error:'Mua hàng chưa được mở cho tài khoản này. Vui lòng xem Kho Premium hoặc liên hệ Admin.'});
  const {productId,requestId,quotedPriceVnd,service}=req.body||{};
  const email=String(req.body?.recipientEmail||'').trim().toLowerCase();
  if(typeof productId!=='string'||typeof requestId!=='string'||!commerce.validId(requestId)||
     (email&&!/^[^\s@]{1,64}@[^\s@]{1,170}\.[^\s@]{2,}$/.test(email)))throw commerce.fail('Thông tin đặt hàng không hợp lệ.');
  // Replayed request IDs are handled BEFORE catalog fetch or supplier calls.
  const id=commerce.orderKey(ctx.uid,requestId);
  const prior=(await ctx.db.ref(commerce.ROOT+'/orders/'+id).once('value')).val();
  if(service==='locket'||isLocketPackageCode(productId)){
    return await handleLocketCheckout({...ctx,body:req.body},res,{productId,requestId,quotedPriceVnd,id,prior});
  }
  if(prior){
   if(prior.uid!==ctx.uid||prior.requestId!==requestId||prior.productId!==productId||prior.recipientEmail!==email)
     throw commerce.fail('Mã mua hàng đã dùng cho đơn khác.',409);
   return res.status(200).json(publicResult(prior));
  }
  // Never guess CanBoSo's recipient field: supplier schema differs by SKU.
  // CanBoSo purchase Swagger documents customer_email for email-bound items.
  const emailField=String(process.env.CANBOSO_PURCHASE_EMAIL_FIELD||'customer_email').trim();
  if(email && !['recipient_email','customer_email','email'].includes(emailField))
    throw commerce.fail('Sản phẩm yêu cầu email nhưng CanBoSo chưa xác nhận tên trường API nhận email. Liên hệ Admin.',503);
  const rows=await pricedProducts(ctx.db,await products(true));
  const p=rows.find(item=>item.id===productId);
  if(!p||!p.available)throw commerce.fail('Sản phẩm đã hết hàng hoặc không thể xác nhận giá.',409);
  // Protect the buyer if catalog price changed after opening the purchase modal.
  if(!Number.isSafeInteger(quotedPriceVnd)||quotedPriceVnd!==p.price)
    throw commerce.fail('Giá sản phẩm vừa thay đổi. Làm mới Kho Premium và xác nhận lại trước khi mua.',409);
  const requiresEmail=/\b(slot|invite|join|family)\b/i.test(p.name+' '+p.category);
  if(requiresEmail&&!email)throw commerce.fail('Sản phẩm này yêu cầu email người nhận.',422);
  if(requiresEmail&&!emailField)throw commerce.fail('Sản phẩm cần email nhưng chưa cấu hình trường nhận email CanBoSo.',503);
  const price=p.price;
  const prep=await reserveAndClaim(ctx,{id,product:p,price,recipientEmail:email,requestId});
  if(prep.blocked)return res.status(prep.blocked.status).json(prep.blocked.body);
  if(prep.existing)return res.status(200).json(publicResult(prep.existing));
  const claim=prep.claim;
  let outcome;
  try{
    const response=await callSupplier('/api/v2/telegram-buyer/purchase',{
      method:'POST',idempotencyKey:id,
      body:{product_id:productId,quantity:1,...(email?{[emailField]:email}:{})}});
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
    outcome={kind:'review',diagnostic:{code,httpStatus:Number.isInteger(e?.status)?e.status:null,
      ...(e?.providerCode?{providerCode:e.providerCode}:{})}};
  }
  const finished=await commerce.transact(ctx.db,v=>commerce.completeState(v,id,claim,outcome),{requireExistingRoot:true});
  return res.status(200).json(publicResult(finished.orders[id]));
 }catch(e){return jsonError(res,e)}
};
// Supplier calls and Firebase journal finalization may take several seconds.
module.exports.config={maxDuration:30};
