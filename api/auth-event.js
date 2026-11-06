/**
 * Vercel Function: Google Firebase Auth and legacy-account notification to Telegram.
 * Secrets are provided ONLY as Vercel Environment Variables.
 * Note: legacy password flow is for compatibility with existing RTDB accounts.
 * Move login, password storage and account authorization to Firebase Auth before production.
 */
'use strict';
const admin = require('firebase-admin');
const crypto = require('node:crypto');

function firebaseAdmin() {
  if (!admin.apps.length) {
    const service = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!service) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
    const credentials = JSON.parse(service);
    admin.initializeApp({
      credential: admin.credential.cert(credentials),
      databaseURL: 'https://kitphanmmo-default-rtdb.firebaseio.com'
    });
  }
  return admin;
}
function clean(value, length = 120) {
  return String(value ?? '').replace(/[<>\u0000-\u001f]/g, ' ').slice(0, length);
}
function safeEquals(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error('Telegram delivery failed (HTTP ' + response.status + ')');
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // This endpoint never allows client-controlled message text.
  const event = String(req.body?.event || '');
  let claimRef = null;
  let claimed = false;
  try {
    const firebase = firebaseAdmin();
    let key, message;
    const time = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    if (event === 'google_sign_in') {
      const bearer = String(req.headers.authorization || '');
      if (!bearer.startsWith('Bearer ')) return res.status(401).json({ error: 'Firebase ID token required' });
      const verified = await firebase.auth().verifyIdToken(bearer.slice(7), true);
      const user = await firebase.auth().getUser(verified.uid);
      if (!user.providerData.some(p => p.providerId === 'google.com')) {
        return res.status(403).json({ error: 'Google authentication required' });
      }
      key = crypto.createHash('sha256').update('google:' + verified.uid + ':' + verified.iat).digest('hex');
      const isNew = Date.now() - new Date(user.metadata.creationTime).getTime() < 120000;
      message = [
        isNew ? '🆕 ĐĂNG KÝ GOOGLE' : '🔐 ĐĂNG NHẬP GOOGLE',
        '👤 ' + clean(user.displayName || user.email),
        '📧 ' + clean(user.email),
        '🆔 UID: ' + clean(verified.uid),
        '🕒 ' + time
      ].join('\n');
    } else if (event === 'legacy_login' || event === 'legacy_register') {
      // Compatibility bridge: verify legacy credentials on the server before alerting.
      const username = String(req.body?.username || '').toLowerCase().trim();
      const password = req.body?.password;
      if (!/^[a-z0-9_-]{3,32}$/.test(username) || typeof password !== 'string' || password.length < 8 || password.length > 256) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }
      const snap = await firebase.database().ref('users/' + username).once('value');
      const user = snap.val();
      if (!user || user.username !== username || !safeEquals(user.password, password) || username.startsWith('google_')) {
        return res.status(401).json({ error: 'Account verification failed' });
      }
      const isNew = event === 'legacy_register' && Number(user.createdAt) > Date.now() - 300000 && Number(user.createdAt) <= Date.now() + 30000;
      const bucket = Math.floor(Date.now() / 60000); // max one event per legacy user / minute
      key = crypto.createHash('sha256').update('legacy:' + event + ':' + username + ':' + bucket).digest('hex');
      message = [
        isNew ? '🆕 ĐĂNG KÝ TÀI KHOẢN' : '🔐 ĐĂNG NHẬP TÀI KHOẢN',
        '👤 ' + clean(user.fullname || username),
        '🔖 Tài khoản: @' + clean(username),
        '📧 ' + clean(user.email),
        '🕒 ' + time
      ].join('\n');
    } else {
      return res.status(400).json({ error: 'Unsupported event' });
    }
    claimRef = firebase.database().ref('telegram_auth_events/' + key);
    const now = Date.now();
    const transaction = await claimRef.transaction(current => {
      if (current?.status === 'sent') return;
      if (current?.status === 'sending' && now - Number(current.at || 0) < 45000) return;
      return { status: 'sending', at: now };
    }, undefined, false);
    if (!transaction.committed) return res.status(200).json({ ok: true, duplicate: true });
    claimed = true;
    await sendTelegram(message);
    await claimRef.set({ status: 'sent', at: firebase.database.ServerValue.TIMESTAMP });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[auth-event]', err.message); // never log passwords or bot secrets
    if (claimed && claimRef) {
      try { await claimRef.set({ status: 'failed', at: Date.now() }); } catch (_) {}
    }
    return res.status(500).json({ error: 'Auth notification could not be sent; check Vercel logs' });
  }
};
