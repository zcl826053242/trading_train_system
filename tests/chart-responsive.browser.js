// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；先启动本地 4188 服务。
// 独立 context，不读取或改写已有页面的训练记录；联网行情不在本测试范围。
async (page) => {
  const cases = [[1440, 900], [1100, 760], [901, 760], [844, 390], [561, 760], [390, 667], [390, 844], [320, 667]];
  const results = [], interactions = [], failures = [];
  for (const fallback of [false, true]) {
    for (const [width, height] of cases) {
      const context = await page.context().browser().newContext({ viewport: { width, height } });
      const errors = [];
      try {
        await context.route('**/api/v5/**', route => route.abort());
        await context.route('**/unpkg.com/**', route => route.abort());
        if (fallback) await context.route('**/vendor/lightweight-charts*', route => route.abort());
        const target = await context.newPage();
        target.on('pageerror', error => errors.push(error.message));
        await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
        await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
        await target.locator('[data-nav-target="market"]').click();
        for (const multi of [false, true]) {
          if (multi) {
            await target.locator('#chartIndicatorsOpen').click();
            for (const name of ['rsi', 'macd', 'kdj']) await target.locator(`[data-indicator="${name}"]`).check();
            await target.locator('#chartIndicatorsClose').click();
          }
          await target.waitForTimeout(150);
          const metrics = await target.evaluate(() => {
            const node = document.querySelector('#chart'), chart = node.getBoundingClientRect();
            const svg = node.querySelector('.chart-fallback');
            const paneHeights = proChart.chart?.panes().map(pane => pane.getHeight());
            const svgLayout = svg && fallbackChartLayout(node.clientWidth, node.clientHeight,
              ['rsi', 'macd', 'kdj'].filter(name => state.indicator[name]).length);
            const legends = [...document.querySelectorAll('[data-pane-legend]')].filter(node => !node.hidden).map(node => {
              const r = node.getBoundingClientRect();
              return { name: node.dataset.paneLegend, top: r.top - chart.top, bottom: r.bottom - chart.top, left: r.left - chart.left, right: r.right - chart.left };
            });
            return {
              mode: svg ? 'fallback' : 'professional', width: chart.width, height: chart.height,
              overflow: document.documentElement.scrollWidth - innerWidth, legends, paneHeights,
              curveHeight: svgLayout ? svgLayout.paneStep - 37 : null,
              svgSizeError: svg ? Math.max(Math.abs(svg.viewBox.baseVal.width - node.clientWidth), Math.abs(svg.viewBox.baseVal.height - node.clientHeight)) : 0,
              accountTop: document.querySelector('.chart-account-summary').getBoundingClientRect().top,
              stageBottom: document.querySelector('#chartStage').getBoundingClientRect().bottom
            };
          });
          const name = `${width}x${height}/${fallback ? 'fallback' : 'professional'}/${multi ? 'three-panes' : 'default'}`;
          const checks = [
            [metrics.mode === (fallback ? 'fallback' : 'professional'), 'wrong chart path'],
            [metrics.overflow <= 0, 'horizontal overflow'],
            [metrics.svgSizeError < 1, 'SVG pixel scale differs from container'],
            [metrics.legends.length === (multi ? 5 : 2), 'missing pane legends'],
            [metrics.legends.every(p => p.top >= -1 && p.bottom <= metrics.height + 1 && p.left >= -1 && p.right <= metrics.width + 1), 'legend outside chart'],
            [metrics.accountTop >= metrics.stageBottom - 1, 'account overlaps chart']
          ];
          if (multi && width >= 561 && width <= 1100) {
            checks.push([metrics.height >= 490, 'tablet controls compressed chart below 490px']);
            checks.push([fallback ? metrics.curveHeight >= 20 : metrics.paneHeights.slice(2).every(h => h >= 56), 'tablet oscillator drawing height too small']);
          }
          const broken = checks.filter(([ok]) => !ok).map(([, message]) => message);
          failures.push(...broken.map(message => `${name}: ${message}`));
          results.push({ name, ...metrics, failures: broken });
        }
        const name = `${width}x${height}/${fallback ? 'fallback' : 'professional'}`;
        const originalHeight = await target.locator('#chart').evaluate(node => node.clientHeight);
        if (width <= 1100) {
          await target.locator('#mobileTradeDrawer > summary').click();
          const drawer = await target.evaluate(() => ({
            open: document.querySelector('#mobileTradeDrawer').open,
            height: document.querySelector('#chart').clientHeight,
            attached: document.querySelector('#mobileTradeDock .replay-trade-panel') !== null
          }));
          if (!drawer.open || !drawer.attached || drawer.height !== originalHeight) failures.push(`${name}: drawer changed chart height or lost trading panel`);
          await target.locator('#mobileTradeDrawer > summary').click();
        }
        await target.locator('#chartFullscreen').click();
        await target.waitForFunction(() => document.fullscreenElement !== null);
        await target.waitForTimeout(150);
        const fullscreen = await target.evaluate(() => {
          const rect = document.fullscreenElement.getBoundingClientRect();
          const chart = document.querySelector('#chart').getBoundingClientRect();
          return { height: rect.height, width: rect.width, chartBottom: chart.bottom,
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        if (Math.abs(fullscreen.height - height) > 1 || Math.abs(fullscreen.width - width) > 1 || fullscreen.chartBottom > height + 1 || fullscreen.overflow > 0) failures.push(`${name}: fullscreen escaped viewport`);
        await target.locator('#chartFullscreen').click();
        await target.waitForFunction(() => document.fullscreenElement === null);
        await target.waitForTimeout(150);
        const restoredHeight = await target.locator('#chart').evaluate(node => node.clientHeight);
        if (Math.abs(originalHeight - restoredHeight) > 1) failures.push(`${name}: exit fullscreen changed chart height`);
        interactions.push({ name, drawer: width <= 1100, originalHeight, fullscreen, restoredHeight });
        if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      } catch (error) {
        failures.push(`${width}x${height}/${fallback}: ${error.message}`);
      } finally {
        await context.close();
      }
    }
  }
  return { passed: failures.length === 0, results, interactions, failures };
}
