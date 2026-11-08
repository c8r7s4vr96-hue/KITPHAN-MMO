'use strict';
// V5.3: isolated LIVE intake preparation. RECORD ONLY; there is deliberately
// no function in this module that can increase a real or legacy wallet balance.
const crypto = require('node:crypto');
const LIVE_CODE = /^KPLIVE[A-F0-9]{20}$/;
const BANK_ACCOUNT = /^[0-9]{6,25}$/;
const MAX_DRAFT_VND = 10000000;

function makeDraftCode(){ return 'KPLIVE'+crypto.randomBytes(10).toString('hex').toUpperCase(); }
function goodDraftAmount(n){
  return typeof n==='number' && Number.isSafeInteger(n) && n>=10000 &&
    n<=MAX_DRAFT_VND && n%1000===0;
}
function isValidLiveAccount(n){return typeof n==='string' && BANK_ACCOUNT.test(n);}
function extractLiveCode(content){
  if(typeof content!=='string'||content.length>2000)return null;
  // The source may include bank-added text; require exactly one unambiguous NAP KPLIVE code.
  const matched=[...content.matchAll(/(?:^|[^A-Za-z0-9])NAP\s+(KPLIVE[A-F0-9]{20})(?![A-Za-z0-9])/gi)];
  if(matched.length!==1)return null;
  const code=matched[0][1].toUpperCase();
  return LIVE_CODE.test(code)?code:null;
}
function classificationForDraft(draft, amount, now=Date.now()){
  if(!draft || draft.status!=='draft_not_payable')return 'unmatched';
  if(!LIVE_CODE.test(draft.code||'') || !goodDraftAmount(draft.amountVnd))return 'unmatched';
  if(draft.expiresAt<now)return 'expired_draft';
  if(draft.amountVnd!==amount)return 'amount_mismatch_draft';
  // This is *not* a valid payment intent; the code exists for reconciliation testing only.
  return 'draft_not_payable';
}
module.exports={makeDraftCode,goodDraftAmount,isValidLiveAccount,extractLiveCode,classificationForDraft};
