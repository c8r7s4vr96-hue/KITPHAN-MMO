// Run the shipped Preview client against a local DOM and a simulated authenticated transport.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

class Element {
  constructor() {
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.children = [];
    this.handlers = {};
  }
  addEventListener(event, handler) { this.handlers[event] = handler; }
  fire(event) { return this.handlers[event]({ target: this, preventDefault() {} }); }
  replaceChildren(...children) { this.children = children; this.textContent = ''; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  focus() {}
  reset() {}
}

function createClient(html, storage, transport, initialUid) {
  const elements = new Map();
  const callbacks = [];
  function getElementById(id) {
    assert.ok(html.includes('id="' + id + '"'), 'Missing control: ' + id);
    if (!elements.has(id)) {
      const node = new Element();
      const tag = html.match(new RegExp('<[^>]+id="' + id + '"[^>]*>'))[0];
      node.hidden = /\bhidden\b/.test(tag);
      elements.set(id, node);
    }
    return elements.get(id);
  }
  const auth = {
    currentUser: null,
    onAuthStateChanged(callback) { callbacks.push(callback); },
  };
  function setUser(uid) {
    auth.currentUser = uid ? { uid, getIdToken: async () => 'mock-' + uid } : null;
    return Promise.all(callbacks.map(cb => cb(auth.currentUser)));
  }
  setUser(initialUid);
  const context = {
    auth, crypto: { randomUUID }, AbortController, setTimeout, clearTimeout,
    fetch: transport,
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, val) => storage.set(key, String(val)),
      removeItem: key => storage.delete(key),
    },
    document: { getElementById, createElement: () => new Element() },
  };
  context.window = context;
  const script = html.match(/<script[^>]*id="locket-preview-script"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(script, 'Preview client absent');
  vm.runInNewContext(script[1], context);
  return {
    load: () => context.loadLocketPreview(),
    element: name => getElementById('locket-preview-' + name),
    setUser,
  };
}

function reply(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

async function checkClient(html) {
  const storage = new Map();
  const writes = [];
  const readUsers = [];
  const rows = { alice: [], bob: [] };
  let onProduction = false;
  let connectionLost = true;
  function transport(url, init = {}) {
    assert.equal(url, '/api/shop-orders?action=locket_preview');
    const token = init.headers.Authorization;
    assert.match(token, /^Bearer mock-(alice|bob)$/);
    const uid = token.slice('Bearer mock-'.length);
    if ((init.method || 'GET') === 'GET') {
      readUsers.push(uid);
      return Promise.resolve(onProduction ? reply(404, {}) : reply(200, {ok:true, orders:rows[uid]}));
    }
    assert.equal(init.method, 'POST');
    assert.equal(onProduction, false);
    const body = JSON.parse(init.body);
    writes.push(body);
    if (body.username === 'pending_user') {
      return Promise.resolve(reply(409, {ok:false, error:'PENDING_EXISTS'}));
    }
    if (connectionLost) {
      connectionLost = false;
      return Promise.reject(new Error('Simulated lost connection'));
    }
    if (!rows[uid].some(row => row.id === body.requestId)) {
      rows[uid].push({ id:body.requestId, code:body.code, username:body.username,
        status:'completed', priceVnd:89000, chargedVnd:0, createdAt:Date.now() });
    }
    return Promise.resolve(reply(200, {ok:true, orders:rows[uid]}));
  }

  let client = createClient(html, storage, transport, 'alice');
  await client.load();
  await settle();
  assert.deepEqual(readUsers, ['alice'], 'Preview reads personal history on opening');
  assert.equal(client.element('panel').hidden, false);
  client.element('username').value = 'example_user';
  client.element('code').value = 'LKG1Y';
  client.element('scenario').value = 'success';
  await client.element('form').fire('submit');
  await settle();
  assert.equal(writes.length, 1);
  assert.ok(writes[0].requestId);
  assert.equal(writes[0].username, 'example_user');
  assert.equal(writes[0].code, 'LKG1Y');

  // A reload must retain the original intent after an ambiguous server response.
  client = createClient(html, storage, transport, 'alice');
  await client.load();
  await settle();
  await client.element('form').fire('submit');
  await settle();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1], 'Retry reused the original key and payload');
  assert.equal(rows.alice.length, 1);
  assert.match(client.element('orders').children.map(el => el.textContent).join(' '), /example_user/);
  client.element('username').value = 'pending_user';
  client.element('code').value = 'LKG1Y';
  client.element('scenario').value = 'success';
  await client.element('form').fire('submit');
  assert.equal(writes.length, 3);
  assert.equal(storage.has('kitphan.locket.preview.intent.v1.alice'), false);
  assert.equal(client.element('username').disabled, false, 'Definitive conflict unlocks form');
  client.element('username').value = 'different_user';
  await client.element('form').fire('submit');
  assert.equal(writes.length, 4);
  assert.notEqual(writes[2].requestId, writes[3].requestId);
  assert.equal(rows.alice.length, 2);
  await client.setUser('bob');
  await settle();
  assert.equal(readUsers.at(-1), 'bob');
  assert.doesNotMatch(client.element('orders').children.map(el => el.textContent).join(' '), /example_user/);
  await client.setUser(null);
  await settle();
  assert.equal(client.element('panel').hidden, true);

  onProduction = true;
  const production = createClient(html, storage, transport, 'alice');
  await production.load();
  await settle();
  assert.equal(production.element('panel').hidden, true, '404 suppresses the Preview form');
  assert.equal(writes.length, 4);
}

(async () => {
  for (const file of ['index.html', 'public/index.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    await checkClient(html);
  }
  console.log('PASS: Preview auth/history, ambiguous retry after reload, definitive 409 recovery, UID isolation and 404 hide');
})().catch(error => { console.error(error); process.exitCode = 1; });
