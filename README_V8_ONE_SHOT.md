# KITPHAN MMO V8.1 — FULL SOURCE, CẬP NHẬT 21/11/2026

**Đọc `HUONG_DAN_UPDATE_TAT_CA_V8_1.md` trước khi triển khai.** Các giới hạn V8 lịch sử bên dưới được giữ để đối chiếu; bổ sung V8.1 cho phép đăng nhập bằng username đã liên kết Firebase và có trang kiểm tra API Live chỉ đọc.

## What this release integrates

- Full V7.2 customer deposit UI and backend, V7.3 supplier-error diagnostics, V7.3.1 audited hold refund admin page.
- One canonical real wallet in `live_deposits_v1`; legacy `users.balance` is NOT a spendable second wallet.
- Per-product CanBoSo markup defaults to **20,000 VND**, with protected Admin overrides.
- Catalog, Premium order history and delivery access bound to authenticated Firebase UID.
- Every Premium order uses one stable request ID; Firebase RTDB atomic reserve / status / settle / refund journal.
- **New V8:** refuse another purchase of the *same* SKU while a prior order is unresolved even if a different request ID is generated, reducing duplicate orders on customer retry.
- **New V8:** preserve safe supplier response status/reference for pending results, when supplied by provider. Never store API keys/whole replies in diagnostic fields.
- **New V8:** link the legacy "Lịch Sử Đơn Hàng" page to Premium history; Premium history automatically loads the first time the shop opens, displays holds and refunds, and refreshes after a failed HTTP checkout response.
- Admin Finance reads pending orders and can release held customer funds **only with independent supplier proof**, using `/api/shop-admin-review`, writing a money journal and preventing double refund.

## Critical limits — please read

This is a **release candidate**, not a certified live money system. Do not conclude that a successful unit test proves a real CanBoSo delivery will occur. The public CanBoSo Swagger lists `POST /api/v2/telegram-buyer/purchase`, but actual provider credentials, detailed purchase response schema, and live order fulfillment **cannot be verified offline**. No actual payment or supplier purchase has been made during this build.

A network timeout or ambiguous POST result is *not* proof of failure: the backend MUST keep the customer's money held in `needs_review` or `awaiting_delivery` until Admin obtains supplier evidence, rather than refund/retry automatically. The backend will not promise instantaneous delivery for pending provider orders without a verified order-status API/webhook.

**Unresolved real order:** `ord_fb8c0bb13ff2ed4be01bc08323128ac64482` for `tbao123`, holds 29,000 VND. This ZIP does not automatically alter that order or credit the user. Admin must collect proof and use guarded refund on the Admin Finance page. Customer balance should be checked after the operation.

The previously pictured CanBoSo Buyer API key was exposed in a screenshot: revoke/rotate it with MITA SHOP 98 and update `CANBOSO_API_KEY` in Vercel Production. Never put the key, HMAC secrets or Firebase service-account private key in files or GitHub.

## One-time deployment (without deleting all old files)

1. Back up existing GitHub repo and export a secured Firebase database backup offline.
2. Extract this *entire* ZIP. Copy all contents **inside** `KITPHAN-MMO-main/` into the **root** of your GitHub repository, replacing the same paths and adding missing paths. Do not upload the whole folder as a nested folder and don't delete other working files blindly.
3. Commit changes on main and wait for Vercel Production Ready. Inspect build/runtime logs, not just success status.
4. Preserve current Vercel secrets and check `FIREBASE_SERVICE_ACCOUNT_JSON`, `MAIN_ADMIN_GOOGLE_UID`, MB/SePay vars, `CANBOSO_API_KEY` and `CANBOSO_AUTH_SCHEME`. Never share them in chat.
5. Before enabling normal users to buy, run the **controlled acceptance checklist** below. Do not turn flags on without verifying purchases and bank reconciliation.

## Controlled acceptance checklist

- Sign in as a non-admin verified account and confirm `live_deposits_v1/accounts/<UID>` displays the verified balance; no legacy balance is spendable.
- Generate a QR but **do not make a bank transfer** unless webhook signature, API read, amount/code match and duplicate-credit prevention are checked in staging; a QR is not proof of reconciliation.
- In Admin Finance, verify the old CapCut order is still present as `needs_review` and the 29,000 VND held is not secretly debited twice.
- Ask MITA SHOP 98 to confirm the EXACT purchase payload, accepted auth header, fulfillment fields, idempotency support (if any), and whether it offers a read-only order lookup endpoint. Confirm a failed/timeout purchase is *not automatically safe to retry*.
- Perform a **single controlled small supplier purchase** only after confirming supplier balance, response shape and test user wallet. Observe order status and supplier invoice. If provider returns delivery payload, check that purchaser alone can view delivery via `Kho Premium → Lịch sử mua`.
- Test explicit rejection, ambiguous response, duplicate request, concurrent request, refund-with-evidence and repeated refund on a separate test Firebase project before production launch.
- In case of `needs_review`, stop further live purchases until Admin reconciles them. Verify balance ledger = available + held, and provider side charge.

## Local regression tests

`npm test` runs the current self-contained offline tests; some historical V5.x tests intentionally assert older locked feature flags and are NOT authoritative for V8. For syntax: `python tests/test-syntax.py` (no real network). Do not run tests against live credentials or production Firebase.

## Important platform limitation

This version does not contain an independently verifiable CanBoSo API order-status endpoint. It therefore cannot truthfully guarantee that all supplier purchases deliver immediately; ambiguous outcomes must remain in review. Also, no production SePay payment or supplier purchase was executed in preparing the ZIP. All generated deployment assets are source only; user must deploy and perform controlled acceptance.

## Bản vá rà soát V8 — 2026-11-21

- Số dư hiển thị trong hồ sơ và dashboard **luôn** lấy từ ví thật `live_deposits_v1/accounts/<uid>`. Khi chưa tạo ví: hiển thị 0đ; không bao giờ dùng `users.balance` để thay thế, kể cả khi tắt cờ `LIVE_DEPOSITS_ENABLED`. Nếu UID/username hoặc số dư ví thật không hợp lệ, API báo lỗi thay vì hiển thị tiền sai. **Không chuyển hay xóa số dư cũ.**
- `/api/shop-orders?orderId=...` nay đọc chính xác đơn cũ ngoài 60 đơn gần nhất (và lịch sử cũ ngoài 40 đơn); tài khoản khác không được xem giao hàng. Tóm tắt danh sách vẫn có giới hạn để tránh tải toàn bộ database.
- Admin `GET /api/shop-admin-review` truy vấn theo *trạng thái cần xử lý*, thay vì chỉ xét 100 đơn cập nhật gần nhất. Có trường `possiblyTruncated` nếu đạt giới hạn 250 đơn/trạng thái; giao diện Admin hiện cảnh báo không được kết luận đã đối soát hết.
- Khi supplier phản hồi JSON chỉ có trường `error` mà không khẳng định từ chối, hệ thống **giữ khoản tiền** ở `needs_review` thay vì tự hoàn tiền; Admin cần bằng chứng độc lập từ CanBoSo trước khi giao/hoàn.
- Nạp QR Live trong mã nguồn dành cho **mọi Firebase UID đã xác minh và liên kết tài khoản**, khi hai cờ `LIVE_DEPOSITS_ENABLED` và `SEPAY_LIVE_RECORDING_ENABLED` cùng điều kiện kết nối đã đạt. Biến `LIVE_DEPOSITS_ALLOWED_UIDS` cũ không được dùng và đã bỏ khỏi ví dụ cấu hình. Tránh bật Live trước khi xác minh bank/webhook thật.
- Không sử dụng **mật khẩu lịch sử** dạng văn bản. Từ V8.1, username **đã liên kết** có thể đăng nhập bằng mật khẩu Firebase. Username cũ chưa liên kết cần email đã xác minh và Admin duyệt khôi phục.

**Kiểm thử:** `npm test` bổ sung `tests/test-v8-hardening.js` cho các trường hợp trên; `npm run test:syntax` xác minh cú pháp. Không có giao dịch thật nào được chạy; không coi bản vá này là đã nghiệm thu Production. File `tests/test-ui.py` là script UI lịch sử từ V5.4, chưa cập nhật với các thành phần nạp tiền V8 và không phải chứng chỉ QA V8.

## Bản bổ sung V8.1 — 21/11/2026

Có đăng nhập username đã liên kết Firebase bằng mật khẩu **Firebase**, trang kiểm tra tích hợp read-only `/admin-integrations.html` và ràng buộc Admin phải đăng nhập qua Google. Tài khoản legacy chưa chuyển sang Firebase không thể dùng password plaintext cũ. Chi tiết triển khai một lần và giới hạn kiểm thử Live xem `HUONG_DAN_UPDATE_TAT_CA_V8_1.md`.
