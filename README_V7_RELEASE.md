# KITPHAN-MMO — V7 Release Candidate (đọc trước khi cập nhật)

**Phạm vi:** Mã nguồn hoàn thiện theo yêu cầu 08/11/2026 dựa trên ZIP người dùng gửi và bản vá V6.2 đã tạo QR thành công. Đây là bản **đã kiểm thử OFFLINE**, chưa được xác nhận giao dịch thật với MB Bank/SePay hoặc đơn CanBoSo thật; do đó **KHÔNG** được gọi là Production-ready về mặt tài chính trước khi kiểm thử có kiểm soát.

## 1. Những gì có trong source

- Một nguồn số dư **có thể chi tiêu duy nhất**: `live_deposits_v1/accounts/<firebaseUid>/availableVnd`; `heldVnd` dành cho số tiền đã giữ khi đặt đơn. Tất cả thay đổi ví được commit bằng `transaction()` tại `live_deposits_v1`.
- `users/<username>/balance`, `wallet_accounts`, `wallet_test`, các bảng V5.x/legacy chỉ giữ **lịch sử**. KHÔNG xóa hoặc tự chuyển tiền cũ sang ví mới. Ví cũ có thể còn trường `status:locked`; trang V7 không dựa vào đó để tính số dư mua hàng.
- Nạp tiền đã có ở V6.2: tạo QR và payment intent riêng, SePay HMAC-SHA256, backend đọc lại SePay Read API để xác minh tài khoản, mã giao dịch, số tiền và thời hạn; một ID giao dịch chỉ ghi có một lần. Nhận được QR **chưa chứng minh** webhook và cộng tiền Live hoạt động thật.
- `admin-finance.html`: chỉ `MAIN_ADMIN_GOOGLE_UID`, xem số dư khả dụng/đang giữ, lịch sử, điều chỉnh cộng/trừ có `requestId` chống trùng và lý do tối thiểu 12 ký tự. Quyền ghi tiền chỉ bật nếu `ADMIN_WALLET_ADJUSTMENTS_ENABLED=true`.
- Kho CanBoSo: giá hiển thị mặc định = **giá nguồn VND làm tròn lên bội 100 + đúng 20.000 VND/sản phẩm**. Admin có thể tùy chỉnh **số tiền cộng** của từng sản phẩm; mọi thay đổi có audit ở `shop_pricing_v1/history`. Giá hiển thị với khách không lộ giá nhập; giá đơn được backend tính lại từ API nhà cung cấp.
- Checkout (`/api/shop-checkout`) đã thay lỗi 423 cố định bằng quy trình thực tế có điều kiện: xác thực chủ ví → chọn sản phẩm đang có → giao dịch giữ số dư tại `live_deposits_v1` → phát lệnh mua CanBoSo tối đa một lần → giao hàng và kết toán, hoặc giữ để Admin đối soát, hoặc hoàn lại nếu nhà cung cấp **xác nhận từ chối**. Lỗi timeout / mất mạng sau khi gọi CanBoSo **KHÔNG** tự mua lại hoặc hoàn tiền sai.
- `admin-shop.html`: Admin xử lý đơn chờ/chưa rõ kết quả sau khi xác minh nhà cung cấp, giao hàng hoặc hoàn lại tiền **có xác nhận chưa thu/đã hoàn và lý do**; xử lý cả đơn có trạng thái `requesting_supplier` treo trên 2 phút.
- Catalog/mua hàng chỉ mở cho UID trong danh sách cho phép, ngay cả khi các cờ mua hàng được bật. Tài khoản khác không thấy nút mua Live.
- Giữ nguyên toàn bộ file dịch vụ xã hội cũ và những tài nguyên không đụng tới; các dịch vụ cũ **vẫn bị khóa** khi chưa có backend mua hàng có xác thực.

## 2. Triển khai code không xóa dữ liệu

1. Sao lưu repository hiện tại ở GitHub và **Firebase Realtime Database → Export JSON** về nơi lưu trữ riêng. Bản JSON có dữ liệu nhạy cảm, không upload lên GitHub/chat.
2. Giải nén ZIP này, lấy **nội dung bên trong** thư mục `KITPHAN-MMO-main` và đặt đúng đường dẫn trong repository. File cùng đường dẫn cần được **thay nội dung/overwrite**, file mới được thêm, file không liên quan giữ nguyên. Không upload cả ZIP hoặc thư mục cha lồng nhau lên GitHub. Nếu GitHub web UI không cho overwrite file, dùng Git/GitHub Desktop để thay file và commit.
3. Commit lên `main` đúng repository Production đã kết nối với Vercel; kiểm tra Deployments → Production **Ready**, không vô tình triển khai Vercel Staging.
4. Không xóa dữ liệu Firebase, không sửa `users.balance`, không nhập số dư cũ hàng loạt. Không ghi token `.env`/secret/UID vào code ngoài ví dụ `env.example`.
5. Kiểm tra trang `/admin-finance.html` bằng Google Admin chính; mở `/admin-wallet.html` cho đối soát SePay; `/admin-shop.html` cho xử lý đơn cần xác minh.

**Giới hạn Vercel Hobby:** Source giữ **12** file function trong thư mục `api/`; phần finance và pricing được định tuyến qua function sẵn có (`/api/wallet?action=finance`, `/api/shop-products?action=pricing_admin`). Không tạo project mới.

## 3. Các biến môi trường cần kiểm tra trên Vercel Production

- Đã có từ V6.2: `FIREBASE_SERVICE_ACCOUNT_JSON`, `MAIN_ADMIN_GOOGLE_UID`, `MAIN_ADMIN_USERNAME`, `MB_BANK_ACCOUNT_NUMBER`, `MB_BANK_ACCOUNT_NAME`, `SEPAY_READ_API_TOKEN`, `SEPAY_LIVE_WEBHOOK_SECRET`, `CANBOSO_API_KEY` và `CANBOSO_AUTH_SCHEME`. **Đừng gửi giá trị bí mật lên chat.**
- Giữ các cờ điều chỉnh/mua hàng **TẮT** ngay sau khi upload:

```text
ADMIN_WALLET_ADJUSTMENTS_ENABLED=false
SHOP_PURCHASES_ENABLED=false
SHOP_WALLET_RULES_SECURED=false
SHOP_SUPPLIER_PURCHASE_CONFIRMED=false
SHOP_PURCHASE_ALLOWED_UIDS=<Firebase UID Admin chính>
```

- Chỉ sau khi đối soát ngân hàng và kiểm thử kế toán: `LIVE_DEPOSITS_ENABLED=true`, `SEPAY_LIVE_RECORDING_ENABLED=true`, `LIVE_DEPOSITS_ALLOWED_UIDS=<UID thử nghiệm>`. Cờ đang chạy hiện tại của bạn không bị file ZIP tự sửa.
- `SHOP_PURCHASE_ALLOWED_UIDS` mặc định giới hạn theo `MAIN_ADMIN_GOOGLE_UID` nếu chưa nhập; **KHÔNG** dùng `*` trong giai đoạn thử. Chỉ khi thử thành công mới cân nhắc mở rộng tài khoản khách.
- Chỉ bật `ADMIN_WALLET_ADJUSTMENTS_ENABLED=true` khi đã xác minh quyền Google Admin, quy tắc RTDB và quy trình ghi chứng từ thực tế. Cộng tiền thủ công **không đồng nghĩa tiền đó đã vào ngân hàng**, phải chịu trách nhiệm chứng từ.
- Sau kiểm thử đơn CanBoSo có kiểm soát, chỉ bật đồng thời `SHOP_PURCHASES_ENABLED=true`, `SHOP_WALLET_RULES_SECURED=true`, `SHOP_SUPPLIER_PURCHASE_CONFIRMED=true`. Để giới hạn UID Admin trước, không bật đại trà.
- Giá mặc định +20.000đ đã có trong code; các biến `SHOP_MARKUP_PERCENT`/`SHOP_MARKUP_FIXED_VND` cũ không còn điều khiển giá V7. Sửa mức cộng từng mặt hàng tại `/admin-finance.html`.
- Nếu API CanBoSo yêu cầu trường email cho gói slot, xác nhận schema trên Swagger rồi đặt `CANBOSO_PURCHASE_EMAIL_FIELD=recipient_email` **hoặc** `customer_email` **hoặc** `email` theo đúng tài liệu, trước khi cho mua slot. Không thử mù trên đơn thật.
- Nếu giá CanBoSo dùng USD/USDT, `SHOP_USD_TO_VND` cần tỷ giá chính xác, đáng tin cậy theo chính sách kinh doanh. Thiếu cấu hình hợp lệ thì sản phẩm ngoại tệ không được hiển thị; không tự đoán tỷ giá.

## 4. Checklist an toàn trước khi bật mua hàng thật

1. Firebase RTDB Rules không cho client sửa trực tiếp `live_deposits_v1`, `shop_pricing_v1`, các sổ kế toán và quyền người dùng; chỉ backend Admin SDK được viết. Đánh giá riêng các quyền cũ ở `users`, `deposits`, `orders`, `auth_bindings` và kiểm tra UID chống giả mạo. Không dùng rule cho phép mọi client ghi số dư.
2. SePay webhook đang bật đúng MB Bank, `POST /api/sepay-live-webhook`, sự kiện tiền vào, JSON, HMAC. Đã xác nhận raw body ký hợp lệ khi thực sự chạy trên Vercel; GET trả 405 chỉ chứng minh endpoint hiện diện. Bật retry khi lỗi và theo dõi log.
3. SePay Read API đọc được tài khoản và giao dịch; payment intent được lưu; đối soát bằng ID không cộng trùng, sai nội dung, sai số tiền, sai thời điểm hoặc sai tài khoản.
4. Trong môi trường giả lập, thử các tình huống đơn giao thành công, nhà cung cấp từ chối, timeout không rõ kết quả, lặp request, hết số dư và 2 request đồng thời.
5. Kiểm tra **chính xác PurchaseRequest/PurchaseResponse của tài khoản CanBoSo**, kiểu key và giá/đơn vị tiền. API buyer CanBoSo có chức năng ví của nhà cung cấp; **người mua có thể cần nạp trước tiền vào ví CanBoSo**. Website không thể bảo đảm nhà cung cấp tự trừ thẳng tiền từ MB Bank cho từng đơn nếu API không hỗ trợ.
6. Xác nhận một giao dịch thử thật có kiểm soát (sau khi mọi bước trên đạt), so khớp sao kê MB Bank, webhook, event/ledger Firebase, số dư. Xác nhận một đơn CanBoSo pilot với UID Admin và đối chiếu số tiền nhà cung cấp đã trừ và mã hàng bàn giao. **Chỉ sau đó** mới mở cho khách.
7. Đặt chính sách hoàn tiền khi CanBoSo đã thu tiền nhưng không giao ngay; trường hợp timeout giữ khoản tiền `heldVnd`, Admin xác minh trước khi giao hoặc hoàn.

## 5. Cấu trúc Firebase V7

```text
live_deposits_v1/
  accounts/<uid>/{uid,username,availableVnd,heldVnd,totalDepositedVnd,...}
  intents/<depositCode>         # SePay payment intent
  events/sepay_<id>             # proof verified from SePay API
  ledger/sepay_<id>             # bank-verified deposit credit
  orders/ord_<hash>             # new real-wallet CanBoSo orders
  moneyJournal/<eventId>        # admin, reserve, purchase, refund entries
  adminAdjustments/<requestId>  # immutable idempotency claim
shop_pricing_v1/
  items/<productIdHash>         # admin product markup override
  history/<changeId>           # immutable pricing audit
```

Tất cả khoản điều chỉnh, giữ, hoàn, quyết toán tác động `accounts` và `moneyJournal` trong **cùng transaction tại `live_deposits_v1`**. `deposits` của mã V5 và `users.balance` không tham gia giao dịch mới. Lưu ý: transaction ở cả nhánh gốc có thể trở thành nút thắt khi lượng tài khoản/giao dịch tăng cao; cần thiết kế sharding và sổ kế toán chuyên dụng khi mở rộng tải lớn.

## 6. Kiểm thử cục bộ

Yêu cầu Node >=20 và npm cài `firebase-admin` từ `package.json`.

```bash
npm ci  # nếu có package-lock.json; nếu không có: npm install
npm test
python tests/test-syntax.py
python tests/test-ui.py   # cần Python bs4, playwright và chromium
```

Bộ kiểm thử dùng dữ liệu giả, không gọi SePay hay CanBoSo thật, không ghi Firebase Production. Mọi kết quả ở môi trường giả lập không được hiểu là chứng nhận Production.

## 7. Giới hạn cần biết

- Chưa xác nhận được khóa API thật, Firebase Production, luồng webhook thật và Buy API CanBoSo thật từ môi trường biên tập. Không có quyền chạy tiền/đơn của người dùng; không thể xác nhận 100% giao dịch ngân hàng hoặc supplier tại đây.
- Sản phẩm CanBoSo có yêu cầu đầu vào đặc biệt ngoài product_id/quantity/email cần adapter theo Swagger chính xác; những sản phẩm ấy không nên mở cho khách trước khi kiểm thử SKU đó.
- Dữ liệu V5.x vẫn còn và có các màn hình kiểm toán cũ; chỉ **một ví có thể chi tiêu mới** hoạt động. Không xóa bằng tay các nhánh dữ liệu cũ.
- Checkout tự động chỉ áp dụng kho **CanBoSo**, không mở các chức năng Social Boost/Locket cũ vốn đang khóa.
