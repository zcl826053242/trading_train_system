// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 在真实浏览器全屏状态下验证两种图表引擎的22类绘图工具均可创建并清理。
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
    const name = `${viewport.width}/${fallback ? 'fallback' : 'professional'}`;
    const errors = [], checks = [];
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight-charts*', route => route.abort());
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
      if (Boolean(await target.evaluate(() => proChart.fallback)) !== fallback) throw Error('wrong chart engine loaded');
      await target.locator('#chartFullscreen').click();
      await target.waitForFunction(() => document.fullscreenElement === document.querySelector('.chart-wrap'));
      const frame = await target.evaluate(() => {
        const chart = document.querySelector('#chart').getBoundingClientRect(), full = document.querySelector('.chart-wrap').getBoundingClientRect();
        return { width: full.width, height: full.height, chartWidth: chart.width, chartHeight: chart.height,
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      if (Math.abs(frame.width - viewport.width) > 1 || Math.abs(frame.height - viewport.height) > 1 || frame.overflow > 0) {
        failures.push(`${name}: fullscreen frame mismatch (${JSON.stringify(frame)})`);
      }

      const point = async (index, count) => {
        const position = await target.evaluate(({ index, count }) => {
          const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect();
          const width = surface.chart.timeScale().width(), height = surface.chart.panes()[0].getHeight();
          return { x: rect.left + surface.left + width * (.28 + .43 * index / Math.max(1, count - 1)),
            y: rect.top + surface.top + height * (.32 + .36 * (index % 2)) };
        }, { index, count });
        await target.mouse.click(position.x, position.y);
      };
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
        const button = target.locator(`[data-tool="${tool}"]`);
        await button.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
        await button.click();
        for (let index = 0; index < pointCount; index++) await point(index, pointCount);
        if (tool === 'anyWaves') await target.locator('#finishAnyWaves').click();
        const created = await target.evaluate(() => ({ count: proChart.drawings.length,
          type: proChart.drawings[0]?.edit?.type, fallback: Boolean(proChart.fallback),
          draft: Boolean(proChart.trendPoint || proChart.measurePoint || proChart.shapePoints.length) }));
        const expectedType = tool === 'hline' ? 'horizontal'
          : tool === 'trendline' ? 'trendline'
            : tool === 'fib' ? 'fibonacci'
              : tool === 'measure' ? 'measurement'
                : ['straightLine', 'straightRay', 'straightSegment'].includes(tool) ? 'linePrimitive' : tool;
        const ok = created.count === 1 && created.type === expectedType && created.fallback === fallback && !created.draft;
        if (!ok) failures.push(`${name}/${tool}: fullscreen create failed (${JSON.stringify(created)})`);
        await target.locator('#clearDrawings').click();
        const cleared = await target.evaluate(() => ({ count: proChart.drawings.length,
          draft: Boolean(proChart.trendPoint || proChart.measurePoint || proChart.shapePoints.length),
          fullscreen: document.fullscreenElement === document.querySelector('.chart-wrap'),
          managerVisible: document.querySelector('#drawingManager').getBoundingClientRect().height > 0 }));
        if (cleared.count !== 0 || cleared.draft || !cleared.fullscreen || !cleared.managerVisible) {
          failures.push(`${name}/${tool}: fullscreen clear/state failed (${JSON.stringify(cleared)})`);
        }
        checks.push({ tool, created, cleared, passed: ok && cleared.count === 0 && !cleared.draft });
      }
      await target.locator('#chartFullscreen').click();
      await target.waitForFunction(() => document.fullscreenElement === null);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, frame, toolCount: checks.length, checks, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      results.push({ name, error: error.message, errors });
    } finally {
      if (await context.pages()[0]?.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false)) {
        await context.pages()[0].keyboard.press('Escape').catch(() => {});
      }
      await context.close();
    }
  }
  return { passed: failures.length === 0, toolCount: tools.length, results, failures };
}
