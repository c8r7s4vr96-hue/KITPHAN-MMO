# KIT PHAN MMO Premium V5.3 — SAFE PREPARATION / CHƯA MỞ NẠP LIVE

**Trạng thái: mã nguồn đã cập nhật, nhưng đây CHƯA PHẢI hệ thống nạp tiền thật tự động.**

## Những gì đã được thực hiện

- Xóa **số tài khoản MB Bank hardcoded** và **VietQR cố định** trong tab `Nạp tiền` ở `index.html` để không hướng dẫn khách chuyển thật tới quy trình chưa cộng tiền.
- Giao diện khách hiển thị rõ **Nạp tiền đang tạm khóa**, không phát QR và không hiện nội dung chuyển khoản. Tab lịch sử cũ vẫn giữ nguyên.
- Thêm `/api/sepay-live-webhook` (tệp `api/sepay-live-webhook.js`) để ghi nhận **giao dịch LIVE chờ đối soát** với secret HMAC riêng, tài khoản MB Bank cấu hình qua Vercel, kiểm tra ký tự/timestamp/ngân hàng/số tiền/giao dịch vào, lưu chống trùng và hash của raw body.
- Webhook LIVE lưu `wallet_live_payment_events/sepay_<id>` và **luôn đặt `credited:false`, `spendable:false`, `status:'pending_manual_reconciliation'`**. KHÔNG cộng tiền vào `wallet_accounts`, `wallet_ledger`, `users.balance`; không gọi CanBoSo.
- API Admin `GET /api/wallet?action=deposit_readiness`: xem trạng thái an toàn; không tiết lộ thông tin ngân hàng/secret.
- API Admin `POST /api/wallet?action=deposit_draft`: chỉ admin Firebase UID `MAIN_ADMIN_GOOGLE_UID`, username `adminkit` tạo **mã bản nháp KHÔNG THANH TOÁN**. Chỉ ghi `wallet_live_drafts` và `wallet_live_draft_codes`; không hiện số tài khoản/QR.
- `admin-wallet.html`: thêm mục Premium V5.3 để kiểm tra và tạo mã bản nháp.
- `sepay_receiver.php`: **vô hiệu hóa vĩnh viễn** endpoint PHP cũ vốn có thể cộng vào `users.balance`. Nếu đang có PHP hosting riêng, phải ngừng webhook PHP tại bên thứ ba; đẩy bản vá GitHub/Vercel không tự cập nhật hosting ngoài.
- Giữ nguyên chức năng Test V5.2.3, nhưng `WALLET_SANDBOX_ENABLED=false` khi đã thử xong.

## Trước khi đưa lên GitHub

1. Sao lưu repository và dữ liệu Firebase; lưu ZIP cũ ở máy riêng.
2. Giải nén **bản đầy đủ** và thay toàn bộ file trong repository (hoặc chỉ giải nén **gói patch**, rồi chép đúng thư mục); không tải ZIP như một file vào thư mục gốc của website.
3. Commit/push lên GitHub `main`, Vercel → Deployments → Production Ready.
4. Mở website → **Nạp tiền**: phải hiện `Đang tạm khóa`, KHÔNG xuất hiện số tài khoản/QR.
5. Vào `admin-wallet.html` bằng Google Admin → nhập `adminkit` → **Xem báo cáo**. Xác nhận mục Premium V5.3 xuất hiện, `liveDepositsOpen:false`, `automaticLiveCreditsEnabled:false`, ví thật `LOCKED 0đ`.
6. Tài khoản khách thường phải bị từ chối với `403` nếu gọi `deposit_readiness` hoặc `deposit_draft`.
7. Kiểm tra Firebase: `wallet_accounts/<UID>/availableVnd=0`, `status='locked'`; không có thay đổi ở `users.balance`.

## Biến Vercel cho giai đoạn hiện tại

```text
WALLET_SANDBOX_ENABLED=false
ACCOUNT_WALLET_RECONCILED=false
ACCOUNT_ADMIN_WALLET_ENABLED=false
SHOP_PURCHASES_ENABLED=false
SHOP_WALLET_RULES_SECURED=false
SHOP_SUPPLIER_PURCHASE_CONFIRMED=false
SEPAY_LIVE_RECORDING_ENABLED=false
```

Nếu chưa có `SEPAY_LIVE_RECORDING_ENABLED`, hãy tạo với `false` (Production). Deployment mới sẽ áp dụng.

**KHÔNG bắt buộc nhập thông tin tài khoản MB Bank/secret LIVE để triển khai bản an toàn này.** Khi sẵn sàng kiểm thử việc **ghi nhận** tiền thật trong quy trình đối soát độc lập, mới cung cấp trên Vercel (không commit Github):

```text
MB_BANK_ACCOUNT_NUMBER=<số tài khoản MB Bank thật đã xác minh, giữ đủ số 0 đầu>
SEPAY_LIVE_WEBHOOK_SECRET=<secret HMAC riêng của SePay LIVE, tối thiểu 16 ký tự>
```

Secret Test `SEPAY_WEBHOOK_SECRET` phải **khác** secret Live. Endpoint Test cũ `/api/sepay-webhook` tiếp tục tách riêng. **Chưa đăng ký webhook của tài khoản thật đến endpoint Live và chưa chuyển khoản thật** trong giai đoạn này. Nếu sau này kích hoạt ghi nhận, chỉ dùng `POST https://kitphanmmo.vercel.app/api/sepay-live-webhook` khi đã có cơ chế kiểm tra ngân hàng độc lập, quy trình xử lý giao dịch bị treo/sai mã, nhật ký cảnh báo và giám sát; `SEPAY_LIVE_RECORDING_ENABLED=true` chỉ bật tính năng GHI NHẬN, không bao giờ cộng tiền.

## Kiểm thử cục bộ

- Node.js >=20.
- `npm test` — kiểm thử backend cũ + 36 assertions V5.3 (Firebase và SePay in-memory giả lập).
- `python tests/test-syntax.py` — kiểm tra cú pháp JS; cần các phụ thuộc Python đang có sẵn.
- `python tests/test-ui.py` — trình duyệt headless kiểm tra UI, **không phát VietQR**; cần Playwright/Chromium.
- Không có giao dịch ngân hàng LIVE thực tế nào được gửi bởi các kiểm thử.

## Lộ trình V5.3 Live thực sự — CHƯA HOÀN THÀNH

Để mở nạp thật và tự cộng số dư cho khách, trước tiên cần triển khai tiếp:

1. Xác thực sở hữu từng ví khách bằng Firebase Auth và tạo ví mới `wallet_accounts/<UID>` với số dư mở đầu 0đ độc lập dữ liệu cũ.
2. Mã nạp LIVE duy nhất cho từng yêu cầu; QR VietQR xây từ số tài khoản do người dùng xác minh trên server (không hardcode); chỉ hiện khi hệ thống LIVE đã được mở chính thức.
3. Kiểm tra giao dịch LIVE bằng SePay **và đối chiếu nguồn ngân hàng đáng tin cậy**, xử lý nạp thiếu/sai nội dung, sai số tiền, giao dịch bị đảo ngược.
4. Cộng tiền và ghi ledger **nguyên tử + chống trùng** theo transaction ID toàn cục, khả năng sửa trạng thái khi gián đoạn, cảnh báo và đối soát định kỳ.
5. Kiểm thử cạnh tranh, hồi quy, thanh toán/hoàn tiền và phân quyền; duyệt go-live trước khi đổi bất kỳ cờ an toàn nào.

**Tuyệt đối không tự đổi `ACCOUNT_WALLET_RECONCILED` hoặc `SHOP_PURCHASES_ENABLED` thành `true` để thử nghiệm.** V5.3 Safe Preparation không thể cộng tiền LIVE ngay cả khi đổi biến môi trường.

## Tài liệu kỹ thuật đối chiếu

- SePay xác thực HMAC: https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc
- SePay bảo mật webhook: https://developer.sepay.vn/vi/sepay-webhooks/bao-mat
- SePay VietQR: https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code
