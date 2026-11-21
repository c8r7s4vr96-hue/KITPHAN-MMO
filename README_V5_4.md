# KIT PHAN MMO Premium V5.4 — CUSTOMER-SCOPED DEPOSIT PREVIEWS / CHƯA MỞ NẠP LIVE

**Đây là bản nâng cấp mã nguồn V5.3 để chuẩn bị luồng nạp tiền theo từng tài khoản khách. Chưa phải cổng thanh toán thật.**

## Đã thực hiện

1. **Khách đã đăng nhập/xác minh Firebase Auth** có thể vào tab `Nạp tiền` tạo **bản nháp đối soát không thanh toán** với số tiền 10.000–10.000.000đ (bước 1.000đ). Không trả về số tài khoản ngân hàng, VietQR hay nội dung chuyển khoản. Khách chỉ đọc được các bản nháp thuộc Firebase UID của mình; không có trường UID/username trong body do khách cung cấp.
2. **Mỗi UID chỉ có một bản nháp còn hiệu lực** (30 phút). Yêu cầu lặp cùng số tiền trả về cùng bản nháp; yêu cầu khác số tiền trước khi hết hạn bị từ chối. Tối đa 12 bản nháp mới mỗi ngày cho một UID. Mã `KP54P...` được sinh ngẫu nhiên và giữ trong index riêng.
3. **Admin chính** xem danh sách gần nhất 15 bản nháp (`/api/wallet?action=deposit_preview_queue`). Khách thường bị từ chối 403.
4. **Webhook LIVE V5.3** có thêm bước đọc và phân loại mã bản nháp `KP54P...` *nếu webhook LIVE được cấu hình ghi nhận sau này*, nhưng chỉ lưu trong `wallet_live_payment_events`; không cộng tiền, không duyệt yêu cầu, không sửa số dư. Vẫn yêu cầu HMAC và đối chiếu số tài khoản như V5.3.
5. Có helper tạo URL VietQR trong `lib/wallet-live-previews.js` để phục vụ **phiên bản thương mại đã được kiểm thử trong tương lai**, nhưng helper **không được gọi từ bất kỳ API hay trang web V5.4 nào**. Khách luôn nhìn thấy cảnh báo `VietQR đang tắt`.
6. Giữ nguyên các biện pháp bảo vệ V5.2.3/V5.3, `sepay_receiver.php` đã vô hiệu hóa, không tạo thêm Vercel Function (vẫn 12 file JS trong `api/`).

## Cập nhật GitHub (chọn 1 trong 2 ZIP, không cần cả hai)

**Khuyên dùng:** `KITPHAN_MMO_V5_4_Only_Changed_Files.zip`. Giải nén, đặt các tệp bên trong đúng đường dẫn trên GitHub; **thay các file trùng tên, thêm file mới, không xóa file khác**. Chú ý tệp `lib/wallet-live-previews.js` là tệp mới và API phụ thuộc tệp này.

Hoặc dùng `KITPHAN_MMO_Premium_V5_4_SAFE_Full.zip` để lấy toàn bộ mã nguồn phiên bản V5.4 (phù hợp khi có bản sao lưu và muốn cập nhật đồng bộ).

Sau khi Commit lên `main`, kiểm tra Vercel > Deployments > **Production / Ready**. Nếu có cấu hình Vercel mới thì cần redeploy để áp dụng, nhưng **V5.4 không yêu cầu thêm biến Vercel mới**.

## Kiểm tra sau cập nhật

1. Mở trang web → Nạp tiền. Vẫn hiện **Đang tạm khóa**; **không** có số tài khoản MB Bank hay VietQR.
2. Đăng nhập **một tài khoản khách có Firebase Auth đã xác minh**, điền `10000`, tích ô `Không chuyển khoản thật`, nhấn **Tạo bản nháp (KHÔNG THANH TOÁN)**. Kết quả phải có mã `KP54P...` và thông báo **không thanh toán**.
3. Nhấn Xem trạng thái: chỉ thấy bản nháp của chính tài khoản đó. Không chuyển tiền theo mã này!
4. Đăng nhập tài khoản khách khác, xác nhận không thấy mã của tài khoản đầu. Nếu gọi `deposit_preview_queue` bằng khách thường phải bị 403.
5. Đăng nhập Admin tại `admin-wallet.html` → `Xem báo cáo` → `Xem bản nháp khách V5.4 (Admin)` để thấy danh sách. Ví thật vẫn `LOCKED · 0đ`.
6. Kiểm tra `wallet_accounts`, `wallet_ledger`, `users.balance` không đổi khi tạo bản nháp.

## Các nhánh Firebase mới

- `wallet_live_preview_active/<Firebase UID>` — bản nháp hiện tại
- `wallet_live_previews/<Firebase UID>/<timestamp>_<requestId>` — lịch sử bản nháp
- `wallet_live_preview_codes/<referenceCode>` — index đối soát
- `wallet_live_preview_admin_queue/<timestamp>_<requestId>` — danh sách cho Admin
- `wallet_live_preview_daily/<Firebase UID>/<YYYYMMDD>` — giới hạn số bản nháp

**Không cần mở `.read` hay `.write` RTDB cho client**. API dùng Firebase Admin SDK sau khi xác minh token Firebase.

## Biến Vercel phải giữ an toàn

```env
WALLET_SANDBOX_ENABLED=false
SEPAY_LIVE_RECORDING_ENABLED=false
ACCOUNT_WALLET_RECONCILED=false
ACCOUNT_ADMIN_WALLET_ENABLED=false
SHOP_PURCHASES_ENABLED=false
SHOP_WALLET_RULES_SECURED=false
SHOP_SUPPLIER_PURCHASE_CONFIRMED=false
```

Không đặt `SEPAY_LIVE_RECORDING_ENABLED=true` chỉ để thử tính năng bản nháp. V5.4 không có cờ mở nạp tiền thật, không trả QR; không được chuyển khoản thử bằng ngân hàng thật.

**V5.4 chưa làm:** đối soát sao kê ngân hàng độc lập, sổ cái ví khách live, atomic real-money credit, xử lý giao dịch thiếu/sai mã/số tiền, đảo ngược giao dịch, chính sách hoàn tiền, giám sát và kiểm toán vận hành. Những phần đó cần thiết trước khi chuyển sang cổng nạp tiền Live có thể chi tiêu.

## Kiểm thử cục bộ

```bash
npm test
python tests/test-syntax.py
python tests/test-ui.py
```

Có kiểm thử V5.3 cũ và kiểm thử V5.4 mới (dữ liệu Firebase/SePay giả lập in-memory). Các bài kiểm thử **không gửi giao dịch ngân hàng thật**. UI test dùng Chromium giả lập.

Tài liệu kỹ thuật SePay:
- HMAC webhook: https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc
- Bảo mật webhook: https://developer.sepay.vn/vi/sepay-webhooks/bao-mat
- URL VietQR: https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code
