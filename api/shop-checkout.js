'use strict';
/** V5.2.1: hard lock legacy checkout. NEVER debit users/{username}/balance. */
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method !== 'POST') return res.status(405).json({ok:false,error:'Method not allowed'});
  return res.status(423).json({
    ok:false,checkoutEnabled:false,reason:'LEGACY_WALLET_BLOCKED',
    error:'Ví cũ là dữ liệu lịch sử/chưa đối soát; không được dùng mua hàng. Mua tự động đang tạm khóa để tách ví thật và ví thử nghiệm.'
  });
};
