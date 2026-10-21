// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；隔离验证行情来源与交易 CSV 归因。
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  try {
    await context.route('https://fapi.binance.com/fapi/v1/klines**', async route => {
      const now = Math.floor(Date.now() / 3600000) * 3600000;
      const rows = Array.from({ length: 16 }, (_, i) => {
        const openTime = now - (16 - i) * 3600000, close = 68000 + i;
        return [String(openTime), String(close - 1), String(close + 2), String(close - 2), String(close), '10', String(openTime + 3599999), '1', '1', '1', '1', '0'];
      });
      await route.fulfill({ json: rows });
    });
    const target = await context.newPage();
    target.on('pageerror', error => errors.push(error.message));
    await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => sessionPersistenceReady && historicalReady && state.liveRows.length >= 8);
    const result = await target.evaluate(() => {
      sim.trades = [{ sourceId: 'binance-usdm-public-swap', venue: 'Binance', marketType: '永续', symbol: 'ETHUSDT', side: 'short', entry: 2500, exit: 2490, pnl: 10, r: .4, reason: '规则, 含 "引号"' },
        { side: 'long', entry: 1, exit: 1, pnl: 0, r: 0, reason: 'legacy trade' }];
      sim.importedTrades = [{ side: 'long', entry: 5, exit: 6, pnl: 1, r: .2, reason: 'imported' }];
      window.__reviewBlob = null;
      URL.createObjectURL = blob => (window.__reviewBlob = blob, 'blob:review-test');
      URL.revokeObjectURL = () => {};
      document.getElementById('exportReview').click();
      return { meta: document.getElementById('dataSourceMeta').textContent, report: document.getElementById('sessionReportSource').textContent };
    });
    const csv = await target.evaluate(() => window.__reviewBlob.text());
    if (!result.meta.includes('binance-usdm-public-swap') || !result.report.includes('Binance 永续')) throw new Error(`live source label mismatch: ${JSON.stringify(result)}`);
    for (const expected of ['"来源标识"', '"市场类型"', '"模拟交易"', 'binance-usdm-public-swap', 'legacy-unknown', 'imported-unknown', '"导入记录"', '"规则, 含 ""引号"""']) {
      if (!csv.includes(expected)) throw new Error(`trade CSV missing ${expected}: ${csv}`);
    }
    if (errors.length) throw new Error(errors.join('; '));
    return { passed: true, result, csvBytes: new Blob([csv]).size, errors };
  } finally {
    await context.close();
  }
}
