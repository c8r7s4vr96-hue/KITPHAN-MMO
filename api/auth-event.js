const admin = require('firebase-admin');
const crypto = require('node:crypto');

function firebaseAdmin() {
  if (!admin.apps.length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('Firebase service account missing');
    const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(credentials), databaseURL: 'https://kitphanmmo-default-rtdb.firebaseio.com' });
  }
  return admin;
}
function clean(value, max = 120) { return String(value ?? '').replace(/[<>\u0000-\u001f]/g, ' ').slice(0,max); }
async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('Telegram environment variables missing');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({chat_id: chat, text})
  });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
  const result = await response.json();
  if (!result.ok) throw new Error('Telegram rejected message');
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  try {
    const bearer = req.headers.authorization || '';
    if (!bearer.startsWith('Bearer ')) return res.status(401).json({error:'Missing Firebase ID token'});
    const sdk = firebaseAdmin();
    const verified = await sdk.auth().verifyIdToken(bearer.slice(7), true);
    const user = await sdk.auth().getUser(verified.uid);
    const provider = user.providerData.some(p => p.providerId === 'google.com');
    if (!provider) return res.status(403).json({error:'Google authentication required'});
    const key = crypto.createHash('sha256').update(verified.uid + ':' + verified.iat).digest('hex');
    const ref = sdk.database().ref('telegram_auth_events/' + key);
    const transaction = await ref.transaction(current => current || { uid: verified.uid, at: sdk.database.ServerValue.TIMESTAMP }, undefined, false);
    if (!transaction.committed) return res.status(200).json({ok:true,duplicate:true});
    const isNew = Date.now() - new Date(user.metadata.creationTime).getTime() < 120000;
    const time = new Date().toLocaleString('vi-VN', {timeZone:'Asia/Ho_Chi_Minh'});
    await telegram(`${isNew ? '🆕 ĐĂNG KÝ GOOGLE' : '🔐 ĐĂNG NHẬP GOOGLE'}\n👤 ${clean(user.displayName || user.email)}\n📧 ${clean(user.email)}\n🆔 UID: ${clean(verified.uid)}\n🕒 ${time}`);
    return res.status(200).json({ok:true});
  } catch (error) {
    console.error('[auth-event]', error.message);
    return res.status(500).json({error:'Could not process notification'});
  }
};
