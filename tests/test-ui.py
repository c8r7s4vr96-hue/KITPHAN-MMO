from pathlib import Path
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
import re,json
src=(Path(__file__).resolve().parents[1]/'index.html').read_text()
src=re.sub(r'<script\s+[^>]*src=["\'][^"\']+["\'][^>]*>\s*</script>','',src,flags=re.I)
src=re.sub(r'<link\s+[^>]*href=["\']https?://[^>]+>','',src,flags=re.I)
base='''
Object.defineProperty(window,'localStorage',{configurable:true,value:{_data:{},getItem(k){return this._data[k]||null},setItem(k,v){this._data[k]=String(v)},removeItem(k){delete this._data[k]}}});window.tailwind={config:{}};window.emailjs={init(){}};
window.firebase={ initializeApp(){},database:()=>({ref:()=>({once:(type,fn)=>{const snap={exists:()=>true,val:()=>({})};if(fn)fn(snap);return Promise.resolve(snap);},on(){},set:()=>Promise.resolve(),update:()=>Promise.resolve(),transaction:()=>Promise.resolve({committed:true})})}),auth:Object.assign(()=>({getRedirectResult:()=>Promise.resolve(null),signOut:()=>Promise.resolve(),currentUser:null}),{GoogleAuthProvider:function(){this.setCustomParameters=()=>{}}})};
window.__kpCheckout=[];
window.fetch=async (url,opts)=>{
 const u=String(url);
 if(u.includes('/api/shop-products'))return {ok:true,status:200,json:async()=>({ok:true,checkoutEnabled:true,checkedAt:new Date().toISOString(),products:[
 {id:'slot001',name:'Slot Canva Pro 1 tháng',category:'slot',price:30400,stock:4,stockKnown:true,available:true,unlimited:false,description:'Slot Canva'},
 {id:'account002',name:'Spotify Premium',category:'account',price:86000,stock:8,stockKnown:true,available:true,unlimited:false,description:'Account'}
 ]})};
 if(u.includes('/api/shop-checkout')){
  window.__kpCheckout.push(JSON.parse(opts.body));
  return {ok:true,status:200,json:async()=>({ok:true,status:'delivered',orderId:'req_test_123456',delivery:'email: demo@example.test\\npassword: DEMO-ONLY',price:30400})};
 }
 if(u.includes('/api/shop-orders'))return {ok:true,status:200,json:async()=>({ok:true,orders:[{id:'req_test_123456',name:'Slot Canva Pro 1 tháng',status:'delivered',price:30400,createdAt:Date.now()}],delivery:u.includes('orderId=')?'email: demo@example.test\\npassword: DEMO-ONLY':null})};
 return {ok:true,status:200,json:async()=>({})};
};
'''
src=src.replace('<head>','<head><script>'+base+'</script>',1)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1280,'height':900}); errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(src,wait_until='domcontentloaded',timeout=30000)
 page.add_style_tag(content='.hidden{display:none!important} #main-app{display:flex!important;height:900px!important} #kp-main-scroll{overflow-y:auto!important;height:730px!important}')
 page.evaluate("() => {document.getElementById('auth-screen').classList.add('hidden');document.getElementById('main-app').classList.remove('hidden');window.switchTab('shop');}")
 page.wait_for_timeout(950)
 assert page.locator('#kp-shop-product-grid article').count()==2, page.locator('#kp-shop-message').inner_text()
 page.locator('[data-shop-buy="slot001"]').click()
 assert page.locator('#kp-shop-modal').is_visible()
 assert page.locator('#kp-shop-recipient-row').is_visible()
 assert page.locator('#kp-shop-recipient-email').get_attribute('required') is not None
 page.locator('#kp-shop-recipient-email').fill('customer@example.test')
 page.locator('#kp-shop-confirm').click()
 page.wait_for_timeout(800)
 payloads=page.evaluate('window.__kpCheckout')
 assert len(payloads)==1,payloads
 assert payloads[0]['recipientEmail']=='customer@example.test',payloads
 assert 'DEMO-ONLY' in page.locator('#kp-shop-delivery').inner_text()
 page.locator('#kp-shop-modal-close').click()
 page.locator('[data-shop-delivery="req_test_123456"]').click()
 page.wait_for_timeout(400)
 assert 'DEMO-ONLY' in page.locator('#kp-shop-delivery').inner_text()
 print('PASS UI slot email, purchase request, fulfillment, private order view')
 print('JS errors',errors)
 assert not errors,errors
 browser.close()
