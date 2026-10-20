// 运行：node tests/chart-preferences.cjs。刷新后保留用户选择的均线及结构点，损坏偏好回到默认。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let stored = null, writeBlocked = false;
const controls = { ema20: {}, ema60: {}, structure: {} };
const ma = [5, 10, 20, 60, 120].map(period => ({ dataset: { ma: String(period) } }));
const volume = [5, 10, 20].map(period => ({ dataset: { volMa: String(period) } }));
const state = {};
const context = vm.createContext({
  state,
  localStorage: {
    getItem(key) { assert.equal(key, 'trend-lab-chart-overlays'); return stored; },
    setItem(key, value) { assert.equal(key, 'trend-lab-chart-overlays'); if (writeBlocked) throw Error('quota'); stored = value; }
  },
  document: { getElementById: id => controls[id], querySelectorAll: selector => selector === '[data-ma]' ? ma : volume }
});
for (const name of ['loadChartOverlayPreferences', 'saveChartOverlayPreferences', 'syncChartOverlayControls']) {
  const start = html.indexOf(`    function ${name}(`);
  assert.ok(start > 0, name);
  const end = html.indexOf('\n    }', start) + '\n    }'.length;
  vm.runInContext(html.slice(start, end), context);
}
const plain = value => JSON.parse(JSON.stringify(value));
const defaults = {
  show20: false, show60: false, showStructure: false,
  sma: { 5: true, 10: true, 20: true, 60: false, 120: false },
  volumeSma: { 5: true, 10: true, 20: true }
};
for (const raw of [null, '{bad', 'null', '[]', '42', '"bad"']) {
  stored = raw;
  assert.deepEqual(plain(context.loadChartOverlayPreferences()), defaults);
}
stored = JSON.stringify({ show20: true, show60: 'true', sma: { 5: false, 60: true, 120: 1 }, volumeSma: { 20: false } });
assert.deepEqual(plain(context.loadChartOverlayPreferences()), {
  ...defaults, show20: true, sma: { ...defaults.sma, 5: false, 60: true }, volumeSma: { ...defaults.volumeSma, 20: false }
});
Object.assign(state, { ...defaults, show20: true, show60: true, showStructure: true,
  sma: { 5: false, 10: true, 20: false, 60: true, 120: true }, volumeSma: { 5: false, 10: true, 20: false },
  revealCount: 25, position: { size: 1 }
});
context.saveChartOverlayPreferences();
const saved = stored;
const restored = context.loadChartOverlayPreferences();
assert.equal(restored.show20, true); assert.equal(restored.show60, true); assert.equal(restored.showStructure, true);
assert.deepEqual(plain(restored.sma), state.sma);
assert.deepEqual(plain(restored.volumeSma), state.volumeSma);
assert.equal(JSON.parse(stored).revealCount, undefined);
assert.equal(JSON.parse(stored).position, undefined);
context.syncChartOverlayControls();
assert.equal(controls.ema20.checked, true); assert.equal(controls.ema60.checked, true); assert.equal(controls.structure.checked, true);
assert.deepEqual(ma.map(input => input.checked), [false, true, false, true, true]);
assert.deepEqual(volume.map(input => input.checked), [false, true, false]);
writeBlocked = true;
assert.doesNotThrow(() => context.saveChartOverlayPreferences());
assert.equal(stored, saved);
assert.equal(state.revealCount, 25);
console.log('PASS: EMA/SMA/volume/structure preferences round-trip and sync controls; malformed data defaults; storage failure preserves state.');
