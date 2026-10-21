// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 隔离 context，只验证模拟周线/月线经过整图渲染后的真实时间戳。
async (page) => {
  const failures = [], results = [];
  for (const fallback of [false, true]) {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
    const errors = [], name = fallback ? 'fallback' : 'professional';
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight-charts*', route => route.abort());
      const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      const times = {};
      for (const timeframe of ['1W', '1M']) {
        times[timeframe] = await target.evaluate(period => {
          state.dataMode = 'sim'; state.replayMode = false; state.liveRows = []; state.timeframe = period;
          state.chartZoom = 1; state.chartOffset = 0; renderChart();
          return proChart.visibleRows.map(row => row.time);
        }, timeframe);
      }
      const weeks = times['1W'].map(time => new Date(time * 1000));
      const months = times['1M'].map(time => new Date(time * 1000));
      if (weeks.length < 24 || weeks.some(date => date.getUTCDay() !== 1 || date.getUTCHours() !== 0)) failures.push(`${name}: rendered weekly bars are not Monday UTC`);
      if (months.length < 24 || months.some(date => date.getUTCDate() !== 1 || date.getUTCHours() !== 0)) failures.push(`${name}: rendered monthly bars are not at the UTC month start`);
      if (months.some((date, index) => index && (date.getUTCMonth() !== (months[index - 1].getUTCMonth() + 1) % 12
        || date.getUTCFullYear() !== months[index - 1].getUTCFullYear() + (months[index - 1].getUTCMonth() === 11 ? 1 : 0)))) failures.push(`${name}: rendered monthly bars skip or repeat a calendar month`);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, weeklyCount: weeks.length, weeklyFirst: weeks[0]?.toISOString(), monthlyCount: months.length,
        monthlyFirst: months[0]?.toISOString(), monthlyLast: months.at(-1)?.toISOString(), errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
