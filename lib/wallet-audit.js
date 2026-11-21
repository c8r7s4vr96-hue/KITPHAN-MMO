'use strict';
/** Pure reconciliation helpers. Evidence is HISTORICAL, not bank-verified proof. */
const USERNAME = /^[a-z0-9_-]{3,60}$/;
const MAX_VND = 1_000_000_000_000;
const goodAmount = v => typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim()))
  ? (Number.isSafeInteger(Number(v)) && Number(v) >= 0 && Number(v) <= MAX_VND ? Number(v) : null) : null;
const str = (v,max=150) => String(v??'').replace(/[\u0000-\u001f<>]/g,' ').trim().slice(0,max);
const normalize = v => str(v,60).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
const SUCCESS = new Set(['thanh cong','success','completed','paid','da thanh toan']);
const DONE = new Set(['hoan thanh','completed','delivered','success','da giao']);
const PENDING = new Set(['dang xu ly','pending','processing','awaiting_delivery','needs_review','chua xu ly','cho xu ly']);
function addSafe(x,y){return x!==null && y!==null && Number.isSafeInteger(x+y) && x+y<=MAX_VND ? x+y : null}
function listForUsername(raw,username) {
  return Object.values(raw||{}).filter(v=>v && typeof v==='object' && !Array.isArray(v) && String(v.user||v.username||'').toLowerCase()===username);
}
function summarize(username,user,depositRaw,orderRaw,premiumRaw,eventsRaw) {
  if(!USERNAME.test(username))throw Error('username invalid');
  const deposits=listForUsername(depositRaw,username);
  const orders=listForUsername(orderRaw,username);
  const premium=Object.values(premiumRaw||{}).filter(x=>x && typeof x==='object' && !Array.isArray(x));
  const events=Object.values(eventsRaw||{}).filter(x=>x && x.provider==='sepay' && String(x.usernameHint||'').toLowerCase()===username);
  const historical = {amountVnd:0,count:0,unproven:0,withoutBankId:0,duplicates:0};
  const refs=new Set();
  for(const d of deposits){
    if(!SUCCESS.has(normalize(d.status)))continue;
    historical.count++;
    const n=goodAmount(d.amount);
    historical.amountVnd=addSafe(historical.amountVnd,n);
    if(n===null)historical.unproven++;
    const id=str(d.transactionId||'',100);
    if(!id)historical.withoutBankId++;
    else if(refs.has(id)) historical.duplicates++;
    else refs.add(id);
  }
  const legacyOrders={count:orders.length,completedCount:0,processingCount:0,completedTotalVnd:0,invalidTotal:0};
  for(const o of orders){
    const status=normalize(o.status);
    if(PENDING.has(status))legacyOrders.processingCount++;
    if(DONE.has(status)){
      legacyOrders.completedCount++;
      const n=goodAmount(o.total);
      legacyOrders.completedTotalVnd=addSafe(legacyOrders.completedTotalVnd,n);
      if(n===null)legacyOrders.invalidTotal++;
    }
  }
  const premiumOrders={count:premium.length,delivered:premium.filter(x=>x.status==='delivered').length,needReview:premium.filter(x=>['needs_review','awaiting_delivery','admin_reviewing'].includes(x.status)).length};
  const storedBalance=goodAmount(user?.balance), storedTotal=goodAmount(user?.totalDeposited);
  return {
    username,storedBalanceVnd:storedBalance,storedTotalDepositedVnd:storedTotal,
    recordedDeposits:historical, legacyOrders, premiumOrders,
    paymentEvents:{pendingCount:events.filter(x=>x.status==='pending_reconciliation').length,creditedCount:events.filter(x=>x.credited===true).length,
      totalMatchingHint:events.length},
    warning:'Các bản ghi Firebase cũ KHÔNG chứng minh tiền đã vào ngân hàng hoặc đã bị trừ. Không thể tính số dư đáng tin từ các số liệu này.',
    scan:{sourceLimitPerCollection:500,mayBeIncomplete:true,bankVerified:false,automaticBalanceAdjustment:false},
    spendableBalanceVnd:null, walletLocked:true
  };
}
module.exports={USERNAME,MAX_VND,goodAmount,str,normalize,SUCCESS,DONE,PENDING,listForUsername,summarize};
