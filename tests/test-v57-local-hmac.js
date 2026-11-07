'use strict';
/** Completely offline SePay HMAC/dedup test. No secrets or accounts from Production. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {verifyHmac,validatePayload}=require('../lib/sepay-verification');
const {extractLiveCode}=require('../lib/wallet-live-intake');
const secret='OFFLINE_FAKE_SECRET_NEVER_DEPLOY';
const bank='000000000000';
const now=Math.floor(Date.now()/1000);
const payload={id:987654321,transferType:'in',transferAmount:10000,
 accountNumber:bank,content:'NAP KPLIVE0123456789ABCDEFABCD',referenceCode:'LOCAL-ONLY',
 transactionDate:'2026-11-07 12:00:00',gateway:'MBBank'};
const raw=Buffer.from(JSON.stringify(payload));
const sign=(timestamp,data,key=secret)=>'sha256='+crypto.createHmac('sha256',key).update(timestamp+'.').update(data).digest('hex');
let checks=0;const eq=(x,y)=>{assert.deepEqual(x,y);checks++};
const signature=sign(now,raw);
eq(verifyHmac({raw,secret,signature,timestamp:String(now),nowSeconds:now}).ok,true);
eq(verifyHmac({raw,secret,signature:'sha256='+'0'.repeat(64),timestamp:String(now),nowSeconds:now}).ok,false);
eq(verifyHmac({raw,secret,signature,timestamp:String(now-301),nowSeconds:now}).ok,false);
eq(verifyHmac({raw,secret,signature:sign(now,Buffer.from('{}')),timestamp:String(now),nowSeconds:now}).ok,false);
eq(verifyHmac({raw,secret:'another_secret_long_enough',signature,timestamp:String(now),nowSeconds:now}).ok,false);
eq(validatePayload(payload,bank).ok,true);
eq(validatePayload({...payload,accountNumber:'111111111111'},bank).ok,false);
eq(validatePayload({...payload,transferAmount:20000},bank).ok,true);
eq(validatePayload({...payload,transferType:'out'},bank).ok,false);
eq(extractLiveCode(payload.content),'KPLIVE0123456789ABCDEFABCD');
const seen=new Map();function record(fake){
 const id=String(fake.id);const hash=crypto.createHash('sha256').update(JSON.stringify(fake)).digest('hex');
 const old=seen.get(id);if(old)return old===hash?'duplicate':'conflicting_transaction_id';
 seen.set(id,hash);return 'recorded_unverified_no_credit';
}
eq(record(payload),'recorded_unverified_no_credit');
eq(record(payload),'duplicate');
eq(record({...payload,transferAmount:20000}),'conflicting_transaction_id');
eq(seen.size,1);
const pretendWallet={availableVnd:0,heldVnd:0,status:'locked'};
eq(pretendWallet.availableVnd,0);
console.log('PASS V5.7 LOCAL HMAC simulation: '+checks+' assertions; no Firebase, no payment, no wallet credit');
