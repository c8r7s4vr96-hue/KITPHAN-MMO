'use strict';
/** V5.6: read-only SePay LIVE intake risk audit.
 * A signed SePay webhook is NOT independent bank settlement evidence.
 * All V5.4 previews are NEVER payable; this module has no write methods.
 */
const SHA256=/^[a-f0-9]{64}$/;
const TX=/^[1-9][0-9]{0,15}$/;
const AMOUNT_MISMATCH=new Set(['preview_amount_mismatch','amount_mismatch_draft']);
const EXPIRED=new Set(['expired_preview','expired_draft']);
const PREVIEW=new Set(['preview_not_payable','draft_not_payable']);
const EMPTY=new Set(['no_preview_code','no_code']);
function assessEvent(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||
   v.provider!=='sepay_live'||!TX.test(String(v.transactionId||''))||
   !Number.isSafeInteger(v.amountVnd)||v.amountVnd<=0||v.amountVnd>1000000000||
   typeof v.rawPayloadSha256!=='string'||!SHA256.test(v.rawPayloadSha256)||
   v.status!=='pending_manual_reconciliation'||v.credited!==false||
   v.spendable!==false||v.payable!==false||v.bankVerified!==false){
    return 'integrity_alert';
 }
 if(AMOUNT_MISMATCH.has(v.previewMatch)||AMOUNT_MISMATCH.has(v.draftMatch))return 'amount_mismatch';
 if(EXPIRED.has(v.previewMatch)||EXPIRED.has(v.draftMatch))return 'expired_reference';
 if(PREVIEW.has(v.previewMatch)||PREVIEW.has(v.draftMatch))return 'nonpayable_preview';
 if(EMPTY.has(v.previewMatch)&&EMPTY.has(v.draftMatch))return 'unassigned';
 return 'unmatched_reference';
}
function sanitizeEvent(v){
 const assessment=assessEvent(v);
 const id=String(v?.transactionId||'');
 return {transactionId:TX.test(id)?id:'INVALID',
  amountVnd:Number.isSafeInteger(v?.amountVnd)&&v.amountVnd>0?v.amountVnd:null,
  receivedAt:Number.isSafeInteger(v?.createdAt)&&v.createdAt>0?v.createdAt:null,
  assessment,
  previewMatch:String(v?.previewMatch||'unknown').slice(0,40),
  draftMatch:String(v?.draftMatch||'unknown').slice(0,40),
  bankIndependentlyVerified:false,approvedForCredit:false,
  note:'Bản ghi webhook không chứng minh tiền thực nhận; cần đối soát sao kê độc lập.'};
}
function summarizeEvents(records,limit=25){
 const values=records && typeof records==='object' && !Array.isArray(records)?Object.values(records):[];
 const safe=values.slice(-limit).map(sanitizeEvent).sort((a,b)=>(b.receivedAt||0)-(a.receivedAt||0));
 const counts={};for(const e of safe)counts[e.assessment]=(counts[e.assessment]||0)+1;
 return {scanned:safe.length,counts,integrityAlert:!!counts.integrity_alert,events:safe};
}
module.exports={assessEvent,sanitizeEvent,summarizeEvents};
