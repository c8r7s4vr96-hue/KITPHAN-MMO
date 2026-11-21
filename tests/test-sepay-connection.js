'use strict';
const assert = require('node:assert/strict');
const { checkConnection } = require('../lib/sepay-connection');
const env = { MB_BANK_ACCOUNT_NUMBER: '1234567890', SEPAY_READ_API_TOKEN: 'private-test-token' };
const account = { account_number: env.MB_BANK_ACCOUNT_NUMBER, bank_bin: '970422', active: '1' };
async function run() {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer private-test-token');
    assert.ok(url.startsWith('https://my.sepay.vn/userapi/'));
    return { ok: true, json: async () => ({
      status: 200, messages: { success: true },
      bankaccounts: [account], transactions: [{ account_number: env.MB_BANK_ACCOUNT_NUMBER }]
    }) };
  };
  assert.equal((await checkConnection({}, fetcher)).connected, false);
  assert.equal(calls, 0);
  assert.equal((await checkConnection({ MB_BANK_ACCOUNT_NUMBER: '1234567890' }, fetcher)).connected, false);
  assert.equal(calls, 0);
  const result = await checkConnection(env, fetcher);
  assert.equal(result.connected, true);
  assert.equal(result.accountLast4, '7890');
  assert.equal(calls, 2);
  assert.equal(JSON.stringify(result).includes(env.SEPAY_READ_API_TOKEN), false);
  for (const data of [
    { status: 401 },
    { status: 200, messages: { success: true }, bankaccounts: [] },
    { status: 200, messages: { success: true }, bankaccounts: [{...account,bank_bin:'970436'}] },
    { status: 200, messages: { success: true }, bankaccounts: [{...account,active:'0'}] }
  ]) {
    assert.equal((await checkConnection(env, async()=>({ok:true,json:async()=>data}))).connected, false);
  }
  const failure = await checkConnection(env, async()=>{throw Error(env.SEPAY_READ_API_TOKEN);});
  assert.equal(failure.connected, false);
  assert.equal(JSON.stringify(failure).includes(env.SEPAY_READ_API_TOKEN), false);
  console.log('PASS SePay connection checks, configuration, account matching and redacted errors');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
