// 运行：node tests/chart-indicators.cjs。直接测试页面使用的计算函数，无第三方依赖。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fromPage(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = html.indexOf('\n    function ', start + 1);
  return new Function(`return (${html.slice(start, end).trim()});`)();
}
const sar = fromPage('calcParabolicSar');
const rsi = fromPage('calcRsi');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const rows = [[10, 8], [11, 9], [12, 10], [13, 11], [12, 10], [9, 7], [8, 6], [10, 8], [14, 12], [15, 13]]
  .map(([high, low]) => ({ high, low, open: low + .5, close: high - .5 }));
// 手工递推：第 6 根由涨转跌回到前趋势极高 13，第 9 根由跌转涨回到极低 6。
const expected = [null, 8, 8, 8.8, 9.64, 13, 12.4, 11.12, 6, 6.8];
const values = sar(rows, .1, .2);
expected.forEach((value, i) => value === null ? assert.equal(values[i], null) : near(values[i].value, value));
assert.deepEqual(values.slice(1).map(item => item.rising), [true, true, true, true, false, false, false, true, true]);
// 价格镜像后，SAR 值与方向必须镜像，覆盖相反初始方向和两次反转。
const mirrored = rows.map(row => ({ high: 30 - row.low, low: 30 - row.high, open: 30 - row.open, close: 30 - row.close }));
sar(mirrored, .1, .2).forEach((item, i) => {
  if (!item) return;
  near(item.value, 30 - expected[i]);
  assert.equal(item.rising, !values[i].rising);
});
assert.deepEqual(sar([]), []);
assert.deepEqual(sar(rows.slice(0, 1)), [null]);
const flat = Array.from({ length: 30 }, () => ({ open: 5, high: 5, low: 5, close: 5 }));
assert.ok(sar(flat).slice(1).every(item => item.value === 5));
const ascending = Array.from({ length: 80 }, (_, i) => ({ high: 10 + i, low: 8 + i, close: 9 + i }));
const capped = sar(ascending, .02, .04);
for (let i = 4; i < ascending.length; i++) {
  // 新高持续出现，此时 AF 应保持上限 .04；前两根低点不会限制递推值。
  near(capped[i].value, capped[i - 1].value + .04 * (ascending[i - 1].high - capped[i - 1].value));
}
assert.notEqual(capped.at(-1).value, sar(ascending, .02, .2).at(-1).value);
// 真实历史前缀与完整计算逐位一致，后来揭示的 K 线不能回写过去点位。
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'btc-usdt-1h.json'), 'utf8'));
const history = raw.slice(0, 499).map(row => Array.isArray(row)
  ? { open: +row[1], high: +row[2], low: +row[3], close: +row[4] } : row);
const all = sar(history);
assert.equal(all.length, 499);
assert.ok(all.slice(1).every(item => Number.isFinite(item.value)));
for (let count = 0; count <= history.length; count++) assert.deepEqual(sar(history.slice(0, count)), all.slice(0, count));
assert.deepEqual(rsi([1, 2, 3], 3), [null, null, null]);
assert.equal(rsi([1, 2, 3, 4], 3)[3].value, 100);
assert.equal(rsi([4, 3, 2, 1], 3)[3].value, 0);
assert.equal(rsi([2, 2, 2, 2], 3)[3].value, 50);
// 手算 Wilder RSI：初始平均涨幅 2/3、跌幅 1/3；下一根 +2 后为 10/9、2/9。
const wilder = rsi([1, 2, 3, 2, 4], 3);
near(wilder[3].value, 100 - 100 / 3);
near(wilder[4].value, 100 - 100 / 6);
console.log('PASS: SAR expected values, mirrored reversals, AF cap, edge cases, 500 historical prefixes; RSI warm-up and Wilder values.');
