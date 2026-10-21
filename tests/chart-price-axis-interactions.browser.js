// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 专业图轴缩放与K线交互对照检查，不代表真机触控或实时行情验收。
async (page) => {
  const failures = [], results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [], name = `${viewport.width}x${viewport.height}`;
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.locator('[data-tool="trendline"]').click();
      const points = await target.evaluate(() => {
        const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect();
        const width = surface.chart.timeScale().width(), height = surface.chart.panes()[0].getHeight();
        return [[.36, .66], [.64, .38]].map(([x, y]) => [rect.left + surface.left + width * x, rect.top + surface.top + height * y]);
      });
      for (const [x, y] of points) await target.mouse.click(x, y);
      const before = await target.evaluate(() => ({
        points: proChart.drawings.at(-1).edit.points.map(point => ({ time: point.time, price: point.price })),
        range: proChart.chart.timeScale().getVisibleLogicalRange(),
        count: proChart.drawings.length
      }));
      const axis = await target.evaluate(() => {
        const chart = document.querySelector('#chart').getBoundingClientRect();
        const paneHeight = proChart.chart.panes()[0].getHeight();
        return { x: chart.right - 18, y: chart.top + paneHeight * .42 };
      });
      await target.mouse.move(axis.x, axis.y); await target.mouse.down();
      await target.mouse.move(axis.x, axis.y + 48, { steps: 8 }); await target.mouse.up();
      await target.waitForTimeout(120);
      const dragged = await target.evaluate(() => ({
        auto: proChart.chart.panes()[0].priceScale('right').options().autoScale,
        pressed: document.querySelector('#chartAutoScale').getAttribute('aria-pressed'),
        points: proChart.drawings.at(-1).edit.points.map(point => ({ time: point.time, price: point.price })),
        range: proChart.chart.timeScale().getVisibleLogicalRange(),
        projectionErrors: [...document.querySelectorAll('#chartDrawingOverlay [data-anchor-index]')].map(node => {
          const point = proChart.drawings.at(-1).edit.points[Number(node.dataset.anchorIndex)];
          const actual = new DOMPoint(Number(node.getAttribute('cx')), Number(node.getAttribute('cy'))).matrixTransform(node.ownerSVGElement.getScreenCTM());
          const rect = document.querySelector('#chart').getBoundingClientRect(), surface = drawingSurface();
          const expected = { x: rect.left + surface.left + drawingTimeCoordinate(point, surface.chart.timeScale()),
            y: rect.top + surface.top + surface.series.priceToCoordinate(point.price) };
          return Math.hypot(actual.x - expected.x, actual.y - expected.y);
        })
      }));
      if (dragged.auto || dragged.pressed !== 'false') failures.push(`${name}: price-axis drag did not switch to manual scaling`);
      if (JSON.stringify(dragged.points) !== JSON.stringify(before.points)) failures.push(`${name}: price-axis drag changed drawing anchors`);
      if (dragged.range.from !== before.range.from || dragged.range.to !== before.range.to) failures.push(`${name}: price-axis drag changed the time range`);
      if (dragged.projectionErrors.length !== 2 || dragged.projectionErrors.some(error => error > 1)) failures.push(`${name}: drawing anchors detached from the scaled price axis`);

      const readout = await target.evaluate(() => {
        const row = proChart.visibleRows[Math.floor(proChart.visibleRows.length * .55)], surface = drawingSurface();
        return { row: [row.open, row.high, row.low, row.close].map(formatChartPrice),
          x: document.querySelector('#chart').getBoundingClientRect().left + surface.left + surface.chart.timeScale().timeToCoordinate(row.time),
          y: document.querySelector('#chart').getBoundingClientRect().top + surface.top + surface.series.priceToCoordinate(row.close) };
      });
      await target.mouse.move(readout.x, readout.y); await target.waitForTimeout(80);
      const crosshair = await target.locator('#chartOhlc').textContent();
      if (!readout.row.every(value => crosshair.includes(value))) failures.push(`${name}: OHLC readout failed after price-axis drag`);

      await target.mouse.dblclick(axis.x, axis.y + 48); await target.waitForTimeout(100);
      const doubleClickReset = await target.evaluate(() => ({
        auto: proChart.chart.panes()[0].priceScale('right').options().autoScale,
        pressed: document.querySelector('#chartAutoScale').getAttribute('aria-pressed')
      }));
      if (!doubleClickReset.auto || doubleClickReset.pressed !== 'true') failures.push(`${name}: double-click did not restore automatic scaling`);
      await target.locator('#chartAutoScale').click();
      const buttonDisabledAuto = await target.evaluate(() => proChart.chart.panes()[0].priceScale('right').options().autoScale);
      await target.locator('#chartResetView').click();
      const buttonReset = await target.evaluate(() => ({
        auto: proChart.chart.panes()[0].priceScale('right').options().autoScale,
        pressed: document.querySelector('#chartAutoScale').getAttribute('aria-pressed')
      }));
      if (buttonDisabledAuto) failures.push(`${name}: auto-axis button did not enter manual mode`);
      if (!buttonReset.auto || buttonReset.pressed !== 'true') failures.push(`${name}: reset view did not restore automatic price scaling`);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, before, dragged, readout, crosshair, doubleClickReset, buttonDisabledAuto, buttonReset, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
