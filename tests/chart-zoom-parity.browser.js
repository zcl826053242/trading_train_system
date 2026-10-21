// Playwright browser_run_code_unsafe: filename 指向此文件；本地服务端口 4188。
// 隔离 context；比较专业图与备用图的可视逻辑范围、中心锚点和重置行为。
async (page) => {
  const failures = [], results = [];
  const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 667 }];
  const read = target => target.evaluate(() => {
    const rows = proChart.visibleRows;
    if (proChart.chart) {
      const range = proChart.chart.timeScale().getVisibleLogicalRange();
      return { first: range?.from, last: range?.to, count: range ? range.to - range.from + 1 : 0,
        center: range ? (range.from + range.to) / 2 : 0, loaded: rows.length, engine: 'professional' };
    }
    const count = Math.max(16, Math.min(rows.length, Math.round(rows.length / state.chartZoom)));
    const start = rows.length - count - state.chartOffset;
    return { first: start, last: start + count - 1, count, center: start + (count - 1) / 2,
      loaded: rows.length, engine: 'fallback' };
  });
  const settle = target => target.waitForTimeout(180);
  const readAt = (target, point) => target.evaluate(point => {
    const rows = proChart.visibleRows, chart = document.querySelector('#chart'), rect = chart.getBoundingClientRect();
    if (proChart.chart) {
      const scale = proChart.chart.timeScale(), range = scale.getVisibleLogicalRange();
      return { count: range?.to - range?.from + 1, logical: scale.coordinateToLogical(point.x - rect.left) };
    }
    const svg = chart.querySelector('.chart-fallback'), svgRect = svg.getBoundingClientRect(), view = svg.viewBox.baseVal;
    const count = Math.max(16, Math.min(rows.length, Math.round(rows.length / state.chartZoom)));
    const fraction = ((point.x - svgRect.left) * view.width / svgRect.width - Number(svg.dataset.plotX)) / Number(svg.dataset.plotWidth);
    return { count, logical: rows.length - count - state.chartOffset + fraction * count };
  }, point);
  for (const fallback of [false, true]) for (const viewport of viewports) {
    const context = await page.context().browser().newContext({ viewport });
    const name = `${fallback ? 'fallback' : 'professional'}-${viewport.width}x${viewport.height}`;
    const errors = [];
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight-charts*', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/');
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.locator('summary[aria-label="图表设置"]').click();
      await target.locator('#simDataBtn').click();
      await target.locator('summary[aria-label="图表设置"]').click();
      await target.locator('#chart').scrollIntoViewIfNeeded();
      if (Boolean(await target.evaluate(() => proChart.fallback)) !== fallback) throw Error('wrong chart engine loaded');

      // Center a partially zoomed window so the zoom-in path is not clamped at fit-to-data.
      await target.locator('#chartZoomIn').click();
      await target.locator('#chartZoomIn').click();
      await settle(target);
      const initial = await read(target);
      await target.locator('#chartZoomIn').click();
      await settle(target);
      const zoomed = await read(target);
      const zoomInFactor = initial.count / zoomed.count;
      const centerDriftIn = Math.abs(zoomed.center - initial.center);
      if (zoomInFactor < 1.20 || zoomInFactor > 1.30) failures.push(`${name}: zoom-in factor ${zoomInFactor.toFixed(3)} is not near 1.25`);
      if (centerDriftIn > 1) failures.push(`${name}: zoom-in center drifted ${centerDriftIn.toFixed(2)} bars`);

      await target.locator('#chartZoomOut').click();
      await settle(target);
      const restored = await read(target);
      if (Math.abs(restored.count - initial.count) > 1) failures.push(`${name}: inverse zoom did not restore visible count`);
      if (Math.abs(restored.center - initial.center) > 1) failures.push(`${name}: inverse zoom shifted the visible center`);

      const wheelPoint = await target.evaluate(() => {
        const chart = document.querySelector('#chart'), rect = chart.getBoundingClientRect();
        if (proChart.chart) {
          const scale = proChart.chart.timeScale();
          return { x: rect.left + scale.width() * .63, y: rect.top + proChart.chart.panes()[0].getHeight() * .5 };
        }
        const svg = chart.querySelector('.chart-fallback'), svgRect = svg.getBoundingClientRect(), view = svg.viewBox.baseVal;
        const fraction = .63;
        const localX = Number(svg.dataset.plotX) + Number(svg.dataset.plotWidth) * fraction;
        return { x: svgRect.left + localX * svgRect.width / view.width,
          y: svgRect.top + (Number(svg.dataset.plotY) + Number(svg.dataset.plotHeight) * .5) * svgRect.height / view.height };
      });
      const wheelBefore = await readAt(target, wheelPoint);
      await target.mouse.move(wheelPoint.x, wheelPoint.y);
      await target.mouse.wheel(0, -120);
      await settle(target);
      const wheelAfter = await readAt(target, wheelPoint);
      if (!(wheelAfter.count < wheelBefore.count)) failures.push(`${name}: wheel-up did not zoom in`);
      if (Math.abs(wheelAfter.logical - wheelBefore.logical) > 1.5) failures.push(`${name}: wheel anchor drifted ${(wheelAfter.logical - wheelBefore.logical).toFixed(2)} bars`);
      await target.mouse.wheel(0, 120);
      await settle(target);

      await target.locator('#chartZoomIn').click();
      await target.locator('#chartZoomIn').click();
      await settle(target);
      const twiceZoomed = await read(target);
      await target.locator('#chartResetView').click();
      await settle(target);
      const reset = await read(target);
      if (Math.abs(reset.count - reset.loaded) > 1 || reset.first < -1 || reset.last > reset.loaded) failures.push(`${name}: reset did not fit the loaded data`);
      if (twiceZoomed.count >= initial.count) failures.push(`${name}: repeated zoom-in did not reduce visible range`);
      await target.locator('[data-time="5m"]').click();
      await target.waitForFunction(() => state.timeframe === '5m');
      await settle(target);
      const fiveMinute = await read(target);
      if (fiveMinute.loaded <= reset.loaded || Math.abs(fiveMinute.count - fiveMinute.loaded) > 1 || fiveMinute.first < -1) failures.push(`${name}: switching to 5m did not fit its loaded data`);
      await target.locator('[data-time="1H"]').click();
      await target.waitForFunction(() => state.timeframe === '1H');
      await settle(target);
      const backToOneHour = await read(target);
      if (Math.abs(backToOneHour.count - backToOneHour.loaded) > 1 || backToOneHour.first < -1) failures.push(`${name}: switching back to 1H kept a stale zoom range`);
      if (errors.length) failures.push(`${name}: page errors ${errors.join('; ')}`);
      results.push({ name, initial, zoomed, zoomInFactor, centerDriftIn, restored, wheelBefore, wheelAfter,
        wheelAnchorDrift: Math.abs(wheelAfter.logical - wheelBefore.logical), twiceZoomed, reset, fiveMinute, backToOneHour, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
