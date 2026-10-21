// 运行：node tests/data-source-attribution.cjs。测试行情、历史快照与模拟教学的来源字段映射。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const profiles = html.match(/^    const dataSourceProfiles = (\{[\s\S]*?^    \});/m);
assert.ok(profiles, 'data source profiles exist');
function functionSource(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const body = html.slice(start), end = body.search(/^    }\r?$/m);
  assert.ok(end >= 0, `Missing boundary after ${name}`);
  return body.slice(0, end + 5);
}

const context = vm.createContext({
  state: { replayMode: false, dataMode: 'live', timeframe: '1H' },
  liveMarket: { instrument: 'ETH-USDT-SWAP' },
  liveSymbols: { 'BTC-USDT-SWAP': 'BTCUSDT', 'ETH-USDT-SWAP': 'ETHUSDT', 'SOL-USDT-SWAP': 'SOLUSDT' },
  historicalDatasetInfo: {
    '1H': { source: 'Binance Spot API', intervalMs: 3600000, rowCount: 499, firstOpenTime: 1, lastClosedTime: 3600000 }
  }
});
vm.runInContext(`const dataSourceProfiles = ${profiles[1]};\n${[
  'sourceProfileForMode', 'sourceProfileForSession', 'sourceAttribution'
].map(functionSource).join('\n')}`, context);

const live = context.sourceProfileForMode('live');
assert.equal(live.id, 'binance-usdm-public-swap');
assert.equal(live.marketType, '永续');
assert.equal(live.symbol, 'ETHUSDT', 'live provenance follows the selected contract');
assert.match(context.sourceAttribution(live), /Binance 永续 · ETHUSDT/);

const historical = context.sourceProfileForMode('replay', '1H');
assert.equal(historical.id, 'binance-spot-snapshot');
assert.equal(historical.marketType, '现货');
assert.equal(historical.symbol, 'BTCUSDT');
assert.equal(historical.rowCount, 499);
assert.equal(historical.lastClosedTime, 3600000);

const replaySession = context.sourceProfileForSession({ timeframe: '1H' });
assert.equal(replaySession.id, 'binance-spot-snapshot', 'legacy replay sessions resolve to the known local spot snapshot');
const liveSession = context.sourceProfileForSession({ sourceId: live.id, sourceLabel: live.label, venue: live.venue, marketType: live.marketType, symbol: live.symbol });
assert.equal(liveSession.symbol, 'ETHUSDT');
const teaching = context.sourceProfileForMode('sim');
assert.equal(teaching.id, 'synthetic-teaching');

assert.match(html, /sourceProfileForMode\(state\.dataMode === 'live' \? 'live' : 'sim'\)/,
  'simulated trades retain the chart market source when made from live public data');
assert.match(html, /'legacy-unknown'/, 'legacy CSV rows do not get a fabricated exchange attribution');
assert.match(html, /'模拟交易'/, 'CSV distinguishes the simulated execution from public market data');
assert.doesNotMatch(html, /OKX|okx/, 'obsolete exchange labels are removed from application code');
console.log('PASS: live, spot replay, synthetic and legacy-session provenance remains distinct and traceable.');
