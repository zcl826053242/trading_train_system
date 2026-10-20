// 运行：node tests/chart-axis-controls.cjs。主图坐标变换不得污染成交量及振荡指标。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scales = Array.from({ length: 5 }, () => ({ mode: 0, invertScale: false, autoScale: true }));
const globalOptions = [];
const state = { chartDisplay: { grid: true, priceScaleMode: 'normal', invertScale: false, candleStyle: 'solid', lastPrice: true } };
const series = () => ({ applyOptions() {} });
let synced = 0;
const context = vm.createContext({
  state,
  window: { LightweightCharts: { PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2, IndexedTo100: 3 } } },
  proChart: {
    chart: { applyOptions(options) { globalOptions.push(options); }, panes: () => scales.map(scale => ({ priceScale: () => ({ applyOptions: options => Object.assign(scale, options) }) })) },
    candles: series(), line: series(), ema20: series(), ema60: series(), psarSeries: series(),
    smaSeries: {}, volumeSmaSeries: {}, indicators: {}
  },
  syncChartAxisControls() { synced++; }
});
const start = html.indexOf('    function applyChartDisplaySettings(');
assert.ok(start > 0);
vm.runInContext(html.slice(start, html.indexOf('\n    function ', start + 1)), context);
for (const [mode, expected] of [['percentage', 2], ['logarithmic', 1], ['indexed', 3], ['normal', 0]]) {
  state.chartDisplay.priceScaleMode = mode;
  state.chartDisplay.invertScale = true;
  scales[0].autoScale = false;
  context.applyChartDisplaySettings();
  assert.equal(scales[0].mode, expected);
  assert.equal(scales[0].invertScale, true);
  assert.equal(scales[0].autoScale, false, '显示设置不能重置手动缩放');
  assert.deepEqual(scales.slice(1), Array.from({ length: 4 }, () => ({ mode: 0, invertScale: false, autoScale: true })));
}
assert.equal(synced, 4);
assert.ok(globalOptions.every(options => !Object.hasOwn(options, 'rightPriceScale')));
console.log('PASS: price transforms affect only the main pane; volume/oscillators and manual scaling remain independent.');
