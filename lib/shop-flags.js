'use strict';
function enabled(env=process.env){return env.SHOP_PURCHASES_ENABLED==='true'&&
 env.SHOP_WALLET_RULES_SECURED==='true'&&env.SHOP_SUPPLIER_PURCHASE_CONFIRMED==='true';}
function allowed(uid,env=process.env){
 if(!enabled(env)||typeof uid!=='string'||!uid)return false;
 const raw=env.SHOP_PURCHASE_ALLOWED_UIDS||env.MAIN_ADMIN_GOOGLE_UID||'';
 const list=raw.split(',').map(s=>s.trim()).filter(Boolean);
 return list.includes('*')||list.includes(uid);
}
module.exports={enabled,allowed};
