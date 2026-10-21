// Playwright browser_run_code_unsafe: filename 指向此文件；本地服务端口 4188。
// 独立 context，拦截外部行情；验证鼠标操作与坐标投影，不代表真机触控验收。
async (page) => {
  const results = [], failures = [];
  for (const fallback of [false, true]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 667 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [], checks = [], name = `${viewport.width}/${fallback ? 'fallback' : 'professional'}`;
    const check = (ok, message) => { if (!ok) failures.push(`${name}: ${message}`); };
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
      const marketSummary = () => target.evaluate(() => Object.fromEntries(
        ['lastPrice', 'priceChange', 'regime', 'regimeDesc', 'confidence'].map(id => [id, document.getElementById(id).textContent])));
      const initialSummary = await marketSummary();
      await target.locator('#chartZoomIn').click();
      await target.locator('#chartZoomIn').click();
      await target.waitForTimeout(150);
      const frame = () => target.evaluate(() => {
        const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect();
        return { left: rect.left + surface.left, top: rect.top + surface.top,
          width: surface.chart.timeScale().width(), height: surface.chart.panes()[0].getHeight(),
          offset: state.chartOffset, range: proChart.chart?.timeScale().getVisibleLogicalRange() };
      });
      await target.locator('#chart').scrollIntoViewIfNeeded();
      const before = await frame();
      const x = before.left + before.width * .5, y = before.top + before.height * .55;
      await target.mouse.move(x, y); await target.mouse.down();
      await target.mouse.move(x + before.width * .16, y, { steps: 12 }); await target.mouse.up();
      await target.waitForTimeout(150);
      const after = await frame();
      const pannedSummary = await marketSummary();
      check(JSON.stringify(initialSummary) === JSON.stringify(pannedSummary), 'viewport pan/zoom changed market summary');
      check(fallback ? after.offset > before.offset : after.range.from < before.range.from - .5, 'drag did not pan to earlier candles');
      checks.push({ action: 'pan', before, after, initialSummary, pannedSummary });
      const readouts = [];
      for (const fraction of [.4, .65]) {
        const probe = await target.evaluate(fraction => {
          const surface = drawingSurface(), scale = surface.chart.timeScale();
          const range = proChart.chart?.timeScale().getVisibleLogicalRange();
          const first = range ? Math.max(0, Math.ceil(range.from)) : chartInspection.first;
          const last = range ? Math.min(proChart.visibleRows.length - 1, Math.floor(range.to)) : chartInspection.last;
          const index = Math.round(first + (last - first) * fraction), row = proChart.visibleRows[index];
          const rect = document.querySelector('#chart').getBoundingClientRect();
          const y = surface.chart.panes()[0].getHeight() * fraction;
          return { index, x: rect.left + surface.left + scale.timeToCoordinate(row.time), y: rect.top + surface.top + y,
            price: formatChartPrice(surface.series.coordinateToPrice(y)),
            expected: [row.open, row.high, row.low, row.close].map(formatChartPrice) };
        }, fraction);
        await target.evaluate(() => document.querySelector('#chart').addEventListener('pointermove', event => {
          window.__auditPointer = { x: event.clientX, y: event.clientY };
        }, { once: true, capture: true }));
        await target.mouse.move(probe.x, probe.y); await target.waitForTimeout(80);
        const observed = await target.evaluate(() => {
          const surface = drawingSurface(), rect = document.querySelector('#chart').getBoundingClientRect();
          return { ohlc: document.querySelector('#chartOhlc').textContent,
            pointerPrice: formatChartPrice(surface.series.coordinateToPrice(window.__auditPointer.y - rect.top - surface.top)),
            cross: [...document.querySelectorAll('.chart-fallback > g[opacity="1"] text')].map(node => node.textContent) };
        });
        check(probe.expected.every(value => observed.ohlc.includes(value)), `crosshair OHLC disagrees with candle ${probe.index}`);
        if (fallback) check(observed.cross.includes(observed.pointerPrice), 'fallback crosshair price disagrees with actual pointer coordinate');
        readouts.push({ ...probe, observed });
      }
      check(readouts[0].observed.ohlc !== readouts[1].observed.ohlc, 'crosshair did not update between candles');
      checks.push({ action: 'crosshair', readouts });
      await target.mouse.move(1, 1); await target.waitForTimeout(100);
      const cleared = await target.evaluate(() => {
        const row = chartInspection.rows.at(-1);
        return { ohlc: document.querySelector('#chartOhlc').textContent,
          expected: [row.open, row.high, row.low, row.close].map(formatChartPrice) };
      });
      check(cleared.expected.every(value => cleared.ohlc.includes(value)), 'leaving chart did not restore latest OHLC');
      checks.push({ action: 'crosshair-leave', ...cleared });
      // 切换周期会重建数据；未完成的绘图锚点不能串到新周期。
      await target.locator('[data-tool="trendline"]').click();
      const draftFrame = await frame();
      await target.mouse.click(draftFrame.left + draftFrame.width * .4, draftFrame.top + draftFrame.height * .55);
      const draftBefore = await target.evaluate(() => ({ pending: Boolean(proChart.trendPoint), tool: state.tool }));
      await target.locator('[data-time="5m"]').click();
      await target.waitForTimeout(120);
      const draftAfter = await target.evaluate(() => ({ pending: Boolean(proChart.trendPoint), tool: state.tool, timeframe: state.timeframe }));
      check(draftBefore.pending && draftAfter.timeframe === '5m' && !draftAfter.pending && draftAfter.tool === 'cursor', 'timeframe switch kept an unfinished drawing anchor');
      checks.push({ action: 'timeframe-cancels-drawing-draft', draftBefore, draftAfter });
      await target.locator('[data-time="1H"]').click();
      await target.waitForTimeout(120);
      await target.locator('[data-tool="trendline"]').click();
      await target.locator('#chart').scrollIntoViewIfNeeded();
      const drawingFrame = await frame();
      for (const [fx, fy] of [[.4, .65], [.65, .4]]) await target.mouse.click(drawingFrame.left + drawingFrame.width * fx, drawingFrame.top + drawingFrame.height * fy);
      await target.waitForTimeout(120);
      const points = await target.evaluate(() => proChart.drawings.at(-1)?.edit.points);
      check(points?.length === 2 && points[0].price !== points[1].price && points[0].time !== points[1].time, 'a sloping trendline was not created');
      // 教学模拟 K 线的绘图锚点还会带 scenario 元数据；交互回归只比较时间/价格这两个几何字段。
      const pointGeometry = points?.map(point => ({ time: point.time, price: point.price }));
      const audit = async action => {
        await target.waitForTimeout(180);
        const result = await target.evaluate(() => {
          const drawing = proChart.drawings.at(-1), surface = drawingSurface();
          const handles = [...document.querySelectorAll('#chartDrawingOverlay [data-anchor-index]')];
          const projections = handles.map(node => {
            const point = drawing.edit.points[Number(node.dataset.anchorIndex)];
            const matrix = node.ownerSVGElement.getScreenCTM();
            const actual = new DOMPoint(Number(node.getAttribute('cx')), Number(node.getAttribute('cy'))).matrixTransform(matrix);
            const chart = document.querySelector('#chart').getBoundingClientRect();
            const expected = { x: chart.left + surface.left + drawingTimeCoordinate(point, surface.chart.timeScale()),
              y: chart.top + surface.top + surface.series.priceToCoordinate(point.price) };
            return { actual: { x: actual.x, y: actual.y }, expected, error: Math.hypot(actual.x - expected.x, actual.y - expected.y) };
          });
          return { points: drawing.edit.points, projections, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        check(JSON.stringify(result.points) === JSON.stringify(points), `${action}: changed drawing model`);
        check(result.projections.length === 2 && result.projections.every(p => p.error < 1), `${action}: anchor projection error exceeds 1px`);
        check(result.overflow <= 0, `${action}: horizontal overflow`);
        checks.push({ action, ...result });
      };
      await audit('created');
      const axisPoint = await target.evaluate(() => {
        const chart = document.querySelector('#chart'), rect = chart.getBoundingClientRect();
        if (proChart.chart) return { x: rect.right - 18, y: rect.top + proChart.chart.panes()[0].getHeight() * .42 };
        const svg = chart.querySelector('.chart-fallback'), view = svg.viewBox.baseVal, svgRect = svg.getBoundingClientRect();
        return { x: svgRect.left + (Number(svg.dataset.plotX) + Number(svg.dataset.plotWidth) + 24) * svgRect.width / view.width,
          y: svgRect.top + (Number(svg.dataset.plotY) + Number(svg.dataset.plotHeight) * .42) * svgRect.height / view.height };
      });
      const beforeAxis = await frame();
      await target.mouse.move(axisPoint.x, axisPoint.y); await target.mouse.down();
      await target.mouse.move(axisPoint.x, axisPoint.y + 42, { steps: 8 }); await target.mouse.up();
      await target.waitForTimeout(120);
      const afterAxis = await frame();
      const axisState = await target.evaluate(() => ({
        auto: proChart.chart ? proChart.chart.panes()[0].priceScale('right').options().autoScale : state.fallbackPriceScale.auto,
        zoom: proChart.chart ? null : state.fallbackPriceScale.zoom,
        tool: state.tool,
        points: proChart.drawings.at(-1)?.edit.points.map(point => ({ time: point.time, price: point.price }))
      }));
      check(!axisState.auto, 'price-axis drag did not enter manual scale mode');
      if (fallback) check(axisState.zoom > 1, 'fallback price-axis drag did not increase scale');
      check(JSON.stringify(axisState.points) === JSON.stringify(pointGeometry), 'price-axis drag changed drawing anchors');
      if (fallback) check(afterAxis.offset === beforeAxis.offset, 'price-axis drag changed the time offset');
      else check(afterAxis.range.from === beforeAxis.range.from && afterAxis.range.to === beforeAxis.range.to, 'price-axis drag changed the visible time range');
      checks.push({ action: 'price-axis-state', axisPoint, beforeAxis, afterAxis, axisState });
      await audit('price-axis-after-drawing');
      await target.locator('[data-tool="cursor"]').click();
      const panBeforeAxis = await frame();
      const panX = panBeforeAxis.left + panBeforeAxis.width * .52, panY = panBeforeAxis.top + panBeforeAxis.height * .58;
      await target.mouse.move(panX, panY); await target.mouse.down();
      await target.mouse.move(panX + panBeforeAxis.width * .11, panY, { steps: 8 }); await target.mouse.up();
      await target.waitForTimeout(150);
      const panAfterAxis = await frame();
      check(fallback ? panAfterAxis.offset > panBeforeAxis.offset : panAfterAxis.range.from < panBeforeAxis.range.from - .5,
        'time pan failed after manual price-axis scaling');
      await audit('pan-after-price-axis');
      const postAxisProbe = await target.evaluate(() => {
        const surface = drawingSurface(), rows = proChart.visibleRows, chart = document.querySelector('#chart'), rect = chart.getBoundingClientRect();
        const range = proChart.chart?.timeScale().getVisibleLogicalRange();
        const first = range ? Math.max(0, Math.ceil(range.from)) : Math.max(0, rows.length - Math.max(16, Math.min(rows.length, Math.round(rows.length / state.chartZoom))) - state.chartOffset);
        const last = range ? Math.min(rows.length - 1, Math.floor(range.to)) : Math.min(rows.length - 1, first + Math.max(16, Math.min(rows.length, Math.round(rows.length / state.chartZoom))) - 1);
        const row = rows[Math.round(first + (last - first) * .56)], y = surface.chart.panes()[0].getHeight() * .52;
        return { x: rect.left + surface.left + surface.chart.timeScale().timeToCoordinate(row.time),
          y: rect.top + surface.top + y, expected: [row.open, row.high, row.low, row.close].map(formatChartPrice),
          pointerPrice: formatChartPrice(surface.series.coordinateToPrice(y)) };
      });
      await target.evaluate(() => document.querySelector('#chart').addEventListener('pointermove', event => {
        window.__axisSequencePointer = { x: event.clientX, y: event.clientY };
      }, { once: true, capture: true }));
      await target.mouse.move(postAxisProbe.x, postAxisProbe.y); await target.waitForTimeout(80);
      const postAxisReadout = await target.locator('#chartOhlc').textContent();
      check(postAxisProbe.expected.every(value => postAxisReadout.includes(value)), 'crosshair OHLC failed after pan and manual price scaling');
      if (fallback) {
        const crosshairPrice = await target.locator('.chart-fallback > g[opacity="1"] text').first().textContent();
        check(crosshairPrice === postAxisProbe.pointerPrice, 'fallback crosshair price detached after pan and axis scaling');
      }
      checks.push({ action: 'crosshair-after-pan-and-price-axis', probe: postAxisProbe, ohlc: postAxisReadout });
      await target.locator('#chartZoomIn').click(); await audit('zoom');
      for (const size of [{ width: 1100, height: 760 }, { width: 901, height: 760 }, { width: 390, height: 844 }, viewport]) {
        await target.setViewportSize(size); await audit(`resize-${size.width}x${size.height}`);
      }
      await target.locator('#chartFullscreen').click(); await target.waitForFunction(() => !!document.fullscreenElement); await audit('fullscreen');
      await target.locator('#chartFullscreen').click(); await target.waitForFunction(() => !document.fullscreenElement); await audit('exit-fullscreen');
      // 使用实际训练入口；未揭示后缀注入极端价格后，摘要、OHLC 和指标必须完全不变。
      await target.locator('#workspaceStart').click();
      await target.locator('[data-setup-mode="free"]').click();
      await target.locator('#confirmTrainingStart').click();
      await target.locator('#chartZoomIn').click();
      await target.locator('#chart').scrollIntoViewIfNeeded();
      const replayFrame = await frame();
      const replayX = replayFrame.left + replayFrame.width * .5, replayY = replayFrame.top + replayFrame.height * .5;
      await target.mouse.move(replayX, replayY); await target.mouse.down();
      await target.mouse.move(replayX + replayFrame.width * .2, replayY, { steps: 12 }); await target.mouse.up();
      await target.mouse.move(1, 1); await target.waitForTimeout(100);
      const replay = await target.evaluate(() => {
        const snapshot = () => ({
          summary: ['lastPrice', 'priceChange', 'regime', 'regimeDesc', 'confidence'].map(id => document.getElementById(id).textContent),
          ohlc: document.querySelector('#chartOhlc').textContent,
          legends: [...document.querySelectorAll('[data-pane-legend]')].map(node => node.textContent),
          count: proChart.visibleRows.length, inspectionCount: chartInspection.rows.length
        });
        const revealed = getHistoricalReplay(), expected = revealed.at(-1), before = snapshot();
        const hiddenIndex = state.sessionStart + state.revealCount, original = historicalRows.slice(hiddenIndex);
        let after;
        try {
          for (let i = hiddenIndex; i < historicalRows.length; i++) historicalRows[i] = {
            ...historicalRows[i], open: 900000000 + i, high: 900000010 + i, low: 899999990 + i, close: 900000005 + i, volume: 900000000
          };
          renderChart(); after = snapshot();
        } finally {
          original.forEach((row, index) => { historicalRows[hiddenIndex + index] = row; });
          renderChart();
        }
        return { before, after, revealed: state.revealCount, hiddenCount: original.length,
          expected: [expected.open, expected.high, expected.low, expected.close].map(formatChartPrice), latest: formatChartPrice(expected.close) };
      });
      check(replay.hiddenCount > 0 && replay.revealed === 24, 'replay did not start with hidden future bars');
      check(replay.before.count === replay.revealed && replay.before.inspectionCount === replay.revealed, 'chart exposed unrevealed replay rows');
      check(replay.expected.every(value => replay.before.ohlc.includes(value)) && replay.before.summary[0] === replay.latest, 'panned replay did not restore latest revealed readouts');
      check(JSON.stringify(replay.before) === JSON.stringify(replay.after), 'hidden future prices changed replay summary or indicators');
      checks.push({ action: 'replay-no-future-data', ...replay });
      check(errors.length === 0, `page errors: ${errors.join('; ')}`);
      results.push({ name, checks, errors });
    } catch (error) { failures.push(`${name}: ${error.message}`); }
    finally { await context.close(); }
  }
  return { passed: failures.length === 0, results, failures };
}
