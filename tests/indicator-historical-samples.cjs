// 运行：node tests/indicator-historical-samples.cjs。验证指标课程锚点与闭合 Binance 现货快照一致。
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
const context = vm.createContext({ historicalReady: true, historicalByTimeframe: history, historicalRows: rows,
  state: { replayMode: false, timeframe: '1H', sessionStart: 0, sessionLength: 60 },
  indicatorParamDefaults: {
    macd: { fast: 12, slow: 26, signal: 9 }, bb: { period: 20, multiplier: 2 }, kdj: { period: 9, k: 3, d: 3 }, psar: { step: .02, max: .2 }
  } });
function extract(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  return html.slice(start, html.indexOf('\n    function ', start + 1));
}
for (const name of ['ema', 'calcRsi', 'calcMacd', 'calcBollinger', 'calcKdj', 'calcParabolicSar', 'timeframeSeconds', 'barTime', 'indicatorSampleMetrics', 'indicatorCalculationContext']) vm.runInContext(extract(name), context);

const cases = [
  { indicator: 'macd', index: 87, time: '2026-09-30T16:00:00.000Z', close: 84349.44, values: { dif: 199.2459169132344, dea: 104.12440702463402, histogram: 95.12150988860037 }, title: 'macdPositiveCooling' },
  { indicator: 'macd', index: 276, time: '2026-10-08T13:00:00.000Z', close: 82182.01, values: { dif: -401.28543988708407, dea: -388.26315444459414, histogram: -13.022285442489931 }, title: 'macdBearCrossBelowZero' },
  { indicator: 'bb', index: 174, time: '2026-10-04T07:00:00.000Z', close: 85106, values: { upper: 85057.66749970253, middle: 84862.28300000001, lower: 84666.8985002975, bandWidth: 0.004604742950469888 }, title: 'bollSqueezeExpansion' },
  { indicator: 'kdj', index: 242, time: '2026-10-07T03:00:00.000Z', close: 84150.39, values: { k: 18.907641908186704, d: 18.203287731595843, j: 20.316350261368427 }, title: 'kdjOversoldDowntrend' },
  { indicator: 'psar', index: 255, time: '2026-10-07T16:00:00.000Z', close: 83386.09, values: { value: 82787.25, rising: true }, title: 'sarCountertrendFlip' },
  { indicator: 'psar', index: 265, time: '2026-10-08T02:00:00.000Z', close: 83168.01, values: { value: 83681.91, rising: false }, title: 'sarTrendResumption' }
];
for (const sample of cases) {
  const row = rows[sample.index], metrics = context.indicatorSampleMetrics(sample.index, sample.indicator);
  assert.equal(new Date(row.openTime).toISOString(), sample.time);
  assert.equal(row.close, sample.close);
  assert.equal(metrics.row, row);
  for (const [field, expected] of Object.entries(sample.values)) {
    const actual = sample.indicator === 'macd' ? metrics.macd[field] : sample.indicator === 'bb' ? field === 'bandWidth' ? metrics.bandWidth : metrics.bollinger[field === 'middle' ? 'mid' : field] : sample.indicator === 'kdj' ? metrics.kdj[field] : metrics.psar[field];
    assert.ok(Math.abs(actual - expected) < 1e-8, `${sample.title} ${field}: ${actual} != ${expected}`);
  }
  assert.ok(html.includes(`${sample.title}: { index: ${sample.index},`), `${sample.title} catalog entry`);
}
assert.match(html, /MACD\(12,26,9\) DIF \$\{metrics\.macd\.dif\.toFixed\(2\)\}/);
assert.match(html, /BOLL\(20,2\) 上轨 \$\{metrics\.bollinger\.upper\.toFixed\(2\)\}/);
assert.match(html, /SAR\(0\.02,0\.2\) \$\{metrics\.psar\.value\.toFixed\(2\)\}/);
assert.match(html, /button\.dataset\.pinReplayIndicator = item\.action/);
const triangle = rows[83];
assert.equal(new Date(triangle.openTime).toISOString(), '2026-09-30T12:00:00.000Z');
assert.deepEqual([triangle.open, triangle.high, triangle.low, triangle.close], [83915.17, 85514, 83768, 85290.32]);
assert.match(html, /id: 'triangle-pattern',[^\n]+sampleIds: \['triangleCompressionBreakout'\]/);
assert.match(html, /triangleCompressionBreakout: \{ index: 83,[^\n]+人工选取的触点/);
assert.match(html, /形态标签不是自动识别或方向保证/);
context.state.replayMode = true;
context.state.sessionStart = 64;
const visible = rows.slice(64, 88);
const calculation = context.indicatorCalculationContext(visible);
assert.equal(calculation.offset, 64);
assert.equal(calculation.rows.length, 88, 'indicator warmup must stop at the last revealed row');
assert.equal(calculation.rows.at(-1).close, rows[87].close);
console.log('PASS: MACD/BOLL/KDJ/SAR samples match the closed snapshot; replay indicator warmup stops at the reveal boundary.');
