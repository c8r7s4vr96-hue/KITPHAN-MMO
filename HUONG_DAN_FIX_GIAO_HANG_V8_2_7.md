# KITPHAN MMO V8.2.7 — CanBoSo account delivery fix

## Lỗi đã xác định
Swagger trả `delivery.accounts[].user`, `password`, `verifyEmail`. V8.2.6 chỉ trích xuất `password` từ mỗi phần tử vì không nhận diện `user` và `verifyEmail`, sau đó đánh dấu đơn là `delivered`.

## Thay đổi
- Khi CanBoSo trả `delivery.accounts`, website hiển thị tên đăng nhập, mật khẩu và email xác minh cho **tất cả** tài khoản đã mua.
- Thiếu tên đăng nhập hoặc mật khẩu: đánh dấu `needs_review` / `SUPPLIER_DELIVERY_INCOMPLETE` và giữ tiền chờ đối soát. Không tự mua lại hoặc tự hoàn tiền.
- Giữ nguyên các loại sản phẩm trả mã/chuỗi giao hàng; hỗ trợ `order.status` ở cấp cao nhất.
- Không lưu phản hồi thô, API key hay dữ liệu thanh toán vào nhật ký chẩn đoán.
- Không thay đổi API mua, SePay hoặc bút toán ví.

## Triển khai
Giải nén ZIP, upload các file **bên trong** lên root repository. Xác nhận `lib/shop-fulfillment.js` đã cập nhật và Vercel Production Ready. Có thể dùng patch nhỏ để cập nhật đúng 2 file `lib/shop-fulfillment.js` và `package.json`, hoặc ZIP nguồn đầy đủ. Không xóa `api/`, `lib/` hay dữ liệu Firebase.

## Kiểm tra sau cập nhật
Với đơn thử MỚI, kiểm tra màn hình mua và `Đơn CanBoSo → Xem giao hàng` hiển thị username/email, password và verifyEmail (nếu có); xác nhận khách khác không xem được đơn này.

**Đơn đã giao ở bản cũ:** không được tự mua lại để lấy tên đăng nhập. Nếu đơn cũ đã lưu duy nhất mật khẩu thì dữ liệu tên đăng nhập không thể phục hồi bằng cách chạy lại bộ lọc. Cần tra cứu thông tin đơn trong Mita Shop 98 / CanBoSo theo mã đơn và hỗ trợ khách theo cách bảo mật.

**Giới hạn:** Chỉ kiểm thử dữ liệu mô phỏng, chưa gọi CanBoSo thực tế hoặc Vercel Production.
