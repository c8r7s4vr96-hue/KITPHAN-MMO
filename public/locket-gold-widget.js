(function () {
  const DEFAULT_DNS_URL = "https://doh.2707226.xyz/kitphan1011";
  const PACKAGES = [
    { code: "LKG6M", label: "Locket Gold 6 tháng (LKG6M)", price: 49000 },
    { code: "LKG1Y", label: "Locket Gold 1 năm (LKG1Y)", price: 89000 },
    { code: "LKGVV", label: "Locket Gold Vĩnh Viễn (LKGVV)", price: 100000 },
  ];

  function formatVnd(n) {
    return Number(n || 0).toLocaleString("vi-VN") + "đ";
  }

  function renderWidgetInto(container) {
    if (!container || container.dataset.locketMounted === "1") return;
    container.dataset.locketMounted = "1";

    container.innerHTML = `
      <div id="locket-gold-box" style="max-width:600px;margin:16px auto;padding:20px;border-radius:14px;background:#111318;color:#fff;border:1px solid #262a34;font-family:system-ui,-apple-system,sans-serif;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <h3 style="margin:0;font-size:20px;">Locket Gold - Kích hoạt tự động</h3>
          <span style="font-size:11px;padding:3px 8px;border-radius:999px;background:rgba(16,185,129,0.16);color:#34d399;border:1px solid rgba(16,185,129,0.35);">AUTO API</span>
        </div>
        <p style="margin:0 0 16px;color:#9ca3af;font-size:13px;">Nhập đúng username Locket để kiểm tra tài khoản trước khi thanh toán.</p>

        <label style="display:block;font-size:13px;margin-bottom:6px;color:#d1d5db;">Chọn gói Locket Gold</label>
        <select id="locket-package-select" style="width:100%;padding:11px 12px;border-radius:10px;background:#181b22;color:#fff;border:1px solid #2f3542;margin-bottom:14px;">
          ${PACKAGES.map(
            (p) =>
              `<option value="${p.code}" data-price="${p.price}" ${p.code === "LKG1Y" ? "selected" : ""}>${p.label} — ${formatVnd(p.price)}</option>`
          ).join("")}
        </select>

        <label style="display:block;font-size:13px;margin-bottom:6px;color:#d1d5db;">Username Locket của bạn</label>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <input id="locket-username-input" type="text" placeholder="Ví dụ: camsitup" style="flex:1;padding:11px 12px;border-radius:10px;background:#181b22;color:#fff;border:1px solid #2f3542;outline:none;" />
          <button id="btn-check-locket" type="button" style="padding:0 16px;border-radius:10px;border:none;background:#f59e0b;color:#111;font-weight:700;cursor:pointer;white-space:nowrap;">
            Kiểm tra
          </button>
        </div>

        <div id="locket-check-result" style="display:none;padding:12px;border-radius:10px;background:#181b22;border:1px solid #2f3542;margin-bottom:14px;font-size:13px;"></div>

        <button id="btn-buy-locket" type="button" disabled style="width:100%;padding:12px;border-radius:10px;border:none;background:#ffffff;color:#111;font-weight:700;font-size:15px;cursor:not-allowed;opacity:0.5;">
          Thanh toán & Kích hoạt tự động
        </button>

        <div id="locket-order-result" style="display:none;margin-top:14px;padding:14px;border-radius:10px;background:#0f291e;border:1px solid #10b981;font-size:13px;line-height:1.6;"></div>
      </div>
    `;

    const usernameInput = container.querySelector("#locket-username-input");
    const packageSelect = container.querySelector("#locket-package-select");
    const checkBtn = container.querySelector("#btn-check-locket");
    const buyBtn = container.querySelector("#btn-buy-locket");
    const checkBox = container.querySelector("#locket-check-result");
    const orderBox = container.querySelector("#locket-order-result");

    let verifiedAccount = null;

    function resetVerify() {
      verifiedAccount = null;
      buyBtn.disabled = true;
      buyBtn.style.opacity = "0.5";
      buyBtn.style.cursor = "not-allowed";
    }

    usernameInput.addEventListener("input", resetVerify);

    checkBtn.addEventListener("click", async () => {
      const username = usernameInput.value.trim();
      if (!username) {
        alert("Vui lòng nhập username Locket trước.");
        return;
      }

      resetVerify();
      checkBtn.disabled = true;
      checkBtn.textContent = "Đang kiểm tra...";
      checkBox.style.display = "block";
      checkBox.innerHTML = "Đang tra cứu tài khoản Locket...";

      try {
        const res = await fetch("/api/locket-resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: username }),
        });
        const json = await res.json();

        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.message || "Không tìm thấy username Locket này.");
        }

        verifiedAccount = json.data;
        const avatarHtml = verifiedAccount.avatarUrl
          ? `<img src="${verifiedAccount.avatarUrl}" alt="avatar" style="width:42px;height:42px;border-radius:50%;object-fit:cover;border:1px solid #374151;" />`
          : "";
        const statusText = verifiedAccount.active
          ? `Đang có gói (Hạn: ${verifiedAccount.expiresAt || "N/A"})`
          : "Chưa kích hoạt Gold";

        checkBox.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;">
            ${avatarHtml}
            <div>
              <div style="font-weight:700;color:#10b981;">✓ Đã tìm thấy: ${verifiedAccount.username}</div>
              <div style="color:#9ca3af;font-size:12px;">UID: ${verifiedAccount.uid || "N/A"} • ${statusText}</div>
            </div>
          </div>
        `;

        buyBtn.disabled = false;
        buyBtn.style.opacity = "1";
        buyBtn.style.cursor = "pointer";
      } catch (err) {
        checkBox.innerHTML = `<span style="color:#f87171;">✕ ${err.message}</span>`;
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = "Kiểm tra";
      }
    });

    buyBtn.addEventListener("click", async () => {
      if (!verifiedAccount) {
        alert("Vui lòng bấm Kiểm tra username trước khi mua.");
        return;
      }

      const packageCode = packageSelect.value;
      const selectedOpt = packageSelect.options[packageSelect.selectedIndex];
      const price = Number(selectedOpt.getAttribute("data-price") || 0);

      buyBtn.disabled = true;
      buyBtn.textContent = "Đang xử lý đơn hàng...";
      orderBox.style.display = "none";

      try {
        const checkoutRes = await fetch("/api/shop-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service: "locket",
            packageCode,
            username: verifiedAccount.username,
            uid: verifiedAccount.uid,
            amount: price,
          }),
        });
        const checkoutJson = await checkoutRes.json();
        if (!checkoutRes.ok || checkoutJson.ok === false) {
          throw new Error(checkoutJson.message || "Thanh toán thất bại hoặc số dư không đủ.");
        }

        const orderId = checkoutJson.orderId || checkoutJson.data?.id || `WEB-${Date.now()}`;

        const hookRes = await fetch("/api/locket-order-hook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: orderId,
            service: "locket",
            username: verifiedAccount.username,
            packageCode,
          }),
        });
        const hookJson = await hookRes.json();
        if (!hookRes.ok || !hookJson.ok) {
          throw new Error(
            hookJson.activation?.error || hookJson.message || "Đơn đã tạo nhưng kích hoạt đang chờ xử lý."
          );
        }

        const info = hookJson.order?.fulfillment || hookJson.activation || {};
        const dnsUrl = info.dnsUrl || DEFAULT_DNS_URL;

        orderBox.style.display = "block";
        orderBox.innerHTML = `
          <div style="font-weight:700;color:#34d399;font-size:15px;margin-bottom:6px;">✓ Kích hoạt Locket Gold thành công!</div>
          <div>• Tài khoản: <b>${info.username || verifiedAccount.username}</b></div>
          <div>• Gói: <b>${packageCode}</b></div>
          <div>• Hạn sử dụng: <b>${info.expiresAt || "Đã kích hoạt"}</b></div>
          <div style="margin-top:8px;">
            • Link cài DNS (mở bằng <b>Safari</b> trên iPhone):<br/>
            <a href="${dnsUrl}" target="_blank" style="color:#60a5fa;word-break:break-all;font-weight:600;">${dnsUrl}</a>
          </div>
        `;
      } catch (err) {
        alert(err.message || "Có lỗi xảy ra khi mua gói.");
      } finally {
        buyBtn.disabled = false;
        buyBtn.textContent = "Thanh toán & Kích hoạt tự động";
      }
    });
  }

  function replaceLegacyDemoBox() {
    const allBlocks = Array.from(document.querySelectorAll("div, section, article"));
    for (const el of allBlocks) {
      if (el.id === "locket-gold-box" || el.closest("#locket-gold-box")) continue;
      const txt = (el.innerText || "").trim();
      const hasDemoSignature =
        txt.includes("Chế độ thử dùng ba gói mẫu cố định") ||
        (txt.includes("Danh mục từ nhà cung cấp") && txt.includes("Mua thử"));
      if (hasDemoSignature && txt.length < 1500) {
        renderWidgetInto(el);
        return;
      }
    }
  }

  function boot() {
    const mountTarget =
      document.getElementById("locket-gold-mount") ||
      document.getElementById("locket-gold-box");
    if (mountTarget) {
      renderWidgetInto(mountTarget);
    }
    replaceLegacyDemoBox();
  }

  const observer = new MutationObserver(() => {
    replaceLegacyDemoBox();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      boot();
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    });
  } else {
    boot();
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
})();
