// 运行：node tests/chart-heikin-ashi.cjs。核验 Heikin Ashi 手算递推与历史前缀隔离。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('    function calculateHeikinAshi(');
assert.notEqual(start, -1, 'Heikin Ashi calculator exists');
const end = html.indexOf('\n    function ', start + 1);
const context = vm.createContext({});
vm.runInContext(html.slice(start, end), context);
const plain = value => JSON.parse(JSON.stringify(value));
const rows = [
  { open: 10, high: 14, low: 8, close: 12, volume: 20 },
  { open: 12, high: 15, low: 10, close: 14, volume: 30 },
  { open: 14, high: 16, low: 11, close: 12, volume: 15 }
];
const values = plain(context.calculateHeikinAshi(rows));
assert.deepEqual(values.map(({ open, high, low, close }) => ({ open, high, low, close })), [
  { open: 11, high: 14, low: 8, close: 11 },
  { open: 11, high: 15, low: 10, close: 12.75 },
  { open: 11.875, high: 16, low: 11, close: 13.25 }
]);
assert.ok(values.every(row => row.heikinAshi === true));
assert.deepEqual(values.map(row => row.volume), rows.map(row => row.volume), 'volume stays attached to raw bars');
assert.deepEqual(plain(context.calculateHeikinAshi([])), []);

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'btc-usdt-1h.json'), 'utf8'));
const history = raw.slice(0, 499).map(row => Array.isArray(row)
  ? { open: +row[1], high: +row[2], low: +row[3], close: +row[4], openTime: +row[0] }
  : row);
const full = plain(context.calculateHeikinAshi(history));
for (const count of [1, 8, 12, 24, 60, 120, 300, history.length]) {
  assert.deepEqual(plain(context.calculateHeikinAshi(history.slice(0, count))), full.slice(0, count),
    `Heikin Ashi prefix of ${count} rows is independent of later candles`);
}
const changedFuture = history.map(row => ({ ...row }));
changedFuture[400] = { ...changedFuture[400], open: changedFuture[400].open * 5, high: changedFuture[400].high * 5, low: changedFuture[400].low * 5, close: changedFuture[400].close * 5 };
assert.deepEqual(plain(context.calculateHeikinAshi(changedFuture.slice(0, 300))), full.slice(0, 300),
  'editing hidden future candles cannot change the revealed Heikin Ashi prefix');

assert.match(html, /data-chart-type="heikin"[^>]*aria-label="Heikin Ashi 平均K线（合成）"/);
assert.match(html, /calculateHeikinAshi\(calculationRows\)/);
assert.match(html, /chartType: \['candles', 'heikin', 'line'\]\.includes\(c\.chartType\) \? c\.chartType : 'candles'/);
assert.match(html, /Heikin Ashi 蜡烛和十字线 OHLC 为合成值/);
console.log('PASS: Heikin Ashi recurrence, volume preservation, 499 historical prefixes, hidden-future isolation, and chart-mode disclosure.');
