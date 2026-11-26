'use strict';
/** Only recognizable fulfillment fields reach the purchaser; never echo entire supplier responses. */
const NAMED_FIELDS = ['email','user','username','account_username','login','password','pass','verifyEmail','verify_email','recoveryEmail','recovery_email','account','code','activation_code','redeem_code','license_key','license','serial','key','invite_link','url','link','instructions','instruction','note','text','content'];
const DELIVERY_KEYS = ['delivery','delivered','fulfillment','fulfilment','delivered_items','delivered_accounts','accounts','credentials','items','keys','codes','account_data','product_data'];
const WRAPPERS = ['data','result','purchase'];
const BAD_STATUS = /^(failed|failure|error|rejected|cancelled|canceled|declined|out_of_stock)$/i;
const WAIT_STATUS = /^(pending|processing|queued|waiting|accepted|awaiting_delivery|in_progress)$/i;
const DONE_STATUS = /^(completed|complete|delivered|fulfilled|success|successful|purchased)$/i;
const text = (v,max=4096)=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max);
function statusOf(payload){
  const candidates=[payload?.status,payload?.data?.status,payload?.result?.status,payload?.purchase?.status,payload?.data?.purchase?.status,payload?.order?.status,payload?.data?.order?.status,payload?.result?.order?.status];
  if(candidates.some(v=>BAD_STATUS.test(String(v||''))))return 'failed';
  if(candidates.some(v=>WAIT_STATUS.test(String(v||''))))return 'pending';
  if(candidates.some(v=>DONE_STATUS.test(String(v||''))))return 'done';
  return 'unknown';
}
// Swagger v2 (Telegram Buyer): delivery.accounts[] contains {user, password,
// verifyEmail}. Only mark an explicitly account-shaped purchase as delivered if
// every supplied account has BOTH a login and password. A password by itself is
// not usable and must never settle the customer's held funds.
const accountWrappers=payload=>[payload,payload?.data,payload?.result,payload?.purchase,
  payload?.data?.purchase,payload?.result?.purchase].filter(x=>x&&typeof x==='object');
function accountDelivery(payload){
  for(const wrapper of accountWrappers(payload)){
    const delivery=wrapper.delivery;
    if(!delivery||typeof delivery!=='object'||!Object.prototype.hasOwnProperty.call(delivery,'accounts'))continue;
    const accounts=delivery.accounts;
    if(!Array.isArray(accounts)||accounts.length<1||accounts.length>25)
      return {kind:'incomplete'};
    const blocks=[];
    for(let i=0;i<accounts.length;i++){
      const a=accounts[i];
      if(!a||typeof a!=='object'||Array.isArray(a))return {kind:'incomplete'};
      const login=text(a.user??a.username??a.account_username??a.email??a.login,1024);
      const password=text(a.password??a.pass,2048);
      if(!login||!password)return {kind:'incomplete'};
      const verifyEmail=text(a.verifyEmail??a.verify_email??a.recoveryEmail??a.recovery_email,1024);
      blocks.push([accounts.length>1?`Tài khoản #${i+1}`:null,
        `Tên đăng nhập: ${login}`,`Mật khẩu: ${password}`,
        verifyEmail?`Email xác minh: ${verifyEmail}`:null].filter(Boolean).join('\n'));
    }
    const deliveryText=blocks.join('\n\n');
    // Do not truncate a multi-account delivery: it would silently remove a
    // credential and still mark the order delivered.
    if(deliveryText.length>8500)return {kind:'incomplete'};
    return {kind:'complete',delivery:deliveryText};
  }
  return null;
}
function fulfillmentText(payload){
  const special=accountDelivery(payload);
  if(special)return special.kind==='complete'?special.delivery:null;
  const visited=new WeakSet();
  const lines=[];
  function append(v,label='',depth=0){
    if(depth>6||lines.join('\n').length>9000)return;
    if(v===null||v===undefined)return;
    if(typeof v==='string'||typeof v==='number'){
      const content=text(v,4096);
      if(content && !/^(success|ok|true|completed|purchased|đã mua thành công)$/i.test(content))lines.push(label?`${label}: ${content}`:content);
      return;
    }
    if(typeof v!=='object'||visited.has(v))return;
    visited.add(v);
    if(Array.isArray(v)){
      v.slice(0,25).forEach((item,i)=>append(item,Array.isArray(item)||typeof item==='object'?'':(label?`${label} ${i+1}`:`#${i+1}`),depth+1));
      return;
    }
    let found=false;
    for(const key of NAMED_FIELDS){
      if(v[key]===undefined||v[key]===null||typeof v[key]==='boolean')continue;
      // Avoid exposing an unrelated metadata URL unless it is in a delivery envelope.
      found=true; append(v[key],key,depth+1);
    }
    for(const key of DELIVERY_KEYS){
      if(v[key]===undefined||v[key]===null||NAMED_FIELDS.includes(key))continue;
      found=true; append(v[key],key,depth+1);
    }
    return found;
  }
  // Only inspect explicitly fulfillment-labelled objects/strings, never global request metadata.
  const containers=[];
  for(const wrap of [payload,payload?.data,payload?.result,payload?.purchase,payload?.data?.purchase,payload?.data?.order]){
    if(!wrap||typeof wrap!=='object')continue;
    for(const key of DELIVERY_KEYS)if(wrap[key]!=null)containers.push(wrap[key]);
  }
  // Some APIs return the delivered account as the whole `data` object with login/pass.
  if(payload?.data&&typeof payload.data==='object'&&NAMED_FIELDS.some(k=>['email','username','login','password','pass','activation_code','redeem_code','license_key','serial'].includes(k)&&payload.data[k]!=null))containers.push(payload.data);
  for(const container of containers)append(container);
  const unique=[...new Set(lines.filter(Boolean))].join('\n').slice(0,8500);
  return unique || null;
}
// Supplier identifiers/status only. Never copy a whole provider response into Firebase:
// purchase replies can contain account credentials or other customers' details.
function supplierDiagnostic(payload){
  const objects=[payload,payload?.order,payload?.data,payload?.result,payload?.purchase,payload?.data?.order].filter(x=>x&&typeof x==='object');
  const scalar=(keys)=>{
    for(const o of objects)for(const k of keys){const v=o[k];
      if((typeof v==='string'||typeof v==='number')&&/^[a-zA-Z0-9_ -]{1,90}$/.test(String(v)))return String(v);
    }
    return null;
  };
  return {code:'SUPPLIER_RESULT_UNCONFIRMED',providerStatus:scalar(['status','order_status','purchase_status']),
    providerReference:scalar(['order_id','orderId','orderCode','order_code','purchase_id','transaction_id'])};
}
function classifyResponse(payload){
  if(payload===null||typeof payload!=='object')return {kind:'review',delivery:null};
  const status=statusOf(payload);
  // An unspecified `error` field can describe a timeout *after* the supplier
  // accepted an order. It is not independent proof of rejection. Keep funds held
  // for reconciliation instead of issuing a potentially duplicate refund.
  if(status==='failed')return {kind:'rejected',delivery:null};
  // Prefer human review if the provider reports an error of unknown meaning,
  // even alongside success:false (which sometimes wraps a transport timeout).
  if(payload.error)return {kind:'review',delivery:null,diagnostic:supplierDiagnostic(payload)};
  if(payload.success===false||payload.ok===false)return {kind:'rejected',delivery:null};
  if(status==='pending')return {kind:'pending',delivery:null,diagnostic:supplierDiagnostic(payload)};
  const accounts=accountDelivery(payload);
  // A successful POST can nevertheless return unusable/partial credentials.
  // Hold the funds for supplier reconciliation instead of falsely showing
  // delivery as complete or issuing a second purchase automatically.
  if(accounts?.kind==='incomplete')return {kind:'review',delivery:null,
    diagnostic:{...supplierDiagnostic(payload),code:'SUPPLIER_DELIVERY_INCOMPLETE'}};
  const delivery=fulfillmentText(payload);
  if(delivery)return {kind:'delivered',delivery};
  return {kind:'pending',delivery:null,diagnostic:supplierDiagnostic(payload)};
}
module.exports={classifyResponse,fulfillmentText,statusOf,supplierDiagnostic};
