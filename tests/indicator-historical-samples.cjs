// 运行：node tests/indicator-historical-samples.cjs。验证 MACD 课程锚点与闭合 Binance 现货快照一致。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'btc-usdt-1h.json'), 'utf8'));
const rows = raw.slice(0, 499).map(row => ({
  openTime: row[0], open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5])
}));
const history = { '1H': rows };
const context = vm.createContext({ historicalReady: true, historicalByTimeframe: history,
  indicatorParamDefaults: { macd: { fast: 12, slow: 26, signal: 9 } } });
function extract(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  return html.slice(start, html.indexOf('\n    function ', start + 1));
}
for (const name of ['ema', 'calcRsi', 'calcMacd', 'indicatorSampleMetrics']) vm.runInContext(extract(name), context);

const cases = [
  { index: 87, time: '2026-09-30T16:00:00.000Z', close: 84349.44, dif: 199.2459169132344, dea: 104.12440702463402, histogram: 95.12150988860037, title: 'macdPositiveCooling' },
  { index: 276, time: '2026-10-08T13:00:00.000Z', close: 82182.01, dif: -401.28543988708407, dea: -388.26315444459414, histogram: -13.022285442489931, title: 'macdBearCrossBelowZero' }
];
for (const sample of cases) {
  const row = rows[sample.index], metrics = context.indicatorSampleMetrics(sample.index, true);
  assert.equal(new Date(row.openTime).toISOString(), sample.time);
  assert.equal(row.close, sample.close);
  assert.equal(metrics.row, row);
  for (const field of ['dif', 'dea', 'histogram']) assert.ok(Math.abs(metrics.macd[field] - sample[field]) < 1e-9, `${sample.title} ${field}`);
  assert.ok(html.includes(`${sample.title}: { index: ${sample.index},`), `${sample.title} catalog entry`);
}
assert.match(html, /MACD\(12,26,9\) DIF \$\{metrics\.macd\.dif\.toFixed\(2\)\}/);
assert.match(html, /button\.dataset\.pinReplayIndicator = 'macd'/);
console.log('PASS: MACD samples match the closed Binance BTCUSDT 1H snapshot and default chart calculation.');
