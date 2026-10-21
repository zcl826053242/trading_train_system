// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；验证实盘无数据时不回退到模拟 K 线。
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  let outcome = 'fail';
  let requestCount = 0, releaseInitial;
  let notifyFirstRequest;
  const firstRequestStarted = new Promise(resolve => { notifyFirstRequest = resolve; });
  const waitForFirstRelease = new Promise(resolve => { releaseInitial = resolve; });
  await context.route('https://fapi.binance.com/fapi/v1/klines**', async route => {
    requestCount++;
    if (requestCount === 1) { notifyFirstRequest(); await waitForFirstRelease; }
    if (outcome !== 'ok') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: '50011', msg: 'network unavailable', data: [] }) });
      return;
    }
    const now = Math.floor(Date.now() / 60000) * 60000;
    const data = Array.from({ length: 80 }, (_, i) => {
      const close = 68000 + i * 4;
      const openTime = now - (79 - i) * 60000;
      return [String(openTime), String(close - 5), String(close + 8), String(close - 9), String(close), '12', String(openTime + 59999), String(close * 12), '100', '6', String(close * 6), '0'];
    });
    await route.fulfill({ json: data });
  });
  const target = await context.newPage();
  target.on('pageerror', error => errors.push(error.message));
  await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
  await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
  await target.locator('[data-nav-target="market"]').click();
  await firstRequestStarted;
  await target.waitForFunction(() => state.liveLoading);
  const loading = await target.evaluate(() => ({
    empty: !document.querySelector('#chartEmptyState').hidden,
    title: document.querySelector('#chartEmptyTitle').textContent,
    rows: buildData(state.scenario, state.timeframe).length
  }));
  releaseInitial();
  await target.waitForFunction(() => !state.liveLoading && Boolean(state.liveError));
  const failed = await target.evaluate(() => ({
    rows: state.liveRows.length,
    empty: !document.querySelector('#chartEmptyState').hidden,
    title: document.querySelector('#chartEmptyTitle').textContent,
    price: document.querySelector('#lastPrice').textContent,
    ohlc: document.querySelector('#chartOhlc').textContent,
    simulatedRows: buildData(state.scenario, state.timeframe).length
  }));
  outcome = 'ok';
  await target.locator('#chartEmptyRetry').click();
  await target.waitForFunction(() => !state.liveLoading && state.liveRows.length >= 8 && document.querySelector('#chartEmptyState').hidden);
  const loaded = await target.evaluate(() => ({
    rows: state.liveRows.length,
    empty: document.querySelector('#chartEmptyState').hidden,
    price: document.querySelector('#lastPrice').textContent,
    ohlc: document.querySelector('#chartOhlc').textContent
  }));
  outcome = 'stale-fail';
  await target.evaluate(() => loadLiveMarket());
  await target.waitForFunction(() => !state.liveLoading && Boolean(state.liveError) && state.liveRows.length >= 8);
  const stale = await target.evaluate(() => ({
    rows: state.liveRows.length,
    empty: document.querySelector('#chartEmptyState').hidden,
    price: document.querySelector('#lastPrice').textContent,
    status: document.querySelector('#chartLoadStatus').textContent,
    failed: document.querySelector('#chartLoadStatus').classList.contains('failed')
  }));
  await target.evaluate(() => setDataMode('sim'));
  await target.waitForFunction(() => state.dataMode === 'sim' && document.querySelector('#chartEmptyState').hidden);
  const switched = await target.evaluate(() => ({ mode: state.dataMode, rows: buildData(state.scenario, state.timeframe).length, price: document.querySelector('#lastPrice').textContent }));
  await context.close();
  if (errors.length) throw new Error(errors.join('; '));
  if (!loading.empty || !loading.title.includes('正在读取') || loading.rows !== 0) throw new Error(`加载期间显示了占位 K 线：${JSON.stringify(loading)}`);
  if (failed.rows !== 0 || !failed.empty || failed.price !== '—' || !/^暂无 1H 行情$/.test(failed.ohlc) || failed.simulatedRows !== 0) throw new Error(`实盘空状态不符合预期：${JSON.stringify(failed)}`);
  if (loaded.rows < 8 || !loaded.empty || loaded.price === '—' || !loaded.ohlc.includes('开 ')) throw new Error(`实盘成功状态不符合预期：${JSON.stringify(loaded)}`);
  if (stale.rows < 8 || !stale.empty || !stale.failed || !stale.status.includes('非最新数据') || stale.price !== loaded.price) throw new Error(`已有实盘刷新失败时未保留旧行情：${JSON.stringify(stale)}`);
  if (switched.mode !== 'sim' || switched.rows < 8 || switched.price === '—') throw new Error(`切换模拟教学失败：${JSON.stringify(switched)}`);
  return { passed: true, loading, failed, loaded, stale, switched, errors };
}
