'use strict';
/** V5.4 previews are NOT payments. This module has no live wallet mutation. */
const crypto = require('node:crypto');
const CODE_RE = /^KP54P[A-F0-9]{20}$/;
const ID_RE = /^[a-f0-9]{24}$/;
const UID_RE = /^[A-Za-z0-9_-]{4,160}$/;
const DURATION_MS = 30 * 60 * 1000;
function makePreviewCode(){return 'KP54P'+crypto.randomBytes(10).toString('hex').toUpperCase()}
function makePreviewId(){return crypto.randomBytes(12).toString('hex')}
function goodPreviewAmount(amount){return typeof amount==='number' && Number.isSafeInteger(amount) && amount>=10000 && amount<=10000000 && amount%1000===0}
function validPreview(p){return !!(p && typeof p==='object' && p.version==='5.4' && p.status==='preview_not_payable' && p.payable===false && p.credited===false && UID_RE.test(p.uid||'') && ID_RE.test(p.id||'') && CODE_RE.test(p.code||'') && goodPreviewAmount(p.amountVnd) && Number.isSafeInteger(p.createdAt) && Number.isSafeInteger(p.expiresAt) && p.expiresAt===p.createdAt+DURATION_MS)}
function publicPreview(p,now=Date.now()){
 if(!validPreview(p))return null;
 return {id:p.id,amountVnd:p.amountVnd,referenceCode:p.code,createdAt:p.createdAt,expiresAt:p.expiresAt,
  status:p.expiresAt<=now?'expired_preview':'preview_not_payable',payable:false,credited:false,qrAvailable:false};
}
function extractPreviewCode(content){
 if(typeof content!=='string'||content.length>2000)return null;
 const matches=[...content.matchAll(/(?:^|[^A-Za-z0-9])NAP\s+(KP54P[A-F0-9]{20})(?![A-Za-z0-9])/gi)];
 if(matches.length!==1)return null;
 const code=matches[0][1].toUpperCase();return CODE_RE.test(code)?code:null;
}
function classifyPreview(p,amount,now=Date.now()){
 if(!validPreview(p))return 'unmatched_preview';
 if(p.expiresAt<=now)return 'expired_preview';
 if(p.amountVnd!==amount)return 'preview_amount_mismatch';
 return 'preview_not_payable';
}
/** Provider URL builder for a FUTURE vetted Live implementation. NEVER returned by a V5.4 API. */
function buildVietQrUrl(account,amount,memo,{bank='MB'}={}){
 if(typeof account!=='string'||!/^[0-9]{6,25}$/.test(account)||!goodPreviewAmount(amount) ||
    typeof memo!=='string'||!/^[A-Za-z0-9 ]{8,100}$/.test(memo)||bank!=='MB')return null;
 const url=new URL('https://vietqr.app/img');
 url.searchParams.set('acc',account);url.searchParams.set('bank',bank);url.searchParams.set('amount',String(amount));
 url.searchParams.set('des',memo);url.searchParams.set('template','compact');return url.toString();
}
module.exports={makePreviewCode,makePreviewId,goodPreviewAmount,validPreview,publicPreview,
 extractPreviewCode,classifyPreview,buildVietQrUrl,DURATION_MS};
