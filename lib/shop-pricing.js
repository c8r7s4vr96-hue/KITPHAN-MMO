'use strict';
const crypto=require('node:crypto');
const {salePrice}=require('./shop-common');
const MAX_MARKUP=100000000;
function priceKey(id){return crypto.createHash('sha256').update(id).digest('hex').slice(0,40);}
function effectivePrice(product,overrides){
 const data=overrides?.[priceKey(product.id)];
 const confirmed=data?.productId===product.id?data:null;
 const markup=Number.isSafeInteger(confirmed?.markupVnd)&&confirmed.markupVnd>=0&&confirmed.markupVnd<=MAX_MARKUP?confirmed.markupVnd:20000;
 const price=salePrice(product.costVnd,markup);
 return price===null?null:{...product,price,markupVnd:markup};
}
async function pricedProducts(db,rows){
 const snap=await db.ref('shop_pricing_v1/items').once('value');
 return rows.map(row=>effectivePrice(row,snap.val()||{})).filter(Boolean);
}
function publicProduct(p){const {costVnd,markupVnd,...view}=p;return view;}
module.exports={priceKey,effectivePrice,pricedProducts,publicProduct};
