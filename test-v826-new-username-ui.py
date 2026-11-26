"""Offline browser regression for new Firebase email/password customer -> username activation.
Never calls live Firebase or CanBoSo or performs wallet operations.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re

html=(Path(__file__).resolve().parents[1]/'index.html').read_text(encoding='utf-8')
html=re.sub(r'<script\s+[^>]*src=["\'][^"\']+["\'][^>]*>\s*</script>','',html,flags=re.I)
html=re.sub(r'<link\s+[^>]*href=["\']https?://[^>]+>','',html,flags=re.I)
mock=r'''
Object.defineProperty(window,'localStorage',{configurable:true,value:{_data:{},getItem(k){return Object.prototype.hasOwnProperty.call(this._data,k)?this._data[k]:null},setItem(k,v){this._data[k]=String(v)},removeItem(k){delete this._data[k]}}});
window.tailwind={config:{}};window.emailjs={init(){}};
window.__kpCalls=[];
window.__mockCurrent=null;
window.__mockVerified=false;
window.__mockServerProfile=null;
window.__mockSignups=[];
window.__mockUid='customer_uid_123';
const mockUser={uid:window.__mockUid,email:'newcustomer@example.test',emailVerified:false,
  async sendEmailVerification(){window.__kpCalls.push('verify_email')},
  async getIdToken(){return 'verified-mock-token'},async reload(){this.emailVerified=window.__mockVerified}};
const observer=[];
const mockAuth={
  get currentUser(){return window.__mockCurrent},
  onAuthStateChanged(fn){observer.push(fn);return ()=>{}},
  async createUserWithEmailAndPassword(email,password){
    window.__kpCalls.push('create_firebase');
    mockUser.email=email;mockUser.emailVerified=false;
    window.__mockCurrent=mockUser;
    return {user:mockUser};
  },
  async signOut(){window.__mockCurrent=null;return true},
  async signInWithEmailAndPassword(email,password){
    window.__kpCalls.push('firebase_email_signin');
    mockUser.emailVerified=window.__mockVerified;
    window.__mockCurrent=mockUser;
    return {user:mockUser};
  },
  async signInWithCustomToken(token){
    window.__kpCalls.push('firebase_customtoken_signin');
    if(token!=='test-custom-token')throw Error('Invalid custom token');
    window.__mockCurrent=mockUser;mockUser.emailVerified=true;
    return {user:mockUser};
  },
  async getRedirectResult(){return null},
  async sendPasswordResetEmail(){return true},
  async signInWithPopup(){return {user:mockUser}}
};
window.firebase={initializeApp(){},database:()=>({ref:()=>({on(){},once:async()=>({exists:()=>false,val:()=>null})})}),
  auth:Object.assign(()=>mockAuth,{GoogleAuthProvider:function(){this.setCustomParameters=()=>{}}})};
window.fetch=async (url,opts={})=>{
 const path=String(url);const body=opts.body?JSON.parse(opts.body):{};
 if(path==='/api/account'){
   if(opts.method==='POST'&&body.action==='register'){
     window.__mockSignups.push(body);
     if(!window.__mockVerified)return {ok:false,status:403,json:async()=>({ok:false,error:'Email chưa xác minh'})};
     if(body.username==='takenuser')return {ok:false,status:409,json:async()=>({ok:false,error:'Tên đăng nhập đã được sử dụng.'})};
     window.__mockServerProfile={username:body.username,fullname:body.fullname,email:mockUser.email,role:'Thành viên',balance:0,totalDeposited:0};
     return {ok:true,status:201,json:async()=>({ok:true,profile:window.__mockServerProfile})};
   }
   if(opts.method==='POST'&&body.action==='login_username'){
     if(window.__mockServerProfile?.username!==body.username||body.password!=='password12345')return {ok:false,status:401,json:async()=>({ok:false,error:'Wrong password'})};
     return {ok:true,status:200,json:async()=>({ok:true,customToken:'test-custom-token'})};
   }
   if(!window.__mockVerified)return {ok:false,status:403,json:async()=>({ok:false,error:'Hãy xác minh email trước khi sử dụng.'})};
   if(!window.__mockServerProfile)return {ok:true,status:200,json:async()=>({ok:true,setupRequired:true,verifiedEmail:mockUser.email})};
   return {ok:true,status:200,json:async()=>({ok:true,profile:window.__mockServerProfile,users:[],orders:[],deposits:[],tickets:[]})};
 }
 if(path.startsWith('/api/'))return {ok:true,status:200,json:async()=>({ok:true,orders:[],products:[],recent:[]})};
 return {ok:true,status:200,json:async()=>({})};
};
window.__getMockUser=()=>mockUser;
'''
html=html.replace('<head>','<head><script>'+mock+'</script>',1)
with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':1100,'height':800})
  errors=[]
  page.on('pageerror',lambda err:errors.append(str(err)))
  page.set_content(html,wait_until='domcontentloaded',timeout=20000)
  # Signup a new account, chosen username must NOT be ignored. Password stays outside browser storage.
  page.evaluate("switchAuthMode('register')")
  page.locator('#reg-username').fill('NewCustomer_25')
  page.locator('#reg-fullname').fill('New Customer')
  page.locator('#reg-email').fill('newcustomer@example.test')
  page.locator('#reg-password').fill('password12345')
  page.locator('#reg-confirm-password').fill('password12345')
  page.locator('#form-register [type="submit"]').click()
  page.wait_for_function("window.__kpCalls.includes('verify_email')",timeout=5000)
  draft=page.evaluate("JSON.parse(localStorage.getItem('kp_new_username_v826'))")
  assert draft['username']=='newcustomer_25',draft
  assert draft['uid']=='customer_uid_123',draft
  assert draft['fullname']=='New Customer',draft
  assert 'password12345' not in page.evaluate('JSON.stringify(localStorage)'), 'Password persisted in browser storage'
  assert page.evaluate('window.__mockServerProfile') is None,'Profile created before verification!'
  # Email verified: login via email once, site automatically claims and binds chosen username.
  page.evaluate('window.__mockVerified=true')
  page.locator('#login-username').fill('newcustomer@example.test')
  page.locator('#login-password').fill('password12345')
  page.locator('#form-login [type="submit"]').click()
  page.wait_for_function("window.__mockServerProfile?.username==='newcustomer_25'",timeout=6000)
  page.wait_for_function("window.__kpCalls.includes('firebase_email_signin')",timeout=6000)
  assert page.evaluate("localStorage.getItem('kp_new_username_v826')") is None,'Pending draft not cleared'
  signup=page.evaluate('window.__mockSignups[0]')
  assert signup=={'action':'register','username':'newcustomer_25','fullname':'New Customer'},signup
  # Subsequent sign-in using the username (verified Firebase password only).
  page.evaluate('window.__mockCurrent=null')
  page.locator('#login-username').fill('newcustomer_25')
  page.locator('#login-password').fill('password12345')
  page.locator('#form-login [type="submit"]').click()
  page.wait_for_function("window.__kpCalls.includes('firebase_customtoken_signin')",timeout=6000)
  page.wait_for_function("typeof currentUser!=='undefined' && currentUser?.username==='newcustomer_25'",timeout=6000)
  assert not errors,errors
  print('PASS UI: register username saved for verified UID; no password storage; auto-bind on email login; username login via custom Firebase token')
  browser.close()
