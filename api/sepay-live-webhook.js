'use strict';
/** SePay live webhook: require exact-body HMAC, verify authoritative SePay Read API
 * before canonical wallet credit. Never write users.balance or buy supplier products.
 * When LIVE_DEPOSITS_ENABLED is false, signed events are recorded for audit only. */
const crypto=require('node:crypto');
const {firebase}=require('../lib/shop-common');
const {verifyHmac,validatePayload}=require('../lib/sepay-verification');
const {extractLiveCode,isValidLiveAccount,classificationForDraft}=require('../lib/wallet-live-intake');
const {extractPreviewCode}=require('../lib/wallet-live-previews');
const {resolvePreview}=require('../lib/wallet-v55');

async function readRawBody(req,maxBytes=65536){
  // Use the exact signed bytes; never re-stringify a parsed JSON body.
  if(Buffer.isBuffer(req.rawBody)||typeof req.rawBody==='string'){
    const bytes=Buffer.isBuffer(req.rawBody)?req.rawBody:Buffer.from(req.rawBody);
    if(bytes.length>maxBytes){const e=new Error('Payload too large');e.status=413;throw e;}
    return bytes;
  }
  if(typeof req[Symbol.asyncIterator]!=='function'){const e=new Error('Raw webhook bytes unavailable');e.status=503;throw e;}
  const parts=[];let size=0;
  for await(const part of req){const b=Buffer.isBuffer(part)?part:Buffer.from(part);size+=b.length;
    if(size>maxBytes){const e=new Error('Payload too large');e.status=413;throw e;}parts.push(b);}
  return Buffer.concat(parts);
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({success:false,message:'Method not allowed'});
  const secret=process.env.SEPAY_LIVE_WEBHOOK_SECRET;
  const account=process.env.MB_BANK_ACCOUNT_NUMBER;
  if(process.env.SEPAY_LIVE_RECORDING_ENABLED!=='true'||!secret||!isValidLiveAccount(account)||
     (process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER && account===process.env.SEPAY_SANDBOX_ACCOUNT_NUMBER))
    return res.status(503).json({success:false,message:'Live intake recording is disabled'});
  try{
    const raw=await readRawBody(req);
    const verified=verifyHmac({raw,secret,signature:req.headers['x-sepay-signature'],timestamp:req.headers['x-sepay-timestamp']});
    if(!verified.ok)return res.status(401).json({success:false,message:'Invalid or expired signature'});
    let data;try{data=JSON.parse(raw.toString('utf8'));}catch{return res.status(400).json({success:false,message:'Invalid JSON'});}
    const payload=validatePayload(data,account);
    if(!payload.ok){
      if(payload.reason==='account_unconfigured')return res.status(503).json({success:false,message:'Invalid account configuration'});
      return res.status(200).json({success:true,ignored:true,liveCreditsEnabled:false});
    }
    const hash=crypto.createHash('sha256').update(raw).digest('hex');
    const code=extractLiveCode(data.content);
    const previewCode=extractPreviewCode(data.content);
    const db=firebase().database();
    const live=require('../lib/deposit-live');
    if(live.enabled()){
      const event=await live.reconcileId(db,payload.id,process.env,fetch,data);
      return res.status(200).json({success:true,credited:event.credited,status:event.status});
    }
    // A draft code can help manual reconciliation, never authorize a deposit.
    let draftMatch='no_code';
    if(code){
      const claim=(await db.ref('wallet_live_draft_codes/'+code).once('value')).val();
      if(claim && claim.code===code && /^[A-Za-z0-9_-]{4,160}$/.test(claim.uid||'') &&
         /^[a-f0-9]{20}$/.test(claim.draftId||'')){
        const draft=(await db.ref('wallet_live_drafts/'+claim.uid+'/'+claim.draftId).once('value')).val();
        draftMatch=draft && draft.uid===claim.uid && draft.id===claim.draftId && draft.code===code
          ?classificationForDraft(draft,payload.amount):'unmatched';
      }else draftMatch='unmatched';
    }
    // A V5.4 customer preview is NEVER payable. Matching it is only a reconciliation hint.
    let previewMatch='no_preview_code';
    let matchedPreviewId=null;
    let matchedCustomerUid=null;
    if(previewCode){
      const match=await resolvePreview(db,previewCode,payload.amount);
      previewMatch=match.classification;
      matchedPreviewId=match.previewId||null;
      matchedCustomerUid=match.uid||null;
    }
    const eventRef=db.ref('wallet_live_payment_events/sepay_'+payload.id);
    const record={provider:'sepay_live',transactionId:String(payload.id),amountVnd:payload.amount,
      bankAccountLast4:payload.accountLast4,gateway:payload.gateway,
      referenceCode:payload.referenceCode,transactionDate:payload.recordedAt,
      rawPayloadSha256:hash,code:code||null,draftMatch,previewCode:previewCode||null,previewMatch,
      matchedPreviewId,matchedCustomerUid,reconciliationVersion:'5.5',bankVerified:false,
      status:'pending_manual_reconciliation',credited:false,spendable:false,payable:false,
      createdAt:Date.now()};
    const tx=await eventRef.transaction(v=>v===null?record:undefined,undefined,false);
    if(!tx.committed){
      const old=(await eventRef.once('value')).val();
      if(!old||old.rawPayloadSha256!==hash)
        return res.status(200).json({success:true,duplicate:true,bodyMismatch:true,liveCreditsEnabled:false});
      return res.status(200).json({success:true,duplicate:true,pendingReview:true,liveCreditsEnabled:false});
    }
    return res.status(200).json({success:true,recorded:true,pendingReview:true,
      liveCreditsEnabled:false,draftMatch,previewMatch});
  }catch(e){
    console.error('[sepay-live-webhook] failed:',e.message);
    return res.status(e.status||503).json({success:false,message:'Temporary processing error'});
  }
};
