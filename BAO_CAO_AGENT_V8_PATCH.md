# BÁO CÁO RÀ SOÁT V8 — KITPHAN WEB AGENT TEAM

**Thông tin cập nhật:** Gói V8.1 mới đã bổ sung đăng nhập username đã liên kết Firebase và kiểm tra Live chỉ đọc. Hãy đọc `HUONG_DAN_UPDATE_TAT_CA_V8_1.md`; các mục “chưa hỗ trợ” bên dưới là trạng thái của bản vá V8 trước đây.
Ngày kiểm tra: 21/11/2026. Nguồn: `KITPHAN_MMO_V8_FULL_SOURCE_ONE_SHOT_RC(4).zip` do người dùng tải lên.

## Tình trạng
**Đã vá các lỗi mã nguồn có thể tái hiện/kiểm thử offline. CHƯA xác nhận vận hành thanh toán thật và giao hàng CanBoSo.** Không thay đổi Firebase Production, không thực hiện nạp/rút/chuyển tiền, không gọi API mua hàng thật.

## Lỗi/xử lý đã thực hiện

1. **Số dư hiển thị không thống nhất với ví thật** (`lib/secure-accounts.js`): trước đây dashboard có thể hiện `users.balance` (lịch sử) khi chưa có ví `live_deposits_v1` và cờ Live bị tắt. Nay **luôn hiện** số dư có thể dùng từ ví thật; không có ví hiện `0đ`; dữ liệu ví sai chủ UID/username hoặc số âm bị chặn.
2. **Không xem được chi tiết đơn quá cũ** (`api/shop-orders.js`): trước đây tìm nội dung giao hàng chỉ trong 60 đơn Live/40 đơn legacy được tải gần nhất. Nay nếu có `orderId` sẽ truy vấn thẳng key của đơn, kiểm tra UID chủ đơn, chống xem thông tin giao hàng của tài khoản khác. Danh sách tổng hợp vẫn chỉ 60 đơn, tránh quá tải.
3. **Admin bỏ sót đơn chờ khi phát sinh nhiều đơn mới** (`api/shop-admin-review.js`): thay truy vấn 100 đơn cập nhật gần nhất bằng truy vấn theo 4 trạng thái còn treo, có giới hạn 250 đơn/trạng thái và `possiblyTruncated` cho biết có thể thiếu phần dữ liệu ngoài giới hạn. Hai trang `admin-shop.html` và `admin-finance.html` hiển thị cảnh báo.
4. **Hoàn tiền quá sớm khi nhà cung cấp chỉ trả trường `error`** (`lib/shop-fulfillment.js`): các kết quả không rõ có bị trừ tiền bên CanBoSo hay chưa, bao gồm `success:false` kèm `error` mơ hồ, nay giữ tiền để Admin đối soát thay vì tự động hoàn. Kết quả từ chối rõ ràng vẫn giữ hành vi hoàn về ví như trước.
5. **Cấu hình gây hiểu lầm** (`env.example`): loại bỏ `LIVE_DEPOSITS_ALLOWED_UIDS` khỏi ví dụ vì code Live cho phép mọi Firebase UID đã xác minh + liên kết khi đủ cờ và kết nối. **KHÔNG tự bật** cờ Live nào.
6. Thêm `tests/test-v8-hardening.js`, nối vào `npm test` và cập nhật `README_V8_ONE_SHOT.md`.

## Kiểm thử đã chạy
- `npm test`: **ĐẠT** (offline mocks; có bài kiểm thử mới cho ví, lịch sử đơn, chủ sở hữu, Admin và phản hồi lỗi).
- `npm run test:syntax`: **ĐẠT**.
- `tests/test-ui.py`: script cũ V5.4 có các phần tử không còn phù hợp V8, bị treo khi thử chạy headless. **Chưa có bằng chứng UI/ảnh trình duyệt toàn phần đạt kiểm thử.** Không đưa kết quả UI vào cam kết.

## Những điểm CHƯA thể đảm bảo và cần xử lý trước khi bán thật
- Đăng nhập bằng **username + mật khẩu cũ** vẫn không được cho phép. Dùng Firebase email/mật khẩu hoặc Google + liên kết tài khoản. Không khôi phục xác thực password plaintext cũ.
- Cần đối chiếu chính xác payload/credential/order response/status API CanBoSo với tài khoản nhà cung cấp thực tế. Timeout hoặc trạng thái mơ hồ cần đối soát; không mua lại mù. **Không có bằng chứng một giao dịch giao thành công thực tế.**
- Cần kiểm tra MB/SePay webhook HMAC, raw body, SePay Read API, ngân hàng nhận và một trường hợp nạp thử có kiểm soát; offline không xác minh được.
- Thực tế phải có `FIREBASE_SERVICE_ACCOUNT_JSON` và các biến môi trường đúng trong Vercel Production. Không gửi bí mật vào chat hay đưa `.env` lên GitHub.
- Admin cần kiểm tra **mọi đơn đang giữ tiền**, kể cả những đơn vượt quá giới hạn truy vấn. Chỉ hoàn nếu đã xác nhận nhà cung cấp **chưa thu/đã hoàn**.
- Giao dịch toàn nhánh `live_deposits_v1` có thể tốn tài nguyên khi dữ liệu lớn; cần tái kiến trúc cho quy mô lớn.

## Hướng dẫn cập nhật một lần
1. Sao lưu repo GitHub và **sao lưu riêng Firebase RTDB JSON** an toàn, không tải dữ liệu cá nhân lên nơi công khai.
2. Giải nén ZIP bản vá. Sao chép **toàn bộ nội dung bên trong** thư mục `KITPHAN-MMO-main/` lên **thư mục gốc repository** đã liên kết Vercel Production. Ghi đè file trùng tên; không xóa thủ công dữ liệu Firebase hoặc nộp nguyên thư mục cha lồng nhau.
3. Commit GitHub; kiểm tra Vercel Production deployment `Ready` và Logs. Sau đó xác minh trang, đăng nhập Google/email Firebase, lịch sử đơn và QR Live bằng tài khoản thử.
4. **Không bật** `SHOP_PURCHASES_ENABLED`, `SHOP_WALLET_RULES_SECURED`, `SHOP_SUPPLIER_PURCHASE_CONFIRMED`, `LIVE_DEPOSITS_ENABLED`, `SEPAY_LIVE_RECORDING_ENABLED`, hoặc các cờ tiền khác chỉ vì bản vá offline đạt. Bật lần lượt chỉ khi đã đáp ứng điều kiện đối soát độc lập và thử nghiệm cách ly.
5. Mở `/admin-shop.html`, `/admin-finance.html` bằng **Google Admin UID chính** để kiểm tra đơn đang giữ và chứng từ.
