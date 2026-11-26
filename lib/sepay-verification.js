'use strict';
const crypto = require('node:crypto');

function verifyHmac({ raw, signature, timestamp, secret, nowSeconds = Math.floor(Date.now()/1000) }) {
  if (typeof secret !== 'string' || secret.length < 16) return { ok:false, reason:'secret_unconfigured' };
  if (!/^[0-9]{10,12}$/.test(String(timestamp || ''))) return {ok:false,reason:'timestamp_invalid'};
  const signedAt = Number(timestamp);
  if (!Number.isSafeInteger(signedAt) || Math.abs(nowSeconds - signedAt) > 300) return {ok:false,reason:'timestamp_expired'};
  if (typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return {ok:false,reason:'signature_invalid'};
  const expected = 'sha256=' + crypto.createHmac('sha256',secret).update(String(timestamp) + '.').update(raw).digest('hex');
  const actualBuffer = Buffer.from(signature.toLowerCase(),'utf8');
  const expectedBuffer = Buffer.from(expected,'utf8');
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer,expectedBuffer)) return {ok:false,reason:'signature_mismatch'};
  return {ok:true};
}

function extractUsername(content) {
  if (typeof content !== 'string') return null;
  const hits = [...content.matchAll(/(?:^|[^a-zA-Z0-9_])NAP\s+([a-zA-Z0-9_]{3,32})(?![a-zA-Z0-9_])/gi)];
  // Avoid resolving ambiguous transfer notes automatically.
  if (hits.length !== 1) return null;
  return hits[0][1].toLowerCase();
}

function validatePayload(data, accountNumber) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {ok:false,reason:'json_not_object'};
  const id = data.id;
  if (!Number.isSafeInteger(id) || id <= 0) return {ok:false,reason:'transaction_id_invalid'};
  if (data.transferType !== 'in') return {ok:false,reason:'not_incoming'};
  const amount = data.transferAmount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000) return {ok:false,reason:'amount_invalid'};
  if (typeof accountNumber !== 'string' || !/^[0-9]{6,25}$/.test(accountNumber)) return {ok:false,reason:'account_unconfigured'};
  if (String(data.accountNumber ?? '') !== accountNumber) return {ok:false,reason:'account_mismatch'};
  const userHint = extractUsername(data.content);
  return {
    ok:true,
    id, amount,
    userHint,
    referenceCode: typeof data.referenceCode==='string' ? data.referenceCode.slice(0,96) : '',
    recordedAt: typeof data.transactionDate==='string' ? data.transactionDate.slice(0,35) : '',
    accountLast4: accountNumber.slice(-4),
    gateway: typeof data.gateway === 'string' ? data.gateway.slice(0,48) : ''
  };
}
module.exports = { verifyHmac, extractUsername, validatePayload };
