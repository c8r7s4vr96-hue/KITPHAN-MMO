'use strict';
// KIT PHAN MMO V5.2 - STEP 1. Safe webhook ingestion ONLY. NO balance credit.
const crypto = require('node:crypto');
const admin = require('firebase-admin');
const {verifyHmac,validatePayload} = require('../lib/sepay-verification');

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
    if (!txn.committed) return res.status(200).json({success:true,duplicate:true});
    // Do not update users.balance, deposits, or send a "credit successful" notification.
    return res.status(200).json({success:true,recorded:true,pendingReview:true});
  } catch (e) {
    console.error('[sepay-webhook] Error processing event:',e.message);
    return res.status(Number(e.status)||503).json({success:false,message:'Temporary processing error'});
  }
};
