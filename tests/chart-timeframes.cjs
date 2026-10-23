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
const binanceFuturesIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
assert.deepEqual(Object.values(liveBars), binanceFuturesIntervals, 'Binance Futures interval mapping uses supported keys and case');
assert.match(html, /fapi\.binance\.com\/fapi\/v1\/klines/);
assert.match(html, /symbol=\$\{encodeURIComponent\(liveSymbols\[liveMarket\.instrument\]/);
assert.match(html, /interval=\$\{encodeURIComponent\(bar\)/);

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
const context = vm.createContext({ state: { replayMode: false, dataMode: 'sim', liveRows: [], timeframe: '1H' } });
vm.runInContext(['seeded', 'timeframeSeconds', 'barTime', 'buildData'].map(functionSource).join('\n'), context);
for (const timeframe of expected) {
  context.state.timeframe = timeframe;
  const seconds = context.timeframeSeconds(timeframe);
  assert.ok(Number.isFinite(seconds) && seconds > 0, `${timeframe} has a drawing/replay interval`);
  const rows = context.buildData('range', timeframe);
  assert.ok(rows.length >= 24, `${timeframe} supplies a usable simulated chart window`);
  assert.ok(rows.every(row => [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite)));
  for (const scenario of ['up', 'down', 'range']) {
    const series = context.buildData(scenario, timeframe);
    const green = series.filter(row => row.close > row.open).length;
    const red = series.filter(row => row.close < row.open).length;
    const net = series.at(-1).close - series[0].open;
    const span = Math.max(...series.map(row => row.high)) - Math.min(...series.map(row => row.low));
    assert.ok(series.every(row => row.high >= Math.max(row.open, row.close) && row.low <= Math.min(row.open, row.close) && row.volume > 0), `${scenario}/${timeframe} OHLC candles are valid`);
    assert.ok(green > 0 && red > 0, `${scenario}/${timeframe} has both bullish and bearish candles instead of a one-color staircase`);
    assert.equal(JSON.stringify(series), JSON.stringify(context.buildData(scenario, timeframe)), `${scenario}/${timeframe} remains deterministic for repeatable practice`);
    if (scenario === 'up') assert.ok(net > 0, `${timeframe} up practice retains a rising structure`);
    if (scenario === 'down') assert.ok(net < 0, `${timeframe} down practice retains a falling structure`);
    if (scenario === 'range') assert.ok(Math.abs(net) < span * .3, `${timeframe} range practice remains centered rather than trending`);
  }
  const times = rows.slice(0, 3).map((row, index) => context.barTime(row, index));
  assert.ok(times[0] < times[1] && times[1] < times[2], `${timeframe} simulation timestamps increase`);
}
for (const [scenario, wick, field] of [['longUpperWick', 'high', 'open'], ['longLowerWick', 'open', 'low']]) {
  context.state.timeframe = '1H';
  const rows = context.buildData(scenario, '1H'), target = rows.at(-4);
  assert.ok((target[wick] - target[field]) >= 850, `${scenario} keeps its explicitly designed wick after realistic variation is added`);
}
context.state.timeframe = '1H';
const gapRows = context.buildData('gapShock', '1H');
assert.ok(Math.max(...gapRows.slice(1).map((row, i) => Math.abs(row.open - gapRows[i].close))) >= 800, 'gap-shock exercise keeps a visible price gap');
context.state.timeframe = '1W';
assert.equal(new Date(context.barTime({ i: 0 }, 0) * 1000).getUTCDay(), 1, 'simulated weekly candles start on Monday UTC');
context.state.timeframe = '1M';
const monthly = [0, 1, 2].map(i => new Date(context.barTime({ i }, i) * 1000));
assert.deepEqual(monthly.map(date => [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()]),
  [[2025, 0, 1], [2025, 1, 1], [2025, 2, 1]], 'simulated monthly candles follow calendar month boundaries');
assert.equal((context.barTime({ i: 1 }, 1) - context.barTime({ i: 0 }, 0)) / 86400, 31,
  'monthly timestamp spacing reflects the actual month length');
console.log('PASS: 15 live/simulation intervals; deterministic two-sided OHLC trends, centered ranges, designed wicks/gaps, calendar weeks/months, and replay gates.');
