// 运行：node tests/live-market.cjs。使用页面真实函数验证请求切换、晚到响应和失败恢复。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function source(name) {
  const pattern = new RegExp(`^    (?:async )?function ${name}\\(`, 'm');
  const start = html.search(pattern);
  assert.notEqual(start, -1, `Missing ${name}`);
  const remaining = html.slice(start + 1);
  const next = remaining.search(/^    (?:async )?function /m);
  assert.notEqual(next, -1, `Missing boundary after ${name}`);
  return html.slice(start, start + 1 + next);
}
const payload = close => Array.from({ length: 8 }, (_, i) => [
  String(1700000000000 + i * 60000), String(close - 1), String(close + 2), String(close - 2), String(close), '12', String(1700000059999 + i * 60000), '100', '1', '1', '1', '0'
]);
function dataHarness() {
  const context = vm.createContext({
    state: { dataMode: 'live', replayMode: false, liveRows: [], scenario: 'up' },
    historicalRows: [], getHistoricalReplay: () => [{ open: 1, high: 2, low: 0, close: 1, volume: 1 }], seeded: () => .5
  });
  vm.runInContext(source('buildData'), context);
  return context;
}
function harness() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { hidden: true, textContent: '', classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) } });
    }
    return elements.get(id);
  };
  const requests = [], timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    state: { dataMode: 'live', replayMode: false, timeframe: '1H', liveRows: [], liveLoading: false, liveError: '', liveUpdatedAt: 0 },
    liveMarket: { endpoint: 'https://example.test/candles', instrument: 'BTC-USDT-SWAP', source: 'test fixture' },
    liveSymbols: { 'BTC-USDT-SWAP': 'BTCUSDT', 'ETH-USDT-SWAP': 'ETHUSDT', 'SOL-USDT-SWAP': 'SOLUSDT' },
    liveBars: { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1H': '1h', '2H': '2h', '4H': '4h', '6H': '6h', '8H': '8h', '12H': '12h', '1D': '1d', '3D': '3d', '1W': '1w', '1M': '1M' }, liveRequestId: 0, liveRequestController: null, liveRefreshTimer: null,
    AbortController, encodeURIComponent, Date,
    document: { getElementById: get },
    setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id), clearInterval: () => {},
    updateDataSourceUI: () => {}, updateMarketPerformance: () => {}, updateSimDisplay: () => {}, renderChart: () => {},
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, signal: options.signal,
      ok: close => resolve({ ok: true, json: async () => payload(close) }),
      fail: message => reject(new Error(message)),
      http: status => resolve({ ok: false, status }),
      insufficient: () => resolve({ ok: true, json: async () => [] }),
      // 部分场景故意允许取消后仍返回，验证请求序号保护而不只依赖 fetch 的取消行为。
      respectAbort: () => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
  });
  vm.runInContext(['parseLiveCandles', 'stopLiveMarket', 'loadLiveMarket'].map(source).join('\n'), context);
  return { context, requests, timers, get };
}
(async () => {
  // Binance Futures Kline rows require a valid close-time and reject the still-open candle.
  {
    const context = vm.createContext({ Date });
    vm.runInContext(source('parseLiveCandles'), context);
    const now = Date.now(), closed = [now - 120000, '10', '12', '9', '11', '3', now - 60001];
    const forming = [now - 60000, '11', '13', '10', '12', '4', now + 1000];
    const invalid = [now - 180000, '10', '9', '11', '10', '1', now - 120001];
    assert.deepEqual(Array.from(context.parseLiveCandles([forming, invalid, closed]), row => row.openTime), [now - 120000]);
    assert.throws(() => context.parseLiveCandles({ code: '0', data: [closed] }), /Binance Futures K 线返回格式异常/);
  }
  // 无实盘行情不可回退成模拟样本；模拟模式和有效回放仍各自返回本模式的数据。
  {
    const c = dataHarness();
    assert.equal(c.buildData('up', '1H').length, 0);
    c.state.dataMode = 'sim';
    assert.ok(c.buildData('up', '1H').length > 0);
    c.state.dataMode = 'live';
    c.state.liveRows = [{ open: 90, high: 92, low: 89, close: 91, volume: 2 }];
    assert.equal(c.buildData('up', '1H')[0].close, 91);
    c.state.replayMode = true;
    c.state.liveRows = [];
    c.historicalRows = [{ open: 1, high: 2, low: 0, close: 1, volume: 1 }];
    assert.equal(c.buildData('up', '1H')[0].close, 1);
  }
  // 快速切周期：旧请求的成功和失败都不能覆盖新周期，旧 finally 不能清掉新 loading。
  for (const outcome of ['ok', 'fail']) {
    const { context: c, requests, timers, get } = harness();
    const old = c.loadLiveMarket();
    c.state.timeframe = '5m';
    const current = c.loadLiveMarket();
    assert.equal(requests[0].signal.aborted, true);
    assert.ok(requests[1].url.includes('interval=5m'));
    requests[0][outcome](outcome === 'ok' ? 100 : 'old network failure');
    await old;
    assert.equal(c.state.liveLoading, true);
    assert.equal(c.state.liveError, '');
    requests[1].ok(200); await current;
    assert.equal(c.state.liveRows[0].close, 200);
    assert.equal(c.state.liveLoading, false);
    assert.equal(get('chartLoadStatus').hidden, true);
    assert.equal(timers.size, 0);
  }
  // 新响应先完成，随后旧响应晚到也不得覆盖。
  {
    const { context: c, requests } = harness();
    const old = c.loadLiveMarket(), current = c.loadLiveMarket();
    requests[1].ok(300); await current;
    requests[0].ok(100); await old;
    assert.equal(c.state.liveRows[0].close, 300);
  }
  // 切回模拟/历史时，晚到的响应不能恢复加载提示或写入行情。
  for (const replay of [false, true]) {
    const { context: c, requests, timers, get } = harness();
    const pending = c.loadLiveMarket();
    c.state.dataMode = 'sim'; c.state.replayMode = replay; c.stopLiveMarket();
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(get('chartLoadStatus').hidden, true);
    requests[0].ok(900); await pending;
    assert.equal(c.state.liveRows.length, 0);
    assert.equal(c.state.liveLoading, false);
    assert.equal(c.state.liveError, '');
    assert.equal(timers.size, 0);
    await c.loadLiveMarket();
    assert.equal(requests.length, 1);
  }
  // 超时真正取消请求，结束 loading；没有数据时不能写成“保留上次行情”。
  {
    const { context: c, requests, timers, get } = harness();
    const pending = c.loadLiveMarket(); requests[0].respectAbort();
    const timer = [...timers.values()][0]; assert.equal(timer.ms, 12000); timer.callback();
    await pending;
    assert.equal(c.state.liveError, '请求超时，请稍后重试');
    assert.equal(c.state.liveLoading, false);
    assert.match(get('chartLoadStatus').textContent, /暂无可用实盘数据/);
    assert.equal(get('chartLoadStatus').classList.contains('failed'), true);
    assert.equal(timers.size, 0);
  }
  // HTTP/数据不足/断网均可结束请求；已有行情必须标为非最新，重试成功清理失败状态。
  for (const failure of ['http', 'insufficient', 'fail']) {
    const { context: c, requests, get } = harness();
    const first = c.loadLiveMarket(); requests[0].ok(200); await first;
    const pending = c.loadLiveMarket(); requests[1][failure](failure === 'http' ? 503 : 'offline'); await pending;
    assert.equal(c.state.liveRows[0].close, 200);
    assert.equal(c.state.liveLoading, false);
    assert.match(get('chartLoadStatus').textContent, /非最新数据/);
    const retry = c.loadLiveMarket(); requests[2].ok(400); await retry;
    assert.equal(c.state.liveError, '');
    assert.equal(c.state.liveRows[0].close, 400);
    assert.equal(get('chartLoadStatus').hidden, true);
    assert.equal(get('chartLoadStatus').classList.contains('failed'), false);
  }
  for (const [instrument, symbol] of [['BTC-USDT-SWAP', 'BTCUSDT'], ['ETH-USDT-SWAP', 'ETHUSDT'], ['SOL-USDT-SWAP', 'SOLUSDT']]) {
    const { context: c, requests } = harness(); c.liveMarket.instrument = instrument;
    const pending = c.loadLiveMarket();
    assert.ok(requests[0].url.includes(`symbol=${symbol}`), `${instrument} requests ${symbol}`);
    requests[0].ok(500); await pending;
  }
  for (const timeframe of Object.keys(contextTimeframes())) {
    const { context: c, requests } = harness(); c.state.timeframe = timeframe;
    const pending = c.loadLiveMarket();
    const expectedInterval = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1H': '1h', '2H': '2h', '4H': '4h', '6H': '6h', '8H': '8h', '12H': '12h', '1D': '1d', '3D': '3d', '1W': '1w', '1M': '1M' }[timeframe];
    assert.ok(requests[0].url.includes(`interval=${encodeURIComponent(expectedInterval)}`), `${timeframe} requests the selected Binance Futures interval`);
    requests[0].ok(500); await pending;
  }
  console.log('PASS: latest request wins; simulation/replay cancellation; 12s timeout; HTTP/offline/insufficient data; stale labels and retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });

function contextTimeframes() {
  return { '1m': 1, '3m': 1, '5m': 1, '15m': 1, '30m': 1, '1H': 1, '2H': 1, '4H': 1,
    '6H': 1, '8H': 1, '12H': 1, '1D': 1, '3D': 1, '1W': 1, '1M': 1 };
}
