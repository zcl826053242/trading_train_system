// 用 browser_run_code_unsafe 的 filename 参数运行；独立 Chromium 模拟视口，不是真机。
async (page) => {
  const results = [], failures = [];
  for (const fallback of [false, true]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 667 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const name = `${viewport.width}/${fallback ? 'fallback' : 'professional'}`, errors = [], cases = [];
    const check = (ok, message) => { if (!ok) failures.push(`${name}: ${message}`); };
    try {
      await context.route('https://fapi.binance.com/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight*', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.locator('#workspaceStart').click();
      await target.locator('[data-setup-mode="free"]').click();
      await target.locator('#confirmTrainingStart').click();
      if (viewport.width <= 1100) await target.locator('#mobileTradeDrawer > summary').click();
      await target.locator('#openPosition').click();
      check(await target.evaluate(() => Boolean(sim.position) && state.replayMode), 'test did not open a real replay position');
      await target.locator('#chartIndicatorsOpen').click();
      for (const key of ['rsi', 'macd', 'kdj']) await target.locator(`[data-indicator="${key}"]`).check();
      await target.locator('#chartIndicatorsClose').click();
      await target.locator('[data-tool="trendline"]').click();
      await target.locator('#chart').scrollIntoViewIfNeeded();
      await target.waitForTimeout(200);
      const surface = await target.evaluate(() => { const s = drawingSurface(), r = document.getElementById('chart').getBoundingClientRect(); return { x: r.x + s.left, y: r.y + s.top, w: s.chart.timeScale().width(), h: s.chart.panes()[0].getHeight() }; });
      for (const [x, y] of [[.3, .5], [.6, .7]]) await target.mouse.click(surface.x + surface.w * x, surface.y + surface.h * y);
      check(await target.evaluate(() => proChart.drawings.length === 1), 'test did not create a trendline');
      await target.locator('[data-tool="cursor"]').click();
      await target.locator('[data-pane-boundary="0"]').focus();
      await target.locator('[data-pane-boundary="0"]').press('ArrowDown');
      const snap = async () => { await target.waitForTimeout(150); return target.evaluate(() => ({ panes: chartPaneSnapshot(), height: document.getElementById('chart').clientHeight, focused: chartPaneSizing.focused, separatorsHidden: document.getElementById('chartPaneSeparators').hidden, overflow: document.documentElement.scrollWidth - innerWidth })); };
      const invariant = () => target.evaluate(() => JSON.stringify({ account: sim, reveal: state.revealCount, timeframe: state.timeframe, session: state.sessionStart, decisions: replayTraining.decisions, drawings: proChart.drawings.map(x => x.edit), layouts: localStorage.getItem('trend-lab-pane-layouts') }));
      const range = () => target.evaluate(() => proChart.chart?.timeScale().getVisibleLogicalRange() || { zoom: state.chartZoom, offset: state.chartOffset });
      const projection = () => target.evaluate(() => {
        const s = drawingSurface(), r = document.getElementById('chart').getBoundingClientRect();
        return [...document.querySelectorAll('#chartDrawingOverlay [data-anchor-index]')].map(node => {
          const point = proChart.drawings[0].edit.points[Number(node.dataset.anchorIndex)];
          const actual = new DOMPoint(Number(node.getAttribute('cx')), Number(node.getAttribute('cy'))).matrixTransform(node.ownerSVGElement.getScreenCTM());
          return Math.hypot(actual.x - r.left - s.left - s.chart.timeScale().timeToCoordinate(point.time), actual.y - r.top - s.top - s.series.priceToCoordinate(point.price));
        });
      });
      const baseline = await snap(), before = await invariant(), rangeBefore = await range();
      for (const pane of ['main', 'volume', 'rsi', 'macd', 'kdj']) {
        const control = target.locator(`[data-pane-focus="${pane}"]`);
        await control.click();
        const focused = await snap(), i = focused.panes.names.indexOf(pane);
        check(focused.focused === pane && Math.abs(focused.panes.tops[i]) < 1 && Math.abs(focused.panes.heights[i] - (focused.height - 28)) < 3, `${pane} does not fill the available plot height`);
        check(focused.separatorsHidden && focused.overflow <= 0, `${pane} focus retains separators or causes overflow`);
        check(await target.locator('[data-pane-focus]:visible').count() === 1 && await control.getAttribute('aria-pressed') === 'true', `${pane} restore control unavailable`);
        const visiblePanes = await target.evaluate(() => proChart.chart
          ? chartPaneSnapshot().names.filter((name, i) => getComputedStyle(proChart.chart.panes()[i].getHTMLElement()).visibility !== 'hidden')
          : [...document.querySelectorAll('#chart [data-chart-pane], #chart [data-indicator-pane]')].filter(node => getComputedStyle(node).display !== 'none').map(node => node.dataset.chartPane || node.dataset.indicatorPane));
        check(JSON.stringify(visiblePanes) === JSON.stringify([pane]), `${pane} focus left other pane canvases visible`);
        check(await target.locator('#chartAutoScale').isDisabled() === (pane !== 'main'), `${pane} main axis control state incorrect`);
        if (pane !== 'main') check(!await target.locator('#chartDrawingOverlay').isVisible(), `${pane} focus left price drawings visible`);
        check(await invariant() === before, `${pane} focus changed account, replay, drawing or saved proportions`);
        check(JSON.stringify(await range()) === JSON.stringify(rangeBefore), `${pane} focus changed the visible range`);
        await target.locator('#chart').focus(); await target.locator('#chart').press('Home'); await target.locator('#chart').press('ArrowRight');
        check(await target.evaluate(() => chartInspection.active && chartInspection.index === chartInspection.first + 1), `${pane} keyboard inspection failed`);
        check(await invariant() === before, `${pane} inspection advanced replay`);
        await control.click();
        const restored = await snap();
        check(!restored.focused && restored.panes.heights.every((h, j) => Math.abs(h - baseline.panes.heights[j]) < 2), `${pane} restore lost custom proportions`);
        const projectionErrors = await projection();
        check(projectionErrors.length === 2 && projectionErrors.every(error => error < 1), `${pane} restore detached drawing handles`);
        check(await target.locator('#chartAutoScale').isEnabled(), `${pane} restore left main axis control disabled`);
        cases.push({ pane, height: focused.panes.heights[i], restored: restored.panes.heights, projectionErrors });
      }
      await target.locator('[data-pane-focus="rsi"]').click(); await snap();
      await target.locator('#chart').focus(); await target.locator('#chart').press('Home'); await target.locator('#chart').press('ArrowRight');
      check(await target.evaluate(() => chartInspection.active), 'keyboard inspection did not become active before Escape');
      await target.keyboard.press('Escape'); await snap();
      check(await target.evaluate(() => !chartPaneSizing.focused && !chartInspection.active), 'Escape did not restore pane and clear stale crosshair/readout');
      // 双击绘图区放大/还原，右侧价格轴仍保留自动缩放语义。
      await target.locator('#chart').scrollIntoViewIfNeeded();
      const box = await target.locator('#chart').boundingBox(), s = (await snap()).panes, v = s.names.indexOf('volume');
      await target.mouse.dblclick(box.x + box.width * .35, box.y + s.tops[v] + s.heights[v] * .6);
      check((await snap()).focused === 'volume', 'plot double click did not maximize volume');
      await target.mouse.dblclick(box.x + box.width * .35, box.y + 80);
      check(!(await snap()).focused, 'plot double click did not restore volume');
      await target.locator('#chartAutoScale').click(); await snap();
      await target.locator('#chart').scrollIntoViewIfNeeded();
      const axisBox = await target.locator('#chart').boundingBox(), main = (await snap()).panes;
      await target.mouse.dblclick(axisBox.x + axisBox.width - 12, axisBox.y + main.heights[0] * .6);
      check(!(await snap()).focused && await target.locator('#chartAutoScale').getAttribute('aria-pressed') === 'true', 'price axis double click should restore autoscale, not maximize pane');
      await target.locator('[data-pane-focus="rsi"]').click(); await snap();
      const zoomBefore = await range(); await target.locator('#chartZoomIn').click(); await snap();
      const zoomed = await range();
      check(JSON.stringify(zoomed) !== JSON.stringify(zoomBefore), 'zoom controls inactive while focused');
      await target.locator('[data-pane-focus="rsi"]').click(); await snap();
      check(JSON.stringify(await range()) === JSON.stringify(zoomed), 'restore discarded focused zoom');
      await target.locator('[data-pane-focus="macd"]').click(); await snap();
      await target.setViewportSize({ width: 901, height: 760 }); await snap();
      await target.setViewportSize(viewport); await snap();
      await target.locator('#chartFullscreen').click(); await target.waitForFunction(() => document.fullscreenElement);
      const fs = await snap(), fsIndex = fs.panes.names.indexOf('macd');
      check(Math.abs(fs.panes.heights[fsIndex] - (fs.height - 28)) < 3, 'fullscreen focus did not fit viewport');
      // Escape 先还原单窗格，下一次再退出全屏。
      await target.keyboard.press('Escape'); await snap();
      check(await target.evaluate(() => !chartPaneSizing.focused && Boolean(document.fullscreenElement)), 'Escape did not restore pane before fullscreen exit');
      await target.keyboard.press('Escape'); await target.waitForFunction(() => !document.fullscreenElement); await snap();
      check(await invariant() === before, 'resize/fullscreen changed training state or persisted proportions');
      await target.locator('[data-pane-focus="kdj"]').click(); await snap();
      await target.locator('#chartIndicatorsOpen').click(); await target.locator('[data-indicator="kdj"]').uncheck(); await target.locator('#chartIndicatorsClose').click();
      check(!(await snap()).focused, 'removing focused indicator stranded the chart');
      check(await target.locator('#chartAutoScale').isEnabled(), 'removing focused indicator left main axis control disabled');
      await target.locator('[data-pane-focus="rsi"]').click(); await snap();
      await target.locator('[data-tool="trendline"]').click();
      check(!(await snap()).focused, 'drawing tool did not restore hidden main pane');
      await target.locator('[data-tool="cursor"]').click();
      await target.locator('[data-pane-focus="volume"]').click(); await snap();
      await target.locator('summary[aria-label="图表设置"]').click(); await target.locator('#resetChartPaneLayout').click(); await target.locator('summary[aria-label="图表设置"]').click();
      check(!(await snap()).focused, 'panel reset left focused chart active');
      await target.locator('[data-pane-focus="rsi"]').click(); await snap();
      await target.reload({ waitUntil: 'domcontentloaded' }); await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      check(!(await snap()).focused, 'temporary focus unexpectedly persisted after reload');
      check(await target.evaluate(() => Boolean(sim.position) && state.replayMode), 'reload lost the real position/replay');
      // 直接构造空行情边界验证显示层清理；并非真实接口故障验收。
      await target.locator('[data-pane-focus="rsi"]').click(); await snap();
      await target.evaluate(() => { state.replayMode = false; state.dataMode = 'live'; state.liveRows = []; state.liveLoading = false; state.liveError = 'focus cleanup test'; renderChart(); });
      check(!(await snap()).focused && await target.locator('[data-pane-focus]:visible').count() === 0, 'empty market retained pane focus/actions');
      target.once('dialog', dialog => dialog.accept());
      check(await target.evaluate(() => setDataMode('sim')), 'test did not confirm switching the existing position context'); await snap();
      check(await target.locator('[data-pane-focus="main"]').isVisible() && await target.locator('#chartAutoScale').isEnabled(), 'new data did not restore usable pane/axis controls');
      check(!errors.length, errors.join('; '));
      results.push({ name, cases, fullscreen: fs, errors });
    } catch (error) { failures.push(`${name}: ${error.message}`); }
    finally { await context.close(); }
  }
  return { passed: !failures.length, results, failures };
}
