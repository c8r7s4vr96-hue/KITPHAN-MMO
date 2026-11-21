'use strict';
const {identity,checkOrigin}=require('./secure-accounts');
const {jsonError}=require('./shop-common');
const {priceKey}=require('./shop-pricing');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false});
 try{
  if(req.method==='POST')checkOrigin(req);
  const ctx=await identity(req,{adminOnly:true});
  const ref=ctx.db.ref('shop_pricing_v1/items');
  if(req.method==='GET')return res.status(200).json({ok:true,defaultMarkupVnd:20000,overrides:(await ref.once('value')).val()||{}});
  const {productId,markupVnd,reason}=req.body||{};
  if(typeof productId!=='string'||!/^[a-zA-Z0-9_:.-]{1,90}$/.test(productId)||
    !Number.isSafeInteger(markupVnd)||markupVnd<0||markupVnd>100000000||
    typeof reason!=='string'||reason.trim().length<12||reason.length>300)
    throw Object.assign(Error('Nhập mã sản phẩm, giá cộng và lý do hợp lệ.'),{status:422});
  const change=await ctx.db.ref('shop_pricing_v1').transaction(current=>{
    const s=current||{};s.items ||= {};s.history ||= {};
    const id=require('node:crypto').randomUUID();
    s.items[priceKey(productId)]={productId,markupVnd,changedBy:ctx.uid,changedAt:Date.now()};
    s.history[id]={productId,markupVnd,reason:reason.trim(),adminUid:ctx.uid,changedAt:Date.now()};
    return s;
  },undefined,false);
  return res.status(200).json({ok:true,productId,markupVnd});
 }catch(e){return jsonError(res,e)}
};
