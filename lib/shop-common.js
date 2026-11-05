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
function salePrice(cost) {
  const percent=Number(process.env.SHOP_MARKUP_PERCENT||'0');
  const fixed=Number(process.env.SHOP_MARKUP_FIXED_VND||'0');
  if (!Number.isFinite(cost)||cost<=0||!Number.isFinite(percent)||!Number.isFinite(fixed)||percent<0||fixed<0) return null;
  return Math.ceil((cost*(1+percent/100)+fixed)/100)*100;
}
function normalize(row) {
  if (!row||typeof row!=='object') return null;
  const id=String(row.product_id??row.id??row.productId??'');
  const name=safeText(row.name??row.title??row.product_name,180);
  const cat=safeText(row.category_name??row.category?.name??row.category??row.group??'',70);
  if (!/^[a-zA-Z0-9_\-:.]{1,90}$/.test(id)||!name||/locket/i.test(name+' '+cat)) return null;
  const cost=num(row.price_vnd??row.price??row.unit_price??row.selling_price);
  const price=salePrice(cost);
  if(price===null) return null;
  const stockRaw=row.stock??row.available_stock??row.stock_quantity??row.inventory_quantity??row.quantity??row.inventory??row.remaining;
  const unlimited=row.unlimited===true||row.unlimited_stock===true||row.is_unlimited===true||stockRaw==='∞'||stockRaw==='unlimited'||stockRaw===Infinity;
  const stock=unlimited?null:(Number.isFinite(num(stockRaw))?Math.max(0,Math.floor(num(stockRaw))):0);
  const soldout=row.active===false||row.is_active===false||row.available===false||row.status==='inactive';
  return {id,name,category:cat||'Tài khoản Premium',description:safeText(row.description??'',260),price,stock,unlimited,available:!soldout&&(unlimited||stock>0)};
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
    const list=sourceList(data).map(normalize).filter(Boolean);
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
  const bearer=req.headers.authorization||'';
  if(bearer.startsWith('Bearer ')){
    const verified=await firebase().auth().verifyIdToken(bearer.slice(7),true);
    return ('google_'+verified.uid.replace(/[^a-zA-Z0-9_-]/g,'_')).toLowerCase();
  }
  const username=verifySession(cookieMap(req).kp_shop_session);
  if(!username)throw error('Vui lòng đăng nhập lại để đặt hàng',401);
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
module.exports={firebase,error,safeText,normalize,products,callSupplier,usernameFromRequest,signSession,digest,checkOrigin,jsonError};
