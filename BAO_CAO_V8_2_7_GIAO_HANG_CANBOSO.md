# Báo cáo vá giao hàng CanBoSo — KITPHAN MMO V8.2.7

## Bằng chứng
Swagger `POST /api/v2/telegram-buyer/purchase` trả kết quả mẫu:
`delivery.accounts: [{user, password, verifyEmail}]`.
Trong V8.2.6, `lib/shop-fulfillment.js` không nhận diện `user` và `verifyEmail`, vì vậy nhiều đơn chỉ hiển thị `password`, sau đó bị đánh dấu `delivered` không đầy đủ.

## Đã sửa
- Xử lý đầy đủ `delivery.accounts` theo Swagger; hỗ trợ nhiều tài khoản và email xác minh.
- Tài khoản thiếu `user/login/email` hoặc `password` chuyển `needs_review` (`SUPPLIER_DELIVERY_INCOMPLETE`), **không** tự đánh dấu giao xong và không tự phát lệnh mua lại.
- Bổ sung nhận diện `order.status` và `orderCode` của nhà cung cấp trong chẩn đoán an toàn.
- Không thay đổi API POST mua, logic nạp SePay, ví tiền hay các quy tắc quyền Admin.
- Đã thêm kiểm thử giữ tiền khi thiếu thông tin, tất toán một lần khi đầy đủ và đọc lại trong lịch sử.

## Kiểm thử local
- `npm test`: PASS.
- `npm run build`: PASS.
- `npm run test:syntax`: PASS.
- API Vercel: 12 file.
- Kiểm tra ZIP: PASS.

## Chưa xác nhận
- Không gọi API mua hàng thật, không kết nối tài khoản CanBoSo/Mita Shop 98 hoặc Firebase Production.
- Không kiểm chứng trình duyệt Production sau deploy.

## Lưu ý đơn đã mua ở bản cũ
Đơn đã được ghi `delivered` với chỉ password **không tự bổ sung username khi deploy**. Dữ liệu đã bị bỏ qua tại thời điểm mua, nên cần dùng lịch sử đơn ở CanBoSo/Mita Shop 98 hoặc hỗ trợ nhà cung cấp để tra cứu thông tin đầy đủ. Không gửi lại lệnh mua để truy xuất dữ liệu cũ; không chỉnh tiền/ví Firebase bằng tay.
