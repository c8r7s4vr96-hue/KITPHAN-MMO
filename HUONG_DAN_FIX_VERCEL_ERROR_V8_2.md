# KITPHAN MMO V8.2 — Vercel build repair (21/11/2026)

## Đã thêm
- `package.json`: lệnh `npm run build` và ghim Node.js 22.x để tránh runtime tự nâng cấp.
- `vercel.json`: `framework: null`, `buildCommand: npm run build`, `outputDirectory: public`.
- `scripts/build-static.js`: tạo thư mục `public/` chỉ chứa HTML/ảnh/CSS; không sao chép `api/`, `lib/`, các khóa hoặc dữ liệu thử nghiệm ra frontend.
- `.gitignore`: loại trừ `public/` được sinh khi build.

## Cách triển khai
1. Sao lưu GitHub và Firebase. Tuyệt đối không xóa dữ liệu Firebase.
2. Giải nén ZIP, chọn **toàn bộ file bên trong** và tải lên gốc repo GitHub đang liên kết Vercel, không tải nguyên ZIP.
3. Tại GitHub root phải có `index.html`, `api/`, `lib/`, `package.json`, `scripts/`, `vercel.json`.
4. Vào Vercel > Project Settings > Build and Deployment: Framework Preset = Other; Root Directory = `./` (nếu repo ở gốc). Build Command, Output Directory ưu tiên theo `vercel.json`, không cần cài bằng tay. Node.js Version nên để 22.x.
5. Commit GitHub để Vercel deploy lại. Truy cập `/` và `/admin-checkout.html` để xác nhận static frontend. **Không bật mua Live cho khách khi chưa đối soát đơn thử CanBoSo/SePay thực tế.**

## Nếu vẫn còn Error
Vercel > Project > Deployments > chọn dòng Error > Building (Build Logs), tìm các dòng màu đỏ ở cuối và gửi ảnh hoặc copy nguyên văn khoảng 15-30 dòng cuối. Nếu không có logs, chụp Deployment Details / thông báo Error. **Không gửi API key/token hoặc private key.**

## Giới hạn
Bản này là bản vá đóng gói/build theo các thiếu sót đã quan sát được, **không xác nhận nguyên nhân Vercel cụ thể** vì chưa có Build Logs hoặc quyền xem dự án Vercel. Không thực hiện deploy hay kiểm thử SePay/CanBoSo Live.
