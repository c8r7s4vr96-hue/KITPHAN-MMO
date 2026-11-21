'use strict';
const crypto = require('node:crypto');
const admin = require('firebase-admin');
const BASE = 'https://canboso.com';
const DB_URL = 'https://kitphanmmo-default-rtdb.firebaseio.com';
function firebase() {
  if (!admin.apps.length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('Missing Firebase service credentials');
    const cert = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(cert), databaseURL: DB_URL });
  }
  return admin;
}
function error(message, status=500, details='') { const e=new Error(message); e.status=status; e.details=details; return e; }
function safeText(s,max=220) {return String(s??'').replace(/[\x00-\x1f<>]/g,' ').trim().slice(0,max)}
function num(v) {const n=Number(v);return Number.isFinite(n)?n:NaN;}
function salePrice(cost,markup=20000) {
  // CanBoSo: unit price rounded to 100 VND plus EXACTLY 20,000 VND by default.
  // Admin may override a specific product's markup using the protected API.
  if (!Number.isFinite(cost)||cost<=0||!Number.isSafeInteger(markup)||markup<0||markup>100000000) return null;
  const base=Math.ceil(cost/100)*100;
  return Number.isSafeInteger(base+markup)&&base+markup<=1000000000?base+markup:null;
}
// Bản vá V4.1: chuyển giá về VND một cách có kiểm tra đơn vị tiền.
// Không đoán tỷ giá. Nếu nhà cung cấp bán bằng USD thì cần cấu hình SHOP_USD_TO_VND trước.
function parseVietnameseNumber(value) {
  if (typeof value==='number') return Number.isFinite(value) && value>0 ? value : NaN;
  if (typeof value!=='string') return NaN;
  let t=value.trim().replace(/\s+/g,'').replace(/₫|đ|vnd/gi,'');
  let factor=1;
  if (/[kK]$/.test(t)){factor=1000;t=t.slice(0,-1);}
  if (!/^[0-9.,]+$/.test(t))return NaN;
  if (t.includes('.') && t.includes(',')) {
    const lastDot=t.lastIndexOf('.'),lastComma=t.lastIndexOf(',');
    t=lastDot>lastComma?t.replace(/,/g,''):t.replace(/\./g,'').replace(',','.');
  } else if (t.includes(',')) {
    const parts=t.split(',');
    t=parts.length>2 || (parts.length===2&&parts[1].length===3&&factor===1) ? parts.join('') : t.replace(',','.');
  } else if (t.includes('.')) {
    const parts=t.split('.');
    t=parts.length>2 || (parts.length===2&&parts[1].length===3&&factor===1) ? parts.join('') : t;
  }
  const n=Number(t)*factor;
  return Number.isFinite(n)&&n>0?n:NaN;
}
function currencyName(v){return String(v??'').trim().toUpperCase();}
function convertToVnd(amount,currency) {
  const value=parseVietnameseNumber(amount);
  if(!Number.isFinite(value)||value<=0)return NaN;
  const unit=currencyName(currency||'VND');
  if(unit==='VND'||unit==='VNĐ'||unit==='DONG')return value;
  if(unit==='USD'||unit==='USDT'){
    const rate=Number(process.env.SHOP_USD_TO_VND);
    return Number.isFinite(rate)&&rate>=1000&&rate<=100000 ? value*rate : NaN;
  }
  return NaN; // tiền tệ khác: không tạo giá giả
}
function priceInVnd(row,defaultCurrency) {
  const explicit=row.price_vnd??row.priceVnd??row.priceVND;
  if(explicit!==undefined&&explicit!==null)return convertToVnd(explicit,'VND');
  const p=row.price??row.unit_price??row.selling_price;
  const baseCurrency=currencyName(row.currency??row.priceCurrency??defaultCurrency??'VND');
  if(p&&typeof p==='object'&&!Array.isArray(p)){
    // Chỉ đọc các trường được gắn rõ là VND hoặc trường amount/value có currency.
    for(const key of ['vnd','VND','priceVnd','price_vnd','amountVnd','amount_vnd']){
      if(p[key]!=null)return convertToVnd(p[key],'VND');
    }
    const unit=currencyName(p.currency??p.currencyCode??p.unit??baseCurrency);
    for(const key of ['amount','value','price','total','formatted','display']){
      if(p[key]!=null){const n=convertToVnd(p[key],unit);if(Number.isFinite(n))return n;}
    }
    for(const key of ['usd','USD','usdt','USDT']){
      if(p[key]!=null){const n=convertToVnd(p[key],key);if(Number.isFinite(n))return n;}
    }
    return NaN;
  }
  if(typeof p==='string'){
    if(/\b(?:USD|USDT)\b|\$/i.test(p))return convertToVnd(p.replace(/\b(?:USD|USDT)\b|\$/gi,''),'USD');
    if(/\bVND\b|₫|đ/i.test(p))return convertToVnd(p,'VND');
  }
  return convertToVnd(p,baseCurrency);
}
// V4.3: read product stock as a number, numeric string, or nested stock metadata.
// Never infer stock from unrelated fields, stale Telegram messages, or a boolean alone.
function stockDetails(row) {
  if (!row || typeof row !== 'object') return {stock:null,unlimited:false,stockKnown:false,available:false};
  const rootKeys=['stock','available_stock','availableStock','availableQuantity','availableQty',
    'stock_quantity','stockQuantity','stockCount','stock_count','inventory_quantity',
    'remaining','remainingQuantity','remaining_count','remainingCount',
    'quantity','available_count','availableCount','in_stock_count','inStockCount',
    'stock_left','stockLeft','remaining_stock','remainingStock'];
  const countKeys=['available','availableQuantity','availableQty','available_quantity','available_qty',
    'available_stock','availableStock','available_units','availableUnits','available_count','availableCount',
    'remaining','remainingQuantity','remaining_count','remainingCount','remaining_stock',
    'inStock','in_stock','inStockCount','in_stock_count',
    'quantity','qty','stock','stockQuantity','stock_quantity','stockCount','stock_count',
    'count','total','totalQuantity','total_quantity','onHand','on_hand','current','currentStock',
    'current_stock','balance','left','sellable','sellableStock','sellable_stock'];
  const containers=['stock','inventory','availability','inventoryInfo','stockInfo','stock_info','stockStatus','stock_status'];
  const count=v=>{
    if (typeof v==='number' && Number.isSafeInteger(v) && v>=0) return v;
    if (typeof v==='string' && /^\d+$/.test(v.trim())) {
      const n=Number(v.trim());return Number.isSafeInteger(n)?n:null;
    }
    return null;
  };
  const counts=[];
  for (const k of rootKeys) if (row[k]!=null && typeof row[k]!=='object') {
    // Top-level available/inStock are deliberately NOT treated as numeric stock.
    const n=count(row[k]);if(n!==null)counts.push(n);
  }
  const visited=new Set();
  function nested(node,depth){
    if(!node||typeof node!=='object'||Array.isArray(node)||visited.has(node)||depth>3)return;
    visited.add(node);
    for(const k of countKeys){
      const v=node[k];
      if(v==null)continue;
      const n=count(v);
      if(n!==null)counts.push(n);
      else if(typeof v==='object')nested(v,depth+1);
    }
    for(const k of containers)if(node[k]&&typeof node[k]==='object')nested(node[k],depth+1);
  }
  for(const k of containers)nested(row[k],0);
  const unlimitedNodes=[row,row.stock,row.inventory,row.availability].filter(x=>x&&typeof x==='object');
  const unlimited=unlimitedNodes.some(x=>x.unlimited===true||x.isUnlimited===true||x.is_unlimited===true||x.unlimitedStock===true||x.unlimited_stock===true||String(x.type||'').toLowerCase()==='unlimited') ||
    [row.stock,row.inventory].some(v=>v==='∞'||String(v||'').toLowerCase()==='unlimited');
  // Prefer the provider's most-specific available count, rather than e.g. total inventory.
  const stock=counts.length?counts[0]:null;
  const stockKnown=unlimited||stock!==null;
  const nodes=[row,row.stock,row.inventory,row.availability].filter(x=>x&&typeof x==='object');
  const truthyFlag=x=>[true,'true','available','in_stock','instock','active'].includes(x);
  const falsyFlag=x=>[false,'false','unavailable','out_of_stock','outofstock','sold_out','inactive'].includes(x);
  const reportedAvailable=nodes.some(n=>truthyFlag(n.isAvailable)||truthyFlag(n.available)||truthyFlag(n.inStock)||truthyFlag(n.in_stock)||truthyFlag(n.is_available));
  const reportedUnavailable=nodes.some(n=>falsyFlag(n.isAvailable)||falsyFlag(n.available)||falsyFlag(n.inStock)||falsyFlag(n.in_stock)||falsyFlag(n.is_available)||
    n.active===false||n.is_active===false||['inactive','disabled','out_of_stock','sold_out'].includes(String(n.status||'').toLowerCase()));
  return {stock,unlimited,stockKnown,available:!reportedUnavailable&&(unlimited||(stockKnown&&stock>0)||(!stockKnown&&reportedAvailable))};
}
function normalize(row,defaultCurrency) {
  if (!row||typeof row!=='object')return null;
  const id=String(row.product_id??row.id??row.productId??'');
  const name=safeText(row.name??row.title??row.product_name,180);
  const cat=safeText(row.category_name??row.category?.name??row.category??row.group??row.productType??'',70);
  if(!/^[a-zA-Z0-9_\-:.]{1,90}$/.test(id)||!name||/locket/i.test(name+' '+cat))return null;
  const cost=priceInVnd(row,defaultCurrency);
  const price=salePrice(cost);
  if(price===null)return null;
  return {id,name,category:cat||'Tài khoản Premium',description:safeText(row.description??'',260),costVnd:Math.ceil(cost/100)*100,price,...stockDetails(row)};
}
function sourceList(payload) {
  if(Array.isArray(payload))return payload;
  if(Array.isArray(payload?.products))return payload.products;
  if(Array.isArray(payload?.data))return payload.data;
  if(Array.isArray(payload?.data?.products))return payload.data.products;
  if(Array.isArray(payload?.data?.items))return payload.data.items;
  if(Array.isArray(payload?.items))return payload.items;
  if(Array.isArray(payload?.result?.products))return payload.result.products;
  throw error('Supplier response schema could not be recognized; check Swagger and adapter',502);
}
// Aggregate diagnostics only: no API keys, credentials, product contents or prices.
let catalogDiagnostics = null;
function getCatalogDiagnostics(){return catalogDiagnostics;}
function makeCatalogDiagnostics(payload,rows,normalized){
  // Chỉ tiết lộ kiểu dữ liệu và tên trường, KHÔNG tiết lộ giá, tài khoản hoặc key.
  const defaultCurrency=currencyName(payload?.walletCurrency||'');
  const data={sourceRows:rows.length,displayedRows:normalized.length,rejectedRows:rows.length-normalized.length,
    sourceFields:(payload&&!Array.isArray(payload)&&typeof payload==='object')?Object.keys(payload).slice(0,12):[],
    productFields:rows[0]&&typeof rows[0]==='object'?Object.keys(rows[0]).slice(0,25):[],
    currency:defaultCurrency||'UNSPECIFIED',
    priceTypes:{null:0,number:0,string:0,object:0,array:0,other:0},
    priceObjectFields:[],
    rejected:{locket:0,missingId:0,missingName:0,invalidPrice:0,other:0},
    stockKnown:0,stockUnknown:0,availabilityWithoutCount:0,
    stockRootTypes:{object:0,number:0,string:0,null:0,other:0},stockNestedFields:[],
    note:'Metadata and field names only; no prices, API keys, or product secrets'};
  const keys=new Set();
  const stockKeys=new Set();
  for(const row of rows){
    const stockRow=row && typeof row==='object' ? row.stock : null;
    const stockType=stockRow==null?'null':Array.isArray(stockRow)?'other':(typeof stockRow in data.stockRootTypes?typeof stockRow:'other');
    data.stockRootTypes[stockType]++;
    if(stockRow && typeof stockRow==='object' && !Array.isArray(stockRow)){
      Object.keys(stockRow).filter(k=>/stock|qty|quantity|available|count|remain|total|type|status|inventory|unlimited|active|sold|onhand|current|left/i.test(k)).slice(0,25).forEach(k=>stockKeys.add(k));
    }
    if(!row||typeof row!=='object'){data.rejected.other++;continue;}
    const p=row.price_vnd??row.priceVnd??row.priceVND??row.price??row.unit_price??row.selling_price;
    const type=p==null?'null':Array.isArray(p)?'array':typeof p;
    data.priceTypes[type in data.priceTypes?type:'other']++;
    if(p&&typeof p==='object'&&!Array.isArray(p))Object.keys(p).slice(0,20).forEach(k=>keys.add(k));
    const id=String(row.product_id??row.id??row.productId??'');
    const name=safeText(row.name??row.title??row.product_name,180);
    const cat=safeText(row.category_name??row.category?.name??row.category??row.group??row.productType??'',70);
    if(/locket/i.test(name+' '+cat)){data.rejected.locket++;continue;}
    if(!/^[a-zA-Z0-9_\-:.]{1,90}$/.test(id)){data.rejected.missingId++;continue;}
    if(!name){data.rejected.missingName++;continue;}
    if(salePrice(priceInVnd(row,defaultCurrency))===null){data.rejected.invalidPrice++;continue;}
    if(!normalize(row,defaultCurrency)){data.rejected.other++;continue;}
    const availability=stockDetails(row);
    if(availability.stockKnown)data.stockKnown++;else data.stockUnknown++;
    if(availability.available&&!availability.stockKnown)data.availabilityWithoutCount++;
  }
  data.priceObjectFields=[...keys].slice(0,20);
  data.stockNestedFields=[...stockKeys].slice(0,24);
  return data;
}
let cached=null; let cachedAt=0; let inflight=null;
async function callSupplier(path, options={}) {
  const key=process.env.CANBOSO_API_KEY;
  if(!key) throw error('Supplier API is not configured',503);
  const headers={Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})};
  // Swagger auth schemes vary by account; this is deliberately configurable.
  const scheme=(process.env.CANBOSO_AUTH_SCHEME||'x-api-key').toLowerCase();
  if(scheme==='bearer') headers.Authorization='Bearer '+key;
  else if(scheme==='authorization') headers.Authorization=key;
  else if(scheme==='x-buyer-api-key') headers['X-Buyer-API-Key']=key;
  else headers['X-API-Key']=key;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch(BASE+path,{method:options.method||'GET',headers,body:options.body?JSON.stringify(options.body):undefined,signal:controller.signal,cache:'no-store'});
    const data=await response.json().catch(()=>null);
    if(response.status===429){const e=error('Nhà cung cấp giới hạn yêu cầu. Vui lòng thử lại sau.',429);e.retryAfter=response.headers.get('retry-after')||'60';throw e;}
    if(!response.ok) throw error('Supplier API returned HTTP '+response.status,response.status>=500?502:response.status);
    if(data===null) throw error('Supplier returned invalid JSON',502);
    return data;
  } catch(e) {if(e.name==='AbortError')throw error('Supplier timed out; order state must be verified',504);throw e;}
  finally{clearTimeout(timer)}
}
async function products(fresh=false) {
  const now=Date.now();if(!fresh&&cached&&now-cachedAt<30000)return cached;
  if(!fresh&&inflight)return inflight;
  const get=async()=>{
    const data=await callSupplier('/api/v2/telegram-buyer/products');
    const rows=sourceList(data);
    const unit=currencyName(data?.walletCurrency||'');
    const list=rows.map(row=>normalize(row,unit)).filter(Boolean);
    catalogDiagnostics=makeCatalogDiagnostics(data,rows,list);
    if(list.length===0) console.warn('[Shop products] Zero display products:',JSON.stringify(catalogDiagnostics));
    if(!fresh){cached=list;cachedAt=Date.now()}
    return list;
  };
  if(fresh)return get();
  inflight=get();try{return await inflight}finally{inflight=null}
}
function cookieMap(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)]}));}
function digest(v){return crypto.createHash('sha256').update(String(v)).digest('hex')}
function signSession(username){
  const secret=process.env.SHOP_SESSION_SECRET;
  if(!secret||secret.length<32)throw error('SHOP_SESSION_SECRET must have 32+ characters',503);
  const raw=Buffer.from(JSON.stringify({u:username,exp:Date.now()+7*86400000})).toString('base64url');
  const sig=crypto.createHmac('sha256',secret).update(raw).digest('base64url');
  return raw+'.'+sig;
}
function verifySession(session) {
  const secret=process.env.SHOP_SESSION_SECRET;
  if(!secret||!session||!session.includes('.'))return null;
  const [raw,sig]=session.split('.');const expected=crypto.createHmac('sha256',secret).update(raw).digest('base64url');
  const a=Buffer.from(sig||''),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  let obj;try{obj=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'))}catch{return null}
  return obj.exp>Date.now()&&/^[a-z0-9_-]{3,60}$/.test(obj.u)?obj.u:null;
}
async function usernameFromRequest(req) {
  const bearer=String(req.headers.authorization||'');
  if(!bearer.startsWith('Bearer ')) throw error('Firebase Authentication required; legacy sessions are disabled.',401);
  const sdk=firebase();
  const verified=await sdk.auth().verifyIdToken(bearer.slice(7),true);
  const user=await sdk.auth().getUser(verified.uid);
  if(!user.emailVerified || user.disabled) throw error('Please verify your email account.',403);
  // Only the Admin's explicitly configured UID can access the main Admin username.
  if(process.env.MAIN_ADMIN_GOOGLE_UID && verified.uid===process.env.MAIN_ADMIN_GOOGLE_UID){
    const account=String(process.env.MAIN_ADMIN_USERNAME||'adminkit').toLowerCase();
    if(!/^[a-z0-9_-]{3,60}$/.test(account))throw error('Admin account mapping invalid',503);
    return account;
  }
  const binding=(await sdk.database().ref('auth_bindings/'+verified.uid).once('value')).val();
  const username=typeof binding==='string'?binding:binding?.username;
  if(!/^[a-z0-9_-]{3,60}$/.test(String(username||''))) throw error('Account linking is required before checkout.',403);
  const record=(await sdk.database().ref('users/'+username).once('value')).val();
  if(!record || record.authUid!==verified.uid)throw error('Account ownership could not be verified.',403);
  return username;
}

function checkOrigin(req){
  const origin=req.headers.origin;const host=req.headers.host;
  if(origin&&new URL(origin).host!==host)throw error('Invalid request origin',403);
}
function jsonError(res,e){
  const status=e?.status&&e.status>=400&&e.status<=599?e.status:500;
  if(status>=500)console.error('[Shop API]',e?.message||e);
  if(status===429)res.setHeader('Retry-After',e.retryAfter||'60');
  return res.status(status).json({ok:false,error:status>=500?'Dịch vụ tạm thời không khả dụng. Vui lòng thử lại hoặc liên hệ quản trị.':safeText(e?.message||'Yêu cầu không hợp lệ')});
}
module.exports={firebase,error,safeText,salePrice,normalize,products,getCatalogDiagnostics,callSupplier,usernameFromRequest,signSession,digest,checkOrigin,jsonError};
