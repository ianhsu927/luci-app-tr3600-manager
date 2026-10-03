const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../htdocs/luci-static/resources/view/tr3600-manager/main.js'), 'utf8');

async function check(writable) {
  const nodes = [], changes = [];
  let led = { supported: true, count: 2, lit: 1, disabled: false,
    leds: [{ name: 'red:status' }, { name: 'white:status' }] };
  function E(tag, attrs, children) {
    if (typeof attrs !== 'object' || Array.isArray(attrs)) { children = attrs; attrs = {}; }
    const node = { tag, attrs: attrs || {}, children, textContent: '', listeners: {},
      isConnected: true, addEventListener(event, fn) { this.listeners[event] = fn; },
      replaceChildren(...items) { this.children = items; }, querySelector() { return null; },
      querySelectorAll() { return []; }, setCustomValidity() {}, reportValidity() {} };
    nodes.push(node);
    return node;
  }
  const rpc = { declare(spec) {
    return async (...args) => {
      if (spec.object === 'tr3600.led') {
        if (spec.method === 'set') {
          assert.equal(typeof args[0], 'boolean');
          changes.push(args[0]);
          led = { ...led, disabled: args[0], lit: args[0] ? 0 : 1 };
          return { ok: true };
        }
        return led;
      }
      if (spec.object === 'tr3600.fan') return { supported: false };
      if (spec.object === 'network.interface') return [];
      if (spec.object === 'system') return { model: 'Cudy TR3600 v1' };
      return { boot: {}, filesystems: '' };
    };
  } };
  const view = new Function('view', 'rpc', 'poll', 'E', 'localStorage', 'L', 'document', source)(
    { extend: value => value }, rpc, { add() {}, remove() {} }, E,
    { getItem() { return null; }, setItem() {} }, { hasViewPermission() { return writable; } },
    { hidden: false });
  view.render(await view.load());
  await new Promise(setImmediate);
  const off = nodes.find(n => n.tag === 'button' && n.children === '关闭指示灯');
  const on = nodes.find(n => n.tag === 'button' && n.children === '恢复灯光');
  assert.ok(off && on);
  assert.equal(off.disabled, !writable);
  assert.ok(nodes.some(n => n.textContent.includes('red:status')));
  if (writable) {
    await off.listeners.click();
    assert.ok(nodes.some(n => n.textContent === '指示灯已关闭'));
    assert.equal(on.disabled, false);
    await on.listeners.click();
    assert.ok(nodes.some(n => n.textContent === '指示灯按系统设置运行'));
    assert.deepEqual(changes, [true, false]);
  } else {
    assert.equal(on.disabled, true);
    assert.deepEqual(changes, []);
  }
}
(async () => {
  await check(true);
  await check(false);
  console.log('PASS: manager rendering, live LED names, off/on flow and read-only buttons');
})().catch(err => { console.error(err); process.exitCode = 1; });
