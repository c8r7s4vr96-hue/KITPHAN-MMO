/** Sends only a REAL persisted RTDB order, never user-provided Telegram text. */
'use strict';
const admin = require('firebase-admin');

function firebaseAdmin() {
  if (!admin.apps.length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)),
      databaseURL: 'https://kitphanmmo-default-rtdb.firebaseio.com'
    });
  }
  return admin;
}
function clean(value, max = 180) { return String(value ?? '').replace(/[<>\u0000-\u001f]/g, ' ').slice(0, max); }
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const orderId = String(req.body?.orderId || '');
  if (!/^LCK-[0-9]{5}$/.test(orderId)) return res.status(400).json({ error: 'Invalid order ID' });
  let ref, claimed = false;
  try {
    const sdk = firebaseAdmin();
    const db = sdk.database();
    const snapshot = await db.ref('orders/' + orderId).once('value');
    if (!snapshot.exists()) return res.status(404).json({ error: 'Order not found' });
    const order = snapshot.val();
    if (order.id !== orderId || typeof order.user !== 'string' || !/^[a-z0-9_-]{3,100}$/i.test(order.user) ||
        typeof order.service !== 'string' || !order.service.trim() ||
        !Number.isSafeInteger(Number(order.total)) || Number(order.total) <= 0) {
      return res.status(422).json({ error: 'Invalid order record' });
    }
    const bearer = String(req.headers.authorization || '');
    if (!bearer.startsWith('Bearer ')) return res.status(401).json({ error: 'Firebase ID token required' });
    const verified = await sdk.auth().verifyIdToken(bearer.slice(7), true);
    let expected = null;
    if (process.env.MAIN_ADMIN_GOOGLE_UID && verified.uid === process.env.MAIN_ADMIN_GOOGLE_UID) {
      expected = String(process.env.MAIN_ADMIN_USERNAME || 'adminkit').toLowerCase();
    } else {
      const binding = (await sdk.database().ref('auth_bindings/'+verified.uid).once('value')).val();
      expected = typeof binding === 'string' ? binding : binding?.username;
      const record = expected ? (await sdk.database().ref('users/'+expected).once('value')).val() : null;
      if (!record || record.authUid !== verified.uid) return res.status(403).json({error:'Account binding invalid'});
    }
    if (expected !== order.user) return res.status(403).json({error:'Order/account mismatch'});
    ref = db.ref('telegram_order_events/' + orderId);
    const now = Date.now();
    const claim = await ref.transaction(v => {
      if (v?.status === 'sent') return;
      if (v?.status === 'sending' && now - Number(v.at || 0) < 120000) return;
      return { status: 'sending', at: now };
    }, undefined, false);
    if (!claim.committed) return res.status(200).json({ ok: true, duplicate: true });
    claimed = true;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) throw new Error('Telegram configuration missing');
    const userSnap = await db.ref('users/' + order.user).once('value');
    const user = userSnap.val() || {};
    const message = [
      '🛒 ĐƠN HÀNG MỚI',
      '🆔 Mã đơn: ' + clean(orderId),
      '👤 Tài khoản: ' + clean(order.user),
      '🔑 UID: ' + clean(user.uid || user.firebaseUid || 'Không có'),
      '🌐 Nền tảng: ' + clean(order.platform),
      '📌 Dịch vụ: ' + clean(order.service),
      '🔗 Target: ' + clean(order.link, 400),
      '📦 Số lượng: ' + clean(order.qty),
      '💰 Tổng tiền: ' + Number(order.total).toLocaleString('vi-VN') + ' VNĐ',
      '📋 Trạng thái: ' + clean(order.status),
      '🕒 Thời gian: ' + clean(order.date)
    ].join('\n');
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: chatId, text: message }),
      signal: AbortSignal.timeout(12000)
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok || !result.ok) throw new Error('Telegram HTTP ' + resp.status);
    await ref.set({ status:'sent', at:sdk.database.ServerValue.TIMESTAMP });
    return res.status(200).json({ ok:true });
  } catch (err) {
    console.error('[order-event]', err.message); // No bot token in logs
    if (claimed && ref) {
      try { await ref.set({status:'failed',at:Date.now()}); } catch (_) {}
    }
    return res.status(500).json({ error:'Order notification could not be sent; check Vercel logs' });
  }
};
