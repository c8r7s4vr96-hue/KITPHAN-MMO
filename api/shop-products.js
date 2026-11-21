'use strict';
const {products,getCatalogDiagnostics,jsonError,firebase}=require('../lib/shop-common');
const {pricedProducts,publicProduct}=require('../lib/shop-pricing');
const {access}=require('../lib/shop-access');
module.exports=async(req,res)=>{
 if(req.query?.action==='pricing_admin')return require('../lib/shop-admin-prices-handler')(req,res);
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
 res.setHeader('Cache-Control','private, no-store'); // checkoutEnabled is account-scoped
 try{
   const rows=await pricedProducts(firebase().database(),await products(false));
   let checkoutEnabled=false;
   let checkoutReason='PURCHASES_NOT_READY';
   let checkoutMode='legacy';
   const {identity}=require('../lib/secure-accounts');
   const db=firebase().database();
   let uid=null;
   if(String(req.headers?.authorization||'').startsWith('Bearer ')) {
     try { const ctx=await identity(req); uid=ctx.uid; }
     catch(e) { checkoutReason=e?.status===409?'ACCOUNT_SETUP_REQUIRED':e?.status===401?'SIGN_IN_REQUIRED':'ACCOUNT_VERIFICATION_REQUIRED'; }
   }
   const gate=await access(db,uid);
   checkoutMode=gate.mode;
   if(uid) {checkoutEnabled=gate.enabled; checkoutReason=gate.reason;}
   else if(checkoutReason==='PURCHASES_NOT_READY') checkoutReason=gate.mode==='pilot'?'PILOT_ONLY':
     gate.mode==='public'?'SIGN_IN_REQUIRED':gate.reason;
   return res.status(200).json({ok:true,products:rows.map(publicProduct),checkoutEnabled,checkoutReason,checkoutMode,verifiedWalletOnly:true,
     checkedAt:new Date().toISOString(),...(req.query?.debug==='1'?{diagnostics:getCatalogDiagnostics()}: {})});
 }catch(e){res.setHeader('Cache-Control','no-store');return jsonError(res,e)}
};
