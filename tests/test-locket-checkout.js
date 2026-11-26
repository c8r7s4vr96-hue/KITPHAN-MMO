'use strict';
/** All in memory: tests Locket resolve, Locket Gold checkout (uplocket.io.vn), idempotency, orders history, and refund on provider failure. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const native = Module._load;
Module._load = function (name, parent, main) {
  if (name === 'firebase-admin') return { apps: [] };
  return native.call(this, name, parent, main);
};
const secure = require('../lib/secure-accounts');
Module._load = native;

const customerUid = 'customerLocketUid_1234';
const envKeys = ['LOCKET_API_KEY', 'LOCKET_API_BASE_URL', 'LOCKET_MARKUP_VND', 'SHOP_HARD_DISABLE'];
const saved = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
Object.assign(process.env, {
  LOCKET_API_KEY: 'test-locket-ctv-key-only',
  LOCKET_API_BASE_URL: 'https://uplocket.io.vn',
  LOCKET_MARKUP_VND: '0',
  SHOP_HARD_DISABLE: 'false',
});

function snapshot(v) { return { val: () => v, exists: () => v !== undefined && v !== null }; }
function makeDb() {
  const data = {
    shop_checkout_control_v2: { mode: 'public', updatedBy: 'adminGoogleUid_1234', updatedAt: Date.now() },
    live_deposits_v1: {
      accounts: {
        [customerUid]: { uid: customerUid, username: 'locketuser1', availableVnd: 200000, heldVnd: 0, totalDepositedVnd: 200000 },
      },
    },
  };
  const get = path => path.split('/').reduce((v, k) => v?.[k], data);
  const set = (path, value) => {
    const keys = path.split('/'), last = keys.pop();
    let v = data;
    for (const k of keys) v = v[k] ||= {};
    v[last] = value;
  };
  return {
    data, get,
    ref(path) {
      const state = { path, column: null, equals: null, limit: null };
      return {
        orderByChild(col) { state.column = col; return this; },
        equalTo(v) { state.equals = v; return this; },
        limitToLast(n) { state.limit = n; return this; },
        async once() {
          let result = get(path);
          if (state.column && result && typeof result === 'object') {
            result = Object.fromEntries(Object.entries(result).filter(([, v]) => v?.[state.column] === state.equals).slice(-Number(state.limit || 1e6)));
          }
          return snapshot(structuredClone(result ?? null));
        },
        async transaction(fn) {
          const current = get(path) ?? null;
          const updated = fn(structuredClone(current));
          if (updated === undefined) return { committed: false, snapshot: snapshot(current) };
          set(path, updated);
          return { committed: true, snapshot: snapshot(structuredClone(updated)) };
        },
      };
    },
  };
}

const db = makeDb();
secure.identity = async (req) => {
  if (!req.ctx) throw Object.assign(Error('Sign in required'), { status: 401 });
  return { ...req.ctx, db };
};

const products = require('../api/shop-products');
const checkout = require('../api/shop-checkout');
const orders = require('../api/shop-orders');

const customer = { uid: customerUid, username: 'locketuser1', isAdmin: false };
const reply = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
async function call(fn, ctx, method, body = {}, query = {}) {
  const res = reply();
  await fn({ ctx, method, body, query, headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } }, res);
  return res;
}

const originalFetch = global.fetch;
async function test() {
  try {
    let exportCalls = 0;
    let shouldFailExport = false;

    global.fetch = async (url, opts = {}) => {
      assert.equal(opts.headers['X-API-KEY'], 'test-locket-ctv-key-only');
      if (url.endsWith('/api/v1/packages')) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({
            ok: true,
            packages: [
              { packageId: 101, code: 'LKG1Y', name: '1 năm', ctvPrice: 70000, minRetailPrice: 89000, durationDays: 365, lifetime: false, videoMode: '4k', aiQuota: 100, isTrial: false },
            ],
          }),
        };
      }
      if (url.endsWith('/api/v1/dns/lookup')) {
        const body = JSON.parse(opts.body);
        assert.equal(body.username, 'kitphantest');
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({
            ok: true,
            data: {
              uid: 'uid_locket_999',
              username: 'kitphantest',
              avatarUrl: 'https://example.com/a.jpg',
              active: false,
              expiresAt: null,
              packageName: null,
            },
          }),
        };
      }
      if (url.endsWith('/api/v1/dns/export')) {
        exportCalls++;
        if (shouldFailExport) {
          return { ok: false, status: 402, text: async () => JSON.stringify({ ok: false, error: 'Insufficient CTV credits' }) };
        }
        const body = JSON.parse(opts.body);
        assert.equal(body.username, 'kitphantest');
        assert.equal(body.packageId, 101);
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({
            ok: true,
            data: {
              uid: 'uid_locket_999',
              username: 'kitphantest',
              packageId: 101,
              packageCode: 'LKG1Y',
              packageName: '1 năm',
              activationCode: 'ACT-XYZ-123',
              expiresAt: '2027-11-26T00:00:00Z',
              installUrl: 'https://uplocket.io.vn/dns/kitphantest.mobileconfig',
              reused: false,
            },
          }),
        };
      }
      throw new Error('Unexpected fetch URL: ' + url);
    };

    // 1. Resolve tests
    assert.equal((await call(products, customer, 'GET', {}, { action: 'locket_resolve' })).statusCode, 405);
    assert.equal((await call(products, null, 'POST', { identifier: 'kitphantest' }, { action: 'locket_resolve' })).statusCode, 401);
    assert.equal((await call(products, customer, 'POST', { identifier: '   ' }, { action: 'locket_resolve' })).statusCode, 422);

    const rOk = await call(products, customer, 'POST', { identifier: '@kitphantest' }, { action: 'locket_resolve' });
    assert.equal(rOk.statusCode, 200, JSON.stringify(rOk.body));
    assert.equal(rOk.body.ok, true);
    assert.equal(rOk.body.data.uid, 'uid_locket_999');
    assert.equal(rOk.body.data.username, 'kitphantest');
    assert.equal(rOk.body.data.check.active, false);

    // 2. Checkout validation
    const missingUser = await call(checkout, customer, 'POST', {
      productId: 'LKG1Y', service: 'locket', quotedPriceVnd: 89000, requestId: 'locket_req_00000001', locketUsername: '',
    });
    assert.equal(missingUser.statusCode, 422);

    // 3. Successful Locket checkout
    const buyOk = await call(checkout, customer, 'POST', {
      productId: 'LKG1Y', service: 'locket', quotedPriceVnd: 89000, requestId: 'locket_req_00000002', locketUsername: 'kitphantest',
    });
    assert.equal(buyOk.statusCode, 200, JSON.stringify(buyOk.body));
    assert.equal(buyOk.body.ok, true);
    assert.equal(buyOk.body.status, 'delivered');
    assert.equal(buyOk.body.locket.username, 'kitphantest');
    assert.equal(buyOk.body.locket.packageId, 101);
    assert.equal(buyOk.body.locket.packageCode, 'LKG1Y');
    assert.equal(buyOk.body.locket.activationCode, 'ACT-XYZ-123');
    assert.equal(buyOk.body.locket.dnsUrl, 'https://uplocket.io.vn/dns/kitphantest.mobileconfig');
    assert.match(buyOk.body.delivery, /ACT-XYZ-123/);
    assert.match(buyOk.body.delivery, /uplocket\.io\.vn\/dns\/kitphantest\.mobileconfig/);
    assert.equal(db.get(`live_deposits_v1/accounts/${customerUid}/availableVnd`), 111000);
    assert.equal(db.get(`live_deposits_v1/accounts/${customerUid}/heldVnd`), 0);
    assert.equal(exportCalls, 1);

    // 4. Idempotent replay
    const replay = await call(checkout, customer, 'POST', {
      productId: 'LKG1Y', service: 'locket', quotedPriceVnd: 89000, requestId: 'locket_req_00000002', locketUsername: 'kitphantest',
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.id, buyOk.body.id);
    assert.equal(exportCalls, 1, 'idempotent replay must not call provider again');

    // 5. Orders history
    const hist = await call(orders, customer, 'GET', {}, { orderId: buyOk.body.id });
    assert.equal(hist.statusCode, 200);
    assert.equal(hist.body.orders.length, 1);
    assert.equal(hist.body.orders[0].service, 'locket');
    assert.equal(hist.body.orders[0].locket.activationCode, 'ACT-XYZ-123');
    assert.match(hist.body.delivery, /kitphantest/);

    // 6. Provider failure (402) -> refund hold
    db.data.live_deposits_v1.accounts[customerUid].lastPurchaseAt = 0;
    shouldFailExport = true;
    const buyFail = await call(checkout, customer, 'POST', {
      productId: 'LKG1Y', service: 'locket', quotedPriceVnd: 89000, requestId: 'locket_req_00000003', locketUsername: 'kitphantest',
    });
    assert.equal(buyFail.statusCode, 422);
    assert.equal(buyFail.body.ok, false);
    assert.equal(buyFail.body.status, 'refunded');
    assert.match(buyFail.body.error, /Insufficient CTV credits/);
    assert.match(buyFail.body.error, /hoàn lại vào ví/);
    assert.equal(db.get(`live_deposits_v1/accounts/${customerUid}/availableVnd`), 111000);
    assert.equal(db.get(`live_deposits_v1/accounts/${customerUid}/heldVnd`), 0);

    console.log('PASS: Locket resolve, Locket Gold checkout (uplocket.io.vn), idempotency, orders history, and refund on provider failure');
  } finally {
    global.fetch = originalFetch;
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test().catch(e => { console.error(e); process.exitCode = 1; });
