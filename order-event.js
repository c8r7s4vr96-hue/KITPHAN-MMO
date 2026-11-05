const admin = require('firebase-admin');

function firebaseAdmin() {
  if (!admin.apps.length) {
    const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
    admin.initializeApp({
      credential: admin.credential.cert(credentials),
      databaseURL: 'https://kitphanmmo-default-rtdb.firebaseio.com'
    });
  }
  return admin;
}

function clean(value, max = 180) {
  return String(value ?? '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, max);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const orderId = String(req.body?.orderId || '');
  if (!/^LCK-[0-9]{5}$/.test(orderId)) return res.status(400).json({ error: 'Invalid order ID' });
  try {
    const sdk = firebaseAdmin();
    const db = sdk.database();
    const snapshot = await db.ref('orders/' + orderId).once('value');
    if (!snapshot.exists()) return res.status(404).json({ error: 'Order not found' });
    const order = snapshot.val();
    if (order.id !== orderId || !order.user || !order.service || !Number.isFinite(Number(order.total)) || Number(order.total) <= 0) {
      return res.status(422).json({ error: 'Invalid order record' });
    }
    const eventRef = db.ref('telegram_order_events/' + orderId);
    const now = Date.now();
    const claim = await eventRef.transaction(v => {
      if (v?.status === 'sent' || (v?.status === 'sending' && now - Number(v.at || 0) < 120000)) return;
      return { status: 'sending', at: now };
    }, undefined, false);
    if (!claim.committed) return res.status(200).json({ ok: true, duplicate: true });
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) throw new Error('Telegram configuration missing');
    const userSnap = await db.ref('users/' + order.user).once('value');
    const user = userSnap.val() || {};
    const text = [
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
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('Telegram sendMessage failed');
    await eventRef.set({ status: 'sent', at: sdk.database.ServerValue.TIMESTAMP });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[order-event]', error.message);
    // The two-minute claim expires to permit a manual retry without immediate duplicates.
    return res.status(500).json({ error: 'Notification failed' });
  }
};
