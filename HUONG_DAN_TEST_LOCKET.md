# Kiểm thử Locket Gold

Chức năng **Mua thử** mô phỏng thao tác đặt đơn trong trình duyệt. Bạn có thể dùng username giả để thử cả ba gói. Kết quả chỉ xác nhận hành vi của giao diện. Đơn thử không trừ ví, không gửi tới nhà cung cấp và không cấp Gold cho tài khoản Locket.

## Thử nhanh trên máy

Giải nén ZIP, mở thư mục `tests`, rồi mở `thu-locket-offline.html` bằng trình duyệt. Chọn **Mua thử** và dùng username giả như `kitphantest`. Trang thử này chạy ngay, không cần mạng hay đăng nhập.

## Thử trên website qua Vercel Preview

1. Giải nén ZIP. Thư mục gốc của dự án chứa `package.json`, `index.html`, `api/` và `lib/`.
2. Trên repository GitHub đang kết nối với Vercel, tạo nhánh `test-locket` từ nhánh đang chạy. Cập nhật nội dung đã giải nén vào gốc nhánh thử rồi commit.
3. Trong **Deployments** của dự án Vercel, mở bản **Preview** thuộc nhánh `test-locket`. Phần mua thử Locket hoạt động mà không cần khai báo token Locket.
4. Mở **Dịch vụ Locket** trên bản Preview. Danh mục lấy từ nhà cung cấp qua máy chủ của shop. Ba mã LKG6M, LKG1Y, LKGVV có giá bán lần lượt 49.000đ, 89.000đ và 100.000đ. Các mã mới xuất hiện với nhãn **Chưa đặt giá**.
5. Để kiểm tra phản hồi của bản Preview, mở đường dẫn `/api/shop-products?action=locket_catalog` trên cùng tên miền. Khi đồng bộ thành công, phản hồi có `ok: true` và danh sách `packages`. Chức năng đọc danh mục hoạt động độc lập với ví tiền và không cần cấu hình token Locket.
6. **Mua thử** dùng dữ liệu mô phỏng. Trang thử ngoại tuyến chỉ dùng để thử chức năng này. Muốn kiểm tra danh mục thật, dùng bản Preview có kết nối mạng.

## Các tình huống cần thử

| Thao tác | Kết quả mong đợi |
|---|---|
| Chọn lần lượt từng gói | 180 ngày hiển thị 49.000đ, 1 năm hiển thị 89.000đ, vĩnh viễn hiển thị 100.000đ. |
| Để trống username rồi tiếp tục | Biểu mẫu yêu cầu nhập username. Lịch sử đơn thử chưa tăng. |
| Nhập `kitphantest`, chọn gói 180 ngày rồi chuyển sang bước xác nhận | Kiểm tra lại username, gói và giá 49.000đ trước khi xác nhận. |
| Bấm xác nhận hai lần liên tiếp trên cùng một yêu cầu | Lịch sử thử chỉ thêm một đơn cho lần xác nhận đó. |
| Tải lại trang trong cùng tab rồi mở lại mục Locket | Đơn vừa tạo vẫn có trong lịch sử thử, đúng username, gói và giá. |
| Chọn **Mất phản hồi** cho username thử mới rồi xác nhận | Lịch sử ghi **Chờ đối soát**, số tiền thực thu 0đ. |
| Tải lại trong cùng tab, chọn lại đúng username và gói đang chờ rồi thử tiếp | Trang hiện mã đơn đang chờ và chặn đơn trùng. Bạn có thể dùng username thử khác để tiếp tục. |

Khi báo lỗi, hãy gửi thao tác bạn vừa thực hiện, kết quả thực tế và ảnh chụp màn hình đã che thông tin tài khoản. Không gửi token.
