'use strict';
/** V5.7: read-only live deposit launch guardrails. This module CANNOT credit wallets.
 * Its output is a preflight report, NOT authorization to receive real transfers.
 */
const {summarizeEvents}=require('./wallet-v56');
const {strictLockedWallet,validBankConfig}=require('./wallet-v55');

function evaluateLaunchSafety({wallet,events,environment}={}){
  const env=environment||{};
  const summary=summarizeEvents(events||{},25);
  const bankConfigured=validBankConfig(env.MB_BANK_ACCOUNT_NUMBER,env.MB_BANK_ACCOUNT_NAME);
  const hmacConfigured=typeof env.SEPAY_LIVE_WEBHOOK_SECRET==='string'&&env.SEPAY_LIVE_WEBHOOK_SECRET.length>=16;
  const realWalletLocked=strictLockedWallet(wallet);
  const guardrails=[
    {id:'real_wallet_locked_zero',pass:realWalletLocked,
     label:'Ví thật phải LOCKED 0đ và không cho chi tiêu'},
    {id:'live_recording_disabled',pass:env.SEPAY_LIVE_RECORDING_ENABLED!=='true',
     label:'Ghi nhận webhook Live vẫn TẮT trong giai đoạn xây dựng'},
    {id:'sandbox_disabled',pass:env.WALLET_SANDBOX_ENABLED!=='true',
     label:'Chế độ Sandbox đã tắt trên Production'},
    {id:'checkout_disabled',pass:env.SHOP_PURCHASES_ENABLED!=='true',
     label:'Tự động mua hàng vẫn TẮT'},
    {id:'account_wallet_unreconciled',pass:env.ACCOUNT_WALLET_RECONCILED!=='true',
     label:'Chưa cho phép dùng số dư chưa đối soát'},
    {id:'admin_qr_disabled',pass:env.V55_ADMIN_QR_PREVIEW_ENABLED!=='true',
     label:'QR kỹ thuật Admin vẫn TẮT'},
    {id:'live_event_integrity',pass:!summary.integrityAlert,
     label:'Không phát hiện bản ghi bất thường trong phạm vi đã quét'}
  ];
  const launchBlockers=[
    {id:'bank_proof',label:'Chưa có chứng từ sao kê ngân hàng đối chiếu độc lập gắn với từng giao dịch'},
    {id:'payable_intent',label:'Mã KP54P/KPLIVE đang là bản nháp KHÔNG THANH TOÁN, chưa có payment intent thật'},
    {id:'signed_webhook_runtime',label:'Chưa kiểm thử endpoint Live thực tế với HMAC và dữ liệu cô lập'},
    {id:'atomic_credit_engine',label:'Chưa triển khai và kiểm thử cộng ví nguyên tử + sổ cái chính xác một lần'},
    {id:'customer_wallet_migration',label:'Chưa đối soát và khởi tạo ví thật cho từng khách hàng'},
    {id:'unmatched_money_policy',label:'Chưa có quy trình xử lý chuyển thiếu/thừa tiền và giao dịch không có mã'},
    {id:'provider_reconciliation',label:'Chưa triển khai đối soát bù giao dịch bị bỏ lỡ từ SePay/ngân hàng'}
  ];
  return {
    version:'5.7',readOnly:true,
    bankConfigured,hmacConfigured,
    realWalletLocked,
    safetyChecks:guardrails,
    safeDevelopmentState:guardrails.every(c=>c.pass),
    launchBlockers,launchBlockersCount:launchBlockers.length,
    eventsScanned:summary.scanned,eventCounts:summary.counts,
    integrityAlert:summary.integrityAlert,
    canAcceptLiveDeposits:false,canCreditWallet:false,canPurchase:false,
    bankSettlementVerified:false,
    message:'CHỈ KIỂM TRA ĐIỀU KIỆN V5.7; KHÔNG MỞ NẠP, KHÔNG CỘNG TIỀN, KHÔNG PHÁT QR.'
  };
}
module.exports={evaluateLaunchSafety};
