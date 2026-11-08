'use strict';
/** Only recognizable fulfillment fields reach the purchaser; never echo entire supplier responses. */
const NAMED_FIELDS = ['email','username','login','password','pass','account','code','activation_code','redeem_code','license_key','license','serial','key','invite_link','url','link','instructions','instruction','note','text','content'];
const DELIVERY_KEYS = ['delivery','delivered','fulfillment','fulfilment','delivered_items','delivered_accounts','accounts','credentials','items','keys','codes','account_data','product_data'];
const WRAPPERS = ['data','result','purchase'];
const BAD_STATUS = /^(failed|failure|error|rejected|cancelled|canceled|declined|out_of_stock)$/i;
const WAIT_STATUS = /^(pending|processing|queued|waiting|accepted|awaiting_delivery|in_progress)$/i;
const DONE_STATUS = /^(completed|complete|delivered|fulfilled|success|successful|purchased)$/i;
const text = (v,max=4096)=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max);
function statusOf(payload){
  const candidates=[payload?.status,payload?.data?.status,payload?.result?.status,payload?.purchase?.status,payload?.data?.purchase?.status,payload?.data?.order?.status];
  if(candidates.some(v=>BAD_STATUS.test(String(v||''))))return 'failed';
  if(candidates.some(v=>WAIT_STATUS.test(String(v||''))))return 'pending';
  if(candidates.some(v=>DONE_STATUS.test(String(v||''))))return 'done';
  return 'unknown';
}
function fulfillmentText(payload){
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
function classifyResponse(payload){
  if(payload===null||typeof payload!=='object')return {kind:'review',delivery:null};
  if(payload.success===false||payload.ok===false||payload.error || statusOf(payload)==='failed')return {kind:'rejected',delivery:null};
  const status=statusOf(payload);
  if(status==='pending')return {kind:'pending',delivery:null};
  const delivery=fulfillmentText(payload);
  if(delivery)return {kind:'delivered',delivery};
  return {kind:'pending',delivery:null};
}
module.exports={classifyResponse,fulfillmentText,statusOf};
