import { createLocketOrder, getCtvProfile, DNS_URL } from "./locket-provider.js";

const processedOrders = new Map();

export function isLocketGoldOrder(order = {}) {
  const service = String(order.service || order.type || order.category || "").toLowerCase();
  const code = String(order.packageCode || order.code || order.productCode || "").toUpperCase();
  const name = String(order.productName || order.name || order.title || "").toLowerCase();
  return (
    service === "locket" ||
    service === "locket_gold" ||
    code.startsWith("LKG") ||
    name.includes("locket")
  );
}

/**
 * Tự động kích hoạt Locket Gold cho đơn đã thanh toán.
 * Có chống kích hoạt trùng theo orderId và thử lại khi lỗi mạng/tạm thời.
 */
export async function runAutoLocketActivation(order, { maxRetries = 2 } = {}) {
  const orderId = String(order?.id || order?.orderId || `ORD-${Date.now()}`);
  const username = String(
    order?.username || order?.locketUsername || order?.target || order?.account || ""
  ).trim();
  const packageCode = String(
    order?.packageCode || order?.code || order?.providerPackageCode || ""
  ).trim();

  if (processedOrders.has(orderId)) {
    const existing = processedOrders.get(orderId);
    if (existing.status === "COMPLETED") return existing;
  }

  if (!username || !packageCode) {
    const failed = {
      ok: false,
      orderId,
      status: "FAILED",
      error: "Missing username or packageCode",
    };
    processedOrders.set(orderId, failed);
    return failed;
  }

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await createLocketOrder({
        username,
        packageCode,
        note: order?.note || `Auto Web Order #${orderId}`,
      });

      const completed = {
        ok: true,
        orderId,
        status: "COMPLETED",
        activatedAt: new Date().toISOString(),
        username: result.uid?.username || username,
        uid: result.uid?.uidString || null,
        packageCode,
        expiresAt: result.order?.expiresAt || result.uid?.expiresAt || null,
        dnsUrl: result.dnsUrl || DNS_URL,
        installGuide:
          "Mở link DNS bằng Safari trên iPhone để tải và cài đặt Profile DNS, sau đó mở lại Locket.",
      };
      processedOrders.set(orderId, completed);
      return completed;
    } catch (err) {
      lastError = err;
      const isClientError = err?.status && err.status >= 400 && err.status < 500 && err.status !== 429;
      if (isClientError) break;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  const failed = {
    ok: false,
    orderId,
    status: "PENDING_RETRY",
    error: lastError?.message || "Activation failed",
  };
  processedOrders.set(orderId, failed);
  return failed;
}

/**
 * Gắn thẳng kết quả kích hoạt Locket vào object đơn hàng sau khi thanh toán thành công.
 */
export async function attachLocketActivationToOrder(order) {
  if (!order || !isLocketGoldOrder(order)) {
    return { order, activation: null, skipped: true };
  }

  if (order.status === "COMPLETED" && order.fulfillment?.dnsUrl) {
    return { order, activation: { ok: true, ...order.fulfillment }, skipped: true };
  }

  const activation = await runAutoLocketActivation(order);
  if (activation.ok) {
    order.status = "COMPLETED";
    order.fulfillment = {
      service: "locket",
      uid: activation.uid,
      username: activation.username,
      packageCode: activation.packageCode,
      expiresAt: activation.expiresAt,
      dnsUrl: activation.dnsUrl,
      installGuide: activation.installGuide,
      activatedAt: activation.activatedAt,
    };
  } else {
    order.status = activation.status || "PENDING_RETRY";
    order.fulfillmentError = activation.error;
  }

  return { order, activation, skipped: false };
}

export async function checkCoinHealth(minCoinThreshold = 10) {
  const profile = await getCtvProfile();
  const balanceCoin = Number(profile?.balanceCoin ?? 0);
  return {
    balanceCoin,
    lowCoin: balanceCoin < minCoinThreshold,
    profile,
  };
}
