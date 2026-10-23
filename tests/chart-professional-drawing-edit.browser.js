// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 每种对象使用独立页面，隔离其他绘图对象的交互状态，验证专业图锁定和锚点编辑。
async (page) => {
  const tools = [
    ['hline', 1], ['trendline', 2], ['fib', 2], ['measure', 2], ['rectangle', 2],
    ['horizontalRay', 1], ['horizontalSegment', 2], ['verticalLine', 1], ['verticalRay', 1],
    ['verticalSegment', 2], ['straightLine', 2], ['straightRay', 2], ['straightSegment', 2],
    ['trendAngle', 2], ['triangle', 3], ['parallelogram', 3], ['circle', 2], ['arrow', 2],
    ['anyWaves', 3], ['threeWaves', 4], ['fiveWaves', 6], ['eightWaves', 9]
  ];
  const failures = [], results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) for (const [tool, pointCount] of tools) {
    const context = await page.context().browser().newContext({ viewport });
    const name = `${viewport.width}x${viewport.height}/${tool}`;
    const errors = [];
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/');
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.evaluate(() => { state.dataMode = 'sim'; state.replayMode = false; state.liveRows = []; state.liveError = ''; state.liveLoading = false; renderChart(); updateSimDisplay(); });
      await target.locator('summary[aria-label="图表设置"]').click();
      await target.locator('#simDataBtn').click();
      await target.locator('summary[aria-label="图表设置"]').click();
      await target.locator('#chart').scrollIntoViewIfNeeded();

      const toolButton = target.locator(`[data-tool="${tool}"]`);
      if (['horizontalRay', 'horizontalSegment', 'verticalLine', 'verticalRay', 'verticalSegment',
        'straightLine', 'straightRay', 'straightSegment', 'trendAngle', 'triangle', 'parallelogram',
        'circle', 'arrow'].includes(tool) || tool.endsWith('Waves')) {
        await target.locator('#moreDrawingTools').click();
        if (['triangle', 'parallelogram', 'circle', 'arrow'].includes(tool) || tool.endsWith('Waves')) {
          await target.locator('#advancedDrawingTools summary').click();
          await target.locator('#advancedDrawingTools').evaluate(menu => { menu.scrollTop = menu.scrollHeight; });
        }
      }
      await toolButton.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
      await toolButton.click();
      for (let index = 0; index < pointCount; index++) {
        const point = await target.evaluate(({ index, pointCount }) => {
          const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect();
          const width = surface.chart.timeScale().width(), height = surface.chart.panes()[0].getHeight();
          return { x: rect.left + surface.left + width * (.28 + .43 * index / Math.max(1, pointCount - 1)),
            y: rect.top + surface.top + height * (.32 + .36 * (index % 2)) };
        }, { index, pointCount });
        await target.mouse.click(point.x, point.y);
      }
      if (tool === 'anyWaves') await target.locator('#finishAnyWaves').click();
      const created = await target.evaluate(() => ({ count: proChart.drawings.length,
        type: proChart.drawings[0]?.edit?.type, points: proChart.drawings[0]?.edit?.points?.length || 0,
        draft: Boolean(proChart.trendPoint || proChart.measurePoint || proChart.shapePoints.length) }));
      const expectedType = tool === 'hline' ? 'horizontal'
        : tool === 'trendline' ? 'trendline'
          : tool === 'fib' ? 'fibonacci'
            : tool === 'measure' ? 'measurement'
              : ['straightLine', 'straightRay', 'straightSegment'].includes(tool) ? 'linePrimitive' : tool;
      if (created.count !== 1 || created.type !== expectedType || created.draft) {
        failures.push(`${name}: creation failed in isolated page (${JSON.stringify(created)})`);
        results.push({ name, tool, created, errors });
        continue;
      }

      await target.locator('[data-tool="cursor"]').click();
      const drawingId = await target.evaluate(() => proChart.drawings[0].id);
      const row = target.locator(`[data-drawing-id="${drawingId}"]`);
      const probe = () => target.evaluate(() => {
        const drawing = proChart.drawings[0], surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect();
        let x, y;
        if (drawing.edit.type === 'horizontal' || drawing.edit.type === 'fibonacci') {
          const part = drawing.edit.type === 'horizontal' ? drawing.parts.find(item => item.type === 'price') : drawing.parts.find(item => item.level === 0);
          x = rect.left + surface.left + surface.chart.timeScale().width() * .5;
          y = rect.top + surface.top + part.owner.priceToCoordinate(part.options.price);
        } else {
          const point = drawing.edit.points[0];
          x = rect.left + surface.left + drawingTimeCoordinate(point, surface.chart.timeScale());
          y = rect.top + surface.top + surface.series.priceToCoordinate(point.price);
        }
        return { x, y, geometry: { points: drawing.edit.points?.map(point => ({ ...point })) ?? null,
          prices: drawing.parts.filter(part => part.type === 'price').map(part => part.options.price) } };
      });
      const lockedProbe = await probe();
      await row.locator('[data-drawing-action="lock"]').click();
      // 在手机高度下，对象管理行会在图表下方，点击后浏览器可能滚动到操作按钮。
      // 先把主图重新滚回视口，再投影锚点；不能把视口外坐标误判成绘图拖动失败。
      await target.locator('#chart').scrollIntoViewIfNeeded();
      await target.waitForTimeout(80);
      const visibleLockedProbe = await probe();
      await target.mouse.move(visibleLockedProbe.x, visibleLockedProbe.y); await target.mouse.down();
      await target.mouse.move(visibleLockedProbe.x + 22, visibleLockedProbe.y - 18, { steps: 6 }); await target.mouse.up();
      const afterLockedDrag = await probe();
      const locked = await target.evaluate(() => proChart.drawings[0].locked);
      if (!locked || JSON.stringify(afterLockedDrag.geometry) !== JSON.stringify(lockedProbe.geometry)) {
        failures.push(`${name}: locked geometry changed during pointer drag`);
      }

      await row.locator('[data-drawing-action="lock"]').click();
      await target.locator('#chart').scrollIntoViewIfNeeded();
      await target.waitForTimeout(80);
      const editableProbe = await probe();
      await target.mouse.move(editableProbe.x, editableProbe.y); await target.mouse.down();
      await target.mouse.move(editableProbe.x + 22, editableProbe.y - 18, { steps: 6 }); await target.mouse.up();
      const afterEdit = await probe();
      if (JSON.stringify(afterEdit.geometry) === JSON.stringify(editableProbe.geometry)) {
        failures.push(`${name}: unlocked geometry did not change after dragging its edit target`);
      }
      const editEnded = await target.evaluate(() => proChart.editingDrawing === null);
      if (!editEnded) failures.push(`${name}: pointer release did not end drawing edit`);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, tool, created, lockedGeometry: afterLockedDrag.geometry,
        editedGeometry: afterEdit.geometry, editEnded, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      results.push({ name, tool, error: error.message, errors });
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, toolCount: tools.length, viewportCount: 2, results, failures };
}
