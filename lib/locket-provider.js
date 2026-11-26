'use strict';

const DEFAULT_BASE_URL = 'https://uplocket.io.vn';

const getBaseUrl = () => (process.env.LOCKET_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const getApiKey = () => process.env.LOCKET_API_KEY || process.env.LOCKET_SECRET_KEY || '';

function authHeaders() {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('Missing LOCKET_API_KEY');
    err.status = 503;
    throw err;
  }
  return {
    'X-API-KEY': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function callProvider(path, { method = 'GET', body = null, auth = true, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getBaseUrl()}${path}`, {
      method,
      headers: auth ? authHeaders() : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      const err = new Error(`Invalid JSON (${res.status}): ${text.slice(0, 200)}`);
      err.status = res.status || 502;
      throw err;
    }
    if (!res.ok || json?.ok === false || json?.success === false) {
      const err = new Error(json?.error || json?.message || `HTTP ${res.status}`);
      err.status = res.status || 502;
      err.payload = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLocketPackages() {
  const json = await callProvider('/api/v1/packages', { auth: true });
  const list = Array.isArray(json.packages) ? json.packages : Array.isArray(json.data) ? json.data : [];
  return list.map((pkg) => ({
    packageId: pkg?.packageId ?? pkg?.id ?? null,
    code: String(pkg?.code || '').trim(),
    name: String(pkg?.name || '').trim(),
    adminName: pkg?.adminName ? String(pkg.adminName).trim() : null,
    ctvPrice: Number(pkg?.ctvPrice || 0),
    durationDays: pkg?.durationDays ?? null,
    lifetime: Boolean(pkg?.lifetime),
    creditCost: pkg?.creditCost ?? null,
    videoMode: pkg?.videoMode ?? null,
    aiQuota: pkg?.aiQuota ?? null,
    isTrial: Boolean(pkg?.isTrial),
    minRetailPrice: Number(pkg?.minRetailPrice || 0),
  }));
}

function normalizeLookupPayload(json, fallbackUsername) {
  const d = (json && typeof json.data === 'object' && json.data) ? json.data : (json || {});
  return {
    uid: d.uid ?? d.uidString ?? null,
    username: d.username || fallbackUsername,
    avatarUrl: d.avatarUrl || d.avatar || '',
    active: Boolean(d.active ?? d.isGold ?? d.goldActive),
    expiresAt: d.expiresAt || d.expiredAt || null,
    packageName: d.packageName || d.package || d.tier || null,
    activationCode: d.activationCode || null,
    installUrl: d.installUrl || d.downloadUrl || d.url || d.enrollUrl || null,
  };
}

async function lookupLocketDns(identifier) {
  const clean = String(identifier || '').trim().replace(/^@/, '');
  if (!clean) {
    const err = new Error('Username Locket is required');
    err.status = 422;
    throw err;
  }
  try {
    const json = await callProvider('/api/v1/dns/lookup', {
      method: 'POST',
      body: { username: clean },
    });
    return normalizeLookupPayload(json, clean);
  } catch (err) {
    if (err?.status === 404 || err?.status === 405) {
      const qs = new URLSearchParams({ username: clean });
      const json = await callProvider(`/api/v1/dns/lookup?${qs.toString()}`, { method: 'GET' });
      return normalizeLookupPayload(json, clean);
    }
    throw err;
  }
}

async function resolveLocketUsername(identifier) {
  return lookupLocketDns(identifier);
}

async function checkLocketUid(username) {
  const info = await lookupLocketDns(username);
  return {
    active: info.active,
    expiresAt: info.expiresAt,
    package: info.packageName,
    packageName: info.packageName,
    tier: info.packageName,
    activationCode: info.activationCode,
    installUrl: info.installUrl,
  };
}

async function createLocketOrder({ username, packageId = null, packageCode = '' }) {
  const cleanUser = String(username || '').trim().replace(/^@/, '');
  const cleanCode = String(packageCode || '').trim();
  if (!cleanUser) {
    const err = new Error('username is required');
    err.status = 422;
    throw err;
  }

  let resolvedPackageId = packageId;
  let resolvedCode = cleanCode;
  let resolvedName = null;

  if (resolvedPackageId == null && cleanCode) {
    const packages = await fetchLocketPackages();
    const match = packages.find(
      (p) => p.code === cleanCode || (p.packageId != null && String(p.packageId) === cleanCode)
    );
    if (!match || match.packageId == null) {
      const err = new Error(`Package not found: ${cleanCode}`);
      err.status = 404;
      throw err;
    }
    resolvedPackageId = match.packageId;
    resolvedCode = match.code || cleanCode;
    resolvedName = match.name || null;
  }

  if (resolvedPackageId == null) {
    const err = new Error('packageId or packageCode is required');
    err.status = 422;
    throw err;
  }

  const json = await callProvider('/api/v1/dns/export', {
    method: 'POST',
    body: { username: cleanUser, packageId: resolvedPackageId },
  });
  const d = (json && typeof json.data === 'object' && json.data) ? json.data : (json || {});

  return {
    data: d,
    uid: d.uid ?? d.uidString ?? null,
    username: d.username || cleanUser,
    packageId: d.packageId ?? resolvedPackageId,
    packageCode: d.packageCode || resolvedCode || null,
    packageName: d.packageName || resolvedName || null,
    activationCode: d.activationCode || null,
    expiresAt: d.expiresAt || d.expiredAt || null,
    dnsUrl: d.installUrl || d.downloadUrl || d.url || d.enrollUrl || null,
    reused: Boolean(d.reused),
  };
}

module.exports = {
  fetchLocketPackages,
  resolveLocketUsername,
  checkLocketUid,
  createLocketOrder,
};
