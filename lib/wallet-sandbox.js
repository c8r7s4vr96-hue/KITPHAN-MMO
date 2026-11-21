'use strict';
/** Pure helpers for TEST-ONLY deposit simulations. NEVER mutate wallet_accounts or users. */
const crypto = require('node:crypto');
const TEST_CODE=/^KPTEST[A-F0-9]{16}$/;
const MAX_TEST_CREDIT=100000; // VND per transaction, test-money only
const MAX_TEST_TOTAL=1000000; // VND per sandbox account
const MAX_TEST_EVENTS=100;
function makeCode(){return 'KPTEST'+crypto.randomBytes(8).toString('hex').toUpperCase();}
function extractTestCode(content){
  if(typeof content!=='string')return null;
  const m=[...content.matchAll(/(?:^|[^a-zA-Z0-9_])NAP\s+(KPTEST[A-F0-9]{16})(?![a-zA-Z0-9_])/gi)];
  return m.length===1?m[0][1].toUpperCase():null;
}
function goodTestAmount(n){return Number.isSafeInteger(n)&&n>=10000&&n<=MAX_TEST_CREDIT&&n%1000===0;}
function validUid(uid){return typeof uid==='string'&&/^[A-Za-z0-9_-]{10,160}$/.test(uid);}
function validIntent(intent){return intent&&typeof intent==='object'&&/^[a-z0-9]{20}$/.test(String(intent.intentId||''))&&TEST_CODE.test(String(intent.code||''));}
/** A single Firebase transaction on wallet_sandbox_accounts/{uid} atomically writes both balance and journal. */
function applySandboxCredit(before,{uid,txId,intentId,amountVnd,now}) {
  if(!validUid(uid)||!/^[0-9]{1,20}$/.test(String(txId))||!/^[a-z0-9]{20}$/.test(String(intentId))||!goodTestAmount(amountVnd)||!Number.isSafeInteger(now))return undefined;
  const eventKey='sepay_'+txId;
  const base=before===null?{
    uid,currency:'VND',kind:'simulation_only',availableVnd:0,heldVnd:0,
    processed:{},usedIntents:{},ledger:{},createdAt:now,version:1
  }:before;
  if(!base||base.uid!==uid||base.kind!=='simulation_only'||base.currency!=='VND'||base.heldVnd!==0||!Number.isSafeInteger(base.availableVnd)||base.availableVnd<0)return undefined;
  const processed=base.processed||{},used=base.usedIntents||{},ledger=base.ledger||{};
  if(processed[eventKey]||used[intentId])return undefined;
  if(Object.keys(processed).length>=MAX_TEST_EVENTS||base.availableVnd+amountVnd>MAX_TEST_TOTAL)return undefined;
  return {...base,availableVnd:base.availableVnd+amountVnd,version:(base.version||0)+1,
    processed:{...processed,[eventKey]:{amountVnd,intentId,at:now}},
    usedIntents:{...used,[intentId]:eventKey},
    ledger:{...ledger,[eventKey]:{type:'test_sepay_credit',status:'simulation_only',transactionId:String(txId),intentId,deltaVnd:amountVnd,availableAfterVnd:base.availableVnd+amountVnd,createdAt:now}}};
}
function alreadyApplied(v,txId,intentId){
  return !!(v&&v.processed&&v.processed['sepay_'+txId]?.intentId===intentId&&v.usedIntents?.[intentId]==='sepay_'+txId);
}
module.exports={makeCode,extractTestCode,goodTestAmount,validUid,validIntent,applySandboxCredit,alreadyApplied,TEST_CODE};
