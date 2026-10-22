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

for (const { storageAvailable, sessionAvailable } of [
  { storageAvailable: true, sessionAvailable: true },
  { storageAvailable: false, sessionAvailable: true },
  { storageAvailable: false, sessionAvailable: false }
]) {
  const records = Array.from({ length: 503 }, (_, id) => ({ id }));
  const warning = { hidden: true };
  let written = null;
  let sessionWritten = null;
  let sessionRemoved = false;
  const context = vm.createContext({
    sim: { trades: records },
    tradeSessionBackupKey: 'trend-lab-trades-session-backup',
    document: { getElementById: id => id === 'tradeStorageWarning' ? warning : null },
    localStorage: {
      setItem(key, value) {
        assert.equal(key, 'trend-lab-trades');
        if (!storageAvailable) throw new Error('QuotaExceededError');
        written = JSON.parse(value);
      }
    },
    ...(sessionAvailable ? {
      sessionStorage: {
        setItem(key, value) {
          assert.equal(key, 'trend-lab-trades-session-backup');
          sessionWritten = JSON.parse(value);
        },
        removeItem(key) {
          assert.equal(key, 'trend-lab-trades-session-backup');
          sessionRemoved = true;
        }
      }
    } : {})
  });
  vm.runInContext(source, context);
  assert.equal(context.persistTradeRecords(), storageAvailable);
  if (storageAvailable) {
    assert.equal(written.length, 500, 'Persist only the supported latest trade history');
    assert.equal(written[0].id, 3);
    assert.equal(warning.hidden, true, 'Successful persistence clears a stale warning');
    assert.equal(sessionRemoved, true, 'Successful persistence clears the same-tab backup');
  } else {
    assert.equal(records.length, 503, 'Storage failure must not discard in-memory records');
    assert.equal(warning.hidden, false, 'Storage failure must be visible to the user');
    if (sessionAvailable) {
      assert.equal(sessionWritten.length, 500, 'Keep the latest 500 records in the same-tab backup');
      assert.equal(sessionWritten[0].id, 3);
      assert.match(warning.textContent, /当前标签页并可在刷新后恢复/);
    } else {
      assert.equal(sessionWritten, null, 'Do not claim a backup when session storage is unavailable');
      assert.match(warning.textContent, /刷新前请到训练复盘导出交易 CSV/);
    }
  }
}

const journalStart = html.search(/^    const tradeJournal = \(\(\) => \{/m);
assert.ok(journalStart >= 0, 'Trade journal loader must exist');
const journalBody = html.slice(journalStart);
const journalEndMatch = journalBody.match(/^    \}\)\(\);?\r?$/m);
assert.ok(journalEndMatch, 'Trade journal loader must have a top-level boundary');
const journalSource = journalBody.slice(0, journalEndMatch.index + journalEndMatch[0].length);
function loadJournal(localRows, sessionRows) {
  const context = vm.createContext({
    tradeSessionBackupKey: 'trend-lab-trades-session-backup',
    tradeJournalRestoredFromSession: false,
    localStorage: { getItem: key => key === 'trend-lab-trades' && localRows !== null ? JSON.stringify(localRows) : null },
    sessionStorage: { getItem: key => key === 'trend-lab-trades-session-backup' && sessionRows !== null ? JSON.stringify(sessionRows) : null }
  });
  vm.runInContext(`${journalSource}\nglobalThis.__result = { trades: tradeJournal, restored: tradeJournalRestoredFromSession };`, context);
  return JSON.parse(JSON.stringify(context.__result));
}
const row = (id, createdAt) => ({ id, createdAt });
const oldRows = [row('old-1', '2026-10-22T12:00:00.000Z')];
const newerRows = [...oldRows, row('new-2', '2026-10-23T12:00:00.000Z')];
assert.deepEqual(loadJournal(oldRows, newerRows), { trades: newerRows, restored: true },
  'A session backup containing newer closed trades must supersede an older local journal');
assert.deepEqual(loadJournal(newerRows, oldRows), { trades: newerRows, restored: false },
  'A stale session backup must not overwrite a newer local journal');
assert.deepEqual(loadJournal(null, oldRows), { trades: oldRows, restored: true },
  'A session backup must recover when local storage has no trade journal');

assert.match(html, /persistTradeRecords\(\);\s*markStageActivity\('trades'\)/,
  'Closing a position must persist the trade record before advancing stage progress');
assert.match(html, /id="tradeStorageWarning"[^>]*role="status"[^>]*hidden/,
  'The persistence warning must be announced accessibly and start hidden');
assert.match(html, /sessionIsNewer[\s\S]*tradeJournalRestoredFromSession = true/,
  'Startup must compare a session backup with local records before choosing the recovery source');
console.log('PASS: trade storage success/failure, same-tab backup, fallback warning, latest-record cap, memory retention, and accessible recovery.');
