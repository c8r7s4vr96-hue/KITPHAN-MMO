# KITPHAN MMO V8.2.8 — Đối soát khoản nạp 35.000đ ngoài ranh giới thời gian

## Nguyên nhân có bằng chứng
- SePay transaction `102074459`, 35.000 VND, ngân hàng 01:30:00 ngày 24/11/2026 (giờ VN).
- Intent `KPN8E7965CA72C63B1D47F3A994`, tạo 01:30:01, kết thúc 01:50:01 cùng ngày.
- API đã ghi sự kiện `outside_window`, `credited:false`. Thời gian bank sớm hơn tạo intent 1 giây.

## Vá mã
- Chấp nhận bank time sớm tối đa 60 giây so với `createdAt`, vẫn yêu cầu thời gian <= `expiresAt`.
- Khi event `outside_window` đã có từ bản cũ, cho phép recheck một lần nếu ID, fingerprint SePay, account MB, amount, code, UID, intent pending và không có ledger cho ID đó đều hợp lệ. Không mở lại các sự kiện khác.
- Giao dịch ví, intent, event và ledger ghi cùng một transaction Firebase tại gốc `live_deposits_v1`.
- Giữ nguyên Admin-only action `POST /api/wallet?action=live_deposit_reconcile`, yêu cầu Firebase Google Admin và origin hợp lệ. Không có endpoint công khai mới.
- Bổ sung nút đối soát cho Admin ở `admin-finance.html`.

## Triển khai một lần
1. Sao lưu repository GitHub hiện tại và Firebase RTDB trước khi thay đổi.
2. Tải nội dung ZIP V8.2.8 vào root repository, giữ cấu trúc `api/` + `lib/` + `index.html` + `vercel.json`. GitHub phải chứa các file mới `lib/deposit-live.js`, `admin-finance.html`, `package.json`.
3. Commit, xác nhận Vercel Production Ready.
4. Mở `/admin-finance.html`, đăng nhập Google Admin chính, nhập `adminkit` rồi bấm Xem số dư.
5. Tại **Đối soát giao dịch SePay bị lệch thời gian** nhập số `102074459`, kiểm chứng chứng từ và tích xác nhận, bấm Đối soát đúng **một lần**.
6. Kiểm tra phản hồi `credited: true` hoặc trạng thái `credited` và đối chiếu ví tăng đúng 35.000đ, `totalDepositedVnd` tăng 35.000đ, `ledger/sepay_102074459` tồn tại, `events/sepay_102074459` thành credited, intent thành paid. Nếu ví đã cộng trước, phép gọi lặp không cộng thêm.

**Không dùng nút Cộng tiền Admin để xử lý cùng giao dịch, không thay đổi Firebase bằng tay, không gửi lại webhook.** Nếu backend báo chưa cộng, hãy dừng, đối chiếu event, intent và ledger trước.

## Giới hạn
- Kiểm thử offline/mô phỏng không phải xác nhận số dư Production. Không truy cập tài khoản SePay/Firebase của chủ website, không tự cộng tiền. Mọi biến môi trường Production được giữ nguyên.
- Giới hạn webhook/transaction cũ ngoài 60 giây vẫn giữ `outside_window` và cần xử lý riêng.
