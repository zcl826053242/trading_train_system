// 运行：node tests/chart-keyboard.cjs。逐根检查不能揭示未来，也不能接管表单或绘图的按键。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const status = { textContent: '' };
const chartInspection = { rows: [], first: 0, last: -1, index: null, active: false, show: null, clear: null };
const state = { tool: 'cursor', revealCount: 25 };
let modal = false, restored = 0;
const inspected = [];
const context = vm.createContext({
  chartInspection, state,
  document: {
    getElementById: id => id === 'chartInspectionStatus' ? status : { textContent: id },
    querySelector: () => modal
  }
});
for (const name of ['configureChartInspection', 'clearChartInspection', 'inspectChartWithKeyboard']) {
  const start = html.indexOf(`    function ${name}(`);
  assert.ok(start > 0, name);
  // The final function is followed by event registration; stop at its own closing brace.
  const end = html.indexOf('\n    }', start) + '\n    }'.length;
  vm.runInContext(html.slice(start, end), context);
}
const rows = Object.freeze(Array.from({ length: 25 }, (_, i) => Object.freeze({ close: i })));
context.configureChartInspection(rows, 0, 24, i => inspected.push(i), () => restored++);
function press(key, target = 'chart', options = {}) {
  const event = { key, target: { id: target }, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...options };
  context.inspectChartWithKeyboard(event);
  return event;
}
press('ArrowLeft'); assert.equal(chartInspection.index, 23);
press('Home'); press('ArrowLeft'); assert.equal(chartInspection.index, 0);
press('End'); for (let i = 0; i < 30; i++) press('ArrowRight');
assert.equal(chartInspection.index, 24);
assert.equal(state.revealCount, 25);
assert.ok(inspected.every(i => i >= 0 && i < 25));
const count = inspected.length;
press('Home', 'chartOhlc'); press('Home', 'chart', { ctrlKey: true });
modal = true; press('Home'); modal = false;
state.tool = 'anyWaves'; press('Home'); state.tool = 'cursor';
assert.equal(inspected.length, count);
assert.equal(press('Escape').prevented, true);
assert.equal(restored, 1); assert.equal(chartInspection.index, null); assert.equal(status.textContent, '');
// 降级图缩放后只允许查看其窗口，不能误取裁切前后数据。
context.configureChartInspection(rows, 8, 20, i => inspected.push(i), () => restored++);
press('Home'); press('ArrowLeft'); assert.equal(chartInspection.index, 8);
press('End'); press('ArrowRight'); assert.equal(chartInspection.index, 20);
context.clearChartInspection(); assert.equal(restored, 2);
console.log('PASS: keyboard inspection respects revealed/window bounds, restores readouts and leaves forms, dialogs and drawing tools alone.');
