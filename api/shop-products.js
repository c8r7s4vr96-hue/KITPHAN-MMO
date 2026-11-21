'use strict';
const {products,getCatalogDiagnostics,jsonError,firebase}=require('../lib/shop-common');
const {pricedProducts,publicProduct}=require('../lib/shop-pricing');
const {enabled,allowed}=require('../lib/shop-flags');
module.exports=async(req,res)=>{
 if(req.query?.action==='pricing_admin')return require('../lib/shop-admin-prices-handler')(req,res);
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
 res.setHeader('Cache-Control','private, no-store'); // checkoutEnabled is account-scoped
 try{
   const rows=await pricedProducts(firebase().database(),await products(false));
   let checkoutEnabled=false;
   // Diagnostic reason is deliberately coarse: never expose private IDs or configuration secrets.
   let checkoutReason='PURCHASES_NOT_READY';
   if(enabled()){
     if(!String(req.headers?.authorization||'').startsWith('Bearer '))checkoutReason='SIGN_IN_REQUIRED';
     else {
       try{
         const {identity}=require('../lib/secure-accounts');
         const ctx=await identity(req);
         checkoutEnabled=allowed(ctx.uid);
         checkoutReason=checkoutEnabled?'READY':'ACCOUNT_NOT_ALLOWED';
       }catch(e){
         checkoutReason=e?.status===401?'SIGN_IN_REQUIRED':
           e?.status===409?'ACCOUNT_SETUP_REQUIRED':'ACCOUNT_VERIFICATION_REQUIRED';
       }
     }
   }
   return res.status(200).json({ok:true,products:rows.map(publicProduct),checkoutEnabled,checkoutReason,verifiedWalletOnly:true,
     checkedAt:new Date().toISOString(),...(req.query?.debug==='1'?{diagnostics:getCatalogDiagnostics()}: {})});
 }catch(e){res.setHeader('Cache-Control','no-store');return jsonError(res,e)}
};
