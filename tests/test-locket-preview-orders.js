'use strict';

const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const Module = require('node:module');
const load = Module._load;
const previousEnv = process.env.VERCEL_ENV;
const store = new Map();
const versions = new Map();
const paths = [];
let verificationCount = 0;
let retries = 0;
const snap = obj => ({val: () => structuredClone(obj)});

function ref(path) {
  paths.push(path);
  assert.match(path, /^locket_preview_orders_v1\/[A-Za-z0-9_-]+$/);
  return {
    async once(event) {
      assert.equal(event, 'value');
      return snap(store.get(path) ?? null);
    },
    async transaction(update) {
      // Firebase may submit a null local value, then retry against remote data.
      update(null);
      while (true) {
        const version = versions.get(path) || 0;
        const proposal = update(structuredClone(store.get(path) ?? null));
        await Promise.resolve();
        if ((versions.get(path) || 0) !== version) { retries++; continue; }
        if (proposal === undefined) return {committed: false, snapshot: snap(store.get(path))};
        store.set(path, proposal);
        versions.set(path, version + 1);
        return {committed: true, snapshot: snap(proposal)};
      }
    },
  };
}
const admin = {
  apps: [1],
  database: () => ({ref}),
  auth: () => ({
    async verifyIdToken(token, checkRevoked) {
      verificationCount++;
      assert.equal(checkRevoked, true);
      if (token === 'expired') throw Object.assign(Error('expired'), {code: 'auth/id-token-expired'});
      return {uid: token};
    },
    async getUser(uid) {return {uid, emailVerified: uid !== 'unverified'};},
  }),
};
Module._load = function (name, ...args) {
  return name === 'firebase-admin' ? admin : load.call(this, name, ...args);
};
const orders = require('../api/shop-orders');
Module._load = load;
const user = 'Alice/with.#$[]';
async function request(method, body, who = user, origin = 'https://preview.test') {
  const res = {
    headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) {this.statusCode = code; return this;},
    json(data) {this.body = data;},
  };
  const headers = {host: 'preview.test', origin};
  if (who) headers.authorization = 'Bearer ' + who;
  await orders({method, body, headers, query: {action: 'locket_preview', uid: 'not-trusted'}}, res);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  return res;
}
const make = (scenario = 'success') => ({requestId: randomUUID(), code: 'LKG1Y', username: 'Alice.X', scenario});
async function run() {
  const input = make();
  for (const env of ['production', 'development', '']) {
    process.env.VERCEL_ENV = env;
    for (const method of ['GET', 'POST']) assert.equal((await request(method, input)).statusCode, 404);
  }
  assert.equal(paths.length, 0);
  assert.equal(verificationCount, 0);
  process.env.VERCEL_ENV = 'preview';
  assert.equal((await request('DELETE')).statusCode, 405);
  assert.equal((await request('POST', input, user, 'https://elsewhere.test')).statusCode, 403);
  assert.equal((await request('GET', null, '')).statusCode, 401);
  assert.equal((await request('GET', null, 'expired')).statusCode, 401);
  assert.equal((await request('POST', input, 'unverified')).statusCode, 403);
  assert.equal(paths.length, 0);
  for (const invalid of [undefined, {...input, requestId: 'bad.key'}, {...input, username: 'a/b'},
                         {...input, code: 'FREE'}, {...input, scenario: 'live'}]) {
    assert.equal((await request('POST', invalid)).statusCode, 422);
  }
  const attempts = await Promise.all(Array.from({length: 5}, () =>
    request('POST', {...input, priceVnd: 1, chargedVnd: 89000, uid: 'other'})));
  assert.ok(retries > 0);
  for (const result of attempts) {
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, attempts[0].body);
  }
  const first = attempts[0].body.orders[0];
  assert.deepEqual(attempts[0].body.orders, [{
    id: input.requestId, username: 'Alice.X', code: 'LKG1Y', status: 'completed',
    priceVnd: 89000, chargedVnd: 0, createdAt: first.createdAt,
  }]);
  assert.ok(Number.isSafeInteger(first.createdAt));
  assert.equal((await request('POST', {...input, code: 'LKGVV'})).statusCode, 409);
  assert.equal((await request('POST', {...input, scenario: 'timeout'})).statusCode, 409);
  assert.deepEqual((await request('GET', null, 'other')).body, {ok:true, orders:[]});
  const timeouts = [make('timeout'), make('timeout')];
  const timed = await Promise.all(timeouts.map(body => request('POST', body)));
  assert.deepEqual(timed.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(timed.find(r => r.statusCode === 409).body.error, 'PENDING_EXISTS');
  const pending = timed.find(r => r.statusCode === 200).body.orders.find(row => row.status === 'pending');
  assert.ok(pending);
  const retry = timeouts.find(body => body.requestId === pending.id);
  assert.equal((await request('POST', retry)).statusCode, 200);
  const duplicate = await request('POST', {...make(), username: 'alice.x'});
  assert.equal(duplicate.body.error, 'PENDING_EXISTS');
  for (const [code, price] of [['LKG6M',49000], ['LKGVV',100000]]) {
    const result = await request('POST', {...make(), code});
    assert.equal(result.body.orders.find(row => row.code === code).priceVnd, price);
  }
  const path = 'locket_preview_orders_v1/' + Buffer.from(user).toString('base64url');
  assert.ok(store.has(path));
  const newOrder = {...make(), username: 'bounded'};
  const table = store.get(path);
  while (Object.keys(table).length < 99) {
    const id = randomUUID();
    table[id] = {...first, id};
  }
  const end = await Promise.all([request('POST', newOrder), request('POST', {...newOrder, requestId: randomUUID()})]);
  assert.deepEqual(end.map(r => r.statusCode).sort(), [200, 409]);
  const full = (await request('POST', input)).body.orders;
  assert.equal(full.length, 100);
  assert.deepEqual(full.find(row => row.id === input.requestId), first);
  assert.deepEqual((await request('GET')).body.orders, full);
}
run().finally(() => {
  if (previousEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = previousEnv;
}).then(() => console.log('PASS: Preview orders route, authorization, isolation, concurrent idempotency and bounded history'))
  .catch(err => {console.error(err); process.exitCode = 1;});
