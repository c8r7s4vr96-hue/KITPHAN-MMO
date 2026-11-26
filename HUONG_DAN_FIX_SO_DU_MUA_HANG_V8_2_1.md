# KITPHAN MMO V8.2.1 — Vá lỗi kiểm tra số dư khi mua hàng

## Triệu chứng
- Ở phần nạp tiền, ví thật khả dụng hiển thị 30.000đ; lịch sử nạp 30.000đ đã cộng.
- Khi mua sản phẩm 24.300đ, checkout báo `Số dư ví thật không đủ`.

## Nguyên nhân khả dĩ từ mã nguồn (chưa xác minh bằng log Production)
Trong `lib/wallet-commerce.js`, trước bản vá `transact()` gọi `ref('live_deposits_v1').transaction(update)` trực tiếp. Firebase RTDB có thể truyền `null` vào lần gọi đầu của callback khi cache trống, ngay cả khi dữ liệu đã tồn tại trên máy chủ. `reserveState` khi đó tạo tài khoản tạm 0đ trong bản sao rồi ném thông báo không đủ số dư trước khi SDK có cơ hội nạp và thử lại dữ liệu thực.

## Sửa đổi
1. `lib/wallet-commerce.js`: đọc `live_deposits_v1` (chỉ đọc) trước giao dịch để khởi tạo cache Firebase. Việc GIỮ tiền và TẠO đơn vẫn nằm trong giao dịch RTDB nguyên tử. Không cộng tiền, không ghi đơn ngoài giao dịch.
2. `api/shop-checkout.js`: đọc lại ví của chính Firebase UID đã đăng nhập trước khi giữ tiền; báo lỗi chính xác hơn nếu API không thấy đúng ví, hoặc số dư thực sự không đủ. Lần kiểm tra này chỉ để chẩn đoán, không thay cho kiểm tra nguyên tử trong transaction.
3. Test mới cho Vercel cold-start: với tiền nạp đã xác minh 30.000đ, mua 24.300đ sẽ giữ 24.300đ và còn 5.700đ; request replay không được giữ tiền lần hai.

## Triển khai an toàn
1. Sao lưu repository GitHub và Firebase.
2. Giải nén ZIP, cập nhật nội dung tại gốc repository (KHÔNG upload nguyên ZIP lên GitHub).
3. Xác nhận `api/` vẫn 12 file, giữ `.vercelignore` và `vercel.json`.
4. Xem Vercel → Deployments; bản mới phải Ready.
5. Đăng nhập đúng tài khoản đã nạp. Làm mới trang Nạp tiền, kiểm tra ví vẫn có 30.000đ. Trước khi mua lại, xem `Kho Premium → Lịch sử mua` để tránh đặt trùng đơn trước đây. Nếu có tiền đang giữ hoặc đơn chờ, đối soát trước.
6. Thử mua đúng MỘT lần. Quan sát lịch sử đơn; nếu chưa nhận được hàng, không nhấn mua lại, kiểm tra CanBoSo và nhật ký server.

## Phạm vi
- Đã kiểm thử offline (mô phỏng Firebase + các test hiện có), KHÔNG thử POST mua hàng thật, KHÔNG chuyển khoản và KHÔNG xác nhận kết quả Production.
- Nếu vẫn có lỗi, cần log Vercel của `/api/shop-checkout` tại thời điểm mua, che token/secret và ảnh phần số dư đã làm mới.
