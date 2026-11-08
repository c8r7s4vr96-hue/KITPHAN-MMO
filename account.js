'use strict';
const {checkOrigin,error,identity,verifiedIdentity,createAccount,queueMigration,dashboardData,clean,now}=require('../lib/secure-accounts');
const {jsonError}=require('../lib/shop-common');
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false});
  try{
    if(req.method==='GET'){
      const ctx=await identity(req,{allowUnmapped:true});
      if(!ctx.username){
        const pending=(await ctx.db.ref('account_migration_requests/'+ctx.uid).once('value')).val();
        return res.status(200).json({ok:true,setupRequired:true,verifiedEmail:ctx.email,pending:pending?.status==='pending'});
      }
      return res.status(200).json(await dashboardData(ctx));
    }
    checkOrigin(req);
    const action=String(req.body?.action||'');
    if(action==='register'){
      const ctx=await verifiedIdentity(req);
      const p=await createAccount(ctx,String(req.body?.username||'').trim().toLowerCase(),String(req.body?.fullname||''));
      return res.status(201).json({ok:true,profile:p});
    }
    if(action==='request_migration'){
      const ctx=await verifiedIdentity(req);
      const r=await queueMigration(ctx,String(req.body?.username||'').trim().toLowerCase());
      return res.status(202).json({ok:true,...r});
    }
    const ctx=await identity(req);
    if(action==='profile'){
      const name=clean(req.body?.fullname,90);
      if(name.length<2)throw error('Tên hiển thị phải có từ 2 ký tự.',422);
      await ctx.db.ref('users/'+ctx.username).update({fullname:name});
      return res.status(200).json({ok:true});
    }
    if(action==='ticket'){
      const subject=clean(req.body?.subject,130);const message=clean(req.body?.message,1500);
      if(subject.length<3||message.length<5)throw error('Chủ đề hoặc nội dung quá ngắn.',422);
      const id='TCK-'+ctx.db.ref('tickets').push().key;
      await ctx.db.ref('tickets/'+id).set({id,user:ctx.username,subject,message,status:'Chờ phản hồi',date:new Date().toISOString().slice(0,16)});
      return res.status(201).json({ok:true,id});
    }
    throw error('Thao tác không hỗ trợ.',400);
  }catch(e){return jsonError(res,e)}
};
