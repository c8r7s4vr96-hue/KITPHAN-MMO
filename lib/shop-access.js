'use strict';
/** Admin-managed, fail-closed checkout activation. No client can write this setting.
 * Legacy V8 env gates remain available for pilot deployments; when a verified
 * Google Admin explicitly configures a managed mode it takes precedence.
 * SHOP_HARD_DISABLE=true always stops new purchases in either mode. */
const legacy=require('./shop-flags');
const CONTROL='shop_checkout_control_v2';
const MODES=new Set(['pilot','public','paused']);
const UID=/^[A-Za-z0-9_-]{4,160}$/;
function validControl(s){return s&&typeof s==='object'&&MODES.has(s.mode)&&UID.test(String(s.updatedBy||''))&&Number.isSafeInteger(s.updatedAt)&&s.updatedAt>0;}
async function status(db,env=process.env){
 const record=(await db.ref(CONTROL).once('value')).val();
 if(record!==null&&record!==undefined&&!validControl(record))return {mode:'paused',managed:true,invalid:true,updatedAt:null,updatedBy:null,pilotStartedAt:null};
 if(!validControl(record))return {mode:'legacy',managed:false,updatedAt:null,updatedBy:null,pilotStartedAt:null};
 return {mode:record.mode,managed:true,updatedAt:record.updatedAt,updatedBy:record.updatedBy,
  pilotStartedAt:record.pilotStartedAt||null,verifiedOrderId:record.verifiedOrderId||null};
}
async function access(db,uid,env=process.env){
 if(env.SHOP_HARD_DISABLE==='true')return {enabled:false,reason:'SHOP_HARD_DISABLED',mode:'paused'};
 const control=await status(db,env);
 if(control.managed){
  if(control.mode==='public')return {enabled:UID.test(String(uid||'')),reason:uid?'READY':'SIGN_IN_REQUIRED',mode:'public'};
  if(control.mode==='pilot'){
   const allowed=UID.test(String(uid||'')) && !!env.MAIN_ADMIN_GOOGLE_UID && uid===env.MAIN_ADMIN_GOOGLE_UID;
   return {enabled:allowed,reason:allowed?'READY':'PILOT_ONLY',mode:'pilot'};
  }
  return {enabled:false,reason:'SHOP_PAUSED',mode:'paused'};
 }
 if(!legacy.enabled(env))return {enabled:false,reason:'PURCHASES_NOT_READY',mode:'legacy'};
 const allowed=legacy.allowed(uid,env);
 return {enabled:allowed,reason:allowed?'READY':uid?'ACCOUNT_NOT_ALLOWED':'SIGN_IN_REQUIRED',mode:'legacy'};
}
module.exports={CONTROL,status,access,validControl};
