// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 独立上下文仅拦截交易记录键，真实走开仓/平仓按钮，不触碰其他存储。
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const failures = [];
  try {
    await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
    await context.route('**/unpkg.com/**', route => route.abort());
    await context.addInitScript(() => {
      window.__failTradeStorage = false;
      window.__capturedCsv = null;
      const nativeSetItem = Storage.prototype.setItem;
      if (!sessionStorage.getItem('__trade-storage-seeded')) {
        nativeSetItem.call(localStorage, 'trend-lab-trades', JSON.stringify([{
          side: 'long', entry: 100, exit: 101, pnl: 1, r: 0.1, reason: '既有记录',
          sourceId: 'sim-teaching', sourceLabel: '模拟教学情景', venue: 'local', marketType: 'synthetic',
          symbol: 'BTC-USDT-SWAP', createdAt: '2026-10-22T12:00:00.000Z'
        }]));
        sessionStorage.setItem('__trade-storage-seeded', 'yes');
      }
      window.__failTradeStorage = true;
      const createObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => {
        if (blob instanceof Blob && blob.type.includes('text/csv')) blob.text().then(text => { window.__capturedCsv = text; });
        return createObjectURL(blob);
      };
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'trend-lab-trades' && window.__failTradeStorage) throw new DOMException('quota exceeded', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
    });
    const target = await context.newPage();
    target.on('pageerror', error => errors.push(error.message));
    await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
    await target.locator('[data-nav-target="market"]').click();
    await target.waitForFunction(() => activeWorkspace === 'market');
    await target.evaluate(() => setDataMode('sim'));
    await target.waitForFunction(() => state.dataMode === 'sim' && Boolean(visibleClose()) && !document.querySelector('#openPosition').disabled);
    const stageTradesBefore = await target.evaluate(() => stageState.progress[stageState.active].trades);
    await target.locator('#openPosition').dblclick();
    await target.waitForFunction(() => Boolean(sim.position) && !document.querySelector('#closePosition').disabled);
    await target.locator('#closePosition').dblclick();
    await target.waitForFunction(() => !sim.position && sim.trades.length === 2 && !document.querySelector('#tradeStorageWarning').hidden);
    const failedWrite = await target.evaluate(() => ({
      warningVisible: !document.querySelector('#tradeStorageWarning').hidden,
      tradeCount: sim.trades.length,
      symbol: sim.trades.at(-1)?.symbol,
      stageTrades: stageState.progress[stageState.active].trades,
      warningText: document.querySelector('#tradeStorageWarning').textContent.trim()
    }));
    if (!failedWrite.warningVisible || failedWrite.tradeCount !== 2 || failedWrite.stageTrades !== stageTradesBefore + 1 || !failedWrite.warningText.includes('导出交易 CSV')) {
      failures.push(`Storage failure did not preserve and explain the trade: ${JSON.stringify(failedWrite)}`);
    }

    await target.locator('[data-nav-target="review"]').click();
    await target.waitForFunction(() => activeWorkspace === 'review');
    await target.locator('#exportReview').click();
    await target.waitForFunction(() => typeof window.__capturedCsv === 'string');
    const failedStorageCsv = await target.evaluate(() => window.__capturedCsv);
    const csvLines = failedStorageCsv.replace(/^\uFEFF/, '').split(/\r?\n/);
    if (csvLines.length !== 3 || !csvLines.slice(1).some(line => line.includes('模拟交易') && line.includes(failedWrite.symbol) && line.includes('手动平仓'))) {
      failures.push(`CSV export did not include the trade held only in memory: ${JSON.stringify(csvLines)}`);
    }

    await target.evaluate(() => { localStorage.removeItem('trend-lab-session-draft'); sessionPersistenceDirty = false; });
    await target.reload({ waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
    const afterFailedReload = await target.evaluate(() => ({
      tradeCount: sim.trades.length,
      sessionBackup: JSON.parse(sessionStorage.getItem('trend-lab-trades-session-backup') || '[]').length,
      warningVisible: !document.querySelector('#tradeStorageWarning').hidden,
      warningText: document.querySelector('#tradeStorageWarning').textContent.trim(),
      stageTrades: stageState.progress[stageState.active].trades
    }));
    if (afterFailedReload.tradeCount !== 2 || afterFailedReload.sessionBackup !== 2 || !afterFailedReload.warningVisible
      || !afterFailedReload.warningText.includes('标签页备份恢复') || afterFailedReload.stageTrades !== stageTradesBefore + 1) {
      failures.push(`Storage failure did not restore in the same tab after reload: ${JSON.stringify(afterFailedReload)}`);
    }

    await target.locator('[data-nav-target="review"]').click();
    await target.waitForFunction(() => activeWorkspace === 'review');
    const recoveredReviewRows = await target.locator('#tradeTableBody tr').allTextContents();
    if (recoveredReviewRows.length !== 2 || !recoveredReviewRows.some(text => text.includes('手动平仓'))) {
      failures.push(`Review workspace did not expose recovered trade history: ${JSON.stringify(recoveredReviewRows)}`);
    }

    await target.locator('[data-nav-target="market"]').click();
    await target.waitForFunction(() => activeWorkspace === 'market');
    if (!(await target.locator('#simDataBtn').isVisible())) {
      await target.locator('details.chart-advanced > summary').click();
    }
    await target.locator('#simDataBtn').click();
    await target.waitForFunction(() => state.dataMode === 'sim' && Boolean(visibleClose()));
    await target.evaluate(() => { window.__failTradeStorage = false; });
    await target.locator('#openPosition').dblclick();
    await target.waitForFunction(() => Boolean(sim.position));
    await target.locator('#closePosition').dblclick();
    await target.waitForFunction(() => !sim.position && sim.trades.length === 3 && document.querySelector('#tradeStorageWarning').hidden);
    const recovered = await target.evaluate(() => ({
      warningHidden: document.querySelector('#tradeStorageWarning').hidden,
      persisted: JSON.parse(localStorage.getItem('trend-lab-trades') || '[]').length,
      tradeCount: sim.trades.length,
      stageTrades: stageState.progress[stageState.active].trades
    }));
    if (!recovered.warningHidden || recovered.persisted !== 3 || recovered.tradeCount !== 3) {
      failures.push(`Recovered storage did not persist both trades and clear the warning: ${JSON.stringify(recovered)}`);
    }
    await target.reload({ waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
    const afterReload = await target.evaluate(() => ({
      tradeCount: sim.trades.length,
      persisted: JSON.parse(localStorage.getItem('trend-lab-trades') || '[]').length,
      stageTrades: stageState.progress[stageState.active].trades,
      warningHidden: document.querySelector('#tradeStorageWarning').hidden
    }));
    if (afterReload.tradeCount !== 3 || afterReload.persisted !== 3 || afterReload.stageTrades !== recovered.stageTrades || !afterReload.warningHidden) {
      failures.push(`Reload changed persisted trade/activity state: ${JSON.stringify(afterReload)}`);
    }
    if (errors.length) failures.push(`pageerror: ${errors.join(' | ')}`);
    return { passed: failures.length === 0, failures, failedWrite, failedStorageCsvRows: csvLines.length - 1, afterFailedReload, recoveredReviewRows, recovered, afterReload, pageErrors: errors.length };
  } finally {
    await context.close();
  }
}
