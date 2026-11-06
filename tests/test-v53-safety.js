'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const page=read('index.html');
const live=read('api/sepay-live-webhook.js');
const old=read('sepay_receiver.php');
assert(!page.includes('89123456789125'),'legacy MB account must not be exposed to customers');
assert(!page.includes('img.vietqr.io/image/MB-'),'hardcoded QR must be disabled');
assert(page.includes('VietQR đang tắt'));
assert(!live.includes("ref('users/") && !live.includes("ref('wallet_accounts/") && !live.includes("ref('wallet_ledger/"),
  'LIVE recording endpoint must never touch wallet balances');
assert(live.includes("SEPAY_LIVE_WEBHOOK_SECRET") && live.includes('verifyHmac') && live.includes("rawPayloadSha256"));
assert(!old.includes("$user['balance']") && !old.includes('sepayProcessed'),
  'retired PHP must not contain wallet credit logic');
console.log('PASS V5.3 safety invariants: no exposed hardcoded QR, no live credit, retired PHP');
