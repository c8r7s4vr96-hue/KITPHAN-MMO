'use strict';

const { fetchLocketPackages } = require('./locket-provider');

const FIXED_LOCKET_PRICES_BY_CODE = new Map([
  ['LKG1M', 20000],
  ['LKG3M', 50000],
  ['LKG6M', 110000],
  ['LKG1Y', 200000],
  ['LKGVV', 99000],
]);

function fixedLocketPriceVnd(row) {
  if (!row || row.isTrial) return null;
  const code = typeof row.code === 'string' ? row.code.trim().toUpperCase() : '';
  if (FIXED_LOCKET_PRICES_BY_CODE.has(code)) {
    return FIXED_LOCKET_PRICES_BY_CODE.get(code);
  }
  if (row.lifetime) return 99000;
  const days = Number(row.durationDays);
  if (Number.isFinite(days) && days > 0) {
    if (days >= 28 && days <= 31) return 20000;
    if (days >= 85 && days <= 95) return 50000;
    if (days >= 175 && days <= 186) return 110000;
    if (days >= 360 && days <= 366) return 200000;
  }
  return null;
}

function computeRetailPriceVnd(row, markupVnd = Number(process.env.LOCKET_MARKUP_VND || 0)) {
  const fixed = fixedLocketPriceVnd(row);
  if (fixed !== null) return fixed;

  const ctvPrice = Number(row?.ctvPrice || 0);
  const minRetail = Number(row?.minRetailPrice || 0);
  const safeMarkup = Number.isFinite(markupVnd) && markupVnd >= 0 ? markupVnd : 0;

  let priceVnd = null;
  if (Number.isFinite(ctvPrice) && ctvPrice > 0) {
    priceVnd = Math.ceil((ctvPrice + safeMarkup) / 1000) * 1000;
  } else if (Number.isFinite(minRetail) && minRetail > 0) {
    priceVnd = Math.ceil(minRetail / 1000) * 1000;
  }
  if (priceVnd !== null && Number.isFinite(minRetail) && minRetail > 0 && priceVnd < minRetail) {
    priceVnd = Math.ceil(minRetail / 1000) * 1000;
  }
  return Number.isSafeInteger(priceVnd) && priceVnd > 0 ? priceVnd : null;
}

function publicPackages(rows, markupVnd) {
  const result = new Map();
  for (const row of rows || []) {
    if (!row || typeof row.code !== 'string' || typeof row.name !== 'string') continue;
    const code = row.code.trim();
    const name = row.name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(code)) continue;
    if (!name || name.length > 256 || /[\x00-\x1f\x7f<>]/.test(name)) continue;
    if (result.has(code)) continue;
    const priceVnd = computeRetailPriceVnd(row, markupVnd);
    result.set(code, {
      packageId: row.packageId ?? row.id ?? null,
      code,
      name,
      priceVnd,
      durationDays: row.durationDays ?? null,
      lifetime: Boolean(row.lifetime),
      videoMode: row.videoMode ?? null,
      aiQuota: row.aiQuota ?? null,
      isTrial: Boolean(row.isTrial),
      available: priceVnd !== null && priceVnd > 0,
    });
  }
  return [...result.values()];
}

async function fetchLocketCatalogPackages() {
  const rows = await fetchLocketPackages();
  return publicPackages(rows);
}

async function locketCatalog(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    const packages = await fetchLocketCatalogPackages();
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    return res.status(200).json({ ok: true, packages });
  } catch {
    return res.status(502).json({ ok: false, error: 'LOCKET_CATALOG_UNAVAILABLE' });
  }
}

locketCatalog.computeRetailPriceVnd = computeRetailPriceVnd;
locketCatalog.publicPackages = publicPackages;
locketCatalog.fetchLocketCatalogPackages = fetchLocketCatalogPackages;
locketCatalog.isLocketPackageCode = (code) => /^LKG/i.test(String(code || '').trim());

module.exports = locketCatalog;
