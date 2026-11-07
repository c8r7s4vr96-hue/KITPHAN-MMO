'use strict';
/** V5.8 customer ZERO-VND bootstrap only.
 * This module never credits, debits, spends, confirms bank deposits or imports legacy money.
 * Stored on Firebase Admin SDK only after verified UID -> username binding in secure-accounts.identity.
 */
const UID=/^[A-Za-z0-9_-]{4,160}$/;
const USERNAME=/^[a-z0-9_-]{3,60}$/;
const GENESIS='genesis_locked_v58';

function validCustomerLocked(v,uid,username){
  return !!(v && typeof v==='object' && v.uid===uid && v.username===username &&
    v.currency==='VND' && v.source==='customer_zero_initialization_v58' &&
    v.availableVnd===0 && v.heldVnd===0 && v.status==='locked' &&
    v.paymentEnabled===false && v.legacyFundsImported===false &&
    v.version===1 && Number.isSafeInteger(v.createdAt) && v.createdAt>0);
}
function validGenesis(g,uid){
  return !!(g && g.id===GENESIS && g.uid===uid &&
    g.type==='bootstrap_customer_zero_locked' && g.status==='non_financial' &&
    g.deltaVnd===0 && g.availableAfterVnd===0 && g.heldAfterVnd===0 &&
    g.externalTransactionId===null);
}
function blockedEnvironment(env=process.env){
  return env.ACCOUNT_WALLET_RECONCILED==='true' || env.SHOP_PURCHASES_ENABLED==='true' ||
    env.SEPAY_LIVE_RECORDING_ENABLED==='true' || env.WALLET_SANDBOX_ENABLED==='true';
}
async function initializeCustomerZeroWallet(db,uid,username,{now=Date.now(),environment=process.env}={}){
  if(!UID.test(uid)||!USERNAME.test(username)||username==='adminkit'){
    const err=new Error('Tài khoản không phù hợp để tạo ví khách 0đ.');err.status=403;throw err;
  }
  if(blockedEnvironment(environment)){
    const err=new Error('Đang bật cờ không phù hợp với chế độ chuẩn bị V5.8.');err.status=503;throw err;
  }
  const walletRef=db.ref('wallet_accounts/'+uid);
  const fresh={uid,username,currency:'VND',availableVnd:0,heldVnd:0,
    status:'locked',version:1,source:'customer_zero_initialization_v58',
    legacyFundsImported:false,paymentEnabled:false,createdAt:now};
  const tx=await walletRef.transaction(v=>v===null?fresh:undefined,undefined,false);
  if(!tx.committed){
    const existing=(await walletRef.once('value')).val();
    if(!validCustomerLocked(existing,uid,username)){
      const err=new Error('Ví đã tồn tại ở trạng thái khác; không được ghi đè.');err.status=409;throw err;
    }
  }
  const ref=db.ref('wallet_ledger/'+uid+'/'+GENESIS);
  const entry={id:GENESIS,uid,type:'bootstrap_customer_zero_locked',
    deltaVnd:0,availableAfterVnd:0,heldAfterVnd:0,status:'non_financial',
    externalTransactionId:null,createdAt:now,
    note:'Khởi tạo ví khách 0đ, khóa hoàn toàn. Không đối soát hoặc nhập số dư lịch sử.'};
  const logged=await ref.transaction(v=>v===null?entry:undefined,undefined,false);
  if(!logged.committed){
    const old=(await ref.once('value')).val();
    if(!validGenesis(old,uid)){
      const err=new Error('Bút toán khởi tạo không khớp; yêu cầu Admin kiểm tra.');err.status=409;throw err;
    }
  }
  return {created:tx.committed,duplicate:!tx.committed,status:'locked',
    availableVnd:0,heldVnd:0,ledgerInitialized:true,legacyFundsImported:false,
    paymentEnabled:false,liveDepositsOpen:false,automaticCreditsEnabled:false};
}
module.exports={GENESIS,validCustomerLocked,validGenesis,blockedEnvironment,initializeCustomerZeroWallet};
