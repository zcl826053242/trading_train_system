// 运行：node tests/chart-indicator-presets.cjs。快速预设只改变图表展示，不改变行情数据或训练状态。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = vm.createContext({
  state: {
    show20: false, show60: false, showStructure: false,
    sma: { 5: false, 10: false, 20: false, 60: false, 120: false },
    volumeSma: { 5: false, 10: false, 20: false },
    indicator: { rsi: false, macd: false, bb: false, kdj: false, psar: false },
    timeframe: '1H', revealCount: 25, sessionLength: 60
  },
  document: { querySelectorAll: () => [], getElementById: () => ({ textContent: '' }) },
  localStorage: { setItem(key, value) { writes[key] = JSON.parse(value); } },
  writes: {}, renderChart() { renders++; }, saveIndicatorPreferences() { this.savedIndicators = { ...this.state.indicator }; },
  saveChartOverlayPreferences() {}, syncChartOverlayControls() {}, renders: 0
});
// Bind test spies to the same context object.
vm.runInContext('var writes = {}; var renders = 0;', context);
const source = name => {
  const start = html.search(new RegExp(`^    function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `missing ${name}`);
  const body = html.slice(start), end = body.search(/^    }\r?$/m);
  assert.ok(end >= 0, `missing function boundary ${name}`);
  return body.slice(0, end + 5);
};
const presetStart = html.indexOf('    const chartIndicatorPresets = {');
const presetEnd = html.indexOf('\n    };', presetStart) + '\n    };'.length;
assert.ok(presetStart >= 0 && presetEnd > presetStart, 'preset definitions must be present');
vm.runInContext(html.slice(presetStart, presetEnd), context);
for (const name of ['currentChartIndicatorPreset', 'syncChartIndicatorPresetButtons', 'applyChartIndicatorPreset']) vm.runInContext(source(name), context);
// Test with real persistence/sync fns while keeping chart rendering deterministic.
const persisted = {};
context.localStorage = { setItem: (key, value) => { persisted[key] = JSON.parse(value); } };
context.document = {
  getElementById: id => id === 'chartCoach' ? context.coach : context.controls[id],
  querySelectorAll: selector => selector === '[data-indicator-preset]' ? context.presetButtons
    : selector === '[data-ma]' ? context.maInputs
    : selector === '[data-vol-ma]' ? context.volInputs : []
};
context.coach = { textContent: '' };
context.controls = { ema20: {}, ema60: {}, structure: {} };
context.maInputs = [5, 10, 20, 60, 120].map(period => ({ dataset: { ma: String(period) } }));
context.volInputs = [5, 10, 20].map(period => ({ dataset: { volMa: String(period) } }));
context.presetButtons = ['basic', 'trend', 'momentum'].map(key => ({ dataset: { indicatorPreset: key }, pressed: 'false', setAttribute(name, value) { if (name === 'aria-pressed') this.pressed = value; } }));
context.localStorage.setItem = (key, value) => { persisted[key] = JSON.parse(value); };
vm.runInContext(source('syncChartOverlayControls'), context);
vm.runInContext(source('saveChartOverlayPreferences'), context);
vm.runInContext(source('saveIndicatorPreferences'), context);
vm.runInContext('renderChart = function(){ renders++; };', context);
assert.equal(context.currentChartIndicatorPreset(), 'basic');
assert.equal(context.applyChartIndicatorPreset('unknown'), false);
assert.equal(context.applyChartIndicatorPreset('trend'), true);
assert.equal(context.state.show20, true); assert.equal(context.state.show60, true);
assert.equal(JSON.stringify(context.state.sma), JSON.stringify({ 5: false, 10: false, 20: false, 60: false, 120: false }));
assert.equal(JSON.stringify(context.state.volumeSma), JSON.stringify({ 5: false, 10: false, 20: true }));
assert.equal(context.currentChartIndicatorPreset(), 'trend');
assert.deepEqual(context.presetButtons.map(button => button.pressed), ['false', 'true', 'false']);
assert.equal(persisted['trend-lab-chart-overlays'].show20, true);
assert.equal(JSON.stringify(persisted['trend-lab-chart-indicators']), JSON.stringify(context.state.indicator));
assert.equal(context.coach.textContent.includes('EMA20'), true);
assert.equal(context.renders, 1);
assert.equal(context.applyChartIndicatorPreset('momentum'), true);
assert.equal(context.state.indicator.rsi, true); assert.equal(context.state.indicator.macd, false);
assert.equal(context.currentChartIndicatorPreset(), 'momentum');
assert.equal(context.coach.textContent.includes('RSI'), true);
assert.equal(context.renders, 2);
context.state.indicator.kdj = true;
context.syncChartOverlayControls();
assert.equal(context.currentChartIndicatorPreset(), '');
assert.deepEqual(context.presetButtons.map(button => button.pressed), ['false', 'false', 'false']);
assert.equal(context.state.revealCount, 25); assert.equal(context.state.sessionLength, 60);
console.log('PASS: basic/trend/momentum indicator presets update overlays, subpanels, readouts, coaching, persistence, and active preset state without changing replay progress.');
