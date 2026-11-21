# KITPHAN MMO V8.2 — MỞ MUA HÀNG CHO KHÁCH (21/11/2026)

## Kết quả cập nhật

Mã nguồn được nâng cấp từ ZIP **KITPHAN MMO V8.1 FULL UPDATE ONE SHOT**.

- `/admin-checkout.html`: Google Admin chính có thể **mở thử cho Admin → mở cho tất cả khách → tạm dừng mua** bằng trang quản trị, thay vì sửa từng file hoặc UID thủ công.
- `/api/shop-settings`: API Firebase-token Admin-only; kiểm tra GET CanBoSo trước khi mở pilot; chỉ mở công khai khi có **đơn pilot đã giao** và **moneyJournal settle_...** tương ứng, Admin xác nhận đã đối soát đơn thực tế. Cấu hình lưu dưới `shop_checkout_control_v2` trong Firebase RTDB, có lịch sử thay đổi tối đa 100 mục.
- `/lib/shop-access`: hỗ trợ chế độ `pilot`, `public`, `paused` và tương thích chế độ V8 cũ (các biến `SHOP_PURCHASES_ENABLED`, `SHOP_WALLET_RULES_SECURED`, `SHOP_SUPPLIER_PURCHASE_CONFIRMED`, `SHOP_PURCHASE_ALLOWED_UIDS`). Khi đã chọn chế độ quản trị mới, chế độ này **được ưu tiên** so với các cờ V8 cũ. `SHOP_HARD_DISABLE=true` là khóa cứng khẩn cấp, chặn cả hai cơ chế.
- `/api/shop-checkout`: chỉ cho Firebase UID đã xác thực và liên kết username mua; kiểm tra trạng thái mở bán trước và sát thời điểm giữ tiền; so giá hiển thị với giá backend mới nhất; kiểm tra email đối với các SKU slot/invite/family. Giữ nguyên idempotency, ví duy nhất `live_deposits_v1`, nhật ký giao dịch và trạng thái review khi CanBoSo chưa chắc chắn.
- `/api/shop-products`: quyền mua công khai theo phiên Firebase (không lấy danh sách cho phép UID Admin làm mặc định trong chế độ `public`).
- Trên website khách, mua hàng chỉ được kích hoạt khi sản phẩm còn hàng, tài khoản đã được xác minh và cửa hàng đang mở.

## Cách cập nhật toàn bộ một lần

1. **Sao lưu** GitHub repository + xuất dữ liệu Firebase RTDB; không xóa lịch sử đơn, số dư, các bảng `live_deposits_v1`.
2. Giải nén ZIP. **Chép toàn bộ file và thư mục nằm *bên trong* `KITPHAN-MMO-main/` vào thư mục gốc repo GitHub**, bao gồm `api/shop-settings.js`, `lib/shop-access.js`, `admin-checkout.html`. Commit + push vào nhánh GitHub đang liên kết Vercel (Production). Đợi deployment Ready và xem log; không đưa API key/service-account JSON vào GitHub.
3. Kiểm tra `https://kitphanmmo.vercel.app/api/shop-products` trả danh sách sản phẩm; kiểm tra server Firebase và `CANBOSO_API_KEY`, `MAIN_ADMIN_GOOGLE_UID` đã đúng trong Vercel Production.
4. Mở `https://kitphanmmo.vercel.app/admin-checkout.html`; đăng nhập bằng **Google Admin chính**. Nếu trang báo không có quyền, kiểm tra UID/email đã xác minh và biến Admin chính.
5. Tại **Bước 1**, đối chiếu ví thật và số dư CanBoSo, xác nhận hai ô, nhấn **Mở mua thử cho Admin**. Hệ thống kiểm tra read-only ba API CanBoSo; nếu thiếu key, API không trả hợp lệ hoặc kho không xác minh còn hàng, sẽ không bật pilot.
6. Vào Kho Premium bằng **Google Admin chính**, kiểm tra số dư ví thật rồi mua **một sản phẩm rẻ nhất** có tồn kho bằng tiền đã đối soát (đây là đơn mua thật; không giả lập). Sau đó xem lại lịch sử đơn trong website, đối chiếu **đơn này có thật trong CanBoSo**, số dư nhà cung cấp, và journal `live_deposits_v1/moneyJournal/settle_<orderId>` tại Firebase. **Nếu đơn đang chờ hoặc cần review, không mua lại, không mở công khai.**
7. Trở lại `/admin-checkout.html`, chọn mã đơn vừa giao, xác nhận đủ ba ô sau khi kiểm tra chứng từ rồi gõ `MO BAN` để nhấn **Mở bán cho tất cả khách**. Trang sẽ thông báo `ĐÃ MỞ BÁN CHO TẤT CẢ KHÁCH`.
8. Kiểm tra bằng tài khoản khách Firebase khác (email xác minh, username đã liên kết, ví thật có số dư) trong tab Kho Premium → mua một SKU không cần email → kiểm tra giao hàng, lịch sử đơn, CanBoSo, trạng thái ví. Không dùng tiền lịch sử `users.balance` để mua. Sau khi đã xác minh, mới thông báo khách dùng chính thức.

## Khi có lỗi

- **Mở bán vẫn khóa:** đọc lý do `/api/shop-products` (đăng nhập, hồ sơ chưa liên kết, pilot, paused, hard-disable). Khi sử dụng giao diện quản trị V8.2, không cần sửa UID allowlist từng khách.
- **Đơn không được giao nhưng tiền bị giữ:** vào `/admin-shop.html` để xem đơn `needs_review`, `awaiting_delivery`, `requesting_supplier`. Đối chiếu CanBoSo **trước** khi hoàn hoặc giao thủ công. Không tự động gửi yêu cầu mua lần hai.
- **Khách chưa nạp được tiền:** SePay/MB Bank thuộc quy trình độc lập. Cần xác nhận webhook, xác thực HMAC, đọc giao dịch ngân hàng và các cờ `LIVE_DEPOSITS_ENABLED`, `SEPAY_LIVE_RECORDING_ENABLED` trước khi bật nạp thật. Đăng ký/mua không tự bật nạp tiền.
- **SKU yêu cầu email (slot/invite/family):** cần xác minh tên trường trong `PurchaseRequest` của CanBoSo và cấu hình `CANBOSO_PURCHASE_EMAIL_FIELD` theo tên trường hỗ trợ; nếu chưa chắc, hệ thống không gửi đơn sai dữ liệu. Không đoán tên trường.
- **Dừng khẩn cấp:** Google Admin nhấn **TẠM DỪNG MUA HÀNG NGAY**. Nếu không vào được trang, đặt `SHOP_HARD_DISABLE=true` trên Vercel Production và redeploy. Những đơn đã được nhà cung cấp nhận trước khi tạm dừng vẫn cần đối soát.
- **Cần quay về pilot sau paused:** bấm Mở thử cho Admin và thực hiện một đơn thử mới. Mỗi lần mở công khai có xác minh giao dịch mới; không sử dụng lại đơn từ đợt cũ.

## Giới hạn đã kiểm tra

- `npm test`: các bài kiểm thử Node offline đạt, gồm ví khách/trừ tiền/giữ tiền/nhận hàng, kiểm tra chống trùng, quyền Admin, mở công khai, dừng và kill switch.
- `npm run test:syntax`: đạt; `python tests/test-v82-admin-ui.py`: đạt bằng Chromium headless với API Firebase/CanBoSo giả lập.
- **Chưa thực hiện** POST CanBoSo thật, chuyển tiền ngân hàng thật, triển khai Production, hoặc xác minh Firebase/SePay thật bằng secret của bạn. Không được xem kiểm thử mô phỏng như bằng chứng sản phẩm đã được mua và giao ngoài đời thực.
- Đây là quy trình mở bán kiểm soát, không phải cơ chế bật tiền thật tự động khi upload ZIP.

**Nguồn API chính thức:** https://canboso.com/api/swagger/ (Buyer API v2, endpoint products/orders/balance/purchase).
