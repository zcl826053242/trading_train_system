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
  { indicator: 'rsi', index: 431, time: '2026-10-15T00:00:00.000Z', close: 81656.01, values: { rsi: 33.33138467629682 }, title: 'rsiBullishDivergenceCandidate' },
  { indicator: 'psar', index: 255, time: '2026-10-07T16:00:00.000Z', close: 83386.09, values: { value: 82787.25, rising: true }, title: 'sarCountertrendFlip' },
  { indicator: 'psar', index: 265, time: '2026-10-08T02:00:00.000Z', close: 83168.01, values: { value: 83681.91, rising: false }, title: 'sarTrendResumption' }
];
for (const sample of cases) {
  const row = rows[sample.index], metrics = context.indicatorSampleMetrics(sample.index, sample.indicator);
  assert.equal(new Date(row.openTime).toISOString(), sample.time);
  assert.equal(row.close, sample.close);
  assert.equal(metrics.row, row);
  for (const [field, expected] of Object.entries(sample.values)) {
    const actual = sample.indicator === 'macd' ? metrics.macd[field] : sample.indicator === 'bb' ? field === 'bandWidth' ? metrics.bandWidth : metrics.bollinger[field === 'middle' ? 'mid' : field] : sample.indicator === 'kdj' ? metrics.kdj[field] : sample.indicator === 'psar' ? metrics.psar[field] : metrics.rsi;
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
const upperWick = rows[113], lowerWick = rows[138];
assert.equal(new Date(upperWick.openTime).toISOString(), '2026-10-01T18:00:00.000Z');
assert.deepEqual([upperWick.open, upperWick.high, upperWick.low, upperWick.close], [84908, 85273.65, 84671.01, 84802.02]);
assert.ok(Math.abs((upperWick.high - Math.max(upperWick.open, upperWick.close)) - 365.65) < 1e-8);
assert.ok(Math.abs(Math.abs(upperWick.close - upperWick.open) - 105.98) < 1e-8);
assert.equal(new Date(lowerWick.openTime).toISOString(), '2026-10-02T19:00:00.000Z');
assert.deepEqual([lowerWick.open, lowerWick.high, lowerWick.low, lowerWick.close], [84262.01, 84354.57, 83975.58, 84315.28]);
assert.ok(Math.abs((Math.min(lowerWick.open, lowerWick.close) - lowerWick.low) - 286.43) < 1e-8);
assert.ok(Math.abs(Math.abs(lowerWick.close - lowerWick.open) - 53.27) < 1e-8);
assert.match(html, /id: 'candles',[^\n]+sampleIds: \['upperWickAtPriorHigh', 'lowerWickNearRangeLow'\]/);
assert.match(html, /upperWickAtPriorHigh: \{ index: 113,[^\n]+不能单凭此K线做方向判断/);
assert.match(html, /lowerWickNearRangeLow: \{ index: 138,[^\n]+不能单凭此K线做方向判断/);
const catalogStart = html.indexOf('    const indicatorHistoricalSampleCatalog = ');
vm.runInContext(html.slice(catalogStart, html.indexOf('\n    const indicatorCategoryLabels', catalogStart)).replace('const indicatorHistoricalSampleCatalog', 'var sampleCatalog'), context);
for (const [id, anchor, first, neck, second, field, neckField, prices] of [
  ['doubleBottomNecklineBreak', 81, 63, 70, 78, 'low', 'high', [82900, 83849, 82956.11, 83918.01]],
  ['doubleTopNecklineBreak', 276, 255, 267, 270, 'high', 'low', [83681.91, 82227.56, 83283.28, 82182.01]]
]) {
  const entry = context.sampleCatalog[id];
  assert.equal(entry.index, anchor);
  assert.deepEqual([rows[first][field], rows[neck][neckField], rows[second][field], rows[anchor].close], prices);
  assert.ok(first < neck && neck < second && second + 3 <= anchor, `${id}: selected turns are confirmable before the anchor`);
  assert.ok(first >= anchor - 23 && second <= anchor, `${id}: all manual points are visible in the initial window`);
  assert.equal(rows[anchor].close > rows[neck][neckField], field === 'low');
  assert.ok(context.indicatorSampleMetrics(anchor), `${id}: sample has enough warmup`);
  assert.deepEqual(JSON.parse(JSON.stringify(entry.annotations)), [{ index: first, field, label: 'A' }, { index: neck, field: neckField, label: 'N' }, { index: second, field, label: 'B' }]);
  assert.match(entry.prompt, /不代表自动识别或反转保证/);
}
const divergence = context.sampleCatalog.rsiBullishDivergenceCandidate;
const divergenceA = context.indicatorSampleMetrics(422), divergenceB = context.indicatorSampleMetrics(431), divergenceEnd = context.indicatorSampleMetrics(431);
assert.equal(divergence.index, 431);
assert.deepEqual([rows[422].low, rows[431].low, rows[439].low, rows[431].close], [81588.88, 81398.37, 81180.59, 81656.01]);
assert.ok(rows[422].low < rows[421].low && rows[422].low <= rows[423].low);
assert.ok(rows[431].low < rows[430].low && rows[431].low <= rows[432].low);
assert.ok(Math.abs((rows[431].low / rows[422].low - 1) * 100 + 0.2335) < 0.001);
assert.ok(Math.abs(divergenceA.rsi - 26.114658632535054) < 1e-8);
assert.ok(Math.abs(divergenceB.rsi - 33.33138467629682) < 1e-8);
assert.ok(divergenceB.rsi > divergenceA.rsi);
assert.ok(Math.abs(divergenceB.rsi - divergenceA.rsi - 7.216726043761766) < 1e-8);
assert.ok(rows[439].low < rows[431].low && divergenceEnd.row === rows[431]);
assert.deepEqual(JSON.parse(JSON.stringify(divergence.annotations)), [{ index: 422, field: 'low', label: 'A' }, { index: 431, field: 'low', label: 'B' }]);
assert.match(divergence.prompt, /不保证反转/);
assert.doesNotMatch(divergence.prompt, /81180\.59|81380\.29/);
context.el = (tag, attributes, text) => ({ tag, attributes, text, children: [], append(...nodes) { this.children.push(...nodes); } });
vm.runInContext(extract('renderIndicatorSampleChart'), context);
const sampleEntry = context.sampleCatalog.doubleBottomNecklineBreak;
const originalChart = context.renderIndicatorSampleChart(rows, 81, sampleEntry.annotations);
const modifiedFuture = rows.map((row, i) => i > 81 ? { ...row, high: 999999, low: 1, close: 999999 } : row);
assert.equal(JSON.stringify(context.renderIndicatorSampleChart(modifiedFuture, 81, sampleEntry.annotations)), JSON.stringify(originalChart), 'preview must not change when future rows change');
const extraFuturePoint = [...sampleEntry.annotations, { index: 82, field: 'high', label: 'future' }];
assert.equal(JSON.stringify(context.renderIndicatorSampleChart(rows, 81, extraFuturePoint)), JSON.stringify(originalChart), 'preview must ignore future manual points');
context.state.replayMode = true;
context.state.sessionStart = 64;
const visible = rows.slice(64, 88);
const calculation = context.indicatorCalculationContext(visible);
assert.equal(calculation.offset, 64);
assert.equal(calculation.rows.length, 88, 'indicator warmup must stop at the last revealed row');
assert.equal(calculation.rows.at(-1).close, rows[87].close);
console.log('PASS: indicator, candle-pattern, and RSI divergence anchors match closed Binance spot data; manual points stay in-window and replay warmup stops at the reveal boundary.');
