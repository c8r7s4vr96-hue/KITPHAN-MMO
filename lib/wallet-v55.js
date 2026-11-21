'use strict';
/** V5.5: purely informational bank reconciliation and admin-only QR engineering preview.
 * NEVER mutates balances, ledgers, purchase state, or a customer's payable status.
 */
const {goodPreviewAmount,validPreview,classifyPreview}=require('./wallet-live-previews');
const PREVIEW_CODE=/^KP54P[A-F0-9]{20}$/;
const UID=/^[A-Za-z0-9_-]{4,160}$/;
const HISTORY_KEY=/^\d{13}_[a-f0-9]{24}$/;
const ACCOUNT=/^[0-9]{6,25}$/;
const BANK_BIN='970422'; // MB Bank per VietQR bank directory.

function validBankConfig(number,name){
 return typeof number==='string' && ACCOUNT.test(number) &&
   typeof name==='string' && name.trim().length>=3 && name.trim().length<=100 &&
   !/[<>\x00-\x1f]/.test(name);
}
/** Uses the current VietQR Quick Link format. The URL could accept REAL transfers.
 * Never call for public customers while payments remain disabled.
 */
function buildAdminQrUrl(account,name,amount,code){
 if(!validBankConfig(account,name)||!goodPreviewAmount(amount)||
    typeof code!=='string'||!PREVIEW_CODE.test(code))return null;
 const url=new URL('https://img.vietqr.io/image/'+BANK_BIN+'-'+account+'-compact2.png');
 url.searchParams.set('amount',String(amount));
 url.searchParams.set('addInfo','NAP '+code);
 url.searchParams.set('accountName',name.trim());
 return url.toString();
}
/** Only matches an indexed non-payable customer preview. Invalid/expired/mismatch remain non-payable. */
async function resolvePreview(db,code,amount,now=Date.now()){
 if(typeof code!=='string'||!PREVIEW_CODE.test(code)||!goodPreviewAmount(amount))
  return {classification:'invalid_request',matched:false};
 const claim=(await db.ref('wallet_live_preview_codes/'+code).once('value')).val();
 if(!claim || claim.code!==code || !UID.test(claim.uid||'') ||
    !/^[a-f0-9]{24}$/.test(claim.id||'') || !HISTORY_KEY.test(claim.historyKey||''))
  return {classification:'unmatched_preview',matched:false};
 const stored=(await db.ref('wallet_live_previews/'+claim.uid+'/'+claim.historyKey).once('value')).val();
 if(!validPreview(stored) || stored.uid!==claim.uid || stored.id!==claim.id ||
    stored.code!==code || stored.historyKey!==claim.historyKey)
  return {classification:'unmatched_preview',matched:false};
 const classification=classifyPreview(stored,amount,now);
 return {classification,matched:true,username:typeof stored.username==='string'?stored.username.slice(0,60):'',
   uid:claim.uid,previewId:claim.id,amountVnd:stored.amountVnd,expiresAt:stored.expiresAt,
   payable:false,credited:false};
}
function strictLockedWallet(v){return !!(v && v.status==='locked' && v.availableVnd===0 && v.heldVnd===0 && v.paymentEnabled===false)}
module.exports={BANK_BIN,buildAdminQrUrl,resolvePreview,validBankConfig,strictLockedWallet};
