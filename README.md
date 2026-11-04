# KIT PHAN MMO – Telegram (giai đoạn 1)

## Đã tích hợp
- Thông báo **đăng nhập Google** và **đăng ký Google** (suy ra từ thời điểm tạo tài khoản Firebase Auth) qua `/api/auth-event` trên Vercel.
- Backend xác minh Firebase ID token trước khi gửi Telegram; token bot không nằm trong HTML.
- Chống gửi trùng cơ bản theo UID và thời điểm phát hành ID token. Không đảm bảo exactly-once nếu Telegram thất bại sau khi ghi dấu sự kiện.
- Giữ giao diện, đăng nhập Popup và tài khoản cũ như file gốc.

## Chưa bật – KHÔNG nên sử dụng production cho đơn hàng/tiền lúc này
- Thông báo đăng ký/đăng nhập tài khoản mật khẩu cũ, đăng xuất, nạp tiền, thay đổi số dư, ticket, đơn hàng, admin.
- Mã đơn #0001 và UID cho mọi đơn hàng.
- Xác thực mật khẩu cũ bằng Firebase Auth và bảo vệ Database Rules.

**Lý do:** Rules hiện tại `.read: true`, `.write: true` cho phép bất kỳ ai sửa số dư, đơn hàng, tài khoản và giả mạo sự kiện. Website còn lưu mật khẩu dạng rõ, kiểm tra quyền admin ở client, và ghi tiền/đơn hàng từ browser. Không thể coi các sự kiện này là đáng tin cậy cho Telegram trước khi chuyển thao tác nhạy cảm sang backend và khóa Rules. **Không triển khai cho khách hàng thật với Rules hiện tại.**

## Triển khai giai đoạn 1
1. Sao lưu website và Firebase Database; thu hồi Bot Token cũ từng lộ trong HTML.
2. Upload **toàn bộ thư mục** lên Vercel (gồm `index.html`, `api/auth-event.js`, `package.json` và ảnh `anh1.jpg` của bạn). File ảnh không có trong gói, hãy chép từ website cũ.
3. Vercel > Project > Settings > Environment Variables:
   - `TELEGRAM_BOT_TOKEN`: token mới từ BotFather
   - `TELEGRAM_CHAT_ID`: chat nhận thông báo
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: toàn bộ JSON service account lấy từ Firebase Console > Project settings > Service accounts > Generate new private key. **Giữ bí mật**, không upload file JSON lên GitHub.
4. Deploy lại để áp dụng biến môi trường. Thử đăng nhập Google trên URL Vercel và kiểm tra Function Logs.
5. `python -m http.server` **không chạy** API `/api/auth-event`, nên chỉ kiểm tra giao diện trên localhost; muốn kiểm tra Telegram dùng Vercel deployment hoặc Vercel CLI (`vercel dev`).

## Bước tiếp theo bắt buộc trước khi tích hợp toàn bộ hoạt động
- Chuyển tài khoản mới sang Firebase Auth và có lộ trình đổi mật khẩu tài khoản cũ (không tự động đưa mật khẩu rõ lên Telegram).
- Tạo backend cho đăng nhập cũ, mua hàng, nạp tiền, thay đổi số dư, ticket, admin; kiểm tra quyền và giá dịch vụ tại server.
- Đưa sinh mã đơn tăng tuần tự, ghi đơn và trừ tiền vào giao dịch server; không dựa trên giá/số dư gửi từ browser.
- Khóa Realtime Database Rules theo quyền truy cập thực tế, không dùng `.read/.write: true`.
- Gửi Telegram từ sự kiện server đã xác thực, không tin các trường user/uid/giá do browser gửi lên.

## Bảo mật khác
File HTML hiện còn tài khoản admin mẫu và mật khẩu rõ trong mã nguồn cũ; cần loại bỏ, đổi mật khẩu và chuyển phân quyền admin sang backend trước khi công khai.
