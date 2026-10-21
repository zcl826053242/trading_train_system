// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 隔离浏览器并禁用行情/图表库，只检查备用图的指针锚定滚轮缩放。
async (page) => {
  const failures = [], results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 667 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [], name = `${viewport.width}x${viewport.height}`;
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      await context.route('**/vendor/lightweight-charts*', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.evaluate(() => { state.dataMode = 'sim'; state.replayMode = false; state.liveRows = []; state.liveError = ''; state.liveLoading = false; renderChart(); updateSimDisplay(); });
      const pointerX = await target.evaluate(() => {
        const chart = document.querySelector('#chart'), svg = chart.querySelector('.chart-fallback');
        const rect = svg.getBoundingClientRect(), plotX = Number(svg.dataset.plotX), plotWidth = Number(svg.dataset.plotWidth);
        return rect.left + (plotX + plotWidth * .63) * rect.width / svg.viewBox.baseVal.width;
      });
      const pointerY = await target.locator('#chart').evaluate(node => node.getBoundingClientRect().top + 100);
      const anchor = () => target.evaluate(() => {
        const svg = document.querySelector('#chart .chart-fallback'), rect = svg.getBoundingClientRect();
        const rows = buildData(state.scenario, state.timeframe), visible = Math.max(16, Math.min(rows.length, Math.round(rows.length / state.chartZoom)));
        const start = Math.max(0, rows.length - visible - state.chartOffset);
        const x = (window.__wheelX - rect.left) * svg.viewBox.baseVal.width / rect.width;
        const fraction = (x - Number(svg.dataset.plotX)) / Number(svg.dataset.plotWidth);
        return { logical: start + fraction * visible, zoom: state.chartZoom, offset: state.chartOffset };
      });
      await target.evaluate(x => { window.__wheelX = x; }, pointerX);
      const before = await anchor();
      await target.mouse.move(pointerX, pointerY);
      await target.mouse.wheel(0, -120);
      await target.waitForTimeout(80);
      const zoomed = await anchor();
      if (!(zoomed.zoom > before.zoom)) failures.push(`${name}: wheel up did not zoom in`);
      if (Math.abs(zoomed.logical - before.logical) > 1.5) failures.push(`${name}: zoom-in anchor drifted ${zoomed.logical - before.logical} bars`);
      await target.mouse.wheel(0, 120);
      await target.waitForTimeout(80);
      const restored = await anchor();
      if (!(restored.zoom < zoomed.zoom)) failures.push(`${name}: wheel down did not zoom out`);
      if (Math.abs(restored.logical - zoomed.logical) > 1.5) failures.push(`${name}: zoom-out anchor drifted ${restored.logical - zoomed.logical} bars`);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, before, zoomed, restored, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
