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
   if(enabled()&&String(req.headers?.authorization||'').startsWith('Bearer ')){
     try{const {identity}=require('../lib/secure-accounts');const ctx=await identity(req);checkoutEnabled=allowed(ctx.uid)}
     catch { checkoutEnabled=false; }
   }
   return res.status(200).json({ok:true,products:rows.map(publicProduct),checkoutEnabled,verifiedWalletOnly:true,
     checkedAt:new Date().toISOString(),...(req.query?.debug==='1'?{diagnostics:getCatalogDiagnostics()}: {})});
 }catch(e){res.setHeader('Cache-Control','no-store');return jsonError(res,e)}
};
