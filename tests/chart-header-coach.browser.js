// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；检查不同宽度下行情头部与学习提示不互相覆盖。
async (page) => {
  const failures = [], results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1100, height: 760 }, { width: 390, height: 844 }, { width: 390, height: 667 }, { width: 320, height: 667 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [], name = `${viewport.width}x${viewport.height}`;
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', async route => {
        const now = Math.floor(Date.now() / 3600000) * 3600000;
        const rows = Array.from({ length: 80 }, (_, i) => {
          const openTime = now - (80 - i) * 3600000, close = 68000 + Math.sin(i / 7) * 120 + i * 2;
          return [String(openTime), String(close - 12), String(close + 24), String(close - 30), String(close), '20', String(openTime + 3599999), '1', '1', '1', '1', '0'];
        });
        await route.fulfill({ json: rows });
      });
      await context.route('**/unpkg.com/**', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.evaluate(() => setWorkspace('market'));
      await target.waitForFunction(() => state.liveRows.length >= 8 && !state.liveLoading);
      const layout = await target.evaluate(() => {
        const rect = selector => {
          const node = document.querySelector(selector), r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, display: getComputedStyle(node).display };
        };
        const symbol = rect('#chartInstrument'), coach = rect('#chartCoach'), chart = rect('#chart'), stage = rect('#chartStage');
        const iconNodes = [...document.querySelectorAll('[data-lucide]')];
        const renderedIcons = iconNodes.filter(node => node.tagName.toLowerCase() === 'svg');
        return {
          viewport: [innerWidth, innerHeight],
          terminal: document.body.classList.contains('market-terminal'),
          symbol, price: rect('#lastPrice'), period: rect('.chart-period-control'), indicators: rect('#chartIndicatorsOpen'), coach,
          chart, stage, instrumentHintDisplay: getComputedStyle(document.querySelector('#instrumentHint')).display,
          iconCount: iconNodes.length,
          renderedIconCount: renderedIcons.length,
          chartToolIconCount: [...document.querySelectorAll('.chart-tools [data-lucide]')].filter(node => node.tagName.toLowerCase() === 'svg').length,
          meta: document.querySelector('#dataSourceMeta').textContent,
          overflow: document.documentElement.scrollWidth - innerWidth
        };
      });
      const overlap = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
      if (!layout.terminal) failures.push(`${name}: chart workspace did not use terminal layout`);
      if (layout.instrumentHintDisplay !== 'none') failures.push(`${name}: long source hint still occupies the compact symbol header`);
      if (layout.iconCount < 12 || layout.renderedIconCount !== layout.iconCount) failures.push(`${name}: local icon asset did not render all declared icons (${layout.renderedIconCount}/${layout.iconCount})`);
      if (layout.chartToolIconCount < 6) failures.push(`${name}: chart drawing toolbar icons are missing (${layout.chartToolIconCount})`);
      if (overlap(layout.symbol, layout.coach)) failures.push(`${name}: symbol/header text overlaps the coaching strip`);
      if (viewport.width <= 390 && layout.coach.height > 28) failures.push(`${name}: coaching strip wraps into an oversized block (${layout.coach.height}px)`);
      if (layout.overflow > 0) failures.push(`${name}: page has ${layout.overflow}px horizontal overflow`);
      if (!layout.meta.includes('binance-usdm-public-swap')) failures.push(`${name}: data source provenance disappeared`);
      if (layout.chart.y < layout.stage.y || layout.chart.bottom > layout.stage.bottom + 1) failures.push(`${name}: chart escaped its stage`);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, layout, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
