# KITPHAN MMO V8.2.2 — xử lý Firebase transaction cold-null

## Từ ảnh người dùng
- GitHub/package.json đang ghi `8.2.1`.
- Firebase `live_deposits_v1/accounts/<uid>` cho `adminkit` có `availableVnd: 30000` và `totalDepositedVnd: 30000`.
- UI mua hàng vẫn báo `Số dư ví thật không đủ` khi đặt Kling giá `24300`.
- Ảnh GitHub chưa chứng minh Vercel đang chạy commit V8.2.1. Cần đối chiếu commit ở Vercel → Deployments → Ready → Production.

## Thay đổi V8.2.2
- Bảo vệ các giao dịch mua hàng trước callback Firebase nhận `null` lúc serverless khởi động, dù ví trên máy chủ đã tồn tại.
- `null → null` chỉ ở các giao dịch **yêu cầu ROOT đã tồn tại**, cho Firebase nhận được xung đột từ server và gọi lại với dữ liệu thực. Nếu ROOT thật sự trống, trả lỗi an toàn, không tạo ví giả.
- Không thay đổi cách cộng tiền, webhook SePay, giá/nguồn CanBoSo hoặc biến môi trường.
- Kiểm thử mô phỏng: 30.000đ → giữ 24.300đ → 5.700đ; phát lại request không trừ lần hai; đơn chỉ giao một lần.

## Triển khai
1. Sao lưu repository/Firebase.
2. Giải nén ZIP và upload **nội dung bên trong** lên thư mục gốc GitHub, giữ `.vercelignore` và `vercel.json`.
3. Commit → chờ Vercel Deployment mới nhất **Ready** + **Production**. Xác nhận commit khớp.
4. Sau triển khai, xem `live_deposits_v1/orders` và lịch sử website để tránh đơn trước đang `reserved`, `awaiting_delivery`, `needs_review`.
5. Chỉ thực hiện một lần mua thử sau khi không có đơn chờ, giữ tiền và số dư đã đối soát. Không cần nạp thêm tiền.
6. Nếu lỗi vẫn xuất hiện, lấy Vercel → Logs → `/api/shop-checkout` với timestamp, status và error message; che Authorization, token, API key.

## Giới hạn
- Đây là bản vá mã nguồn được kiểm thử mô phỏng, không phải xác nhận giao dịch thật.
- Không có quyền triển khai Vercel hoặc ghi Firebase Production.
- Không thể xác định chắc chắn nguyên nhân Live từ ảnh mà không có log API và commit Production.
