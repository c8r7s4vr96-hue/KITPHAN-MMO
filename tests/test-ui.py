from pathlib import Path
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
import re,json
src=(Path(__file__).resolve().parents[1]/'index.html').read_text()
src=re.sub(r'<script\s+[^>]*src=["\'][^"\']+["\'][^>]*>\s*</script>','',src,flags=re.I)
src=re.sub(r'<link\s+[^>]*href=["\']https?://[^>]+>','',src,flags=re.I)
base='''
Object.defineProperty(window,'localStorage',{configurable:true,value:{_data:{},getItem(k){return this._data[k]||null},setItem(k,v){this._data[k]=String(v)},removeItem(k){delete this._data[k]}}});window.tailwind={config:{}};window.emailjs={init(){}};
window.firebase={ initializeApp(){},database:()=>({ref:()=>({once:(type,fn)=>{const snap={exists:()=>true,val:()=>({})};if(fn)fn(snap);return Promise.resolve(snap);},on(){},set:()=>Promise.resolve(),update:()=>Promise.resolve(),transaction:()=>Promise.resolve({committed:true})})}),auth:Object.assign(()=>({getRedirectResult:()=>Promise.resolve(null),signOut:()=>Promise.resolve(),currentUser:null,onAuthStateChanged:()=>()=>{}}),{GoogleAuthProvider:function(){this.setCustomParameters=()=>{}}})};
window.__kpCheckout=[];
window.fetch=async (url,opts)=>{
 const u=String(url);
 if(u.includes('/api/wallet?action=deposit_preview_create'))return {ok:true,status:201,json:async()=>({ok:true,previewOnly:true,request:{id:'0123456789abcdef01234567',referenceCode:'KP54PAAAAAAAAAAAAAAAAAAAA',amountVnd:10000,createdAt:Date.now(),expiresAt:Date.now()+1800000,status:'preview_not_payable',payable:false,credited:false,qrAvailable:false}})};
 if(u.includes('/api/wallet?action=deposit_preview_status'))return {ok:true,status:200,json:async()=>({ok:true,version:'5.4',previewOnly:true,liveDepositsOpen:false,activePreview:{id:'0123456789abcdef01234567',referenceCode:'KP54PAAAAAAAAAAAAAAAAAAAA',amountVnd:10000,createdAt:Date.now(),expiresAt:Date.now()+1800000,status:'preview_not_payable',payable:false,credited:false,qrAvailable:false},recentPreviews:[]})};
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
 page.evaluate("() => {window.switchTab('deposit');window.generateBankQR();}")
 assert 'KHÔNG thực hiện chuyển khoản' in page.locator('#qrcode-box').inner_text()
 assert page.locator('#tab-deposit img').count()==0
 page.evaluate("() => {auth.currentUser={getIdToken:async()=> 'fake-token'}; currentUser={username:'alice'};}")
 page.evaluate("() => {document.getElementById('kp-v54-ack').checked=true; document.getElementById('kp-v54-create').click();}")
 page.wait_for_timeout(350)
 assert 'KP54PAAAAAAAAAAAAAAAAAAAA' in page.locator('#kp-v54-result').inner_text()
 assert page.locator('#tab-deposit img').count()==0
 assert 'KHÔNG chuyển khoản' in page.locator('#kp-v54-result').inner_text()
 assert '89123456789125' not in src
 print('PASS UI slot email, purchase request, fulfillment, private order view; V5.4 customer preview nonpayable & deposit UI locked')
 print('JS errors',errors)
 assert not errors,errors
 browser.close()
