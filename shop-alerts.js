'use strict';
const safe=s=>String(s??'').replace(/[\u0000-\u001f<>]/g,' ').slice(0,160);
async function alertShop(event,order){
  const token=process.env.TELEGRAM_BOT_TOKEN, chat=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chat)return false;
  const labels={delivered:'✅ ĐÃ GIAO HÀNG',awaiting_delivery:'⏳ ĐƠN CHỜ GIAO HÀNG',needs_review:'⚠️ CẦN KIỂM TRA ĐƠN',refunded:'↩️ ĐÃ HOÀN TIỀN',failed:'❌ ĐẶT HÀNG THẤT BẠI'};
  const text=[labels[event]||'🛍️ ĐƠN HÀNG', 'Mã: '+safe(order.id),'Khách: '+safe(order.username),'Sản phẩm: '+safe(order.name),'Giá: '+(Number(order.price)||0).toLocaleString('vi-VN')+' đ',order.recipientEmail?'Email nhận: '+safe(order.recipientEmail):'', 'Trạng thái: '+safe(event),'Không gửi tài khoản/mật khẩu giao hàng qua bot.'].filter(Boolean).join('\n');
  try{
    const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text}),signal:AbortSignal.timeout(6500)});
    return response.ok;
  }catch(e){console.warn('[shop alert]',safe(e.message));return false;}
}
module.exports={alertShop};
