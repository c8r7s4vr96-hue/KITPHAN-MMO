'use strict';
/** Read-only service diagnostics for authenticated Google admin; NO test charges. */
const crypto=require('node:crypto');
const {checkConnection}=require('./sepay-connection');
const {callSupplier,products}=require('./shop-common');
const {verifyHmac}=require('./sepay-verification');
const {enabled:checkoutEnabled}=require('./shop-flags');
const live=require('./deposit-live');

function localSePay(env=process.env){
  const secret=env.SEPAY_LIVE_WEBHOOK_SECRET||'';
  const configured=secret.length>=16 && /^\d{6,25}$/.test(env.MB_BANK_ACCOUNT_NUMBER||'');
  const raw=Buffer.from('{"diagnostic":true}');
  const timestamp=String(Math.floor(Date.now()/1000));
  const signature='sha256='+crypto.createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex');
  const hmacSelfTest=configured&&verifyHmac({raw,signature,timestamp,secret}).ok &&
    !verifyHmac({raw:Buffer.from('{"diagnostic":false}'),signature,timestamp,secret}).ok;
  return {configured,recordingEnabled:env.SEPAY_LIVE_RECORDING_ENABLED==='true',
    customerDepositsEnabled:env.LIVE_DEPOSITS_ENABLED==='true',
    localHmacSelfTest:hmacSelfTest,
    note:'Tự kiểm tra chữ ký nội bộ, CHƯA chứng minh webhook SePay thật tới Vercel.'};
}
function readiness(env=process.env){
  return {customerDeposits:env.LIVE_DEPOSITS_ENABLED==='true'&&env.SEPAY_LIVE_RECORDING_ENABLED==='true',
    purchases:checkoutEnabled(env),
    buyerPurchaseAllowedUidsConfigured:!!env.SHOP_PURCHASE_ALLOWED_UIDS,
    manualWalletAdjustments:env.ADMIN_WALLET_ADJUSTMENTS_ENABLED==='true'};
}
async function probeCanBoSo({supplierCall=callSupplier,productCall=products,env=process.env}={}){
  if(!env.CANBOSO_API_KEY)return {configured:false,productCatalog:'not_checked',buyerBalance:'not_checked',buyerOrders:'not_checked',message:'CANBOSO_API_KEY chưa được cấu hình.'};
  // GET only. A 200 response proves reachability and key acceptance for the read APIs,
  // NOT purchase payload/schema, actual stock delivery, or provider wallet sufficiency.
  const tasks=[
    async()=>{const list=await productCall(true);return {status:list.length?'read_ok':'catalog_empty_or_unrecognized',count:list.length}},
    async()=>{const v=await supplierCall('/api/v2/telegram-buyer/balance');return {status:v&&typeof v==='object'?'read_ok':'invalid_body'}},
    async()=>{const v=await supplierCall('/api/v2/telegram-buyer/orders');const list=Array.isArray(v)?v:
      Array.isArray(v?.orders)?v.orders:Array.isArray(v?.data?.orders)?v.data.orders:Array.isArray(v?.data)?v.data:null;
      return {status:list?'read_ok':'schema_unrecognized',count:list?.length??null};}
  ];
  const names=['productCatalog','buyerBalance','buyerOrders'];
  const values=await Promise.all(tasks.map(fn=>fn().catch(e=>({status:'failed',httpStatus:e?.status||null}))));
  const result={configured:true};
  names.forEach((key,i)=>{result[key]=values[i]});
  result.message='Chỉ đọc GET từ CanBoSo. Chưa thử POST mua hàng hoặc xác nhận giao tài khoản.';
  return result;
}
async function readProductionEvidence(db){
  if(!db)return {available:false};
  try{
    const [signed,reconciled]=await Promise.all([
      db.ref('wallet_live_payment_events').limitToLast(25).once('value'),
      db.ref('live_deposits_v1/events').limitToLast(25).once('value')
    ]);
    const receipt=Object.values(signed.val()||{}).filter(e=>e&&e.provider==='sepay_live');
    const events=Object.values(reconciled.val()||{}).filter(e=>e&&e.verificationSource==='sepay_read_api_v1');
    const max=a=>a.length?Math.max(...a.map(x=>Number(x.recordedAt||x.createdAt)||0)):null;
    return {available:true,last25SignedWebhookEvents:receipt.length,
      last25ReadApiReconciledEvents:events.length,
      last25VerifiedCreditEvents:events.filter(e=>e.status==='credited'&&e.credited===true).length,
      lastSignedWebhookAt:max(receipt),lastReadApiReconciledAt:max(events),
      note:'Chỉ đếm bản ghi Firebase (tối đa 25 gần nhất mỗi loại); phải đối chiếu sự kiện thật trong SePay trước khi công nhận.'};
  }catch{return {available:false,message:'Không đọc được sự kiện Live từ Firebase.'};}
}
async function checkIntegrations({env=process.env,sepayChecker=checkConnection,supplierCall=callSupplier,productCall=products,db=null}={}){
  const local=localSePay(env);
  const [sepay,canboso]=await Promise.all([
    sepayChecker(env).catch(()=>({connected:false,message:'SePay không truy cập được.'})),
    probeCanBoSo({env,supplierCall,productCall})
  ]);
  const [flags,evidence]=[readiness(env),await readProductionEvidence(db)];
  if(db){try{const managed=await require('./shop-access').status(db,env);
    flags.managedCheckoutMode=managed.mode;flags.purchases=managed.managed?managed.mode==='public':flags.purchases;
    if(env.SHOP_HARD_DISABLE==='true')flags.purchases=false;
  }catch{flags.managedCheckoutMode='unavailable';}}
  const checksPass=sepay.connected&&local.localHmacSelfTest&&
    canboso.productCatalog?.status==='read_ok'&&canboso.buyerBalance?.status==='read_ok'&&canboso.buyerOrders?.status==='read_ok';
  return {ok:true,checkedAt:new Date().toISOString(),readOnly:true,liveTransactionTested:false,
    actualWebhookReceivedAndMatched:false,actualCanBoSoPurchaseTested:false,
    sepay:{...local,readApi:sepay},canboso,flags,evidence,
    summary:checksPass?'Các API chỉ đọc hoạt động. Vẫn cần kiểm thử giao dịch có kiểm soát và đối soát Live.':
      'Có kiểm tra chưa đạt/chưa hoàn tất. Không kết luận hệ thống sẵn sàng giao dịch thật.'};
}
module.exports={localSePay,readiness,probeCanBoSo,readProductionEvidence,checkIntegrations};
