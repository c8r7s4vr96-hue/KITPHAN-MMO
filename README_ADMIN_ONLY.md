# KIT PHAN MMO V5.2.3 — Chỉ Admin được dùng Sandbox

Bản vá nhỏ dành cho hệ thống V5.2.3 đã cài đặt. **Không phải gói mã nguồn đầy đủ.**

## Chỉ thay hai file API

| Đường dẫn GitHub | Thao tác |
|---|---|
| `api/wallet.js` | Thay file cùng tên |
| `api/sepay-webhook.js` | Thay file cùng tên |
| `tests/test-wallet-sandbox-integration.js` | Thay file test nếu có (không bắt buộc để chạy Production) |

Giữ nguyên `admin-wallet.html`, `lib/wallet-sandbox.js`, `index.html`, `admin-shop.html`, các API SePay/CanBoSo khác và `package.json` hiện tại. Đây là bản vá cho V5.2.3, không dùng với phiên bản cũ hơn thiếu `lib/wallet-sandbox.js`.

## Kiểm tra cấu hình Vercel

- `MAIN_ADMIN_GOOGLE_UID` = chính xác Firebase Authentication UID của Google Admin (giá trị đã thiết lập, **không gửi công khai**).
- `MAIN_ADMIN_USERNAME=adminkit`.
- `WALLET_SANDBOX_ENABLED=true` chỉ ở môi trường đang chạy SePay Test mode. Khi không test, đặt `false` rồi deploy lại.
- `SEPAY_SANDBOX_ACCOUNT_NUMBER` và `SEPAY_RECEIVING_ACCOUNT_NUMBER` phải là cùng số tài khoản thử nghiệm, không dùng số tài khoản tiền thật.
- `SEPAY_WEBHOOK_SECRET` phải là Secret HMAC của SePay TEST, không gửi vào GitHub.
- Các biến `SHOP_PURCHASES_ENABLED`, `ACCOUNT_WALLET_RECONCILED`, `ACCOUNT_ADMIN_WALLET_ENABLED`, `SHOP_WALLET_RULES_SECURED`, `SHOP_SUPPLIER_PURCHASE_CONFIRMED` tiếp tục `false`.
- Rules Firebase vẫn `.read: false`, `.write: false`.

## Bảo vệ đã tăng cường

1. `sandbox_prepare` yêu cầu token Firebase hợp lệ, User UID trùng `MAIN_ADMIN_GOOGLE_UID` và username `adminkit`.
2. `sandbox_status` cũng yêu cầu đúng UID Admin; người khác bị từ chối bằng HTTP 403.
3. Webhook nhận chữ ký SePay hợp lệ vẫn chỉ được ghi mô phỏng nếu mã nạp thuộc đúng UID Admin được cấu hình, intent thuộc `adminkit` và ví thật đang khóa 0đ với `paymentEnabled:false`.
4. Không sửa `wallet_accounts`, `users.balance`, `wallet_ledger` thật, hoặc đặt mua CanBoSo.

## Cập nhật và kiểm tra

1. Sao lưu bản repository hiện tại.
2. Thay hai file API trên GitHub đúng đường dẫn, Commit.
3. Trong Vercel → Deployments, đợi Production/Preview mới đạt `Ready`.
4. Kiểm tra Admin Google có thể mở Admin Wallet và xem Sandbox. Đăng nhập bằng **tài khoản Google thường** trong cửa sổ ẩn danh để xác nhận không có quyền truy cập nội dung báo cáo/Sandbox (API phải trả 403).
5. Nếu muốn thử, dùng **SePay Test mode** và mã `NAP KPTEST...` do Admin vừa tạo; không chuyển tiền thật.
6. Firebase `wallet_accounts/<UID>` vẫn `availableVnd:0`, `paymentEnabled:false`, `status:locked`; khoản mô phỏng chỉ được cộng vào `wallet_sandbox_accounts/<UID Admin>`.

## Giới hạn

Trang HTML tĩnh `admin-wallet.html` có thể được mở trực tiếp dưới dạng file web, nhưng **dữ liệu và thao tác có ý nghĩa được khóa trong API**. Không dùng ẩn nút HTML làm biện pháp bảo mật. Gói vá đã được chạy `npm test` với dữ liệu mô phỏng, chưa kiểm chứng trên Production.
