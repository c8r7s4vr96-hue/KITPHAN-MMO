'use strict';
const assert=require('node:assert/strict');
const {loginWithUsername,normalizeHost}=require('../lib/username-login');
const ADMIN='MainGoogleUID_12345',CUSTOMER='FirebaseCustUID_7777',OTHER='UnboundFirebaseUID99';
const TOKEN='turnstile_verified_token_abcdefghijklmnopqrstuvwxyz';
const HOST='kitphanmmo.vercel.app';
const nodes={
  'users/alice':{username:'alice',authUid:CUSTOMER,email:'alice@example.test',balance:50000},
  ['auth_bindings/'+CUSTOMER]:{username:'alice'},
  'users/bob':{username:'bob',authUid:OTHER,email:'bob@example.test',balance:99000},
  ['auth_bindings/'+OTHER]:{username:'someone_else'},
  'users/old_user':{username:'old_user',password:'legacy-password',balance:120000}
};
const db={ref:path=>({once:async()=>({val:()=>nodes[path]||null})})};
const users={
  [ADMIN]:{uid:ADMIN,email:'main@example.test',emailVerified:true,disabled:false},
  [CUSTOMER]:{uid:CUSTOMER,email:'alice@example.test',emailVerified:true,disabled:false},
  [OTHER]:{uid:OTHER,email:'bob@example.test',emailVerified:true,disabled:false}
};
let currentUid=CUSTOMER,wrongPassword=false,hostname=HOST,turnstileOk=true,signInCalls=0;
const sdk={auth:()=>({
  getUser:async uid=>{if(!users[uid])throw Error('not found');return users[uid];},
  verifyIdToken:async()=>({uid:currentUid,firebase:{sign_in_provider:'password'}}),
  createCustomToken:async uid=>'custom_token_for_'+uid
})};
const fetchFn=async(url,opt)=>{
  if(url.includes('siteverify')){
    const fields=new URLSearchParams(opt.body);
    assert.equal(fields.get('secret'),'server-secret');
    assert.equal(fields.get('response'),TOKEN);
    return {ok:true,json:async()=>({success:turnstileOk,hostname})};
  }
  if(url.includes('signInWithPassword')){
    signInCalls++;
    const {email,password}=JSON.parse(opt.body);
    assert.ok(!opt.body.includes('username'));
    if(wrongPassword||password!=='firebase-only-password')return {ok:false,status:400,json:async()=>({error:{message:'INVALID_LOGIN_CREDENTIALS'}})};
    const uid=Object.keys(users).find(key=>users[key].email===email);
    return {ok:true,status:200,json:async()=>({localId:uid,idToken:'firebase_verified_id_token'})};
  }
  throw Error('unexpected URL');
};
const args={password:'firebase-only-password',turnstileToken:TOKEN,hostname:HOST,turnstileSecret:'server-secret',webApiKey:'PublicFirebaseKey123456789',fetchFn,sdk,db,adminUid:ADMIN,adminUsername:'adminkit'};
(async()=>{
  assert.equal(normalizeHost('KitPhanMMO.vercel.app:443'),HOST);
  let r=await loginWithUsername({...args,username:'ALICE'});
  assert.equal(r.customToken,'custom_token_for_'+CUSTOMER);
  currentUid=ADMIN;
  r=await loginWithUsername({...args,username:'adminkit'});
  assert.equal(r.customToken,'custom_token_for_'+ADMIN);
  currentUid=CUSTOMER;
  const reject=async(p,pattern)=>assert.rejects(()=>loginWithUsername({...args,...p}),pattern);
  await reject({username:'old_user'},/chưa liên kết/);
  await reject({username:'bob'},/chưa liên kết/);
  await reject({username:'nobody'},/chưa liên kết/);
  const before=signInCalls;
  await reject({username:'../admin'},/không đúng/);
  assert.equal(signInCalls,before,'Invalid username must not call password API');
  wrongPassword=true;
  await reject({username:'alice'},/không đúng/);
  wrongPassword=false;
  currentUid=ADMIN;
  await reject({username:'alice'},/không đúng/); // Firebase signed UID mismatch
  currentUid=CUSTOMER;
  const oldUser=users[CUSTOMER].emailVerified;users[CUSTOMER].emailVerified=false;
  await reject({username:'alice'},/không đúng/);
  users[CUSTOMER].emailVerified=oldUser;
  turnstileOk=false;
  await reject({username:'alice'},/Cloudflare/);
  turnstileOk=true;
  hostname='forged.example.test';
  await reject({username:'alice'},/Cloudflare/);
  hostname=HOST;
  await reject({username:'alice',turnstileToken:''},/Cloudflare/);
  await reject({username:'alice',turnstileSecret:''},/TURNSTILE_SECRET_KEY/);
  console.log('PASS username login: Firebase-only password, admin UID, bindings, Turnstile, host, bad password, mismatched UID, missing secrets');
})().catch(e=>{console.error(e);process.exitCode=1});
