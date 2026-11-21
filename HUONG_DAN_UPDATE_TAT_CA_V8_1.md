# KITPHAN MMO V8.1 — CẬP NHẬT MỘT LẦN (21/11/2026)

**Nguồn:** ZIP RC(4) người dùng cung cấp; kế thừa bản vá V8 Agent Patch ngày 21/11/2026.

## 1. Đã bổ sung vào mã nguồn

1. **Đăng nhập bằng username hoặc email.** Form đăng nhập trang chủ giờ chấp nhận `username` đã liên kết với Firebase Authentication. Server kiểm tra **mật khẩu Firebase** qua Google Identity Toolkit, xác minh UID, email đã xác minh, bản ghi liên kết và chính chủ rồi mới cấp Firebase custom token. Không đọc mật khẩu trong `users.password` cũ. Có giới hạn 10 lần/15 phút cho username+IP và 30 lần/15 phút cho IP, các khóa lưu hash trong Firebase RTDB. Không trả email hoặc mật khẩu qua API. Đăng nhập bằng email/mật khẩu Firebase và Google vẫn được giữ.
2. **Admin chỉ Google:** UID Admin chính phải thực sự đăng nhập với Google (`sign_in_provider=google.com`) trước khi truy cập API Admin. Đăng nhập bằng username/password không cấp quyền Admin.
3. **Trang /admin-integrations.html:** đăng nhập Google Admin; bấm nút kiểm tra quyền đọc SePay Read API (MB Bank đúng tài khoản, có quyền liệt kê giao dịch) và CanBoSo (GET products/balance/orders); đọc tối đa 25 sự kiện webhook và tối đa 25 giao dịch đối soát đã ghi tại Firebase. Kết quả không lộ key, secret, payload đơn hoặc số tài khoản đầy đủ.
4. **SePay HMAC:** bổ sung cấu hình `bodyParser:false` cho 2 endpoint webhook để bảo toàn raw body ở runtime hỗ trợ. Vẫn bắt buộc ký HMAC trên bytes gốc; không được tự `JSON.stringify(req.body)` và không xác thực được nếu runtime đã làm mất raw body.
5. Giữ nguyên các bản vá V8 trước: số dư ví thật, tra cứu đơn hàng cũ, hàng chờ Admin và giữ tiền khi trạng thái nhà cung cấp không chắc chắn.
6. Thêm `tests/test-v8-username-live.js` và đưa vào `npm test`; kiểm tra cú pháp JS của các trang Admin mới.

## 2. Cập nhật chỉ một ZIP

1. Sao lưu repo GitHub **và** xuất dữ liệu Firebase RTDB vào vị trí riêng, an toàn. Không thay đổi/xóa dữ liệu Production trong bước này.
2. Giải nén ZIP bản mới. **Đưa toàn bộ nội dung bên trong `KITPHAN-MMO-main/` vào root repo** đã liên kết Vercel, ghi đè file trùng tên, thêm file mới. Không đưa cả thư mục cha vào root tạo thành đường dẫn lồng nhau.
3. Commit + Push; kiểm tra Vercel deployment `Ready` và log. Giữ nguyên biến Production đã đặt, không gửi giá trị secret qua chat hay GitHub. `FIREBASE_WEB_API_KEY` là biến **tùy chọn**: mặc định sử dụng Firebase Web API key công khai giống index.html; nếu đổi Firebase project thì cập nhật cả frontend và biến này.
4. Đăng nhập bằng username đã **liên kết** với Firebase và **mật khẩu Firebase**. Nếu username cũ **chưa liên kết**, đăng nhập Firebase bằng email đã xác minh, chọn `YÊU CẦU KHÔI PHỤC TÀI KHOẢN CŨ`; Admin rà soát thông tin/email và duyệt trong `/admin-accounts.html`. Mật khẩu website cũ không được khôi phục trực tiếp; với tài khoản chỉ Google thì đăng nhập bằng Google.
5. Đăng nhập Google Admin tại `https://kitphanmmo.vercel.app/admin-integrations.html` → chọn **Kiểm tra SePay + CanBoSo (chỉ đọc)**. Kiểm tra các chỉ số SePay, kho và lịch sử CanBoSo, dấu vết Firebase. **Không phải** bằng chứng giao dịch/đơn mới đã hoạt động hoàn toàn.

## 3. Việc còn bắt buộc trước khi mở tiền thật

- Trong SePay, xác nhận webhook Live trỏ `POST https://kitphanmmo.vercel.app/api/sepay-live-webhook` (không dùng `sepay_receiver.php` trên Render), chọn đúng tài khoản MB, HMAC, raw body, và đọc log giao nhận thực tế.
- Kiểm tra CanBoSo Buyer API key còn hợp lệ (nếu từng lộ key, phải **thu hồi và thay mới** ở Vercel), sơ đồ `PurchaseRequest`, tồn kho và Buyer wallet. **GET đọc được không đảm bảo POST mua thật hoạt động**.
- Thực hiện nạp thử có kiểm soát với chứng từ ngân hàng đối chiếu `live_deposits_v1/events` và ví khách; kiểm tra chống lặp. Chỉ khi đã xác thực mới mở nạp Live.
- Chỉ thử một đơn CanBoSo nhỏ trên tài khoản kiểm thử có quyền và tiền đã đối soát; đối chiếu Buyer order history với website, thông tin giao hàng và số dư. Không tự gửi lại đơn không rõ kết quả.
- Đối chiếu và xử lý tất cả đơn khách bị giữ tiền, gồm đơn CapCut cũ, tại `/admin-finance.html` hoặc `/admin-shop.html`, **chỉ hoàn khi có bằng chứng không trừ tiền nhà cung cấp**.
- Các cờ `SHOP_PURCHASES_ENABLED`, `SHOP_WALLET_RULES_SECURED`, `SHOP_SUPPLIER_PURCHASE_CONFIRMED`, `LIVE_DEPOSITS_ENABLED`, `SEPAY_LIVE_RECORDING_ENABLED` **không được tự động bật** khi chưa hoàn tất kiểm chứng.

## 4. Trạng thái kiểm thử trong gói

- `npm test`: các bài kiểm thử mô phỏng được chạy tại máy xây dựng, không đụng vào ngân hàng/nhà cung cấp.
- `npm run test:syntax`: kiểm tra cú pháp Node và JS trong HTML.
- **Chưa** kiểm thử giao dịch SePay/CanBoSo Live, chưa có quyền vào Firebase/Vercel Production của người dùng, chưa xác nhận UI bằng trình duyệt thật.

Nguồn tài liệu công khai được tham chiếu: https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc , https://canboso.com/api/swagger/ .
