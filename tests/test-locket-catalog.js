// Offline test of the page's catalog fetch, rendering and Locket tab selection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() {
    this.children = [];
    this.events = {};
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name),
    };
  }
  addEventListener(event, handler) { this.events[event] = handler; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
}

async function check(file) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(html, /<dl id="locket-catalog-list"[^>]*><\/dl>/);
  assert.match(html, /<button\b[^>]*\bdisabled\b[^>]*>Chưa mở bán<\/button>/);
  assert.match(html, /<form id="locket-demo-form" hidden/);
  const elements = new Map();
  function getElementById(id) {
    assert.ok(html.includes('id="' + id + '"'), 'Missing DOM id: ' + id);
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  }
  let now = 10_000_000, requests = 0, resolveResponse;
  const context = vm.createContext({
    document: { getElementById, createElement: () => new Element(), querySelectorAll: () => [] },
    SMM_SERVICES_DATA: { locket: {}, facebook: { name: 'Facebook', categories: [] } },
    updateServiceServers() {},
    Date: { now: () => now }, AbortController, setTimeout, clearTimeout,
    fetch(url, options) {
      assert.equal(url, '/api/shop-products?action=locket_catalog');
      assert.equal(options.method, 'GET');
      requests++;
      return new Promise(resolve => { resolveResponse = resolve; });
    },
  });
  context.window = context;
  const source = html.match(/<script id="locket-catalog-script">([\s\S]*?)<\/script>/)[1];
  const selector = html.match(/function selectPlatform\(platformKey\) \{[\s\S]*?\n        \}/)[0];
  vm.runInContext(source, context);
  vm.runInContext(selector, context);
  const list = getElementById('locket-catalog-list');
  const status = getElementById('locket-catalog-status');
  const retry = getElementById('locket-catalog-retry');
  async function finish(packages, ok = true) {
    const pending = context.loadLocketCatalog();
    resolveResponse({ ok, json: async () => ({ ok: true, packages }) });
    await pending;
  }
  context.selectPlatform('facebook');
  assert.equal(requests, 0);
  for (const platform of ['locket', 'facebook', 'locket']) {
    context.selectPlatform(platform);
    const locked = platform === 'locket';
    assert.equal(getElementById('submit-order-btn').disabled, locked);
    assert.equal(getElementById('locket-info-section').classes.has('hidden'), !locked);
    assert.equal(getElementById('service-order-form').classes.has('hidden'), locked);
  }
  assert.equal(requests, 1);
  assert.match(status.textContent, /Đang tải/);
  const packages = [
    { code: 'LKGT3D', name: 'Test', priceVnd: null },
    { code: 'LKG6M', name: '180 ngày', priceVnd: 49000 },
    { code: 'LKG1Y', name: '1 năm', priceVnd: 89000 },
    { code: 'LKGVV', name: 'Vĩnh viễn', priceVnd: 100000 },
    { code: 'FUTURE', name: '<img src=x>', priceVnd: null },
  ];
  await finish(packages);
  assert.equal(list.children.length, packages.length);
  packages.forEach((plan, index) => {
    const [name, price] = list.children[index].children;
    assert.equal(name.textContent, plan.name + ' (' + plan.code + ')');
    assert.equal(price.textContent, plan.priceVnd === null ? 'Chưa đặt giá' : plan.priceVnd.toLocaleString('vi-VN') + 'đ');
  });
  context.selectPlatform('locket');
  assert.equal(requests, 1, 'recent successful data should be reused');
  now += 61_000;
  context.selectPlatform('locket');
  await finish([], false);
  assert.equal(list.children.length, 0);
  assert.match(status.textContent, /Chưa tải được/);
  assert.equal(retry.hidden, false);
  retry.events.click();
  await finish([]);
  assert.equal(retry.hidden, true);
  assert.match(status.textContent, /chưa niêm yết/);
  now += 61_000;
  context.selectPlatform('locket');
  await finish([packages[0], { code: 45 }]);
  assert.equal(list.children.length, 0);
  assert.equal(retry.hidden, false);
  console.log('PASS: ' + file + ' live catalog rendering, availability, retry and tab switching');
}

(async () => {
  for (const file of ['index.html', 'public/index.html']) await check(file);
})().catch(error => { console.error(error); process.exitCode = 1; });
