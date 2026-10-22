// 运行：node tests/trade-storage.cjs。验证平仓记录的持久化失败会显式提示且可恢复。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.search(/^    function persistTradeRecords\(/m);
assert.ok(start >= 0, 'Trade persistence helper must exist');
const body = html.slice(start);
const end = body.search(/^    }\r?$/m);
assert.ok(end >= 0, 'Trade persistence helper must have a top-level boundary');
const source = body.slice(0, end + 5);

for (const storageAvailable of [true, false]) {
  const records = Array.from({ length: 503 }, (_, id) => ({ id }));
  const warning = { hidden: true };
  let written = null;
  const context = vm.createContext({
    sim: { trades: records },
    document: { getElementById: id => id === 'tradeStorageWarning' ? warning : null },
    localStorage: {
      setItem(key, value) {
        assert.equal(key, 'trend-lab-trades');
        if (!storageAvailable) throw new Error('QuotaExceededError');
        written = JSON.parse(value);
      }
    }
  });
  vm.runInContext(source, context);
  assert.equal(context.persistTradeRecords(), storageAvailable);
  if (storageAvailable) {
    assert.equal(written.length, 500, 'Persist only the supported latest trade history');
    assert.equal(written[0].id, 3);
    assert.equal(warning.hidden, true, 'Successful persistence clears a stale warning');
  } else {
    assert.equal(records.length, 503, 'Storage failure must not discard in-memory records');
    assert.equal(warning.hidden, false, 'Storage failure must be visible to the user');
  }
}

assert.match(html, /persistTradeRecords\(\);\s*markStageActivity\('trades'\)/,
  'Closing a position must persist the trade record before advancing stage progress');
assert.match(html, /id="tradeStorageWarning"[^>]*role="status"[^>]*hidden/,
  'The persistence warning must be announced accessibly and start hidden');
console.log('PASS: trade storage success/failure, latest-record cap, memory retention, and accessible recovery warning.');
