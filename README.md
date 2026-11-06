# KIT PHAN MMO — Premium V5.2.2 (Ví thật 0đ, khóa giao dịch)

## Trạng thái an toàn
- **Không tự nạp tiền, không chuyển tiền cũ, không mở mua hàng.**
- **Chỉ Admin Google website chính** được khởi tạo ví `wallet_accounts/<Firebase UID>` cho đúng tài khoản `adminkit` và **chỉ khi `wallet_test/adminkit` đã được gắn nhãn `simulation_only`**.
- Khởi tạo **0đ**, `status: locked`, `paymentEnabled: false`, `legacyFundsImported: false`.
- Ghi `wallet_ledger/<UID>/genesis_locked_v1` với thay đổi tiền **0đ**, `status: non_financial`.
- Hai thao tác ghi ví và nhật ký **không phải giao dịch nguyên tử chung**; chỉ là bước tạo ví khóa không có biến động tiền. Nếu nhật ký ghi thất bại, bấm lại sẽ bổ sung nhật ký 0đ và không tạo lại ví. Mọi logic thanh toán có tiền thật cần thiết kế giao dịch nguyên tử, sổ cái và chống trùng riêng trước khi bật.

## Cập nhật GitHub — chỉ 2 file phải thay
1. Sao lưu GitHub (Code → Download ZIP). Bạn đã sao lưu Firebase trước đó, nhưng nên lưu bản mới trước khi triển khai.
2. Thay `api/wallet.js` bằng file trong gói này. **Không xóa các API cũ khác**, không tạo function mới.
3. Thay `admin-wallet.html` trong thư mục gốc bằng file trong gói.
4. Tùy chọn: tải `tests/test-locked-wallet.js` vào `tests/`; chạy `node tests/test-locked-wallet.js` trong máy cục bộ (Node 20+).
5. GitHub → Commit changes → Vercel Deployments: kiểm tra bản mới `Production · Ready`.

## Kiểm tra ví mới
1. Kiểm tra trước `https://kitphanmmo.vercel.app/api/shop-products` có `checkoutEnabled: false` và `walletIsolationRequired: true`.
2. Vào `https://kitphanmmo.vercel.app/admin-wallet.html`, đăng nhập đúng Google Admin.
3. Nhập `adminkit` → **Xem báo cáo**.
4. Phần **Khởi tạo ví tiền thật 0đ**: chọn cả hai ô xác nhận, chỉ khi số dư thử nghiệm 97.300.000đ đã được gắn nhãn đúng.
5. Nhấn **Khởi tạo ví thật 0đ (KHÔNG mở giao dịch)** → xác nhận. Trang hiển thị ví 0đ/LOCKED.
6. Firebase Data: kiểm tra:
   - `wallet_accounts/<UID của Google Admin>/availableVnd = 0`
   - `wallet_accounts/<UID>/heldVnd = 0`
   - `wallet_accounts/<UID>/status = "locked"`
   - `wallet_accounts/<UID>/paymentEnabled = false`
   - `wallet_ledger/<UID>/genesis_locked_v1/deltaVnd = 0`
   - `users/adminkit/balance` vẫn **97300000** (dữ liệu tiền ảo), `wallet_test/adminkit/spendableInLive = false`.
7. Bấm lại hành động khởi tạo (nếu UI đã tắt nút, thử lại sau reload) không tạo ví thứ hai; API trả `duplicate:true` khi ví đã tồn tại đúng trạng thái. **Không** thử gửi tiền thật hoặc đặt mua thực tế.

## Bảo mật
- Giữ Firebase Rules: `{"rules":{".read":false,".write":false}}`.
- Giữ các biến môi trường `ACCOUNT_WALLET_RECONCILED=false`, `ACCOUNT_ADMIN_WALLET_ENABLED=false`, `SHOP_PURCHASES_ENABLED=false`, `SHOP_WALLET_RULES_SECURED=false`, `SHOP_SUPPLIER_PURCHASE_CONFIRMED=false`.
- Đừng đổi `SHOP_PURCHASES_ENABLED` hoặc sửa `users.balance` để thử mua. Giữ webhook SePay ở chế độ test/chờ đối soát.
- Không tải file Export JSON Firebase (có thể có dữ liệu nhạy cảm) lên GitHub/chat.
- Không cần thêm biến môi trường mới và không đụng API SePay, Telegram, kho CanBoSo, Locket.

## Giới hạn quan trọng
Gói vá **chỉ khởi tạo ví khóa 0đ cho Google Admin `adminkit`**. Nó **không** tạo ví chi tiêu cho khách, không cấp tiền, không chuyển tiền lịch sử và không xây quy trình mua/hoàn tiền. Để nhận tiền thật cần thiết kế một giao thức nguyên tử cộng tiền + sổ cái + idempotency, xác thực webhook Live riêng và đối soát dữ liệu trước khi mở khóa.

## Nếu bị lỗi
- 403: Firebase UID hiện tại không được cấp quyền Admin.
- 409: Số dư cũ khác nhãn thử nghiệm, ví đã tồn tại trạng thái khác hoặc thiếu nhãn.
- 422: Chưa tích hai xác nhận hoặc dữ liệu đầu vào không hợp lệ.
- 503: Kiểm tra Vercel Function Logs và Firebase service credentials. Không sửa Firebase Rules để mở quyền công khai.
Configure Admin Only Sandbox
