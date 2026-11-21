// Vercel static-site build for KITPHAN MMO V8.2.
// Keep the server-side api/ and lib/ directories out of public/. Vercel deploys
// the api/ functions separately using the Node.js runtime.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public');
const publicExt = new Set(['.html', '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2']);
const requiredPages = ['index.html', 'admin-checkout.html', 'admin-integrations.html'];
for (const name of requiredPages) {
  if (!fs.existsSync(path.join(root, name))) throw new Error(`Missing required website page: ${name}`);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let count = 0;
for (const name of fs.readdirSync(root)) {
  const source = path.join(root, name);
  if (!fs.statSync(source).isFile() || !publicExt.has(path.extname(name).toLowerCase())) continue;
  fs.copyFileSync(source, path.join(out, name));
  count++;
}
if (!fs.existsSync(path.join(out, 'index.html')) || count === 0) throw new Error('Website build output is empty');
console.log(`Prepared ${count} static assets in public/. Backend API routes remain in api/.`);
