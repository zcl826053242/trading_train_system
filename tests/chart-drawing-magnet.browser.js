// Playwright browser_run_code_unsafe：filename 指向此文件；本地服务端口 4188。
// 独立 context；验证 Binance 风格磁吸按钮在专业图/备用 SVG、桌面/手机下的可见 OHLC 锚定与刷新恢复。
async (page) => {
  const failures = [], results = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  for (const fallback of [false, true]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 667 }]) {
    const name = `${fallback ? 'fallback' : 'professional'}-${viewport.width}x${viewport.height}`;
    const context = await page.context().browser().newContext({ viewport });
    const errors = [];
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight-charts*', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/');
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.evaluate(() => {
        state.dataMode = 'sim'; state.replayMode = false; state.liveRows = []; state.liveError = ''; state.liveLoading = false; state.chartType = 'candles'; renderChart();
      });
      await target.locator('#chart').scrollIntoViewIfNeeded();
      const initial = await target.evaluate(() => ({ fallback: Boolean(proChart.fallback), magnet: state.drawingMagnet, pressed: document.querySelector('#chartDrawingMagnet').getAttribute('aria-pressed') }));
      check(initial.fallback === fallback, `${name}: wrong chart backend`);
      check(initial.magnet === false && initial.pressed === 'false', `${name}: magnet should start disabled in an isolated context`);
      await target.locator('#chartDrawingMagnet').click();
      const targetPoints = [];
      await target.locator('[data-tool="trendline"]').click();
      for (const seed of [8, 18]) {
        const point = await target.evaluate(seed => {
          const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect();
          const timeScale = surface.chart.timeScale(), series = surface.series;
          const base = proChart.visibleRows[Math.min(seed, proChart.visibleRows.length - 1)];
          const x = timeScale.timeToCoordinate(base.time);
          const index = Math.max(0, Math.min(proChart.visibleRows.length - 1, Math.round(timeScale.coordinateToLogical(x))));
          const row = proChart.visibleRows[index], chartY = series.priceToCoordinate(row.high) + 2;
          const clientX = Math.round(rect.left + surface.left + x), clientY = Math.round(rect.top + surface.top + chartY);
          const pointerY = clientY - rect.top - surface.top;
          const expectedPrice = [row.open, row.high, row.low, row.close].sort((a, b) => Math.abs(series.priceToCoordinate(a) - pointerY) - Math.abs(series.priceToCoordinate(b) - pointerY))[0];
          return { index, time: row.time, expectedPrice, rowCount: proChart.visibleRows.length, x: clientX, y: clientY };
        }, seed);
        targetPoints.push(point);
        await target.mouse.click(point.x, point.y);
      }
      const created = await target.evaluate(() => ({
        count: proChart.drawings.length,
        points: proChart.drawings[0]?.edit?.points,
        magnet: state.drawingMagnet,
        pressed: document.querySelector('#chartDrawingMagnet').getAttribute('aria-pressed'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      }));
      check(created.count === 1, `${name}: magnetic trendline was not created`);
      check(created.points?.length === 2 && created.points.every((point, index) => Math.abs(point.price - targetPoints[index].expectedPrice) < 1e-6), `${name}: price anchors did not snap to the nearest visible OHLC value`);
      check(created.points?.length === 2 && created.points.every((point, index) => point.time === targetPoints[index].time && Math.abs(point.scenarioProgress - targetPoints[index].index / Math.max(1, targetPoints[index].rowCount - 1)) < 1e-6), `${name}: scenario time anchors do not follow snapped candle positions`);
      check(created.magnet === true && created.pressed === 'true', `${name}: magnet state is not reflected in the control`);
      check(created.overflow === 0, `${name}: magnet control introduced horizontal overflow`);
      await target.locator('[data-tool="cursor"]').click();
      const dragTarget = await target.evaluate(() => {
        const surface = drawingSurface(), scale = surface.chart.timeScale(), series = surface.series;
        const rect = document.querySelector('#chart').getBoundingClientRect(), drawing = proChart.drawings[0];
        const anchor = drawing.edit.points[0], anchorIndex = drawing.edit.points.indexOf(anchor);
        const anchorX = rect.left + surface.left + drawingTimeCoordinate(anchor, scale);
        const anchorY = rect.top + surface.top + series.priceToCoordinate(anchor.price);
        const index = Math.min(proChart.visibleRows.length - 1, anchorIndex + 12), row = proChart.visibleRows[index];
        const x = scale.timeToCoordinate(row.time), y = series.priceToCoordinate(row.high) + 2;
        const clientX = Math.round(rect.left + surface.left + x), clientY = Math.round(rect.top + surface.top + y);
        const localY = clientY - rect.top - surface.top;
        const expectedPrice = [row.open, row.high, row.low, row.close].sort((a, b) => Math.abs(series.priceToCoordinate(a) - localY) - Math.abs(series.priceToCoordinate(b) - localY))[0];
        return { anchorX, anchorY, x: clientX, y: clientY, index, time: row.time, expectedPrice, rowCount: proChart.visibleRows.length };
      });
      await target.mouse.move(dragTarget.anchorX, dragTarget.anchorY);
      await target.mouse.down();
      await target.mouse.move(dragTarget.x, dragTarget.y, { steps: 8 });
      await target.mouse.up();
      const dragged = await target.evaluate(() => proChart.drawings[0]?.edit?.points[0]);
      check(dragged?.time === dragTarget.time && Math.abs(dragged.price - dragTarget.expectedPrice) < 1e-6,
        `${name}: editing a drawing anchor did not snap to the target candle OHLC`);
      check(Math.abs(dragged?.scenarioProgress - dragTarget.index / Math.max(1, dragTarget.rowCount - 1)) < 1e-6,
        `${name}: dragged simulated anchor did not preserve the snapped candle index`);
      await target.reload();
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      const restored = await target.evaluate(() => ({ magnet: state.drawingMagnet, pressed: document.querySelector('#chartDrawingMagnet').getAttribute('aria-pressed'), label: document.querySelector('#chartDrawingMagnet').getAttribute('aria-label') }));
      check(restored.magnet === true && restored.pressed === 'true' && restored.label === '磁吸已开启', `${name}: magnet preference did not survive refresh`);
      if (errors.length) failures.push(`${name}: page errors: ${errors.join('; ')}`);
      results.push({ name, initial, targetPoints, created, dragTarget, dragged, restored, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      results.push({ name, error: error.message, errors });
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
