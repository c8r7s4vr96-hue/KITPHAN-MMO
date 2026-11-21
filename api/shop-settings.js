'use strict';
/** Admin-only checkout launch controls: pilot -> verified order -> public.
 * A launch never changes a customer balance or sends a supplier purchase. */
const {identity,checkOrigin}=require('../lib/secure-accounts');
const {products,callSupplier,jsonError}=require('../lib/shop-common');
const {CONTROL,status}=require('../lib/shop-access');
const {ROOT}=require('../lib/wallet-commerce');
const ORDER=/^ord_[a-f0-9]{36}$/;
const crypto=require('node:crypto');
function audited(s,mode,uid,when,extra={}){
 const current=s&&typeof s==='object'?s:{};
 const history=current.history&&typeof current.history==='object'?{...current.history}:{};
 history[crypto.randomUUID()]={mode,by:uid,at:when,...extra};
 // Bounded audit trail, most recent 100 control changes; money journal is separate.
 const keys=Object.keys(history);if(keys.length>100)keys.slice(0,keys.length-100).forEach(k=>delete history[k]);
 return {...current,...extra,mode,updatedBy:uid,updatedAt:when,history};
}
const validSupplierObject=x=>x&&typeof x==='object';
async function pilotProbe(){
 const [catalog,balance,orders]=await Promise.all([
  products(true),callSupplier('/api/v2/telegram-buyer/balance'),callSupplier('/api/v2/telegram-buyer/orders')]);
 if(!Array.isArray(catalog)||!catalog.some(p=>p.available))throw Object.assign(Error('Kho CanBoSo chưa có sản phẩm xác minh còn hàng.'),{status:503});
 if(!validSupplierObject(balance)||!validSupplierObject(orders)||balance.success===false||orders.success===false||balance.ok===false||orders.ok===false)throw Object.assign(Error('CanBoSo chưa trả kết quả đọc hợp lệ.'),{status:503});
 return true; // GET only; not a guarantee of a successful purchase.
}
async function verifiedPilotOrder(db,uid,orderId,startedAt){
 if(!ORDER.test(String(orderId||'')))throw Object.assign(Error('Nhập mã đơn thử nghiệm hợp lệ.'),{status:422});
 const [a,b]=await Promise.all([
  db.ref(ROOT+'/orders/'+orderId).once('value'),db.ref(ROOT+'/moneyJournal/settle_'+orderId).once('value')]);
 const o=a.val(),entry=b.val();
 const good=o?.uid===uid && o.status==='delivered' && typeof o.delivery==='string' && o.delivery.trim().length>=3 &&
    Number.isSafeInteger(o.price) && o.price>0 && Number(o.createdAt)>=startedAt &&
    entry?.uid===uid && entry?.orderId===orderId && entry?.kind==='purchase' && entry?.amountVnd===o.price &&
    entry?.source==='supplier_delivered';
 if(!good)throw Object.assign(Error('Đơn pilot chưa hoàn thành hoặc không khớp nhật ký ví thật. Không thể mở cho khách.'),{status:409});
 return {id:o.id,name:o.name||o.productId,price:o.price};
}
function settingUpdate(db,operation){return db.ref(CONTROL).transaction(operation,undefined,false)}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false,error:'Method not allowed'});
 try{
  if(req.method==='POST')checkOrigin(req);
  const ctx=await identity(req,{adminOnly:true});
  const env=process.env;
  if(req.method==='GET'){
   const config=await status(ctx.db);
   let candidates=[];
   if(config.mode==='pilot'){
    const result=await ctx.db.ref(ROOT+'/orders').orderByChild('uid').equalTo(ctx.uid).limitToLast(30).once('value');
    candidates=Object.values(result.val()||{}).filter(o=>o?.status==='delivered'&&o.createdAt>=config.pilotStartedAt)
     .map(o=>({id:o.id,name:o.name,price:o.price,at:o.createdAt})).sort((a,b)=>b.at-a.at);
   }
   return res.status(200).json({ok:true,config,candidates,hardDisabled:env.SHOP_HARD_DISABLE==='true',
    apiKeyConfigured:!!env.CANBOSO_API_KEY,adminUidConfigured:!!env.MAIN_ADMIN_GOOGLE_UID,
    note:'Chế độ công khai chỉ mở sau khi đơn pilot thành công và Admin đối soát trực tiếp.'});
  }
  const {action}=req.body||{};
  if(action==='pause'){
   const at=Date.now();const tx=await settingUpdate(ctx.db,current=>audited(current,'paused',ctx.uid,at));
   if(!tx.committed)throw Object.assign(Error('Không lưu được trạng thái đóng mua.'),{status:503});
   return res.status(200).json({ok:true,mode:'paused'});
  }
  if(env.SHOP_HARD_DISABLE==='true')throw Object.assign(Error('SHOP_HARD_DISABLE đang bật trên Vercel. Không thể mở mua.'),{status:423});
  if(action==='pilot'){
   if(req.body?.confirmRealWallet!==true||req.body?.confirmSupplierFunds!==true)
    throw Object.assign(Error('Cần Admin xác nhận ví thật đã đối soát và nhà cung cấp có tiền thật.'),{status:422});
   if(!env.FIREBASE_SERVICE_ACCOUNT_JSON||!env.MAIN_ADMIN_GOOGLE_UID||!env.CANBOSO_API_KEY)
    throw Object.assign(Error('Thiếu cấu hình Firebase Admin hoặc CanBoSo.'),{status:503});
   await pilotProbe();
   const at=Date.now();
   const tx=await settingUpdate(ctx.db,current=>{
    if(current&&current.mode==='public')return; // don't silently demote public while live
    if(current&&current.mode==='pilot')return current; // preserve prior pilot proof
    return audited(current,'pilot',ctx.uid,at,{pilotStartedAt:at,verifiedOrderId:null});
   });
   if(!tx.committed)throw Object.assign(Error('Đang mở mua cho khách; đóng trước khi thử lại.'),{status:409});
   return res.status(200).json({ok:true,mode:'pilot',note:'Chỉ Google Admin chính mua thử bằng ví thật.'});
  }
  if(action==='public'){
   if(req.body?.confirmSupplierOrderChecked!==true||req.body?.confirmWalletLedgerChecked!==true||
     req.body?.confirmCustomerSupportReady!==true||String(req.body?.confirmText||'').trim()!=='MO BAN')
      throw Object.assign(Error('Cần xác nhận đơn CanBoSo, đối soát ví, hỗ trợ khách và nhập MO BAN.'),{status:422});
   const current=await status(ctx.db);
   if(current.mode!=='pilot'||!current.pilotStartedAt)
    throw Object.assign(Error('Phải mở pilot và mua thành công trước khi mở cho tất cả khách.'),{status:409});
   const matched=await verifiedPilotOrder(ctx.db,ctx.uid,req.body?.orderId,current.pilotStartedAt);
   const at=Date.now();
   const tx=await settingUpdate(ctx.db,s=>{
     if(!validPilot(s,current))return;
     return audited(s,'public',ctx.uid,at,{verifiedOrderId:matched.id});
   });
   if(!tx.committed)throw Object.assign(Error('Trạng thái pilot đã đổi; tải lại và kiểm tra.'),{status:409});
   return res.status(200).json({ok:true,mode:'public',verifiedOrderId:matched.id});
  }
  return res.status(422).json({ok:false,error:'Hành động không hợp lệ.'});
 }catch(e){return jsonError(res,e)}
};
function validPilot(s,read){return s?.mode==='pilot'&&s.pilotStartedAt===read.pilotStartedAt&&s.updatedBy===read.updatedBy&&s.updatedAt===read.updatedAt}
