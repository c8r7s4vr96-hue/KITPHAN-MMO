// Offline UI unit test. Execute the page's platform selector against a minimal DOM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const files = ['index.html', 'public/index.html'];
for (const file of files) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const card = html.match(/<section[^>]*id="locket-info-section"[^>]*>([\s\S]*?)<\/section>/)[1];
  for (const [code, duration, amount] of [
    ['LKG6M', '180 ngày', 49000],
    ['LKG1Y', '1 năm', 89000],
    ['LKGVV', 'Vĩnh viễn', 100000],
  ]) {
    const price = amount.toLocaleString('vi-VN') + 'đ';
    assert.ok(card.includes('<dt>' + duration + '</dt><dd class="font-bold">' + price + '</dd>'));
    assert.ok(html.includes("id: '" + code + "', name: '" + duration + " · Chưa mở bán', price: " + amount + ','));
  }
  assert.match(card, /<button\b[^>]*\bdisabled\b[^>]*>Chưa mở bán<\/button>/);
  assert.doesNotMatch(card, /<form|onclick=|<a\s/i);

  const selector = html.match(/function selectPlatform\(platformKey\) \{[\s\S]*?\n        \}/)[0];
  const elements = new Map();
  function getElementById(id) {
    if (!elements.has(id)) {
      assert.ok(html.includes('id="' + id + '"'), 'Missing DOM id: ' + id);
      const classes = new Set();
      elements.set(id, { classes, classList: {
        toggle(name, visible) { if (visible) classes.add(name); else classes.delete(name); },
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
      }});
    }
    return elements.get(id);
  }
  const context = vm.createContext({
    document: { getElementById, querySelectorAll: () => [] },
    SMM_SERVICES_DATA: { locket: {}, facebook: { name: 'Facebook', categories: [] } },
    updateServiceServers() {},
  });
  vm.runInContext(selector, context);
  for (const platform of ['facebook', 'locket', 'facebook', 'locket']) {
    context.selectPlatform(platform);
    const locked = platform === 'locket';
    assert.equal(getElementById('submit-order-btn').disabled, locked);
    assert.equal(getElementById('locket-info-section').classes.has('hidden'), !locked);
    assert.equal(getElementById('service-order-form').classes.has('hidden'), locked);
    assert.equal(getElementById('service-server-details').classes.has('hidden'), locked);
  }
}
console.log('PASS: three Locket prices, disabled card and checkout state across platform switches');
