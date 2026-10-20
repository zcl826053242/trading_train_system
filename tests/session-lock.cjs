// 运行：node tests/session-lock.cjs。验证回放草稿跨标签页独占锁的竞争行为。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('    function acquireSessionDraftLock(');
const end = html.indexOf('\n    function currentReplayDataset()', start);
assert.notEqual(start, -1, 'Missing acquireSessionDraftLock');
assert.notEqual(end, -1, 'Cannot find end of acquireSessionDraftLock');
const acquire = vm.runInNewContext(`(() => {
  const sessionDraftKey = 'test-session-draft';
  ${html.slice(start, end)}
  return acquireSessionDraftLock;
})()`);

let held = false;
const manager = {
  request: async (name, options, callback) => {
    assert.equal(name, 'test-session-draft');
    assert.equal(options.ifAvailable, true);
    if (held) return callback(null);
    held = true;
    try { return await callback({ name }); }
    finally { held = false; }
  }
};

(async () => {
  assert.equal(await acquire({}), null, 'Browsers without Web Locks use the existing storage conflict guard');
  assert.equal(await acquire({ request: () => Promise.reject(new Error('lock failure')) }), false, 'Lock errors must fail closed');
  assert.equal(await acquire({ request: () => { throw new Error('lock failure'); } }), false, 'Synchronous lock errors must fail closed');
  assert.equal(await acquire({ request: async (_name, _options, callback) => callback(null) }), false, 'An occupied lock must be reported');
  assert.equal(await acquire({ request: async (_name, _options, callback) => callback({ name: 'test' }) }), true, 'An available lock must be held');

  assert.equal(await acquire(manager), true, 'First page acquires the draft lock');
  assert.equal(await acquire(manager), false, 'Second page cannot acquire the same draft lock');
  console.log('PASS: draft lock serializes tabs, rejects occupied/error states, and exposes unsupported-browser fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
