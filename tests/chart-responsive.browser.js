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
        await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
        await context.route('**/unpkg.com/**', route => route.abort());
        if (fallback) await context.route('**/vendor/lightweight-charts*', route => route.abort());
        const target = await context.newPage();
        target.on('pageerror', error => errors.push(error.message));
        await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
        await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
        await target.locator('[data-nav-target="market"]').click();
        await target.evaluate(() => { state.dataMode = 'sim'; state.replayMode = false; state.liveRows = []; state.liveError = ''; state.liveLoading = false; renderChart(); updateSimDisplay(); });
        for (const paneCount of [0, 1, 2, 3]) {
          const multi = paneCount === 3;
          if (paneCount) {
            await target.locator('#chartIndicatorsOpen').click();
            await target.locator(`[data-indicator="${['rsi', 'macd', 'kdj'][paneCount - 1]}"]`).check();
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
            const paneCurves = svg ? [...svg.querySelectorAll('[data-indicator-pane]')].map(pane => {
              const legend = legends.find(item => item.name === pane.dataset.indicatorPane);
              const nodes = [...pane.querySelectorAll('path, rect')];
              return { name: pane.dataset.indicatorPane, count: nodes.length, clear: nodes.every(node => {
                const r = node.getBoundingClientRect();
                return r.top - chart.top >= legend.bottom + 2 && r.bottom - chart.top <= node.ownerSVGElement.viewBox.baseVal.height - 28;
              }) };
            }) : [];
            return {
              mode: svg ? 'fallback' : 'professional', width: chart.width, height: chart.height,
              overflow: document.documentElement.scrollWidth - innerWidth, legends, paneHeights, paneCurves,
              curveHeight: svgLayout ? svgLayout.paneStep - 37 : null,
              fallbackMainHeight: svgLayout?.plot.h, fallbackVolumeHeight: svgLayout?.plot.volH,
              paneAxes: svg ? [...svg.querySelectorAll('[data-pane-axis]')].map(node => {
                const r = node.getBoundingClientRect();
                return { name: node.dataset.paneAxis, top: r.top - chart.top, bottom: r.bottom - chart.top,
                  left: r.left - chart.left, right: r.right - chart.left };
              }) : [],
              svgSizeError: svg ? Math.max(Math.abs(svg.viewBox.baseVal.width - node.clientWidth), Math.abs(svg.viewBox.baseVal.height - node.clientHeight)) : 0,
              accountTop: document.querySelector('.chart-account-summary').getBoundingClientRect().top,
              stageBottom: document.querySelector('#chartStage').getBoundingClientRect().bottom
            };
          });
          const name = `${width}x${height}/${fallback ? 'fallback' : 'professional'}/${multi ? 'three-panes' : paneCount ? `${paneCount}-panes` : 'default'}`;
          const checks = [
            [metrics.mode === (fallback ? 'fallback' : 'professional'), 'wrong chart path'],
            [metrics.overflow <= 0, 'horizontal overflow'],
            [metrics.svgSizeError < 1, 'SVG pixel scale differs from container'],
            // 默认清爽预设不显示 SMA/EMA，主图没有指标读数图例；成交量始终保留。
            [metrics.legends.length === paneCount + 1, 'missing pane legends'],
            [metrics.legends.every(p => p.top >= -1 && p.bottom <= metrics.height + 1 && p.left >= -1 && p.right <= metrics.width + 1), 'legend outside chart'],
            [metrics.accountTop >= metrics.stageBottom - 1, 'account overlaps chart']
          ];
          if (multi && width >= 561 && width <= 1100) {
            checks.push([metrics.height >= 490, 'tablet controls compressed chart below 490px']);
            checks.push([fallback ? metrics.curveHeight >= 20 : metrics.paneHeights.slice(2).every(h => h >= 56), 'tablet oscillator drawing height too small']);
          }
          if (paneCount && fallback) {
            checks.push([metrics.curveHeight >= 35, 'oscillator curves compressed below 35px']);
            checks.push([metrics.fallbackMainHeight >= 88 && metrics.fallbackVolumeHeight >= 28, 'oscillators squeezed main/volume too far']);
            checks.push([['rsi', 'macd', 'kdj'].slice(0, paneCount).every(name => metrics.paneAxes.filter(axis => axis.name === name).length >= 2), 'missing oscillator scale']);
            checks.push([metrics.paneAxes.every(axis => axis.left >= 0 && axis.right <= metrics.width + 1 && axis.top >= 0 && axis.bottom <= metrics.height), 'oscillator scale outside chart']);
            checks.push([metrics.paneCurves.length === paneCount && metrics.paneCurves.every(pane => pane.count > 0 && pane.clear), 'oscillator data overlaps readouts or time axis']);
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
        if (fallback) {
          // 零成交量、横盘会使MACD全为0；实际渲染的上下刻度仍应分离。
          const flat = await target.evaluate(() => {
            state.liveRows = buildData(state.scenario, state.timeframe).map(row => ({ ...row, open: 100, high: 101, low: 99, close: 100, volume: 0 }));
            state.dataMode = 'live'; renderChart();
            const ticks = [...document.querySelectorAll('[data-pane-axis="macd"]')].map(node => ({ value: Number(node.dataset.axisValue), y: node.getBoundingClientRect().top }));
            return { ticks, finite: [...document.querySelectorAll('[data-indicator-pane] path')].every(node => !/NaN|Infinity/.test(node.getAttribute('d'))) };
          });
          if (!flat.finite || flat.ticks.length !== 2 || flat.ticks[0].value <= flat.ticks[1].value || flat.ticks[1].y - flat.ticks[0].y < 30) failures.push(`${name}: flat MACD has overlapping scales or invalid paths`);
        }
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
