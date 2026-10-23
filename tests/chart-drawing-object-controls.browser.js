// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 独立 context 验证两套图表引擎的绘图对象锁定、显隐、编辑和删除流程。
async (page) => {
  const tools = [
    ['hline', 1], ['trendline', 2], ['fib', 2], ['measure', 2], ['rectangle', 2],
    ['horizontalRay', 1], ['horizontalSegment', 2], ['verticalLine', 1], ['verticalRay', 1],
    ['verticalSegment', 2], ['straightLine', 2], ['straightRay', 2], ['straightSegment', 2],
    ['trendAngle', 2], ['triangle', 3], ['parallelogram', 3], ['circle', 2], ['arrow', 2],
    ['anyWaves', 3], ['threeWaves', 4], ['fiveWaves', 6], ['eightWaves', 9]
  ];
  const failures = [], results = [];
  for (const fallback of [false, true]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [], name = `${viewport.width}/${fallback ? 'fallback' : 'professional'}`;
    const check = (condition, message) => { if (!condition) failures.push(`${name}: ${message}`); };
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight-charts*', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/');
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.evaluate(() => { state.dataMode = 'sim'; state.replayMode = false; state.liveRows = []; state.liveError = ''; state.liveLoading = false; renderChart(); updateSimDisplay(); });
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

      const objectChecks = [];
      for (const [tool, pointCount] of tools) {
        await target.locator('#clearDrawings').click();
        if (['horizontalRay', 'horizontalSegment', 'verticalLine', 'verticalRay', 'verticalSegment',
          'straightLine', 'straightRay', 'straightSegment', 'trendAngle', 'triangle', 'parallelogram',
          'circle', 'arrow'].includes(tool) || tool.endsWith('Waves')) {
          await target.locator('#moreDrawingTools').click();
          if (['triangle', 'parallelogram', 'circle', 'arrow'].includes(tool) || tool.endsWith('Waves')) {
            await target.locator('#advancedDrawingTools summary').click();
            await target.locator('#advancedDrawingTools').evaluate(menu => { menu.scrollTop = menu.scrollHeight; });
          }
        }
        const toolButton = target.locator(`[data-tool="${tool}"]`);
        await toolButton.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
        await toolButton.click();
        for (let index = 0; index < pointCount; index++) {
          // 对象管理器在手机端位于图表之后，打开后可能滚动页面；每次落点前确保主图处于视口内。
          await target.locator('#chart').scrollIntoViewIfNeeded();
          const point = await target.evaluate(({ index, pointCount }) => {
            const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect();
            const width = surface.chart.timeScale().width(), height = surface.chart.panes()[0].getHeight();
            return { x: rect.left + surface.left + width * (.28 + .43 * index / Math.max(1, pointCount - 1)),
              y: rect.top + surface.top + height * (.32 + .36 * (index % 2)) };
          }, { index, pointCount });
          await target.mouse.click(point.x, point.y);
        }
        if (tool === 'anyWaves') await target.locator('#finishAnyWaves').click();
        const created = await target.evaluate(tool => ({
          count: proChart.drawings.length,
          type: proChart.drawings[0]?.edit?.type,
          fallback: Boolean(proChart.fallback),
          draft: Boolean(proChart.trendPoint || proChart.measurePoint || proChart.shapePoints.length)
        }), tool);
        const expectedType = tool === 'hline' ? 'horizontal'
          : tool === 'trendline' ? 'trendline'
            : tool === 'fib' ? 'fibonacci'
              : tool === 'measure' ? 'measurement'
                : ['straightLine', 'straightRay', 'straightSegment'].includes(tool) ? 'linePrimitive' : tool;
        check(created.count === 1 && created.type === expectedType && created.fallback === fallback && !created.draft,
          `${tool}: object creation did not finish cleanly (${JSON.stringify(created)})`);
        await target.locator('[data-tool="cursor"]').click();
        const drawingId = await target.evaluate(() => proChart.drawings[0]?.id);
        const objectRow = target.locator(`[data-drawing-id="${drawingId}"]`);
        await objectRow.locator('[data-drawing-action="lock"]').click();
        const lockedState = await target.evaluate(() => ({ locked: proChart.drawings[0].locked,
          removeDisabled: document.querySelector('[data-drawing-action="remove"]').disabled }));
        check(lockedState.locked && lockedState.removeDisabled, `${tool}: lock did not protect object from deletion`);
        await target.locator(`[data-drawing-id="${drawingId}"] [data-drawing-action="visibility"]`).click();
        const hiddenState = await target.evaluate(() => ({ visible: proChart.drawings[0].visible,
          label: document.querySelector('[data-drawing-action="visibility"]').getAttribute('aria-label') }));
        check(!hiddenState.visible && hiddenState.label === '显示对象', `${tool}: locked object could not be hidden`);
        await target.locator(`[data-drawing-id="${drawingId}"] [data-drawing-action="visibility"]`).click();
        const shown = await target.evaluate(() => proChart.drawings[0].visible);
        check(shown, `${tool}: locked object could not be shown`);
        await target.locator(`[data-drawing-id="${drawingId}"] [data-drawing-action="lock"]`).click();
        const unlockedState = await target.evaluate(() => ({ locked: proChart.drawings[0].locked,
          removeDisabled: document.querySelector('[data-drawing-action="remove"]').disabled }));
        check(!unlockedState.locked && !unlockedState.removeDisabled, `${tool}: unlock did not restore deletion`);
        await target.locator(`[data-drawing-id="${drawingId}"] [data-drawing-action="remove"]`).click();
        const count = await target.evaluate(() => proChart.drawings.length);
        check(count === 0, `${tool}: object remained after deletion`);
        objectChecks.push({ tool, created, lockedState, hiddenState, shown, unlockedState, count });
      }
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, beforeLock, locked, afterLockedDrag, hidden, unlocked, edited, removed, objectChecks, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, toolCount: tools.length, results, failures };
}
