'use strict';
const {products,getCatalogDiagnostics,jsonError}=require('../lib/shop-common');
module.exports=async(req,res)=>{
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  res.setHeader('Cache-Control','public, s-maxage=30, stale-while-revalidate=15');
  try{
    const list=await products(false);
    return res.status(200).json({ok:true,products:list,checkoutEnabled:process.env.SHOP_PURCHASES_ENABLED==='true'&&process.env.SHOP_WALLET_RULES_SECURED==='true'&&process.env.SHOP_SUPPLIER_PURCHASE_CONFIRMED==='true'&&process.env.ACCOUNT_WALLET_RECONCILED==='true',checkedAt:new Date().toISOString(),...(req.query?.debug==='1'?{diagnostics:getCatalogDiagnostics()}: {})});
  }catch(e){res.setHeader('Cache-Control','no-store');return jsonError(res,e)}
};
