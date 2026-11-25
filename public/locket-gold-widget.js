(function () {
  function initLocketGoldWidget() {
    const usernameInput = document.getElementById("locket-username-input");
    const packageSelect = document.getElementById("locket-package-select");
    const checkBtn = document.getElementById("btn-check-locket");
    const buyBtn = document.getElementById("btn-buy-locket");
    const checkBox = document.getElementById("locket-check-result");
    const orderBox = document.getElementById("locket-order-result");

    if (!usernameInput || !packageSelect || !checkBtn || !buyBtn) return;

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
          body: JSON.stringify({ identifier: username })
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
            amount: price
          })
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
            packageCode
          })
        });
        const hookJson = await hookRes.json();
        if (!hookRes.ok || !hookJson.ok) {
          throw new Error(hookJson.activation?.error || hookJson.message || "Đơn đã tạo nhưng kích hoạt đang chờ xử lý.");
        }

        const info = hookJson.order?.fulfillment || hookJson.activation || {};
        const dnsUrl = info.dnsUrl || "https://doh.2707226.xyz/kitphan1011";

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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLocketGoldWidget);
  } else {
    initLocketGoldWidget();
  }
})();
