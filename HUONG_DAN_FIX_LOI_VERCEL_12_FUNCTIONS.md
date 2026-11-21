# KITPHAN MMO V8.2 — Sửa lỗi giới hạn 12 Serverless Functions của Vercel Hobby

## Lỗi đã nhìn thấy trên Vercel

> Build Failed — No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan.

Mã nguồn trước có **13** file JavaScript trong `api/`. Trên dự án Hobby của bạn, giới hạn hiển thị là **12**. Đây là nguyên nhân cụ thể của lỗi trong ảnh, không liên quan thiếu `npm run build`.

## Đã sửa

- Còn **12 API functions** trong `api/` (vẫn giữ `shop-checkout`, `wallet`, `sepay-live-webhook`, `sepay-webhook`, `shop-products`, `shop-settings`, `shop-orders`).
- Chuyển **API phiên đăng nhập kiểu cũ đã ngừng dùng** từ `api/shop-session.js` sang `lib/legacy-shop-session.js` và xử lý qua `api/shop-orders.js`.
- Giữ nguyên URL `/api/shop-session` bằng Vercel rewrite nội bộ trong `vercel.json`; yêu cầu `DELETE` vẫn xóa cookie cũ, các phương thức khác trả 410 như trước.
- Thêm `.vercelignore`: chỉ cho phép 12 file API cần thiết được deploy. Điều này đặc biệt quan trọng khi bạn upload bằng GitHub web vì file cũ vẫn có thể tồn tại, cho dù không còn trong ZIP mới.
- Thêm bài kiểm thử `tests/test-vercel-hobby-12.js` vào `npm test` để phát hiện nếu bản sau lại vượt giới hạn.
- **Không** thay đổi mã API SePay, CanBoSo hoặc nghiệp vụ trừ/cộng ví trong bản này.

## Thao tác triển khai (GitHub web)

1. **Sao lưu GitHub** và đảm bảo dữ liệu Firebase đã được sao lưu độc lập. Không xóa dữ liệu Firebase.
2. **Giải nén ZIP**. Mở bên trong thư mục và chọn tất cả file/thư mục, gồm cả file `.vercelignore` (quan trọng). **Không tải nguyên ZIP** lên GitHub.
3. Vào repository đang kết nối Vercel > **Add file > Upload files**. Tải các file và thư mục đã chọn lên **gốc** repository.
4. Xác nhận ở gốc repository có `index.html`, `package.json`, `vercel.json`, `.vercelignore`, `api/`, `lib/`, `scripts/`. File `api/shop-session.js` cũ nếu còn trên GitHub nên xóa để gọn; `.vercelignore` đã loại trừ nó khỏi deploy.
5. **Commit changes** lên nhánh Production đang được Vercel theo dõi (ảnh trước là `main`). Đợi trang Deployments xuất hiện commit mới rồi kiểm tra trạng thái.
6. Nếu Vercel vẫn báo quá 12 functions, xác nhận file `.vercelignore` có nằm tại thư mục gốc Vercel cấu hình trong Root Directory. Nếu vẫn không được, xóa hẳn file **`api/shop-session.js` cũ** trên GitHub rồi commit lại.
7. Khi deployment **Ready**, truy cập website và kiểm tra **đăng nhập, tải sản phẩm, xem lịch sử, trang Admin**. Đừng mở bán cho tất cả khách trước khi thử một đơn pilot CanBoSo thật và đối soát sổ ví.

## Kiểm thử offline đã chạy

- `node tests/test-vercel-hobby-12.js` — **PASS**.
- `npm run build` — **PASS** (chuẩn bị 8 tài nguyên tĩnh).
- `npm run test:syntax` — **PASS**.
- `npm test` — **PASS** toàn bộ bài kiểm thử offline hiện có.
- Kiểm tra ZIP CRC — PASS.

**Giới hạn:** Chưa thể khẳng định Vercel Production Ready trước khi GitHub commit được triển khai. Chưa thực hiện thanh toán thật hoặc đặt đơn CanBoSo thật. Mã nguồn này giải quyết lỗi số lượng Functions được nhìn thấy trong ảnh; nếu sau đó có lỗi cấu hình khác, xem Deployment Logs.

**Lưu ý gói dịch vụ:** Hãy kiểm tra điều khoản sử dụng Vercel Hobby đối với website thương mại. Việc giảm Functions chỉ giải quyết giới hạn kỹ thuật, không thay đổi điều khoản gói.
