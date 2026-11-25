'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
Module._load = function (id, ...args) {
  if (id === 'firebase-admin') return {apps: []};
  return load.call(this, id, ...args);
};
const products = require('../api/shop-products');
Module._load = load;

async function run() {
  const calls = [];
  const req = {
    method: 'GET', query: {action: 'locket_catalog', service: 'other'},
    headers: {authorization: 'Bearer private-customer-value'},
  };
  const res = {
    headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(s) { this.statusCode = s; return this; },
    json(body) { this.body = body; },
  };
  const data = [
    {code: 'LKG1Y', name: 'Annual', priceCoin: 5},
    {code: 'LKG6M', name: 'Half year', service: 'locket'},
    {code: 'LKGVV', name: 'Lifetime'},
    {code: 'NEW1', name: 'New', service: 'locket', priceCoin: 20},
    {code: 'LKG1Y', name: 'Duplicate'},
    {code: 'OTHER', name: 'Other', service: 'other'},
    {code: 'BAD', name: '<script>'}, null,
  ];
  let body = {ok: true, data};
  global.fetch = async (url, opts) => {
    calls.push(url);
    assert.equal(url, 'https://locket.2707226.xyz/api/packages?service=locket');
    assert.equal(opts.method, 'GET');
    assert.deepEqual(opts.headers, {Accept: 'application/json'});
    assert.equal(opts.redirect, 'error');
    assert.ok(opts.signal instanceof AbortSignal);
    return {ok: true, json: async () => body};
  };
  await products(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {ok: true, packages: [
    {code: 'LKG1Y', name: 'Annual', priceVnd: 89000},
    {code: 'LKG6M', name: 'Half year', priceVnd: 49000},
    {code: 'LKGVV', name: 'Lifetime', priceVnd: 100000},
    {code: 'NEW1', name: 'New', priceVnd: null},
  ]});
  await products({...req, method: 'POST'}, res);
  assert.equal(res.statusCode, 405);
  assert.equal(calls.length, 1);
  body = {ok: true, data: []};
  await products(req, res);
  assert.deepEqual(res.body, {ok: true, packages: []});
  for (body of [null, {ok: true, data: {}}, {ok: false, data}]) {
    await products(req, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  for (const failure of [
    async () => ({ok: false, status: 500}),
    async () => { throw Error('timeout/private value'); },
    async () => ({ok: true, json() { throw Error('invalid JSON'); }}),
  ]) {
    global.fetch = failure;
    await products(req, res);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, {ok: false, error: 'LOCKET_CATALOG_UNAVAILABLE'});
  }
}
const originalFetch = global.fetch;
run().finally(() => { global.fetch = originalFetch; })
  .then(() => console.log('PASS: public Locket catalog route (mocked provider)'))
  .catch(error => { console.error(error); process.exitCode = 1; });
