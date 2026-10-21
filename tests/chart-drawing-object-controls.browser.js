// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 独立 context 验证两套图表引擎的绘图对象锁定、显隐、编辑和删除流程。
async (page) => {
  const failures = [], results = [];
  for (const fallback of [false, true]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [], name = `${viewport.width}/${fallback ? 'fallback' : 'professional'}`;
    const check = (condition, message) => { if (!condition) failures.push(`${name}: ${message}`); };
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight-charts*', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/');
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.locator('#chart').scrollIntoViewIfNeeded();
      await target.locator('[data-tool="trendline"]').click();
      const points = await target.evaluate(() => {
        const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect();
        const width = surface.chart.timeScale().width(), height = surface.chart.panes()[0].getHeight();
        return [[.35, .65], [.65, .35]].map(([x, y]) => [rect.left + surface.left + width * x, rect.top + surface.top + height * y]);
      });
      for (const [x, y] of points) await target.mouse.click(x, y);
      await target.waitForFunction(() => proChart.drawings.length === 1 && proChart.drawings[0].edit.points.length === 2);
      await target.locator('[data-tool="cursor"]').click();
      const beforeLock = await target.evaluate(() => ({
        id: proChart.drawings[0].id,
        points: proChart.drawings[0].edit.points.map(point => ({ time: point.time, price: point.price })),
        handles: document.querySelectorAll('#chartDrawingOverlay [data-anchor-index]').length
      }));
      const row = target.locator(`[data-drawing-id="${beforeLock.id}"]`);
      check(beforeLock.handles === 2, 'selected trendline did not expose both edit anchors');

      await row.locator('[data-drawing-action="lock"]').click();
      const locked = await target.evaluate(() => ({
        locked: proChart.drawings[0].locked,
        handles: document.querySelectorAll('#chartDrawingOverlay [data-anchor-index]').length,
        removeDisabled: document.querySelector('[data-drawing-action="remove"]').disabled
      }));
      check(locked.locked && locked.handles === 0 && locked.removeDisabled, 'lock state did not remove handles and disable deletion');

      const lockedAnchor = await target.evaluate(() => {
        const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect(), point = proChart.drawings[0].edit.points[0];
        return { x: rect.left + surface.left + drawingTimeCoordinate(point, surface.chart.timeScale()),
          y: rect.top + surface.top + surface.series.priceToCoordinate(point.price) };
      });
      await target.mouse.move(lockedAnchor.x, lockedAnchor.y); await target.mouse.down();
      await target.mouse.move(lockedAnchor.x + 28, lockedAnchor.y - 24, { steps: 6 }); await target.mouse.up();
      const afterLockedDrag = await target.evaluate(() => proChart.drawings[0].edit.points.map(point => ({ time: point.time, price: point.price })));
      check(JSON.stringify(afterLockedDrag) === JSON.stringify(beforeLock.points), 'locked anchor changed during drag');

      await target.locator(`[data-drawing-id="${beforeLock.id}"] [data-drawing-action="visibility"]`).click();
      const hidden = await target.evaluate(() => ({ visible: proChart.drawings[0].visible,
        label: document.querySelector('[data-drawing-action="visibility"]').getAttribute('aria-label'),
        removeDisabled: document.querySelector('[data-drawing-action="remove"]').disabled }));
      check(!hidden.visible && hidden.label === '显示对象' && hidden.removeDisabled, 'locked drawing could not be hidden independently of its lock');
      await target.locator(`[data-drawing-id="${beforeLock.id}"] [data-drawing-action="visibility"]`).click();
      check(await target.evaluate(() => proChart.drawings[0].visible), 'locked drawing could not be shown again');

      await target.locator(`[data-drawing-id="${beforeLock.id}"] [data-drawing-action="lock"]`).click();
      const unlocked = await target.evaluate(() => ({ locked: proChart.drawings[0].locked,
        handles: document.querySelectorAll('#chartDrawingOverlay [data-anchor-index]').length,
        removeDisabled: document.querySelector('[data-drawing-action="remove"]').disabled }));
      check(!unlocked.locked && unlocked.handles === 2 && !unlocked.removeDisabled, 'unlock did not restore anchor editing and deletion');

      const editableAnchor = await target.evaluate(() => {
        const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect(), point = proChart.drawings[0].edit.points[0];
        return { x: rect.left + surface.left + drawingTimeCoordinate(point, surface.chart.timeScale()),
          y: rect.top + surface.top + surface.series.priceToCoordinate(point.price) };
      });
      await target.mouse.move(editableAnchor.x, editableAnchor.y); await target.mouse.down();
      await target.mouse.move(editableAnchor.x + 28, editableAnchor.y - 24, { steps: 6 }); await target.mouse.up();
      const edited = await target.evaluate(() => ({
        points: proChart.drawings[0].edit.points.map(point => ({ time: point.time, price: point.price })),
        editEnded: proChart.editingDrawing === null
      }));
      check(JSON.stringify(edited.points) !== JSON.stringify(beforeLock.points), 'unlocked anchor did not move');
      check(edited.editEnded, 'anchor edit did not end on pointer release');

      await target.locator(`[data-drawing-id="${beforeLock.id}"] [data-drawing-action="remove"]`).click();
      const removed = await target.evaluate(() => ({ count: proChart.drawings.length,
        empty: document.querySelector('#drawingList').textContent.includes('暂无绘图对象') }));
      check(removed.count === 0 && removed.empty, 'unlocked drawing did not delete cleanly');
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, beforeLock, locked, afterLockedDrag, hidden, unlocked, edited, removed, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
