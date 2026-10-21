// Playwright browser_run_code_unsafe: filename 指向此文件；本地服务端口 4188。
// 独立 context；仅用本地模拟数据，验证绘图工具入口、落点、对象创建与清除。
async (page) => {
  const tools = [
    ['hline', 1], ['trendline', 2], ['fib', 2], ['measure', 2], ['rectangle', 2],
    ['horizontalRay', 1], ['horizontalSegment', 2], ['verticalLine', 1], ['verticalRay', 1],
    ['verticalSegment', 2], ['straightLine', 2], ['straightRay', 2], ['straightSegment', 2],
    ['trendAngle', 2], ['triangle', 3], ['parallelogram', 3], ['circle', 2], ['arrow', 2],
    ['anyWaves', 3], ['threeWaves', 4], ['fiveWaves', 6], ['eightWaves', 9]
  ];
  const results = [], failures = [];
  for (const fallback of [false, true]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 667 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const name = `${fallback ? 'fallback' : 'professional'}-${viewport.width}x${viewport.height}`;
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
      await target.locator('summary[aria-label="图表设置"]').click();
      await target.locator('#simDataBtn').click();
      await target.locator('summary[aria-label="图表设置"]').click();
      await target.locator('#chart').scrollIntoViewIfNeeded();
      const chartMode = await target.evaluate(() => Boolean(proChart.fallback));
      if (chartMode !== fallback) throw Error(`expected ${fallback ? 'fallback' : 'professional'} chart`);
      const point = async (index, count) => {
        const { x, y } = await target.evaluate(({ index, count }) => {
          const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect();
          const width = surface.chart.timeScale().width(), height = surface.chart.panes()[0].getHeight();
          return { x: rect.left + surface.left + width * (.28 + .43 * index / Math.max(1, count - 1)),
            y: rect.top + surface.top + height * (.32 + .36 * ((index % 2) ? 1 : 0)) };
        }, { index, count });
        await target.mouse.click(x, y);
      };
      for (const [tool, pointCount] of tools) {
        await target.locator('#clearDrawings').click();
        const button = target.locator(`[data-tool="${tool}"]`);
        if (tool === 'horizontalRay' || tool === 'horizontalSegment' || tool === 'verticalLine'
          || tool === 'verticalRay' || tool === 'verticalSegment' || tool === 'straightLine'
          || tool === 'straightRay' || tool === 'straightSegment' || tool === 'trendAngle'
          || tool === 'triangle' || tool === 'parallelogram' || tool === 'circle' || tool === 'arrow'
          || tool.endsWith('Waves')) {
          await target.locator('#moreDrawingTools').click();
          if (tool === 'triangle' || tool === 'parallelogram' || tool === 'circle' || tool === 'arrow' || tool.endsWith('Waves')) {
            await target.locator('#advancedDrawingTools summary').click();
          }
        }
        await button.click();
        await target.locator('#chart').scrollIntoViewIfNeeded();
        for (let index = 0; index < pointCount; index++) await point(index, pointCount);
        if (tool === 'anyWaves') await target.locator('#finishAnyWaves').click();
        const result = await target.evaluate(tool => ({
          count: proChart.drawings.length,
          type: proChart.drawings[0]?.edit?.type,
          points: proChart.drawings[0]?.edit?.points?.length || 0,
          fallback: Boolean(proChart.fallback),
          draft: Boolean(proChart.trendPoint || proChart.measurePoint || proChart.shapePoints.length)
        }), tool);
        const expectedType = tool === 'hline' ? 'horizontal'
            : tool === 'trendline' ? 'trendline'
              : tool === 'fib' ? 'fibonacci'
                : tool === 'measure' ? 'measurement'
                  : ['straightLine', 'straightRay', 'straightSegment'].includes(tool) ? 'linePrimitive' : tool;
        const ok = result.count === 1 && !result.draft && result.fallback === fallback && result.type === expectedType;
        if (!ok) failures.push(`${name}/${tool}: drawing did not complete as expected (${JSON.stringify(result)})`);
        checks.push({ tool, ...result, passed: ok });
        await target.locator('#clearDrawings').click();
        const cleared = await target.evaluate(() => ({ count: proChart.drawings.length, draft: Boolean(proChart.trendPoint || proChart.measurePoint || proChart.shapePoints.length) }));
        if (cleared.count !== 0 || cleared.draft) failures.push(`${name}/${tool}: clear left drawing residue (${JSON.stringify(cleared)})`);
      }
      if (errors.length) failures.push(`${name}: page errors: ${errors.join('; ')}`);
      results.push({ name, checks, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      results.push({ name, checks, error: error.message, errors });
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, toolCount: tools.length, results, failures };
}
