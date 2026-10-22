// Playwright browser_run_code_unsafe：独立 context，本地端口 4188；不把模拟触控称为真机验收。
async (page) => {
  const failures = [], results = [];
  for (const fallback of [false, true]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 667 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const name = `${viewport.width}/${fallback ? 'fallback' : 'professional'}`, errors = [];
    const check = (ok, message) => { if (!ok) failures.push(`${name}: ${message}`); };
    try {
      await context.route('https://fapi.binance.com/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight*', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      target.on('dialog', dialog => dialog.accept());
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.evaluate(() => { state.dataMode = 'sim'; state.liveRows = []; state.liveLoading = false; state.liveError = ''; renderChart(); });
      const snapshot = async () => { await target.waitForTimeout(100); return target.evaluate(() => {
        const snapshot = chartPaneSnapshot();
        if (!snapshot?.fallback) return snapshot;
        const chart = document.getElementById('chart');
        const layout = fallbackChartLayout(chart.clientWidth, chart.clientHeight, snapshot.names.length - 2);
        return { ...snapshot, plotRatio: layout.plot.h / layout.plot.volH };
      }); };
      const invariant = () => target.evaluate(() => JSON.stringify({ reveal: state.revealCount, timeframe: state.timeframe, session: state.sessionStart, balance: sim.balance, position: sim.position, decisions: replayTraining.decisions, drawings: proChart.drawings.map(item => item.edit), zoom: state.chartZoom, offset: state.chartOffset, range: proChart.chart?.timeScale().getVisibleLogicalRange() }));
      await target.locator('#chartZoomIn').click();
      const initial = await snapshot();
      const handle = target.locator('[data-pane-boundary="0"]');
      await handle.scrollIntoViewIfNeeded();
      await target.waitForTimeout(200);
      const beforeInvariant = await invariant();
      const box = await handle.boundingBox(), delta = viewport.width === 1440 ? 45 : -25;
      await target.mouse.move(box.x + box.width * .5, box.y + 5); await target.mouse.down();
      await target.mouse.move(box.x + box.width * .5, box.y + 5 + delta, { steps: 12 }); await target.mouse.up();
      const dragged = await snapshot();
      check(Math.abs(dragged.heights[0] - initial.heights[0] - delta) < 2, 'separator did not resize the adjacent pair');
      const afterInvariant = await invariant();
      check(afterInvariant === beforeInvariant, `resizing changed chart range, account, drawing or training state: ${beforeInvariant} -> ${afterInvariant}`);
      check(await target.evaluate(() => Boolean(JSON.parse(localStorage.getItem('trend-lab-pane-layouts'))?.layouts['main,volume'])), 'layout not saved');
      await handle.focus(); await handle.press('ArrowUp');
      const keyboard = await snapshot();
      check(Math.abs(dragged.heights[0] - keyboard.heights[0] - 10) < 2, 'keyboard separator resize failed');
      // cancel 是回滚，不留下半次触控布局或持久化偏好。
      const cancelBefore = await snapshot();
      const cancelPreference = await target.evaluate(() => JSON.stringify(chartPaneSizing.layouts));
      const cancelBox = await handle.boundingBox();
      const cdp = await context.newCDPSession(target);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cancelBox.x + cancelBox.width / 2, y: cancelBox.y + 5 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cancelBox.x + cancelBox.width / 2, y: cancelBox.y + 25 }] });
      const cancelMoved = await snapshot();
      check(Math.abs(cancelMoved.heights[0] - cancelBefore.heights[0]) >= 5, 'touch-cancel test did not move the separator');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await cdp.detach();
      check(Math.abs((await snapshot()).heights[0] - cancelBefore.heights[0]) < 1, 'pointercancel did not roll back pane heights');
      check(await target.evaluate(() => JSON.stringify(chartPaneSizing.layouts)) === cancelPreference, 'pointercancel did not restore saved proportions');
      await target.reload({ waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.evaluate(() => { state.dataMode = 'sim'; state.liveRows = []; state.liveLoading = false; state.liveError = ''; renderChart(); });
      const restored = await snapshot();
      check(Math.abs(restored.heights[0] - keyboard.heights[0]) < 2, 'reload lost pane layout');
      // 改变勾选顺序后，专业/备用仍使用主图、量能、RSI、MACD、KDJ顺序。
      await target.locator('#chartIndicatorsOpen').click();
      for (const key of ['kdj', 'macd', 'rsi']) await target.locator(`[data-indicator="${key}"]`).check();
      await target.locator('#chartIndicatorsClose').click();
      const three = await snapshot();
      check(three.names.join(',') === 'main,volume,rsi,macd,kdj', 'pane order depends on indicator activation order');
      check(await target.locator('[data-pane-boundary]').count() === 4, 'missing multi-pane separators');
      // keyboard 强制到边界，主图/量能/振荡图仍保留最小可读高度。
      const lower = target.locator('[data-pane-boundary="1"]');
      await lower.focus(); for (let i = 0; i < 12; i++) await lower.press('Shift+ArrowDown');
      const constrained = await snapshot();
      const mins = await target.evaluate(() => { const s = chartPaneSnapshot(); return chartPaneMinimums(s.names, s.heights.reduce((a,b) => a+b, 0), s.fallback); });
      check(constrained.heights.every((height, i) => height >= mins[i] - 1), 'pane below readable minimum');
      // 开关指标回到之前保存的对应面板组合，而不是沿用另一个组合的比例。
      await target.locator('#chartIndicatorsOpen').click();
      for (const key of ['rsi', 'macd', 'kdj']) await target.locator(`[data-indicator="${key}"]`).uncheck();
      await target.locator('#chartIndicatorsClose').click();
      check(Math.abs((await snapshot()).heights[0] - restored.heights[0]) < 2, 'indicator toggling overwrote the saved base layout');
      // 全屏及 resize 仍有分隔线且不越界。
      await target.locator('#chartFullscreen').click();
      await target.waitForFunction(() => document.fullscreenElement);
      const fullscreen = await snapshot();
      check(await target.locator('[data-pane-boundary="0"]').isVisible(), 'separator unavailable in fullscreen');
      await target.locator('#chartFullscreen').click(); await target.waitForFunction(() => !document.fullscreenElement);
      check(Math.abs((await snapshot()).heights[0] - restored.heights[0]) < 2, 'fullscreen exit changed saved proportions');
      await target.setViewportSize({ width: 901, height: 760 }); await snapshot();
      await target.setViewportSize(viewport); await snapshot();
      // 实际创建趋势线后改变面板高度，几何不变且手柄重新投影；不只对空数组做不变性断言。
      await target.locator('[data-tool="trendline"]').click();
      await target.locator('#chart').scrollIntoViewIfNeeded();
      const surface = await target.evaluate(() => { const s = drawingSurface(), r = document.getElementById('chart').getBoundingClientRect(); return { x: r.x + s.left, y: r.y + s.top, w: s.chart.timeScale().width(), h: s.chart.panes()[0].getHeight() }; });
      for (const [x, y] of [[.35, .65], [.65, .4]]) await target.mouse.click(surface.x + surface.w * x, surface.y + surface.h * y);
      check(await target.evaluate(() => proChart.drawings.at(-1)?.edit.points?.length === 2), 'test did not create a real trendline');
      const drawingBefore = await invariant();
      await handle.focus(); await handle.press('ArrowDown'); await snapshot();
      check(await invariant() === drawingBefore, 'pane resize changed trendline geometry');
      const projection = await target.evaluate(() => {
        const s = drawingSurface(), r = document.getElementById('chart').getBoundingClientRect(), drawing = proChart.drawings.at(-1);
        return [...document.querySelectorAll('#chartDrawingOverlay [data-anchor-index]')].map(node => {
          const point = drawing.edit.points[Number(node.dataset.anchorIndex)];
          const actual = new DOMPoint(Number(node.getAttribute('cx')), Number(node.getAttribute('cy'))).matrixTransform(node.ownerSVGElement.getScreenCTM());
          // 模拟场景绘图可落在两根蜡烛之间，按连续逻辑位置投影，不能只取最近时间戳。
          const logical = point.scenarioProgress * (proChart.visibleRows.length - 1);
          const lower = Math.floor(logical), upper = Math.min(proChart.visibleRows.length - 1, lower + 1);
          const timeScale = s.chart.timeScale();
          const x0 = timeScale.timeToCoordinate(proChart.visibleRows[lower].time), x1 = timeScale.timeToCoordinate(proChart.visibleRows[upper].time);
          const x = x0 + (x1 - x0) * (logical - lower);
          return Math.hypot(actual.x - r.left - s.left - x, actual.y - r.top - s.top - s.series.priceToCoordinate(point.price));
        });
      });
      check(projection.length === 2 && projection.every(error => error < 1), 'pane resize detached drawing handles from candles');
      // 带真实持仓的历史场次也不能被布局操作重置或推进。
      await target.locator('[data-tool="cursor"]').click();
      await target.locator('#workspaceStart').click();
      await target.locator('[data-setup-mode="free"]').click();
      await target.locator('#confirmTrainingStart').click();
      if (viewport.width <= 1100) await target.locator('#mobileTradeDrawer > summary').click();
      await target.locator('#openPosition').click();
      check(await target.evaluate(() => Boolean(sim.position) && state.replayMode), 'test did not open a real simulated position');
      const replayBefore = await invariant();
      await handle.focus(); await handle.press('ArrowUp'); await snapshot();
      check(await invariant() === replayBefore, 'pane resize changed active replay/position');
      await handle.dblclick();
      const reset = await snapshot();
      const defaultMainVolumeRatio = reset.fallback ? 1.94 : 2;
      check(Math.abs((reset.fallback ? reset.plotRatio : reset.heights[0] / reset.heights[1]) - defaultMainVolumeRatio) < .04, `double click failed to reset default ${defaultMainVolumeRatio}:1 proportions`);
      check(await target.evaluate(() => Object.keys(chartPaneSizing.layouts).length === 0), 'reset retained stale pane layouts');
      const layout = await target.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, handles: [...document.querySelectorAll('[data-pane-boundary]')].map(node => { const r = node.getBoundingClientRect(), c = document.getElementById('chart').getBoundingClientRect(); return { top: r.top - c.top, bottom: r.bottom - c.top, height: c.height }; }) }));
      check(layout.overflow <= 0 && layout.handles.every(h => h.top >= 0 && h.bottom <= h.height), 'separator escaped chart or caused overflow');
      // 写入失败不能阻断调整，也不能谎称重置已持久化。
      await target.evaluate(() => { window.originalPaneSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'trend-lab-pane-layouts') throw new DOMException('test quota', 'QuotaExceededError'); return window.originalPaneSetItem.call(this, key, value); }; });
      await handle.focus(); await handle.press('ArrowUp'); await snapshot();
      check((await target.locator('#chartPaneResizeStatus').textContent()).includes('仅本次有效'), 'storage failure not reported');
      const resetInvariant = await invariant();
      await target.locator('summary[aria-label="图表设置"]').click();
      await target.locator('#resetChartPaneLayout').click();
      await target.locator('summary[aria-label="图表设置"]').click();
      const uiReset = await snapshot();
      const uiDefaultMainVolumeRatio = uiReset.fallback ? 1.94 : 2;
      check(Math.abs((uiReset.fallback ? uiReset.plotRatio : uiReset.heights[0] / uiReset.heights[1]) - uiDefaultMainVolumeRatio) < .04, 'settings reset failed');
      check(await invariant() === resetInvariant, 'settings reset changed account, replay, range or drawings');
      check((await target.locator('#chartPaneResizeStatus').textContent()).includes('重置仅本次有效'), 'failed reset falsely reported persistence');
      await target.evaluate(() => { Storage.prototype.setItem = window.originalPaneSetItem; delete window.originalPaneSetItem; });
      await handle.focus(); await handle.press('ArrowUp'); await handle.press('Home'); await snapshot();
      check(await target.evaluate(() => Object.keys(chartPaneSizing.layouts).length === 0), 'Home reset failed');
      check(errors.length === 0, errors.join('; '));
      results.push({ name, initial, dragged, keyboard, restored, three, constrained, fullscreen, projection, reset, layout, errors });
    } catch (error) { failures.push(`${name}: ${error.message}`); }
    finally { await context.close(); }
  }
  return { passed: !failures.length, results, failures };
}
