// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 验证桌面和窄屏全屏下绘图对象管理器保持可见、可操作。
async (page) => {
  const failures = [], results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const name = `${viewport.width}x${viewport.height}`, errors = [];
    const check = (condition, message) => { if (!condition) failures.push(`${name}: ${message}`); };
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/');
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.locator('summary[aria-label="图表设置"]').click();
      await target.locator('#simDataBtn').click();
      await target.locator('summary[aria-label="图表设置"]').click();
      await target.locator('#chart').scrollIntoViewIfNeeded();
      await target.locator('[data-tool="trendline"]').click();
      const anchors = await target.evaluate(() => {
        const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect();
        const width = surface.chart.timeScale().width(), height = surface.chart.panes()[0].getHeight();
        return [[.35, .65], [.65, .35]].map(([x, y]) => ({
          x: rect.left + surface.left + width * x,
          y: rect.top + surface.top + height * y
        }));
      });
      for (const point of anchors) await target.mouse.click(point.x, point.y);
      await target.waitForFunction(() => proChart.drawings.length === 1 && proChart.drawings[0].edit.points.length === 2);
      await target.locator('[data-tool="cursor"]').click();

      await target.locator('#chartFullscreen').click();
      await target.waitForFunction(() => document.fullscreenElement === document.querySelector('.chart-wrap'));
      const fullscreen = await target.evaluate(() => {
        const manager = document.querySelector('#drawingManager'), rect = manager.getBoundingClientRect();
        return { viewport: { width: innerWidth, height: innerHeight },
          chartRect: document.querySelector('.chart-wrap').getBoundingClientRect().toJSON(),
          managerRect: rect.toJSON(), managerVisible: rect.width > 0 && rect.height > 0,
          managerInsideFullscreen: document.fullscreenElement.contains(manager),
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      check(fullscreen.managerVisible && fullscreen.managerInsideFullscreen, 'drawing manager is not visible inside fullscreen chart');
      check(fullscreen.overflow <= 0, `fullscreen document has horizontal overflow (${fullscreen.overflow}px)`);

      const manager = target.locator('#drawingManager');
      if (!(await manager.evaluate(details => details.open))) await manager.locator('summary').click();
      const row = target.locator('[data-drawing-id]');
      await row.locator('[data-drawing-action="lock"]').click();
      const locked = await target.evaluate(() => ({ locked: proChart.drawings[0].locked,
        removeDisabled: document.querySelector('[data-drawing-action="remove"]').disabled,
        handles: document.querySelectorAll('#chartDrawingOverlay [data-anchor-index]').length }));
      check(locked.locked && locked.removeDisabled && locked.handles === 0, 'fullscreen lock state did not apply');

      const geometry = () => target.evaluate(() => proChart.drawings[0].edit.points.map(point => ({ time: point.time, price: point.price })));
      const beforeLockedDrag = await geometry();
      const firstAnchor = await target.evaluate(() => {
        const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect(), point = proChart.drawings[0].edit.points[0];
        return { x: rect.left + surface.left + drawingTimeCoordinate(point, surface.chart.timeScale()),
          y: rect.top + surface.top + surface.series.priceToCoordinate(point.price) };
      });
      await target.mouse.move(firstAnchor.x, firstAnchor.y); await target.mouse.down();
      await target.mouse.move(firstAnchor.x + 26, firstAnchor.y - 20, { steps: 6 }); await target.mouse.up();
      check(JSON.stringify(await geometry()) === JSON.stringify(beforeLockedDrag), 'locked fullscreen drawing moved');

      await row.locator('[data-drawing-action="visibility"]').click();
      check(await target.evaluate(() => !proChart.drawings[0].visible), 'fullscreen hide action failed');
      await target.locator('[data-drawing-id] [data-drawing-action="visibility"]').click();
      check(await target.evaluate(() => proChart.drawings[0].visible), 'fullscreen show action failed');

      await target.locator('[data-drawing-id] [data-drawing-action="lock"]').click();
      const editableAnchor = await target.evaluate(() => {
        const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect(), point = proChart.drawings[0].edit.points[0];
        return { x: rect.left + surface.left + drawingTimeCoordinate(point, surface.chart.timeScale()),
          y: rect.top + surface.top + surface.series.priceToCoordinate(point.price) };
      });
      const beforeEdit = await geometry();
      await target.mouse.move(editableAnchor.x, editableAnchor.y); await target.mouse.down();
      await target.mouse.move(editableAnchor.x + 26, editableAnchor.y - 20, { steps: 6 }); await target.mouse.up();
      const afterEdit = await geometry();
      check(JSON.stringify(afterEdit) !== JSON.stringify(beforeEdit), 'unlocked fullscreen drawing did not edit');
      check(await target.evaluate(() => proChart.editingDrawing === null), 'fullscreen pointer release did not end editing');

      await target.locator('[data-drawing-id] [data-drawing-action="remove"]').click();
      check(await target.evaluate(() => proChart.drawings.length === 0), 'fullscreen delete action failed');
      const managerAfterDelete = await target.evaluate(() => document.querySelector('#drawingManager').getBoundingClientRect().height);
      check(managerAfterDelete > 0, 'drawing manager collapsed or disappeared after deleting the last object');
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, fullscreen, locked, beforeLockedDrag, beforeEdit, afterEdit, managerAfterDelete, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      results.push({ name, error: error.message, errors });
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
