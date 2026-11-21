# KIT PHAN MMO V8 — Đăng nhập bằng tên tài khoản an toàn

## Đã sửa

- `index.html`: ô đăng nhập nhận **tên tài khoản hoặc email Firebase**. Với tên tài khoản, gửi mật khẩu kèm Turnstile đến endpoint mới; với email giữ cách đăng nhập Firebase SDK hiện có.
- `api/username-login.js` và `lib/username-login.js`: kiểm tra Turnstile ở máy chủ, tra tên tài khoản và **UID đã liên kết hai chiều**, lấy email trực tiếp từ Firebase Auth theo UID, và xác thực mật khẩu bằng Firebase Identity Toolkit. Chỉ khi Identity Toolkit trả về ID token đúng UID và Firebase Admin xác minh token, mới phát hành Firebase custom token cho **cùng UID**.
- `adminkit` luôn được ánh xạ đến `MAIN_ADMIN_GOOGLE_UID` trên máy chủ; không lấy quyền admin từ tên nhập vào hoặc trường `role` trong Realtime Database. Google login vẫn giữ nguyên.
- Không sửa, chuyển, cộng hoặc trừ số dư/đơn hàng; không sử dụng mật khẩu cũ lưu ở Realtime Database. Thêm bài kiểm thử bảo mật tại `tests/test-username-login.js`.

## Cấu hình Vercel Production cần thêm

1. Vào Cloudflare Turnstile, tìm widget có **public sitekey** `0x4AAAAAAFzcCERtNo1tZL0h` (sitekey đã có trong `index.html`); copy **Secret Key** riêng tư tương ứng.
2. Vercel > Project KIT PHAN MMO > Settings > Environment Variables: thêm `TURNSTILE_SECRET_KEY` = secret tương ứng, chọn **Production**. Không đưa secret vào GitHub hoặc chat.
3. Xác nhận `FIREBASE_SERVICE_ACCOUNT_JSON`, `MAIN_ADMIN_GOOGLE_UID` và `MAIN_ADMIN_USERNAME=adminkit` vẫn đúng. `FIREBASE_WEB_API_KEY` là tùy chọn nếu Firebase web key của dự án thay đổi.
4. Commit toàn bộ nội dung bên **trong** `KITPHAN-MMO-main/` vào root repo, giữ nguyên các biến môi trường/secrets hiện tại, đợi Vercel deploy bản mới.
5. Đối với **adminkit đang chỉ có Google**: đăng nhập nút Google > **Hồ sơ cá nhân > Thiết lập mật khẩu Firebase để đăng nhập bằng tên tài khoản**; nhập mật khẩu mới, xác minh lại Google bằng popup. Tài khoản và ví vẫn thuộc UID cũ, không tạo UID mới. Nếu Firebase đã có provider mật khẩu thì dùng chức năng Quên mật khẩu để thay đổi.
6. Test một khách hàng đã có `users/<username>.authUid` và `auth_bindings/<UID>.username` khớp, với **mật khẩu Firebase**. Với Admin `adminkit`, mật khẩu chỉ hoạt động sau khi **liên kết vào chính UID Google Admin** ở Hồ sơ cá nhân; nếu chưa liên kết, dùng **Tiếp tục với tài khoản Google**. Mục "Quên mật khẩu" chỉ dùng với email đã có mật khẩu Firebase. KHÔNG tạo UID khác cho tài khoản đang có ví.

## Lưu ý bắt buộc

- **Mật khẩu cũ trước Firebase không được khôi phục / không tự động chạy được**. Không thể dùng lại mã băm hoặc mật khẩu plaintext trong RTDB để chứng minh quyền sở hữu ví. Chủ tài khoản cũ chưa liên kết phải làm quy trình yêu cầu chuyển tài khoản và Admin xác minh/duyệt trước.
- Đăng nhập username chỉ hoạt động khi email Firebase **đã xác minh**, có đăng nhập Email/Password, binding hai chiều và Turnstile secret chính xác. Nếu chưa có secret, email/Google login vẫn hoạt động như trước.
- Cloudflare cần thêm domain Production thực tế (vd `kitphanmmo.vercel.app`) vào widget. Endpoint yêu cầu tên miền đã xác thực khớp `Host` để chống dùng token từ website khác.
- Mã nguồn được kiểm thử offline; **chưa kiểm thử đăng nhập thực tế trên Firebase Production hoặc Cloudflare** và không thay thế bộ nghiệm thu giao dịch/ngân hàng/nhà cung cấp trong `README_V8_ONE_SHOT.md`.

## Kiểm thử offline đã chạy

- `npm test`: bao gồm `tests/test-username-login.js` cho username, UID, legacy, Cloudflare, mismatch.
- `python tests/test-syntax.py`: kiểm tra cú pháp JS server và inline HTML.
- `python tests/test-username-login-ui.py`: kiểm tra trực tiếp ô đăng nhập trong HTML bằng trình duyệt giả lập (không gọi mạng).
- Bài `tests/test-ui.py` cũ từ V5.4 tham chiếu `#qrcode-box` đã không còn trong UI V8 nên không phù hợp để đánh giá tính năng đăng nhập hoặc QR V8.
