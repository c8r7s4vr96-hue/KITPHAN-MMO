'use strict';

const packagesUrl = 'https://locket.2707226.xyz/api/packages?service=locket';
const retailPrices = new Map([
  ['LIFETIME', 99000],
  ['1_YEAR', 200000],
  ['CTV_1_MONTH', 20000],
  ['CTV_3_MONTHS', 50000],
  ['CTV_6_MONTHS', 110000],
  ['LKG6M', 110000],
  ['LKG1Y', 200000],
  ['LKGVV', 99000],
]);

function publicPackages(rows) {
  const result = new Map();
  for (const row of rows) {
    if (!row || typeof row.code !== 'string' || typeof row.name !== 'string') continue;
    if (row.service != null && String(row.service).trim().toLowerCase() !== 'locket') continue;
    const code = row.code.trim();
    const name = row.name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(code)) continue;
    if (!name || name.length > 256 || /[\x00-\x1f\x7f<>]/.test(name)) continue;
    if (!result.has(code)) result.set(code, {code, name, priceVnd: retailPrices.get(code) ?? null});
  }
  return [...result.values()];
}

async function fetchLocketCatalogPackages() {
  const baseUrl = String(process.env.LOCKET_API_BASE_URL || 'https://locket.2707226.xyz').trim().replace(/\/+$/, '');
  const url = baseUrl === 'https://locket.2707226.xyz' ? packagesUrl : `${baseUrl}/api/packages?service=locket`;
  const headers = {Accept: 'application/json'};
  const secretKey = String(process.env.LOCKET_SECRET_KEY || '').trim();
  if (secretKey) headers.Authorization = `Bearer ${secretKey}`;
  const response = await fetch(url, {
    method: 'GET',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Catalog unavailable');
  const body = await response.json();
  if (body?.ok !== true || !Array.isArray(body.data)) throw new Error('Invalid catalog');
  return publicPackages(body.data);
}

async function locketCatalog(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ok: false, error: 'Method not allowed'});
  }
  try {
    const packages = await fetchLocketCatalogPackages();
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    return res.status(200).json({ok: true, packages});
  } catch {
    return res.status(502).json({ok: false, error: 'LOCKET_CATALOG_UNAVAILABLE'});
  }
}

locketCatalog.retailPrices = retailPrices;
locketCatalog.publicPackages = publicPackages;
locketCatalog.fetchLocketCatalogPackages = fetchLocketCatalogPackages;
locketCatalog.isLocketPackageCode = code => retailPrices.has(String(code || '').trim());

module.exports = locketCatalog;
