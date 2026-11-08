'use strict';
/** Admin adjustments and owner wallet overview. No legacy balance migration. */
const {identity,checkOrigin}=require('./secure-accounts');
const {jsonError}=require('./shop-common');
const commerce=require('./wallet-commerce');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false});
 try{
  if(req.method==='POST')checkOrigin(req);
  const admin=req.method==='POST'||String(req.query?.mode||'')==='admin_lookup';
  const ctx=await identity(req,{adminOnly:admin});
  if(req.method==='POST'){
    if(process.env.ADMIN_WALLET_ADJUSTMENTS_ENABLED!=='true')
      throw commerce.fail('Chưa bật điều chỉnh ví trên Production.',423);
    const {username,kind,amountVnd,reason,requestId}=req.body||{};
    if(typeof username!=='string'||!(/^[a-z0-9_-]{3,60}$/).test(username))throw commerce.fail('Username không hợp lệ.');
    const user=(await ctx.db.ref('users/'+username).once('value')).val();
    const uid=username===ctx.username?ctx.uid:user?.authUid;
    if(!uid)throw commerce.fail('Khách phải liên kết tài khoản Google/Firebase UID trước khi điều chỉnh ví.',409);
    if(username!==ctx.username){
      const binding=(await ctx.db.ref('auth_bindings/'+uid).once('value')).val();
      if((typeof binding==='string'?binding:binding?.username)!==username)
        throw commerce.fail('UID và username chưa được liên kết hai chiều. Yêu cầu kiểm tra tài khoản trước.',409);
    }
    // Special admin mapping must not be ambiguous.
    if(username===ctx.username && user?.authUid && user.authUid!==ctx.uid)
      throw commerce.fail('Liên kết UID Admin không trùng.',409);
    const state=await commerce.transact(ctx.db,v=>commerce.adjustState(v,{
      uid,username,adminUid:ctx.uid,requestId,kind,amountVnd,reason}));
    return res.status(200).json({ok:true,wallet:state.accounts[uid],entry:state.adminAdjustments[requestId]});
  }
  const requested=String(req.query?.username||'').trim().toLowerCase();
  let uid=ctx.uid,username=ctx.username;
  if(admin && requested){
    if(!/^[a-z0-9_-]{3,60}$/.test(requested))throw commerce.fail('Username không hợp lệ.');
    username=requested;
    const record=(await ctx.db.ref('users/'+username).once('value')).val();
    if(!record)throw commerce.fail('Không tìm thấy khách.',404);
    uid=username===ctx.username?ctx.uid:record.authUid;
    if(!uid)throw commerce.fail('Khách chưa liên kết Firebase UID.',409);
    if(username!==ctx.username){
      const binding=(await ctx.db.ref('auth_bindings/'+uid).once('value')).val();
      if((typeof binding==='string'?binding:binding?.username)!==username)
        throw commerce.fail('UID và username chưa liên kết hai chiều.',409);
    }
  }
  const snap=await ctx.db.ref(commerce.ROOT+'/accounts/'+uid).once('value');
  const account=snap.val();
  if(account && (account.uid!==uid||account.username!==username))throw commerce.fail('Ví không khớp chủ sở hữu.',409);
  const [jSnap,dSnap]=await Promise.all([ctx.db.ref(commerce.ROOT+'/moneyJournal').orderByChild('uid').equalTo(uid).limitToLast(40).once('value'),ctx.db.ref(commerce.ROOT+'/ledger').orderByChild('uid').equalTo(uid).limitToLast(40).once('value')]);
  const journal=[...Object.values(jSnap.val()||{}),...Object.values(dSnap.val()||{}).map(d=>({...d,kind:'deposit',id:'sepay_'+d.transactionId}))].sort((a,b)=>b.createdAt-a.createdAt).slice(0,40);
  return res.status(200).json({ok:true,username,uid:admin?uid:undefined,
    wallet:{availableVnd:account?.availableVnd||0,heldVnd:account?.heldVnd||0,totalDepositedVnd:account?.totalDepositedVnd||0},
    journal,legacyFundsImported:false,source:'live_deposits_v1'});
 }catch(e){return jsonError(res,e)}
};
