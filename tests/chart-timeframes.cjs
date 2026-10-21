// 运行：node tests/chart-timeframes.cjs。周期映射与合成图数据均使用页面真实函数。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mapping = html.match(/^    const liveBars = (\{[^\r\n]+\});$/m);
assert.ok(mapping, 'live interval mapping exists');
const liveBars = vm.runInNewContext(`(${mapping[1]})`);
const expected = ['1m', '3m', '5m', '15m', '30m', '1H', '2H', '4H', '6H', '8H', '12H', '1D', '3D', '1W', '1M'];
assert.deepEqual(Object.keys(liveBars), expected);
assert.deepEqual(Object.values(liveBars), expected, 'OKX candle bars use matching supported interval keys');

const buttons = [...html.matchAll(/data-time="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(buttons, ['1m', '5m', '15m', '1H', '4H', '1D', '3m', '30m', '2H', '6H', '8H', '12H', '3D', '1W', '1M']);
assert.match(html, /historicalByTimeframe\[timeframe\]\?\.length/);
assert.match(html, /\(c\.replayMode && !\['1m', '5m', '1H'\]\.includes\(c\.timeframe\)\)/,
  'saved blind replay cannot refer to intervals without a Binance historical dataset');

function functionSource(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const body = html.slice(start), end = body.search(/^    }\r?$/m);
  assert.ok(end >= 0, `Missing boundary for ${name}`);
  return body.slice(0, end + 5);
}
const context = vm.createContext({ state: { replayMode: false, dataMode: 'sim', liveRows: [] } });
vm.runInContext(['seeded', 'timeframeSeconds', 'buildData'].map(functionSource).join('\n'), context);
for (const timeframe of expected) {
  const seconds = context.timeframeSeconds(timeframe);
  assert.ok(Number.isFinite(seconds) && seconds > 0, `${timeframe} has a drawing/replay interval`);
  const rows = context.buildData('range', timeframe);
  assert.ok(rows.length >= 24, `${timeframe} supplies a usable simulated chart window`);
  assert.ok(rows.every(row => [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite)));
}
console.log('PASS: 15 live/simulation intervals map cleanly; chart data and timestamp intervals are valid; unavailable replay periods stay gated.');
