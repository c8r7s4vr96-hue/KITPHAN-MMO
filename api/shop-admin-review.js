'use strict';
/** Main Google Admin ONLY. Manual refund requires independent supplier proof. */
const {identity,checkOrigin}=require('../lib/secure-accounts');
const {jsonError}=require('../lib/shop-common');
const commerce=require('../lib/wallet-commerce');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false});
 try{
  if(req.method==='POST')checkOrigin(req);
  const ctx=await identity(req,{adminOnly:true});
  if(req.method==='GET'){
    const records=(await ctx.db.ref(commerce.ROOT+'/orders').orderByChild('updatedAt').limitToLast(100).once('value')).val()||{};
    return res.status(200).json({ok:true,orders:Object.values(records)
      .filter(o=>['awaiting_delivery','needs_review'].includes(o?.status)||(['reserved','requesting_supplier'].includes(o?.status)&&Date.now()-Number(o.updatedAt||0)>=120000))
      .map(o=>({id:o.id,username:o.username,price:o.price,status:o.status,name:o.name,recipientEmail:o.recipientEmail,at:o.updatedAt}))
      .sort((a,b)=>b.at-a.at)});
  }
  const {orderId,action,delivery,reason,supplierConfirmedNotCharged}=req.body||{};
  if(typeof orderId!=='string'||!/^ord_[a-f0-9]{36}$/.test(orderId))throw commerce.fail('Mã đơn không hợp lệ.');
  const state=await commerce.transact(ctx.db,v=>commerce.resolveOrderState(v,{
    id:orderId,adminUid:ctx.uid,action,delivery,reason,confirmedNotCharged:supplierConfirmedNotCharged===true}));
  return res.status(200).json({ok:true,status:state.orders[orderId].status});
 }catch(e){return jsonError(res,e)}
};
