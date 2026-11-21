"""Offline browser smoke test for the actual V8 HTML login controls (no network)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
src=(Path(__file__).resolve().parents[1]/'index.html').read_text()
src=re.sub(r'<script\s+[^>]*src=["\'][^"\']+["\'][^>]*>\s*</script>','',src,flags=re.I)
src=re.sub(r'<link\s+[^>]*href=["\']https?://[^>]+>','',src,flags=re.I)
stub='''
window.tailwind={config:{}};window.emailjs={init(){}};
window.__usernameLoginPosts=[];window.__firebaseLoginCalls=[];
window.firebase={initializeApp(){},database:()=>({ref:()=>({once:()=>Promise.resolve({val:()=>({})}),on(){},set:async()=>{},update:async()=>{}})}),
 auth:Object.assign(()=>({
    currentUser:null,
    signInWithCustomToken:async function(token){window.__firebaseLoginCalls.push('custom:'+token);this.currentUser={uid:'FirebaseCustUID_7777',emailVerified:true,email:'alice@example.test',getIdToken:async()=> 'firebase-id-token'};},
    signInWithEmailAndPassword:async function(email,pw){window.__firebaseLoginCalls.push('email:'+email);this.currentUser={uid:'FirebaseCustUID_7777',emailVerified:true,email,getIdToken:async()=> 'firebase-id-token'};},
    getRedirectResult:async()=>null,signOut:async()=>{},onAuthStateChanged:()=>()=>{}
 }),{GoogleAuthProvider:function(){this.setCustomParameters=()=>{}},EmailAuthProvider:{credential:(email,pw)=>({email,pw})}})};
window.turnstile={reset:()=>{}};
window.fetch=async (url,opt={})=>{
 if(String(url).includes('/api/username-login')){
   window.__usernameLoginPosts.push(JSON.parse(opt.body));
   return {ok:true,status:200,json:async()=>({ok:true,customToken:'firebase_custom_token'})};
 }
 return {ok:true,status:200,json:async()=>({ok:true})};
};
'''
src=src.replace('<head>','<head><script>'+stub+'</script>',1)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page();page.set_content(src,wait_until='domcontentloaded',timeout=30000)
 assert 'Tên tài khoản hoặc Email' in page.locator('label').all_inner_texts().__str__()
 assert page.locator('#profile-password-form').count()==1
 # Force no backend or real Firebase for the browser-only login check.
 page.evaluate('''() => {
   window.kpSecureLoadAccount=async()=>{};
   window.kpSecureHeaders=async()=>({'Content-Type':'application/json'});
   const input=document.createElement('input');input.name='cf-turnstile-response';input.value='valid-test-cloudflare-token';
   document.getElementById('form-login').appendChild(input);
   document.getElementById('login-username').value='adminkit';
   document.getElementById('login-password').value='firebase-password';
 }''')
 page.evaluate('''async()=>handleLogin({preventDefault(){},currentTarget:document.getElementById('form-login')})''')
 posts=page.evaluate('window.__usernameLoginPosts');calls=page.evaluate('window.__firebaseLoginCalls')
 assert len(posts)==1 and posts[0]['username']=='adminkit' and posts[0]['password']=='firebase-password',posts
 assert calls==['custom:firebase_custom_token'],calls
 page.evaluate('''()=>{document.getElementById('login-username').value='user@example.test'}''')
 page.evaluate('''async()=>handleLogin({preventDefault(){},currentTarget:document.getElementById('form-login')})''')
 calls=page.evaluate('window.__firebaseLoginCalls')
 assert calls[-1]=='email:user@example.test',calls
 assert len(page.evaluate('window.__usernameLoginPosts'))==1
 print('PASS UI: username -> backend + custom Firebase token, email -> existing Firebase SDK, profile link form present')
 browser.close()
