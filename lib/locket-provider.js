'use strict';

const DEFAULT_BASE_URL = "https://locket.2707226.xyz";
const DEFAULT_DNS_URL = "https://doh.2707226.xyz/kitphan1011";

const getBaseUrl = () => process.env.LOCKET_API_BASE_URL || DEFAULT_BASE_URL;
const getSecretKey = () => process.env.LOCKET_SECRET_KEY || "";
const getDnsUrl = () => process.env.LOCKET_DNS_URL || DEFAULT_DNS_URL;
const DNS_URL = getDnsUrl();

function authHeaders() {
  const secretKey = getSecretKey();
  if (!secretKey) throw new Error("Missing LOCKET_SECRET_KEY");
  return {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function callProvider(path, { method = "GET", body = null, auth = true, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: auth ? authHeaders() : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || json.ok === false) {
      const err = new Error(json.message || json.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLocketPackages() {
  const json = await callProvider("/api/packages?service=locket", { auth: false });
  const list = Array.isArray(json.data) ? json.data : [];
  const coinRate = Number(process.env.LOCKET_COIN_TO_VND || 1000);
  const multiplier = Number(process.env.LOCKET_MARKUP_MULTIPLIER || 1.3);

  return list.map((pkg) => {
    const priceCoin = Number(pkg.priceCoin || 0);
    const suggestedPriceVnd = Math.ceil((priceCoin * coinRate * multiplier) / 1000) * 1000;
    return {
      providerPackageId: pkg.id,
      packageCode: pkg.code,
      name: pkg.name,
      durationDays: pkg.durationDays,
      priceCoin,
      suggestedPriceVnd,
      service: "locket",
    };
  });
}

async function resolveLocketUsername(identifier) {
  const clean = String(identifier || "").trim();
  if (!clean) throw new Error("Username Locket is required");
  const json = await callProvider("/api/uid/resolve", {
    method: "POST",
    body: { identifier: clean, service: "locket" },
  });
  return json.data;
}

async function checkLocketUid(username) {
  const clean = String(username || "").trim();
  if (!clean) throw new Error("Username Locket is required");
  const qs = new URLSearchParams({ username: clean, service: "locket" });
  const json = await callProvider(`/api/uid/check?${qs.toString()}`);
  return json.data;
}

async function createLocketOrder({ username, packageCode, note = "" }) {
  const cleanUser = String(username || "").trim();
  const cleanCode = String(packageCode || "").trim();
  if (!cleanUser || !cleanCode) {
    throw new Error("username and packageCode are required");
  }
  const json = await callProvider("/api/uid/create", {
    method: "POST",
    body: {
      username: cleanUser,
      packageCode: cleanCode,
      service: "locket",
      note: note || `Auto order ${cleanUser}`,
    },
  });
  return {
    data: json.data,
    uid: json.data?.uid || null,
    order: json.data?.order || null,
    dnsUrl: getDnsUrl(),
  };
}

async function getCtvProfile() {
  const json = await callProvider("/api/keys/me");
  return json.data;
}

module.exports = {
  DNS_URL,
  getDnsUrl,
  fetchLocketPackages,
  resolveLocketUsername,
  checkLocketUid,
  createLocketOrder,
  getCtvProfile,
};
