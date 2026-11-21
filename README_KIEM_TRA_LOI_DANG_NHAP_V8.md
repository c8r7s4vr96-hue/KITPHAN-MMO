# KIT PHAN MMO V8 — Chẩn đoán lỗi "Không thể đăng nhập bằng tên tài khoản"

## Đã thay đổi trong bản này

- Cập nhật `index.html`: khi `/api/username-login` trả về HTML thay vì JSON, 404, 500 hoặc JSON thiếu `customToken`, giao diện sẽ hiển thị thông báo có HTTP status để xác định đúng lỗi; không còn luôn hiện câu mơ hồ “Không thể đăng nhập bằng tên tài khoản.”
- Không thay đổi Firebase UID, quyền Admin, ví, lịch sử giao dịch, API thanh toán hay xử lý đơn.
- Đây là bản **bổ sung chẩn đoán**. Chưa thể khẳng định đã loại bỏ nguyên nhân lỗi trên Production nếu chưa xem HTTP response/Logs thực tế.

## Bước 1: Kiểm tra API trên website

Mở trong tab mới:
`https://kitphanmmo.vercel.app/api/username-login`

- JSON có `"Method not allowed"` (HTTP 405): API tồn tại. Đăng nhập bằng username vẫn cần POST và cấu hình đúng.
- 404: thiếu `api/username-login.js` trên bản Production hoặc Root Directory sai.
- Trang HTML của website thay vì JSON: Vercel đang định tuyến `/api/` vào trang HTML, hoặc đang mở dự án/bản triển khai khác.
- 500: function không khởi chạy; xem Vercel Logs, kiểm tra `firebase-admin`, `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Bước 2: Kiểm tra cấu trúc repo GitHub

Ở root repo phải có **cùng cấp**: `index.html`, `package.json`, `api/`, `lib/`.

Trong `api/` phải có `username-login.js`. Trong `lib/` phải có `username-login.js`.
Không đưa cả thư mục `KITPHAN-MMO-main` vào root nếu Vercel đang đặt Root Directory ở root repo; khi đó file sẽ bị lồng sai tầng.

Vercel > Settings > Build and Deployment > Root Directory phải khớp với thư mục chứa `package.json` và `api/`.
Cần deploy **Production** commit mới sau khi upload. Kiểm tra trong Vercel > Functions/Logs xem `/api/username-login` có tồn tại và lỗi nào được ghi nhận.

## Bước 3: Cấu hình đăng nhập username

Cần có các biến môi trường ở Vercel **Production**:
- `FIREBASE_SERVICE_ACCOUNT_JSON`: cấu hình service account Firebase (giữ bí mật, không gửi vào chat).
- `MAIN_ADMIN_GOOGLE_UID`: đúng UID Google Admin (không phải tên `adminkit`).
- `MAIN_ADMIN_USERNAME`: `adminkit` (hoặc để mặc định `adminkit`).
- `TURNSTILE_SECRET_KEY`: Secret Key Cloudflare Turnstile **khớp với sitekey đang ở index.html**.

Cần bảo đảm hostname `kitphanmmo.vercel.app` được Turnstile chấp nhận, và Email/Password được bật tại Firebase Authentication > Sign-in method.

## Bước 4: Quan trọng với adminkit

V8 KHÔNG dùng mật khẩu `adminkit` cũ trước Firebase. Nếu Admin hiện chỉ đăng nhập Google:
1. Đăng nhập bằng nút Google với **tài khoản có UID khớp** `MAIN_ADMIN_GOOGLE_UID`.
2. Mở Hồ sơ cá nhân, liên kết **mật khẩu Firebase** bằng chức năng trong V8.
3. Đăng xuất và thử `adminkit` + mật khẩu Firebase đã liên kết (cùng xác minh Turnstile).

Không tạo tài khoản Firebase thứ hai để lấy tên `adminkit` và không tự sửa `authUid`, `MAIN_ADMIN_GOOGLE_UID` hay dữ liệu ví. Cần kiểm tra lỗi khách quan trước khi thay đổi cấu hình tài khoản.

## Bước 5: Nếu vẫn lỗi

Trong Chrome nhấn F12 > Network > Fetch/XHR, thử đăng nhập, chọn request `username-login` và chụp **Status Code và Response**. Xóa/che token, mật khẩu, `customToken`, khóa bí mật, header Authorization trước khi chia sẻ. Cũng có thể cung cấp status và thông báo lỗi dạng văn bản (không phải toàn bộ request chứa mật khẩu).
