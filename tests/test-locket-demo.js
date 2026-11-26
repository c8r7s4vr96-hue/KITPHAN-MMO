// Run the actual inline demo script in an isolated DOM with per-tab storage.
// No network, live wallet or provider APIs are available in this VM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

class Element {
  constructor() {
    this.value = '';
    this.textContent = '';
    this.children = [];
    this.handlers = {};
  }

  addEventListener(type, handler) { this.handlers[type] = handler; }
  send(type) { this.handlers[type]({ target: this, preventDefault() {} }); }
  focus() {}
  reset() {}
  replaceChildren(...children) { this.children = children; this.textContent = ''; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
}

function activateDemo(html, storage) {
  const elements = new Map();
  function getElementById(id) {
    assert.ok(html.includes('id="' + id + '"'), 'Missing HTML control: ' + id);
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  }
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const select = html.match(/<select[^>]*id="locket-demo-package"[^>]*>([\s\S]*?)<\/select>/)[1];
  getElementById('locket-demo-package').options = Array.from(
    select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g),
    ([, value, textContent]) => ({value, textContent})
  );
  const document = { getElementById, createElement: () => new Element() };
  const context = { document, sessionStorage, crypto: { randomUUID } };
  context.window = context;
  const source = html.match(/<script[^>]*\bid="locket-demo-script"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(source, 'Missing demo script');
  vm.runInNewContext(source[1], context);
  return (id) => getElementById('locket-demo-' + id);
}

for (const file of ['index.html', 'public/index.html', 'tests/thu-locket-offline.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const storage = new Map();
  const storageKey = 'kitphan.locket.demo.orders.v1';
  const orders = () => JSON.parse(storage.get(storageKey) ?? '[]');
  let control = activateDemo(html, storage);
  for (const [index, [code, price]] of [['LKG6M', 49000], ['LKG1Y', 89000], ['LKGVV', 100000]].entries()) {
    control('start').send('click');
    control('package').value = code;
    control('username').value = 'invalid user!';
    control('form').send('submit');
    control('confirm').send('click');
    assert.equal(orders().length, index, 'Invalid username must not place an order');

    const username = 'test_user' + index;
    control('username').value = username;
    control('form').send('submit');
    assert.ok(control('summary-text').textContent.includes(price.toLocaleString('vi-VN') + 'đ'));
    assert.ok(control('summary-text').textContent.includes('0đ'));
    assert.equal(orders().length, index, 'Review must not finalize an order');
    control('edit').send('click');
    control('confirm').send('click');
    assert.equal(orders().length, index, 'Editing must cancel the previous confirmation');
    control('form').send('submit');
    control('confirm').send('click');
    control('confirm').send('click');
    assert.equal(orders().length, index + 1, 'Duplicate confirmation must be harmless');
    const saved = orders().find(order => Object.values(order).includes(username));
    assert.ok(saved, 'Expected an order with the submitted username');
    assert.ok(Object.values(saved).includes(code), 'Expected selected package code');
    control = activateDemo(html, storage);
    assert.equal(orders().length, index + 1, 'Reload must preserve test orders');
    assert.ok(control('history').children.some(row => row.textContent.includes('@' + username)));
  }
  // Records from earlier releases did not include status.
  const legacy = orders().map(({ status, ...order }) => order);
  storage.set(storageKey, JSON.stringify(legacy));
  control = activateDemo(html, storage);
  assert.ok(control('history').children.every(row => row.textContent.includes('Hoàn tất mô phỏng')));
  control('start').send('click');
  control('package').value = 'LKG6M';
  control('username').value = 'TryTimeout';
  control('scenario').value = 'timeout';
  control('form').send('submit');
  control('confirm').send('click');
  assert.equal(orders().length, 4);
  assert.equal(orders()[0].status, 'pending');
  assert.ok(control('message').textContent.includes('0đ'));
  control = activateDemo(html, storage);
  assert.ok(control('history').children[0].textContent.includes('Chờ đối soát'));
  control('start').send('click');
  control('package').value = 'LKG6M';
  control('username').value = '@trytimeout';
  control('scenario').value = 'success';
  control('form').send('submit');
  assert.ok(control('message').textContent.includes('Đã chặn'));
  control('confirm').send('click');
  assert.equal(orders().length, 4);
  control('package').value = 'LKG1Y';
  control('form').send('submit');
  control('confirm').send('click');
  assert.equal(orders().length, 5);

  const pendingRecords = Array.from({ length: 50 }, (_, i) => ({
    id: 'TEST-' + i, username: 'user' + i, code: 'LKG6M', status: 'pending',
  }));
  storage.set(storageKey, JSON.stringify(pendingRecords));
  control = activateDemo(html, storage);
  control('start').send('click');
  control('package').value = 'LKG1Y';
  control('username').value = 'nextuser';
  control('form').send('submit');
  assert.ok(control('message').textContent.includes('50 đơn thử chờ'));
  control('confirm').send('click');
  assert.deepEqual(orders(), pendingRecords);

}
console.log('PASS: all package codes, validation, duplicate confirmation, same-tab reload, legacy history, timeout and pending duplicate protection');
