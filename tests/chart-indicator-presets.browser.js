// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；验证币安式图表的轻量指标组合入口。
async (page) => {
  const failures = [], results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [], name = `${viewport.width}x${viewport.height}`;
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.evaluate(() => { state.dataMode = 'sim'; state.liveRows = []; state.liveError = ''; state.liveLoading = false; renderChart(); });
      await target.getByRole('button', { name: '指标' }).click();
      const presetNames = await target.locator('[data-indicator-preset]').evaluateAll(nodes => nodes.map(node => node.dataset.indicatorPreset));
      if (JSON.stringify(presetNames) !== JSON.stringify(['basic', 'trend', 'momentum'])) failures.push(`${name}: preset order or names changed`);
      await target.getByRole('button', { name: '趋势对照 EMA20 / EMA60' }).click();
      const trend = await target.evaluate(() => ({
        preset: [...document.querySelectorAll('[data-indicator-preset]')].find(node => node.getAttribute('aria-pressed') === 'true')?.dataset.indicatorPreset,
        ema20: document.getElementById('ema20').checked, ema60: document.getElementById('ema60').checked,
        rsi: state.indicator.rsi, macd: state.indicator.macd,
        volumeMa20: state.volumeSma[20], replay: state.replayMode,
        overflow: document.documentElement.scrollWidth - innerWidth
      }));
      if (trend.preset !== 'trend' || !trend.ema20 || !trend.ema60 || trend.rsi || trend.macd || !trend.volumeMa20 || trend.replay || trend.overflow > 0) failures.push(`${name}: trend preset state mismatch ${JSON.stringify(trend)}`);
      await target.getByRole('button', { name: '动能观察 RSI(14)' }).click();
      await target.waitForTimeout(350);
      const momentum = await target.evaluate(() => ({
        preset: [...document.querySelectorAll('[data-indicator-preset]')].find(node => node.getAttribute('aria-pressed') === 'true')?.dataset.indicatorPreset,
        rsi: state.indicator.rsi, macd: state.indicator.macd, ema20: state.show20, ema60: state.show60,
        rsiReadout: Boolean(document.querySelector('[data-pane-legend="rsi"]') && !document.querySelector('[data-pane-legend="rsi"]').hidden),
        coach: document.getElementById('chartCoach').textContent,
        overflow: document.documentElement.scrollWidth - innerWidth
      }));
      if (momentum.preset !== 'momentum' || !momentum.rsi || momentum.macd || momentum.ema20 || momentum.ema60 || !momentum.rsiReadout || momentum.overflow > 0) failures.push(`${name}: momentum preset state mismatch ${JSON.stringify(momentum)}`);
      await target.reload();
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      const restored = await target.evaluate(() => ({ preset: [...document.querySelectorAll('[data-indicator-preset]')].find(node => node.getAttribute('aria-pressed') === 'true')?.dataset.indicatorPreset, rsi: state.indicator.rsi }));
      if (restored.preset !== 'momentum' || !restored.rsi) failures.push(`${name}: preset did not persist after refresh`);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, trend, momentum, restored, errors });
    } catch (error) { failures.push(`${name}: ${error.message}`); }
    finally { await context.close(); }
  }
  return { passed: failures.length === 0, results, failures };
}
