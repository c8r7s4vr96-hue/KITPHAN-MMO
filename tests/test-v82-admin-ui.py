"""Offline UI smoke test for managed checkout, no provider or Firebase network."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

html=(Path(__file__).parents[1]/'admin-checkout.html').read_text(encoding='utf-8')
html=re.sub(r'<script\s+[^>]*src="[^"]+"[^>]*></script>','',html,flags=re.I)
mock='''
window.__calls=[];window.__mode='legacy';window.__pilotId='ord_111111111111111111111111111111111111';
window.confirm=()=>true;
const signed={email:'admin@demo.invalid',getIdToken:async()=> 'mock-token'};
const fakeAuth={onAuthStateChanged(fn){fn(signed)},signOut:async()=>{},signInWithPopup:async()=>signed};
window.firebase={apps:[],initializeApp(){this.apps.push({})},auth:Object.assign(()=>fakeAuth,{GoogleAuthProvider:function(){}})};
window.fetch=async(path,opts)=>{
 let body={};if(opts.method==='POST')body=JSON.parse(opts.body);
 window.__calls.push({method:opts.method,body});
 if(opts.method==='POST'){
  if(body.action==='pilot')window.__mode='pilot';
  if(body.action==='public')window.__mode='public';
  if(body.action==='pause')window.__mode='paused';
  return {ok:true,status:200,json:async()=>({ok:true,mode:window.__mode})};
 }
 return {ok:true,status:200,json:async()=>({ok:true,config:{mode:window.__mode},apiKeyConfigured:true,adminUidConfigured:true,
  candidates:window.__mode==='pilot'?[{id:window.__pilotId,name:'Demo account',price:30000,at:Date.now()}]:[]})};
};
'''
html=html.replace('<head>','<head><script>'+mock+'</script>',1)
with sync_playwright() as play:
    browser=play.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page()
    page.set_content(html,wait_until='domcontentloaded',timeout=12000)
    page.wait_for_function("document.querySelector('#admin-console')?.hidden === false", timeout=6000)
    assert 'Chế độ V8 cũ' in page.locator('#mode').inner_text()
    page.locator('#ck-wallet').check();page.locator('#ck-provider').check()
    page.locator('#pilot').click()
    page.wait_for_function("document.querySelector('#mode').textContent.includes('thử mua')",timeout=6000)
    page.locator('#candidate-list button').click()
    assert page.locator('#order-id').input_value().startswith('ord_')
    page.locator('#ck-order').check();page.locator('#ck-journal').check();page.locator('#ck-support').check()
    page.locator('#confirm-text').fill('MO BAN')
    page.locator('#public').click()
    page.wait_for_function("document.querySelector('#mode').textContent.includes('TẤT CẢ KHÁCH')",timeout=6000)
    page.locator('#pause').click()
    page.wait_for_function("document.querySelector('#mode').textContent.includes('tạm dừng')",timeout=6000)
    calls=page.evaluate('window.__calls')
    assert [c['body']['action'] for c in calls if c['method']=='POST']==['pilot','public','pause']
    print('PASS V8.2 Admin UI: pilot, choose delivered order, public, pause (offline)')
    browser.close()
