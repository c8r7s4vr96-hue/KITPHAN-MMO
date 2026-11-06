'use strict';
// KIT PHAN MMO V5.2 - STEP 1. Safe webhook ingestion ONLY. NO balance credit.
const crypto = require('node:crypto');
const admin = require('firebase-admin');
const {verifyHmac,validatePayload} = require('../lib/sepay-verification');
const {extractTestCode,applySandboxCredit,alreadyApplied,validIntent} = require('../lib/wallet-sandbox');

function firebase() {
  if (!admin.apps.length) {
    const value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!value) throw new Error('Firebase Admin credentials missing');
    admin.initializeApp({
      credential:admin.credential.cert(JSON.parse(value)),
      databaseURL:'https://kitphanmmo-default-rtdb.firebaseio.com'
    });
  }
  return admin.database();
}

async function readRawBody(req,maxBytes=65536) {
  const parts=[]; let total=0;
  for await (const part of req) {
    const buf=Buffer.isBuffer(part)?part:Buffer.from(part);
    total+=buf.length;
    if (total>maxBytes) { const err = new Error('Payload too large'); err.status=413; throw err; }
    parts.push(buf);
  }
  return Buffer.concat(parts);
}

/** After the signed event is durably stored, optionally settle ONLY a sandbox account.
 * All credits and their idempotency ledger are one transaction at wallet_sandbox_accounts/{uid}.
 * Never touches users.balance, wallet_accounts, wallet_ledger or supplier checkout.
 * Safe to retry if a Function crashes between sandbox credit and event status update.
 */
async function maybeSettleSandbox(db,payload,data,eventRef,eventHash){
  if(process.env.WALLET_SANDBOX_ENABLED!=='true'||
     !process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER||
     process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER!==process.env.SEPAY_RECEIVING_ACCOUNT_NUMBER||
     String(data.accountNumber)!==process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER)return {sandbox:'disabled'};
  const code=extractTestCode(data.content);
  if(!code)return {sandbox:'no_test_code'};
  const [codeSnap,eventSnap]=await Promise.all([
    db.ref('wallet_sandbox_codes/'+code).once('value'),eventRef.once('value')
  ]);
  const claim=codeSnap.val(),existing=eventSnap.val();
  if(!claim||claim.code!==code||!existing||existing.rawPayloadSha256!==eventHash)return {sandbox:'unmatched_or_modified'};
  const uid=claim.uid;
  if(!/^[A-Za-z0-9_-]{10,160}$/.test(String(uid||'')))return {sandbox:'invalid_uid'};
  const intentRef=db.ref('wallet_sandbox_active/'+uid);
  const intent=(await intentRef.once('value')).val();
  if(!validIntent(intent)||intent.uid!==uid||intent.intentId!==claim.intentId||intent.code!==code||intent.amountVnd!==payload.amount)return {sandbox:'intent_mismatch'};
  const accountRef=db.ref('wallet_sandbox_accounts/'+uid);
  const prior=(await accountRef.once('value')).val();
  const wasApplied=alreadyApplied(prior,payload.id,intent.intentId);
  if(!wasApplied && (intent.status!=='awaiting_test_transfer'||intent.expiresAt<Date.now()))return {sandbox:'expired_or_closed'};
  const stamp=Date.now();
  const txn=await accountRef.transaction(v=>applySandboxCredit(v,{
    uid,txId:payload.id,intentId:intent.intentId,amountVnd:payload.amount,now:stamp
  }),undefined,false);
  if(!txn.committed){
    const latest=(await accountRef.once('value')).val();
    if(!alreadyApplied(latest,payload.id,intent.intentId))return {sandbox:'cap_or_conflict'};
  }
  // If the next write fails, the next signed replay safely repairs metadata.
  await intentRef.transaction(v=>v&&v.uid===uid&&v.intentId===intent.intentId&&
    (v.status==='awaiting_test_transfer'||v.status==='simulated_credited')
    ?{...v,status:'simulated_credited',simulatedAt:v.simulatedAt||stamp,transactionId:String(payload.id)}:undefined,undefined,false);
  await eventRef.update({sandboxStatus:'simulated_credited',sandboxCredited:true,sandboxUid:uid,
    sandboxAmountVnd:payload.amount});
  return {sandbox:'simulated_credited',sandboxCredited:true};
}

module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).json({success:false,message:'Method not allowed'});
  const secret=process.env.SEPAY_WEBHOOK_SECRET;
  const receivingAccount=process.env.SEPAY_RECEIVING_ACCOUNT_NUMBER;
  if (!secret || !receivingAccount) return res.status(503).json({success:false,message:'Webhook not configured'});
  try {
    const raw=await readRawBody(req);
    const verified=verifyHmac({raw,secret,signature:req.headers['x-sepay-signature'],timestamp:req.headers['x-sepay-timestamp']});
    if (!verified.ok) return res.status(401).json({success:false,message:'Invalid or expired signature'});
    let data;
    try { data=JSON.parse(raw.toString('utf8')); }
    catch { return res.status(400).json({success:false,message:'Invalid JSON'}); }
    const payload=validatePayload(data,receivingAccount);
    if (!payload.ok) {
      // Valid, authenticated event, but not a qualifying deposit for this receiving account.
      if (payload.reason === 'account_unconfigured') return res.status(503).json({success:false,message:'Invalid server configuration'});
      return res.status(200).json({success:true,ignored:true});
    }
    const hash=crypto.createHash('sha256').update(raw).digest('hex');
    const ref=firebase().ref('payment_webhook_events/sepay_' + payload.id);
    const record={
      provider:'sepay',transactionId:String(payload.id), amountVnd:payload.amount,
      usernameHint:payload.userHint,bankAccountLast4:payload.accountLast4,
      gateway:payload.gateway,referenceCode:payload.referenceCode,
      transactionDate:payload.recordedAt,rawPayloadSha256:hash,
      status:'pending_reconciliation', credited:false,
      receivedAt:admin.database.ServerValue.TIMESTAMP
    };
    const txn=await ref.transaction(before => before === null ? record : undefined,undefined,false);
    if (!txn.committed) {
      const saved=(await ref.once('value')).val();
      // Existing transaction IDs are global; never apply a modified body to an earlier event.
      if(saved?.rawPayloadSha256!==hash)return res.status(200).json({success:true,duplicate:true,bodyMismatch:true});
      const simulation=await maybeSettleSandbox(firebase(),payload,data,ref,hash);
      return res.status(200).json({success:true,duplicate:true,...simulation});
    }
    const simulation=await maybeSettleSandbox(firebase(),payload,data,ref,hash);
    // credited:false always. Sandbox-only credit, if any, lives in wallet_sandbox_accounts.
    return res.status(200).json({success:true,recorded:true,pendingReview:true,...simulation});
  } catch (e) {
    console.error('[sepay-webhook] Error processing event:',e.message);
    return res.status(Number(e.status)||503).json({success:false,message:'Temporary processing error'});
  }
};
