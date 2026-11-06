# KIT PHAN MMO — Premium V4 / Kho tài khoản CanBoSo

Bản V4 được cập nhật trực tiếp từ `index (4).html` của bạn. Giữ nguyên các mục Locket, Facebook, TikTok, Instagram, theme sáng/tối, VI/EN và API Telegram V3. Tạo **mục Kho tài khoản Premium** riêng.

## Tính năng

- Lấy **toàn bộ danh mục đang mở bán** qua `GET /api/v2/telegram-buyer/products`, tự lọc bỏ Locket (cả theo tên lẫn danh mục).
- Tự động kiểm tra tồn kho khi mở mục và mỗi **60 giây** trong khi mục được xem. Backend cache 30 giây, tránh vượt giới hạn API 30 lần/phút/key.
- Tìm theo tên, lọc danh mục, sắp xếp theo giá. Không sử dụng số lượng giả từ ảnh chụp.
- Server tính giá bán = `ceil((giá nhập * (1 + SHOP_MARKUP_PERCENT/100) + SHOP_MARKUP_FIXED_VND) / 100) * 100`. Mặc định tỷ lệ 0 nếu bạn chưa cấu hình.
- Có API mua hàng, đơn mua riêng và giao tài khoản/mã kích hoạt chỉ cho người mua. **Mặc định KHÓA THANH TOÁN THẬT** để không phát sinh giao dịch ngoài ý muốn.
- Khu nhận thông báo Telegram của V3 **vẫn được giữ**, đơn tài khoản thành công có thêm tin báo cho Admin nhưng không gửi mật khẩu/chi tiết kích hoạt.

## Cấu trúc file chính xác

```text
repo/
├── index.html                  (V4 mới; phải ở thư mục gốc)
├── anh1.jpg                   (logo cũ; bạn giữ nguyên)
├── package.json                (thêm/giữ firebase-admin)
├── api/
│   ├── auth-event.js           (API Telegram V3 cũ; giữ hoạt động)
│   ├── order-event.js          (API đơn dịch vụ V3 cũ; giữ hoạt động)
│   ├── shop-products.js        (API đọc sản phẩm/tồn kho)
│   ├── shop-session.js         (phiên mua hàng cho tài khoản thường cũ)
│   ├── shop-checkout.js        (API đặt mua máy chủ)
│   └── shop-orders.js          (tra cứu đơn và giao hàng của chính người mua)
└── lib/
    └── shop-common.js         (thư viện máy chủ; KHÔNG đưa vào public HTML)
```

Các file cũ như `sepay_receiver.php`, `Dockerfile`, `README.txt` trong repo của bạn **chưa cần xóa**. Bản ZIP không chứa các file đó, nhưng bạn phải giữ nguyên chúng khi cập nhật.

## Bước 1 — Thay lên GitHub

1. Tải ZIP, giải nén trên máy tính rồi tải lên **đúng các đường dẫn** như cây thư mục trên.
2. Đảm bảo file V4 có tên chính xác **`index.html`**, không phải `index(1).html`.
3. Không xóa thư mục `api` hiện có. Chỉ bổ sung các file `shop-*` và giữ `auth-event.js`, `order-event.js` (nếu khác bản bạn đang dùng, sao lưu trước khi thay).
4. Nếu `package.json` hiện có thêm dependencies, **gộp** thay vì xóa. Bản mẫu yêu cầu `firebase-admin` >= 13, Node >= 20.
5. Commit vào nhánh đang dùng cho Vercel, kiểm tra Deployments → Production Ready.

**API `/api/...` chỉ chạy khi website được triển khai trên Vercel/Node; GitHub Pages chỉ xuất bản HTML tĩnh, không chạy các endpoint này.** Vì vậy hãy kiểm tra tính năng trên tên miền **`kitphanmmo.vercel.app`** chứ không phải URL GitHub Pages.

## Bước 2 — Tạo API key MỚI và cấu hình Vercel

**CẢNH BÁO:** Ảnh chụp Telegram trong cuộc trò chuyện đã để lộ API key. Hãy thu hồi/đổi key cũ trong bot trước khi kết nối Vercel. **Không dán lại key thật trong chat, README, mã HTML hoặc GitHub.**

Trong **Vercel → Project → Settings → Environment Variables**, thêm các biến như `.env.example` (đây chỉ là mẫu, không lưu `.env` thật lên GitHub):

- `CANBOSO_API_KEY`: key buyer mới, chỉ lưu ở server.
- `CANBOSO_AUTH_SCHEME`: mặc định `x-api-key`. Vì chưa kiểm thử trực tiếp với key thật, nếu Swagger của tài khoản yêu cầu `Authorization: Bearer` thì đặt `bearer`; nếu yêu cầu `Authorization` chứa key trực tiếp thì đặt `authorization`; hoặc `x-buyer-api-key` tùy tài liệu. **Không có cách xác minh tự động auth scheme chỉ từ ảnh Telegram.**
- `CANBOSO_PURCHASE_QUANTITY_ONE`: mặc định `false` (`{product_id: ...}`). Nếu tài liệu `PurchaseRequest` bắt buộc `quantity`, đặt `true` (`{product_id: ..., quantity:1}`). Cần kiểm tra schema thực tế trước khi bật mua thật.
- `SHOP_MARKUP_PERCENT`: ví dụ `20` để tăng 20% so với giá API. Không đặt số âm.
- `SHOP_MARKUP_FIXED_VND`: số tiền cộng thêm trên mỗi đơn, ví dụ `5000`.
- `SHOP_PURCHASES_ENABLED`: giữ **`false`** cho đến khi hoàn thành các điều kiện bảo mật bên dưới.
- `SHOP_SESSION_SECRET`: một chuỗi ngẫu nhiên >= 32 ký tự. Tạo trên máy bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: giống API Telegram V3, phải là JSON của server service account (không công khai).
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: giữ nguyên biến thông báo V3 hiện đang hoạt động.

Sau khi lưu biến môi trường, **Redeploy** (biến môi trường Vercel không tự áp dụng cho deployment đã tồn tại).

## Bước 3 — Kiểm tra kết nối không mua thật

1. Đăng nhập web trên Vercel → chọn menu **Kho tài khoản Premium**.
2. Danh mục phải có dữ liệu tự lấy từ CanBoSo; không có Locket. Số lượng/thời gian đồng bộ được hiển thị trên giao diện.
3. Thử tìm `Canva`/`ChatGPT` và đổi VI/EN, Dark/Light.
4. Nếu nhận **401** từ nhà cung cấp, kiểm tra `CANBOSO_AUTH_SCHEME` và key mới; nếu **422**, kiểm tra schema trong Swagger; nếu **429**, đợi thời gian `Retry-After` và không gửi liên tục.
5. Trên Vercel Logs, xác nhận `GET /api/shop-products` trả 200; tuyệt đối không log token, mật khẩu hoặc service account.

## Bước 4 — Điều kiện bắt buộc trước khi BẬT mua thật

**Đừng đặt `SHOP_PURCHASES_ENABLED=true` ngay.** Website gốc đang đăng nhập tài khoản thường bằng cách tải dữ liệu `users` từ Firebase RTDB, chứa mật khẩu dạng rõ, và có logic trừ/cộng `users/{username}/balance` ngay trên trình duyệt. Nếu RTDB Rules hiện cho client đọc toàn bộ `users` hoặc tự chỉnh `balance`, người lạ có thể chiếm tài khoản, tăng tiền rồi tạo đơn API khiến bạn mất tiền thật.

Cần xử lý trước:

1. **Chuyển đăng nhập thường sang Firebase Authentication** (migrate mật khẩu sang hash an toàn và bỏ đọc toàn bộ users), sử dụng `auth.uid` thay vì chỉ username trong localStorage.
2. **Đóng RTDB Rules toàn bộ dữ liệu tài chính**: không để client tự đọc mật khẩu, ghi balance, orders, `shop_orders`, `shop_deliveries`, `shop_login_limits`. Firebase Admin trong Vercel vẫn truy cập được. Quan trọng: quyền `.read: true` ở parent **không thể bị thu hồi** bằng `.read:false` ở child. Hãy kiểm tra từ root.
3. Dùng xác minh webhook ngân hàng SePay **server-side** và ledger/transaction để cộng số dư một lần duy nhất, không tin dữ liệu do trình duyệt gửi.
4. Xác nhận cùng một người dùng được ánh xạ chính xác vào ví server, test đơn có/không đủ tiền, test **idempotency** (mã `requestId` duy nhất), kiểm tra hoàn tiền và đơn không rõ trạng thái.
5. Xác nhận hàng bạn bán có quyền phân phối hợp lệ, không vi phạm chính sách các nền tảng (đặc biệt tài khoản/chỗ ngồi dùng chung).
6. Nạp trước số dư ví của CanBoSo theo quy định nhà cung cấp. **Ví khách trên web và ví CanBoSo là hai ví khác nhau**. API purchase trừ tiền từ ví CanBoSo của bạn; web chỉ thu tiền từ khách theo nghiệp vụ server.
7. Chỉ khi đầy đủ mới đặt `SHOP_PURCHASES_ENABLED=true` và deploy lại.

### Quy tắc xử lý lỗi đơn

- Nhà cung cấp báo từ chối rõ ràng (HTTP 4xx trừ 429) → backend cố gắng hoàn số dư khách một lần.
- Timeout/HTTP 5xx/không chắc đơn đã xử lý hay chưa → **không tự đặt lại và không tự hoàn**, đánh dấu `needs_review` để admin kiểm tra nhà cung cấp tránh cấp 2 tài khoản/hoàn nhầm.
- Thông tin giao tài khoản nằm ở `shop_deliveries`, chỉ endpoint server xác thực người mua mới trả về. **Firebase Rules phải chặn hoàn toàn việc truy cập trực tiếp từ client**.

## Độ chính xác & giới hạn

- API Swagger xác nhận 3 endpoint `products`, `balance`, `purchase`, nhưng không thể kiểm thử live request/response vì không có truy cập key thật. Code có adapter hỗ trợ các tên trường phổ biến như `id/product_id`, `name`, `price`, `stock/quantity`, `unlimited_stock`. Nếu nhà cung cấp dùng JSON khác, cần chỉnh `lib/shop-common.js` theo response thực (loại bỏ dữ liệu nhạy cảm khi chia sẻ bản mẫu).
- Giá nhà cung cấp dự kiến là **VND**, dựa trên đơn vị VND trong ảnh bot. Nếu API trả đơn vị khác, **không bật mua** cho đến khi kiểm tra/chuyển đổi tiền tệ đúng.
- Chỉ hỗ trợ mua **1 đơn vị mỗi lượt**, để tránh gửi đơn sai số lượng/nhân bản ngoài ý muốn.
- Bản hiện tại ưu tiên giữ nguyên giao diện và các chức năng cũ: chưa thay thế được toàn bộ xác thực/số dư không an toàn trong website cũ.

Tài liệu nhà cung cấp: https://canboso.com/api/swagger/
Deployment update: KIT PHAN MMO Premium V4 - Fixed markup 20000 VND.
Configure Premium Shop Admin access
