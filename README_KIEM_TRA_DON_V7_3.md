# KITPHAN-MMO V7.3 — CHẨN ĐOÁN ĐƠN CANBOSO (KHÔNG TỰ MỞ GIAO DỊCH)

## Đơn CapCut cũ
- Đơn `ord_fb8c0bb13ff2ed4be01bc08323128ac64482` hiện ở `needs_review`, giữ 29.000đ.
- Không chỉnh database, không hoàn tiền hay đặt lại đến khi có bằng chứng nhà cung cấp.
- Bản vá KHÔNG thể phục hồi response CanBoSo đã thất lạc. Đơn cũ sẽ hiện `Chưa có chẩn đoán (đơn cũ)`.

## Thay đổi
- `shop-checkout`: mã hóa nhóm lỗi nhà cung cấp mà không ghi API key, body hay dữ liệu giao hàng.
- `wallet-commerce`: lưu `supplierDiagnostic` cho những đơn MỚI lỗi, không thay đổi quy tắc giữ tiền.
- `shop-admin-review`: Admin có thể đọc mã chẩn đoán từ API GET.
- `shop-orders`: người mua nhận mã trạng thái kỹ thuật không nhạy cảm.
- `admin-finance`: trang xem đơn cần đối soát chỉ-đọc. Không thêm nút tự hoàn hoặc thử lại.

## Cập nhật
Sao lưu Firebase và repository. Chép các file đúng đường dẫn, commit nhánh chính, kiểm tra Vercel Production Ready.
Không ghi khóa thật vào source. API key trong ảnh Telegram từng lộ: yêu cầu nhà cung cấp thu hồi và cấp khóa mới.

## Kiểm tra trước khi cho khách đặt đơn tiếp
1. Đối chiếu lịch sử/báo cáo giao dịch của MITA SHOP 98 (giá nhập 9.000đ), xin xác nhận bằng mã và mốc thời gian.
2. Kiểm tra `admin-finance.html` → Đơn CanBoSo cần đối soát. Đơn cũ chưa có diagnostic.
3. Chỉ khi xác minh chưa thu/chưa giao, Admin mới dùng cơ chế hoàn khoản giữ trong `shop-admin-review` với chứng từ; không chỉnh Firebase trực tiếp.
4. Kiểm tra schema PurchaseRequest trên Swagger CanBoSo với payload hiện có `product_id` và `quantity`, `CANBOSO_AUTH_SCHEME`, khóa đã được xoay.
5. Dùng môi trường test tách biệt trước khi mở lại đơn thật.
