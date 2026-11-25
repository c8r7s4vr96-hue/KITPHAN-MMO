'use strict';

const {verifiedIdentity} = require('./secure-accounts');
const {checkOrigin, error, jsonError} = require('./shop-common');

const root = 'locket_preview_orders_v1';
const limit = 100;
const prices = new Map([['LKG6M', 49000], ['LKG1Y', 89000], ['LKGVV', 100000]]);
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const usernamePattern = /^[a-z0-9._-]{1,40}$/i;

function parseOrder(body) {
  if (!body || typeof body !== 'object') throw error('Thiếu dữ liệu đơn thử.', 422);
  const name = typeof body.username === 'string' ? body.username.trim() : '';
  if (typeof body.requestId !== 'string' || !uuid.test(body.requestId) ||
      !usernamePattern.test(name) || !prices.has(body.code) ||
      !['success', 'timeout'].includes(body.scenario)) {
    throw error('Dữ liệu đơn thử không hợp lệ.', 422);
  }
  return {
    id: body.requestId.toLowerCase(),
    username: name,
    code: body.code,
    status: body.scenario === 'timeout' ? 'pending' : 'completed',
    priceVnd: prices.get(body.code),
    chargedVnd: 0,
    createdAt: Date.now(),
  };
}

function history(snapshot) {
  return Object.values(snapshot.val() || {}).map(row => ({
    id: row.id, username: row.username, code: row.code, status: row.status,
    priceVnd: row.priceVnd, chargedVnd: 0, createdAt: row.createdAt,
  })).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

async function saveOrder(ref, order) {
  const sameTarget = row => row.code === order.code &&
    row.username.toLowerCase() === order.username.toLowerCase();
  const result = await ref.transaction(current => {
    const rows = current || {};
    if (rows[order.id] || Object.keys(rows).length >= limit ||
        Object.values(rows).some(row => row.status === 'pending' && sameTarget(row))) return rows;
    return {...rows, [order.id]: order};
  });
  if (!result.committed) throw error('Chưa lưu được đơn thử. Vui lòng thử lại.', 503);
  const rows = result.snapshot.val();
  const stored = rows[order.id];
  if (stored) {
    if (!sameTarget(stored) || stored.status !== order.status)
      throw error('Mã yêu cầu đã dùng cho đơn thử khác.', 409);
    return result.snapshot;
  }
  if (Object.values(rows).some(row => row.status === 'pending' && sameTarget(row)))
    throw error('PENDING_EXISTS', 409);
  throw error('Đã đạt giới hạn 100 đơn thử.', 409);
}

module.exports = async function locketPreviewOrders(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ok: false, error: 'PREVIEW_ONLY'});
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ok: false, error: 'Method not allowed'});
  }
  try {
    if (req.method === 'POST') checkOrigin(req);
    const {uid, sdk} = await verifiedIdentity(req);
    const key = Buffer.from(uid, 'utf8').toString('base64url');
    const ref = sdk.database().ref(root + '/' + key);
    const snapshot = req.method === 'GET' ? await ref.once('value') : await saveOrder(ref, parseOrder(req.body));
    return res.status(200).json({ok: true, orders: history(snapshot)});
  } catch (err) {
    if (['auth/argument-error', 'auth/id-token-expired', 'auth/id-token-revoked',
         'auth/invalid-id-token', 'auth/user-not-found'].includes(err?.code)) {
      return res.status(401).json({ok: false, error: 'Vui lòng đăng nhập lại.'});
    }
    return jsonError(res, err);
  }
};
