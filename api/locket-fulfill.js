import { runAutoLocketActivation } from "../lib/locket-auto-worker.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }
  try {
    const result = await runAutoLocketActivation(req.body || {});
    const httpCode = result.ok ? 200 : 422;
    return res.status(httpCode).json({
      ok: result.ok,
      data: result,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || "Lỗi hệ thống tự động kích hoạt",
    });
  }
}
