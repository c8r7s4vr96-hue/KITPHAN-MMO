# KITPHAN MMO V6.2 — Kiểm tra nút QR bị khóa

Đã sửa UI để API `GET /api/wallet?action=live_deposit_status` trả về `readinessReason` và `readinessMessage` an toàn (không lộ secret/UID/số tài khoản), đồng thời hiện lý do ngay tại trang Nạp tiền. Nút chỉ hoạt động khi `enabled=true`.

1. Tải các file đã sửa lên GitHub **đúng cấu trúc thư mục**, triển khai Vercel Production Ready.
2. Đăng nhập bằng Google có Firebase Auth UID trùng `MAIN_ADMIN_GOOGLE_UID`. Nếu có `LIVE_DEPOSITS_ALLOWED_UIDS`, đảm bảo danh sách bao gồm UID này; không dùng `*` để thử cho tất cả khách.
3. Kiểm tra `LIVE_DEPOSITS_ENABLED=true` tại Production.
4. Nếu UI báo thiếu cấu hình, chỉ bổ sung tên biến được nêu trong `readinessMessage` tại Vercel Production. Không đăng giá trị secret lên GitHub/chat.
5. `SEPAY_LIVE_RECORDING_ENABLED=true` chỉ bật khi webhook và xác minh độc lập đã kiểm thử; không chuyển khoản thật khi quy trình đối soát chưa xác nhận hoạt động.
6. Trạng thái mở QR **không đồng nghĩa** shop đã mở mua dịch vụ. Kiểm tra nhật ký, chống trùng, khớp người nhận và luồng sử dụng số dư trước khi cho khách nạp thật.

Các phản hồi có `readinessReason`: `disabled`, `not_allowed`, `configuration_incomplete`, `ready`. Không sửa cơ chế cộng tiền, xác thực, hay khóa cửa hàng trong bản vá này.
