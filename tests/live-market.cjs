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
const payload = close => ({ code: '0', data: Array.from({ length: 8 }, (_, i) => [
  String(1700000000000 + i * 60000), String(close - 1), String(close + 2), String(close - 2), String(close), '12'
]) });
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
    liveBars: { '1H': '1H', '5m': '5m' }, liveRequestId: 0, liveRequestController: null, liveRefreshTimer: null,
    AbortController, encodeURIComponent, Date,
    document: { getElementById: get },
    setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id), clearInterval: () => {},
    updateDataSourceUI: () => {}, updateMarketPerformance: () => {}, updateSimDisplay: () => {}, renderChart: () => {},
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, signal: options.signal,
      ok: close => resolve({ ok: true, json: async () => payload(close) }),
      fail: message => reject(new Error(message)),
      http: status => resolve({ ok: false, status }),
      insufficient: () => resolve({ ok: true, json: async () => ({ code: '0', data: [] }) }),
      // 部分场景故意允许取消后仍返回，验证请求序号保护而不只依赖 fetch 的取消行为。
      respectAbort: () => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
  });
  vm.runInContext(['parseLiveCandles', 'stopLiveMarket', 'loadLiveMarket'].map(source).join('\n'), context);
  return { context, requests, timers, get };
}
(async () => {
  // 快速切周期：旧请求的成功和失败都不能覆盖新周期，旧 finally 不能清掉新 loading。
  for (const outcome of ['ok', 'fail']) {
    const { context: c, requests, timers, get } = harness();
    const old = c.loadLiveMarket();
    c.state.timeframe = '5m';
    const current = c.loadLiveMarket();
    assert.equal(requests[0].signal.aborted, true);
    assert.ok(requests[1].url.includes('bar=5m'));
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
  console.log('PASS: latest request wins; simulation/replay cancellation; 12s timeout; HTTP/offline/insufficient data; stale labels and retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
