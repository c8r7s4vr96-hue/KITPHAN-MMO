'use strict';
/**
 * V6.0 - OFFLINE settlement accounting CORE, not connected to any Live API.
 * This is deliberately NOT a bank verification implementation and NOT a
 * production-ready money writer. No Firebase, HTTP, external SDK or env access.
 * The caller MUST independently establish trusted bank evidence before a
 * future reviewed integration can ever use a derived candidate.
 *
 * V5.4 / V5.9 drafts are explicitly NONPAYABLE; they never pass these checks.
 */
const crypto=require('node:crypto');
const LIVE_CODE=/^KP60P[A-F0-9]{24}$/;
const UID=/^[A-Za-z0-9_-]{4,160}$/;
const TX=/^[1-9][0-9]{0,15}$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX_SINGLE_VND=10000000;
const MAX_BALANCE_VND=1000000000;

function reason(reason){return {ok:false,reason,bankVerified:false,canCredit:false};}
function safeAmount(v){return Number.isSafeInteger(v)&&v>=10000&&v<=MAX_SINGLE_VND&&v%1000===0;}
function codeFromContent(s){
 if(typeof s!=='string'||s.length>500)return null;
 const hits=[...s.matchAll(/(?:^|[^a-z0-9])NAP\s+(KP60P[A-F0-9]{24})(?![a-z0-9])/gi)];
 if(hits.length!==1)return null;
 const code=hits[0][1].toUpperCase();
 return LIVE_CODE.test(code)?code:null;
}
function sha(obj){return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');}
/** Offline checking only. A `statement` object supplied to this function is
 * NOT itself independent evidence. A production verifier must fetch and
 * authenticate a bank-issued statement / provider record out-of-band.
 */
function assessTransfer({intent,webhook,statement,expectedAccount,now=Date.now()}={}){
 if(!intent||intent.type!=='verified_live_payment_intent_v60'||intent.status!=='awaiting_bank_transfer'||
   intent.payable!==true||intent.credited!==false||!UID.test(intent.uid||'')||
   !LIVE_CODE.test(intent.code||'')||!safeAmount(intent.amountVnd)||
   !Number.isSafeInteger(intent.createdAt)||!Number.isSafeInteger(intent.expiresAt)||
   intent.createdAt<=0||intent.expiresAt<=intent.createdAt)
   return reason('no_payable_intent');
 if(!/^[0-9]{6,25}$/.test(expectedAccount||'') || intent.accountNumber!==expectedAccount)
   return reason('account_mismatch');
 if(!webhook||!TX.test(String(webhook.transactionId||''))||
   !SHA.test(webhook.rawPayloadSha256||'')||webhook.transferType!=='in'||
   webhook.accountNumber!==expectedAccount||!safeAmount(webhook.amountVnd))
   return reason('unverified_webhook_shape');
 if(!statement || statement.source!=='independent_bank_statement' ||
   !SHA.test(statement.proofSha256||'') ||
   !TX.test(String(statement.transactionId||'')) || statement.transferType!=='in' ||
   statement.accountNumber!==expectedAccount || !safeAmount(statement.amountVnd) ||
   !Number.isSafeInteger(statement.transferredAt) || statement.transferredAt<=0)
   return reason('independent_bank_evidence_missing');
 if(String(webhook.transactionId)!==String(statement.transactionId))return reason('transaction_mismatch');
 if(webhook.amountVnd!==statement.amountVnd||intent.amountVnd!==webhook.amountVnd)
   return reason('amount_mismatch');
 if(codeFromContent(webhook.content)!==intent.code ||
    codeFromContent(statement.content)!==intent.code)
   return reason('reference_mismatch');
 if(statement.transferredAt<intent.createdAt||statement.transferredAt>intent.expiresAt)
   return reason('outside_intent_window');
 if(!Number.isSafeInteger(now)||now<statement.transferredAt)
   return reason('clock_invalid');
 // This is a CANDIDATE, not a verified settlement; independent evidence
 // must be authenticated out-of-band by a future trusted reconciliation service.
 const canonical={txId:String(webhook.transactionId),uid:intent.uid,
   intentCode:intent.code,amountVnd:intent.amountVnd,
   accountNumber:expectedAccount,webhookHash:webhook.rawPayloadSha256,
   statementHash:statement.proofSha256,transferredAt:statement.transferredAt};
 return {ok:true,reason:'matching_candidate_requires_external_verification',
   bankVerified:false,canCredit:false,candidate:canonical,fingerprint:sha(canonical)};
}
/**
 * Pure state transition. Takes a PREAUTHORISED instruction only from trusted
 * server code; NOT exposed in API, and cannot authorize itself. The v58 wallet
 * (LOCKED 0đ) intentionally fails. The canonical posting + balance are returned
 * together for a future single-subtree Firebase RTDB transaction.
 * A cross-UID provider transaction claim is also required BEFORE any live use.
 */
function applyPostingToWallet(wallet,instruction){
 if(!wallet||wallet.status!=='active'||wallet.paymentEnabled!==true||
   wallet.source!=='reconciled_live_wallet_v60'||wallet.legacyFundsImported!==false||
   !UID.test(wallet.uid||'')||wallet.currency!=='VND'||
   !Number.isSafeInteger(wallet.version)||wallet.version<2||
   !Number.isSafeInteger(wallet.availableVnd)||wallet.availableVnd<0||
   !Number.isSafeInteger(wallet.heldVnd)||wallet.heldVnd<0)
   return {ok:false,reason:'wallet_not_reconciled_or_locked'};
 if(!instruction||instruction.authorizedBy!=='independent_bank_reconciler'||
   !TX.test(String(instruction.txId||''))||
   !LIVE_CODE.test(instruction.intentCode||'')||
   !SHA.test(instruction.fingerprint||'')||
   !safeAmount(instruction.amountVnd)||instruction.uid!==wallet.uid)
   return {ok:false,reason:'authorization_required'};
 const key='sepay_'+instruction.txId;
 const postings=wallet.postedTransfers||{};
 const previous=postings[key];
 if(previous){
   if(previous.fingerprint===instruction.fingerprint && previous.intentCode===instruction.intentCode &&
      previous.amountVnd===instruction.amountVnd && previous.uid===instruction.uid)
     return {ok:true,duplicate:true,wallet};
   return {ok:false,reason:'provider_transaction_conflict'};
 }
 const next=wallet.availableVnd+instruction.amountVnd;
 if(!Number.isSafeInteger(next)||next>MAX_BALANCE_VND)return {ok:false,reason:'balance_limit'};
 if(!Number.isSafeInteger(instruction.postedAt)||instruction.postedAt<=0)
   return {ok:false,reason:'invalid_posting_time'};
 const posting={id:key,uid:wallet.uid,type:'verified_bank_deposit',
   amountVnd:instruction.amountVnd,deltaVnd:instruction.amountVnd,
   availableAfterVnd:next,heldAfterVnd:wallet.heldVnd,
   status:'posted',source:'sepay_and_independent_bank_reconciliation',
   fingerprint:instruction.fingerprint,intentCode:instruction.intentCode,
   createdAt:instruction.postedAt};
 const changed={...wallet,availableVnd:next,version:wallet.version+1,
   postedTransfers:{...postings,[key]:posting}};
 return {ok:true,duplicate:false,wallet:changed,posting};
}
/** No DB calls, no bank calls, no financial mutations. Synthetic test only. */
function offlineSelfTest(){
 const now=1700000200000,code='KP60P'+'A'.repeat(24),uid='UIDsyntheticOffline12345';
 const intent={type:'verified_live_payment_intent_v60',status:'awaiting_bank_transfer',
   payable:true,credited:false,uid,code,amountVnd:10000,accountNumber:'0000000000',
   createdAt:now-60000,expiresAt:now+60000};
 const webhook={transactionId:'1234567',rawPayloadSha256:'a'.repeat(64),transferType:'in',
   accountNumber:intent.accountNumber,amountVnd:10000,content:'NAP '+code};
 const statement={source:'independent_bank_statement',proofSha256:'b'.repeat(64),
   transactionId:'1234567',transferType:'in',accountNumber:intent.accountNumber,
   amountVnd:10000,content:'NAP '+code,transferredAt:now-1000};
 const candidate=assessTransfer({intent,webhook,statement,expectedAccount:intent.accountNumber,now});
 const badAmount=assessTransfer({intent,webhook:{...webhook,amountVnd:20000},statement,
   expectedAccount:intent.accountNumber,now});
 const locked={uid,currency:'VND',status:'locked',paymentEnabled:false,source:'customer_zero_initialization_v58',
   legacyFundsImported:false,version:1,availableVnd:0,heldVnd:0};
 const instruction={authorizedBy:'independent_bank_reconciler',uid,txId:webhook.transactionId,
   intentCode:code,amountVnd:10000,fingerprint:candidate.fingerprint,postedAt:now};
 const blocked=applyPostingToWallet(locked,instruction);
 const reconciled={...locked,status:'active',paymentEnabled:true,
   source:'reconciled_live_wallet_v60',version:2};
 const first=applyPostingToWallet(reconciled,instruction);
 const repeat=first.ok?applyPostingToWallet(first.wallet,instruction):{ok:false};
 const altered=first.ok?applyPostingToWallet(first.wallet,{...instruction,amountVnd:20000}):{ok:false};
 return {passed:!!(candidate.ok && candidate.canCredit===false && badAmount.reason==='amount_mismatch' &&
   blocked.reason==='wallet_not_reconciled_or_locked' && first.ok && !first.duplicate &&
   first.wallet.availableVnd===10000 && first.wallet.postedTransfers.sepay_1234567.amountVnd===10000 &&
   repeat.ok && repeat.duplicate && repeat.wallet.availableVnd===10000 &&
   !altered.ok && altered.reason==='provider_transaction_conflict'),
   syntheticOnly:true,independentBankStatementConnected:false,
   actualCreditPerformed:false,productionWalletTouched:false,
   tests:{candidateMatches:!!candidate.ok,missingMoneyStillNotVerified:candidate.canCredit===false,
     amountMismatchRejected:badAmount.reason==='amount_mismatch',
     lockedWalletRejected:blocked.reason==='wallet_not_reconciled_or_locked',
     syntheticAtomicPosting:first.ok&&!first.duplicate,
     syntheticDuplicateNoSecondCredit:repeat.ok&&repeat.duplicate,
     alteredTransactionRejected:altered.reason==='provider_transaction_conflict'}};
}
module.exports={LIVE_CODE,codeFromContent,safeAmount,assessTransfer,applyPostingToWallet,offlineSelfTest};
