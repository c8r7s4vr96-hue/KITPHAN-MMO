'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
Module._load = function (id, ...args) {
  if (id === 'firebase-admin') return { apps: [] };
  return load.call(this, id, ...args);
};
const products = require('../api/shop-products');
Module._load = load;

async function run() {
  const prevKey = process.env.LOCKET_API_KEY;
  const prevMarkup = process.env.LOCKET_MARKUP_VND;
  process.env.LOCKET_API_KEY = 'test-ctv-key';
  process.env.LOCKET_MARKUP_VND = '0';

  const calls = [];
  const req = {
    method: 'GET',
    query: { action: 'locket_catalog', service: 'other' },
    headers: { authorization: 'Bearer private-customer-value' },
  };
  const res = {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(s) { this.statusCode = s; return this; },
    json(body) { this.body = body; },
  };
  const packages = [
    { packageId: 1, code: 'LKG1Y', name: 'Annual', ctvPrice: 70000, minRetailPrice: 89000, durationDays: 365, lifetime: false, videoMode: '4k', aiQuota: 100, isTrial: false },
    { packageId: 2, code: 'LKG6M', name: 'Half year', ctvPrice: 49000, minRetailPrice: 49000, durationDays: 180, lifetime: false, videoMode: 'hd', aiQuota: 50, isTrial: false },
    { packageId: 3, code: 'LKGVV', name: 'Lifetime', ctvPrice: 100000, minRetailPrice: 0, durationDays: null, lifetime: true, videoMode: '4k', aiQuota: 999, isTrial: false },
    { packageId: 4, code: 'NEW1', name: 'New', ctvPrice: 0, minRetailPrice: 0, durationDays: 3, lifetime: false, isTrial: true },
    { packageId: 1, code: 'LKG1Y', name: 'Duplicate', ctvPrice: 70000 },
    { packageId: 5, code: 'BAD', name: '<script>', ctvPrice: 10000 },
    null,
  ];
  let body = { ok: true, packages };
  let okStatus = true;

  try {
    global.fetch = async (url, opts) => {
      calls.push(url);
      assert.equal(url, 'https://uplocket.io.vn/api/v1/packages');
      assert.equal(opts.method, 'GET');
      assert.equal(opts.headers['X-API-KEY'], 'test-ctv-key');
      assert.equal(opts.redirect, 'error');
      assert.ok(opts.signal instanceof AbortSignal);
      return {
        ok: okStatus,
        status: okStatus ? 200 : 500,
        text: async () => JSON.stringify(body),
      };
    };

    await products(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      ok: true,
      packages: [
        { packageId: 1, code: 'LKG1Y', name: 'Annual', priceVnd: 89000, durationDays: 365, lifetime: false, videoMode: '4k', aiQuota: 100, isTrial: false, available: true },
        { packageId: 2, code: 'LKG6M', name: 'Half year', priceVnd: 49000, durationDays: 180, lifetime: false, videoMode: 'hd', aiQuota: 50, isTrial: false, available: true },
        { packageId: 3, code: 'LKGVV', name: 'Lifetime', priceVnd: 100000, durationDays: null, lifetime: true, videoMode: '4k', aiQuota: 999, isTrial: false, available: true },
        { packageId: 4, code: 'NEW1', name: 'New', priceVnd: null, durationDays: 3, lifetime: false, videoMode: null, aiQuota: null, isTrial: true, available: false },
      ],
    });

    await products({ ...req, method: 'POST' }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(calls.length, 1);

    body = { ok: true, packages: [] };
    await products(req, res);
    assert.deepEqual(res.body, { ok: true, packages: [] });

    for (const bad of [null, { ok: false, error: 'bad' }]) {
      body = bad;
      await products(req, res);
      assert.equal(res.statusCode, 502);
      assert.equal(res.headers['Cache-Control'], 'no-store');
    }

    for (const failure of [
      async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: 'down' }) }),
      async () => { throw Error('timeout/private value'); },
      async () => ({ ok: true, status: 200, text: async () => 'invalid-json' }),
    ]) {
      global.fetch = failure;
      await products(req, res);
      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.body, { ok: false, error: 'LOCKET_CATALOG_UNAVAILABLE' });
    }
  } finally {
    if (prevKey === undefined) delete process.env.LOCKET_API_KEY;
    else process.env.LOCKET_API_KEY = prevKey;
    if (prevMarkup === undefined) delete process.env.LOCKET_MARKUP_VND;
    else process.env.LOCKET_MARKUP_VND = prevMarkup;
  }
}

const originalFetch = global.fetch;
run().finally(() => { global.fetch = originalFetch; })
  .then(() => console.log('PASS: public Locket catalog route (uplocket.io.vn mocked)'))
  .catch(error => { console.error(error); process.exitCode = 1; });
