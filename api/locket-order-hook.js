import { attachLocketActivationToOrder } from "../lib/locket-auto-worker.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }
  try {
    const incomingOrder = req.body?.order || req.body || {};
    const { order, activation, skipped } = await attachLocketActivationToOrder(incomingOrder);
    return res.status(activation?.ok || skipped ? 200 : 422).json({
      ok: Boolean(activation?.ok || skipped),
      skipped,
      order,
      activation,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || "Lỗi xử lý hook đơn hàng Locket",
    });
  }
}
