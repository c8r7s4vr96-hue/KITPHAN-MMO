'use strict';
/** Optional manual exception handling: requires Firebase Auth user with custom claim kpShopAdmin=true. */
const {firebase,error,jsonError,checkOrigin,digest}=require('../lib/shop-common');
const {alertShop}=require('../lib/shop-alerts');
const VALID=/^[a-z0-9_-]{3,60}$/;
const ORDER=/^[a-zA-Z0-9_-]{12,90}$/;
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false});
 try{
  checkOrigin(req);
  const bearer=String(req.headers.authorization||'');
  if(!bearer.startsWith('Bearer '))throw error('Admin Firebase token required',401);
  const sdk=firebase();const token=await sdk.auth().verifyIdToken(bearer.slice(7),true);
  const user=await sdk.auth().getUser(token.uid);
  if(user.customClaims?.kpShopAdmin!==true && (!process.env.SHOP_ADMIN_GOOGLE_UID || user.uid!==process.env.SHOP_ADMIN_GOOGLE_UID))throw error('Bạn không có quyền quản trị kho',403);
  const db=sdk.database();
  if(req.method==='GET'){
    const queue=(await db.ref('shop_review_queue').limitToLast(100).once('value')).val()||{};
    return res.status(200).json({ok:true,orders:Object.values(queue).sort((a,b)=>b.at-a.at).slice(0,100)});
  }
  const username=String(req.body?.username||'').toLowerCase();const orderId=String(req.body?.orderId||'');const action=String(req.body?.action||'');
  if(!VALID.test(username)||!ORDER.test(orderId)||!['deliver','refund'].includes(action))throw error('Yêu cầu không hợp lệ',400);
  const ref=db.ref('shop_orders/'+username+'/'+orderId);
  const snap=await ref.once('value');const current=snap.val();
  if(!current)throw error('Không tìm thấy đơn',404);
  if(current.status==='delivered'||current.status==='completed'||current.status==='refunded')throw error('Đơn đã hoàn tất, không được xử lý lại',409);
  if(!['awaiting_delivery','needs_review','reserved','requesting_supplier'].includes(current.status))throw error('Trạng thái đơn không cho phép thao tác',409);
  if(action==='refund' && req.body?.supplierConfirmedNotCharged!==true)throw error('Cần xác nhận nhà cung cấp chưa thu tiền hoặc đã hoàn tiền trước khi hoàn số dư khách',422);
  const delivery=action==='deliver'?String(req.body?.delivery||'').trim():'';
  if(action==='deliver'&&(delivery.length<3||delivery.length>8500))throw error('Nội dung giao hàng phải từ 3–8500 ký tự',400);
  // Lock the order atomically so concurrent admin requests cannot both refund and deliver.
  const locked=await ref.transaction(v=>v&&['awaiting_delivery','needs_review','reserved','requesting_supplier'].includes(v.status)?{...v,status:'admin_reviewing',adminAction:action,adminReviewAt:Date.now(),reviewedBy:token.uid}:undefined,undefined,false);
  if(!locked.committed)throw error('Đơn đang được người khác xử lý',409);
  // Manual operator MUST reconcile supplier outcome before refunding a request with ambiguous status.
  if(action==='refund'){
   const wallet=db.ref('users/'+username);
   const result=await wallet.transaction(v=>{
    const debit=v?.shopDebits?.[orderId];
    if(!debit||debit.status!=='charged'||!Number.isSafeInteger(Number(debit.amount))||!Number.isSafeInteger(Number(v.balance)))return;
    return {...v,balance:Number(v.balance)+Number(debit.amount),shopDebits:{...v.shopDebits,[orderId]:{...debit,status:'refunded',refundedAt:Date.now(),by:token.uid}}};
   },undefined,false);
   if(!result.committed)throw error('Không thể hoàn tiền hoặc đã hoàn trước đó',409);
   await ref.update({status:'refunded',refundedAt:Date.now(),reviewedBy:token.uid});
   await db.ref('shop_review_queue/'+digest(username+':'+orderId).slice(0,42)).remove();
   await alertShop('refunded',{id:orderId,username,name:current.name,price:current.price});
   return res.status(200).json({ok:true,status:'refunded'});
  }
  // Delivery stored in a backend-only node. Do not log secret or send it via Telegram.
  await db.ref('shop_deliveries/'+username+'/'+orderId).set({text:delivery,deliveredAt:Date.now(),manual:true});
  await ref.update({status:'delivered',fulfilledAt:Date.now(),reviewedBy:token.uid});
  await db.ref('shop_review_queue/'+digest(username+':'+orderId).slice(0,42)).remove();
  await alertShop('delivered',{id:orderId,username,name:current.name,price:current.price});
  return res.status(200).json({ok:true,status:'delivered'});
 }catch(e){return jsonError(res,e)}
};
