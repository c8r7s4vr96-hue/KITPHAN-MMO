import { resolveLocketUsername, checkLocketUid } from "../lib/locket-provider.js";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }
  try {
    const identifier = (req.body?.identifier || req.body?.username || req.query?.username || "").trim();
    if (!identifier) {
      return res.status(400).json({ ok: false, message: "Thiếu username Locket" });
    }
    const resolved = await resolveLocketUsername(identifier);
    let statusInfo = null;
    try {
      statusInfo = await checkLocketUid(resolved.username || identifier);
    } catch {}

    return res.status(200).json({
      ok: true,
      data: {
        uid: resolved.uid,
        username: resolved.username || identifier,
        avatarUrl: resolved.avatarUrl || "",
        active: Boolean(statusInfo?.active),
        expiresAt: statusInfo?.expiresAt || null,
        package: statusInfo?.package || null,
      },
    });
  } catch (err) {
    return res.status(err.status || 400).json({
      ok: false,
      message: err.message || "Không tra cứu được tài khoản",
    });
  }
}
