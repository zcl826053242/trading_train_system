// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 验备用 SVG 图价格轴缩放、自动恢复及时间轴隔离，不代表真机验收。
async (page) => {
  const failures = [], results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [], name = `${viewport.width}x${viewport.height}`;
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      await context.route('**/vendor/lightweight-charts*', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.evaluate(() => { state.dataMode = 'sim'; state.replayMode = false; state.liveRows = []; state.liveError = ''; state.liveLoading = false; renderChart(); updateSimDisplay(); });
      const point = await target.locator('#chart .chart-fallback').evaluate(svg => {
        const rect = svg.getBoundingClientRect(), view = svg.viewBox.baseVal;
        const plotX = Number(svg.dataset.plotX), plotW = Number(svg.dataset.plotWidth);
        const y = Number(svg.dataset.plotY) + Number(svg.dataset.plotHeight) * .35;
        return { axisX: rect.left + (plotX + plotW + 24) * rect.width / view.width,
          plotX: rect.left + (plotX + plotW * .55) * rect.width / view.width,
          y: rect.top + y * rect.height / view.height };
      });
      const read = () => target.evaluate(() => ({
        auto: state.fallbackPriceScale.auto,
        pressed: document.querySelector('#chartAutoScale').getAttribute('aria-pressed'),
        zoom: state.fallbackPriceScale.zoom,
        offset: state.fallbackPriceScale.offset,
        baseMin: state.fallbackPriceScale.baseMin,
        baseMax: state.fallbackPriceScale.baseMax,
        timeZoom: state.chartZoom,
        timeOffset: state.chartOffset,
        axisVisible: !document.querySelector('#chartAxisBar').hidden,
        unsupportedModesHidden: [...document.querySelectorAll('[data-axis-mode]')].every(button => button.hidden),
        settingsModeDisabled: document.querySelector('#chartPriceScaleMode').disabled
      }));
      const initial = await read();
      if (!initial.auto || initial.pressed !== 'true' || !initial.axisVisible || !initial.unsupportedModesHidden || !initial.settingsModeDisabled) failures.push(`${name}: fallback axis controls do not expose only supported actions`);
      const wheelAnchor = y => target.evaluate(y => {
        const svg = document.querySelector('#chart .chart-fallback'), view = state.fallbackPriceScale, rect = svg.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, ((y - rect.top) * svg.viewBox.baseVal.height / rect.height - Number(svg.dataset.plotY)) / Number(svg.dataset.plotHeight)));
        const baseCenter = (view.baseMin + view.baseMax) / 2, span = (view.baseMax - view.baseMin) * (view.auto ? 1 : view.zoom);
        return baseCenter + (view.auto ? 0 : view.offset) + (.5 - fraction) * span;
      }, y);
      const anchorBefore = await wheelAnchor(point.y);
      await target.mouse.move(point.axisX, point.y); await target.mouse.down();
      await target.mouse.move(point.axisX, point.y + 60, { steps: 8 }); await target.mouse.up();
      const dragged = await read();
      if (dragged.auto || dragged.pressed !== 'false' || dragged.zoom <= initial.zoom) failures.push(`${name}: dragging the price axis did not switch to manual scaling: ${JSON.stringify(dragged)}`);
      if (dragged.timeZoom !== initial.timeZoom || dragged.timeOffset !== initial.timeOffset) failures.push(`${name}: price-axis drag changed the time range`);
      const candle = await target.evaluate(() => {
        const svg = document.querySelector('#chart .chart-fallback'), rect = svg.getBoundingClientRect(), rows = proChart.visibleRows;
        const index = Math.floor(rows.length * .55), row = rows[index], view = state.fallbackPriceScale;
        const center = (view.baseMin + view.baseMax) / 2 + view.offset, span = (view.baseMax - view.baseMin) * view.zoom;
        const yValue = center + span / 2, y = Number(svg.dataset.plotY) + (yValue - row.close) / span * Number(svg.dataset.plotHeight);
        return { x: rect.left + (Number(svg.dataset.plotX) + (index + .5) * Number(svg.dataset.plotWidth) / rows.length) * rect.width / svg.viewBox.baseVal.width,
          y: rect.top + y * rect.height / svg.viewBox.baseVal.height,
          expected: [row.open, row.high, row.low, row.close].map(formatChartPrice) };
      });
      await target.mouse.move(candle.x, candle.y);
      const crosshair = await target.locator('#chartOhlc').textContent();
      if (!candle.expected.every(value => crosshair.includes(value))) failures.push(`${name}: OHLC crosshair failed after manual price scaling`);
      await target.mouse.move(point.axisX, point.y); await target.mouse.wheel(0, -120);
      const wheeled = await read();
      if (!(wheeled.zoom < dragged.zoom) || wheeled.timeZoom !== dragged.timeZoom || wheeled.timeOffset !== dragged.timeOffset) failures.push(`${name}: axis wheel did not zoom price independently`);
      const anchorAfter = await wheelAnchor(point.y);
      if (Math.abs(anchorAfter - anchorBefore) > Math.abs(anchorBefore) * .002) failures.push(`${name}: axis wheel lost its price anchor`);
      await target.mouse.dblclick(point.axisX, point.y);
      const doubleReset = await read();
      if (!doubleReset.auto || doubleReset.zoom !== 1 || doubleReset.offset !== 0) failures.push(`${name}: double-click did not restore automatic price scale`);
      await target.locator('#chartAutoScale').click();
      const manualToggle = await read();
      if (manualToggle.auto || manualToggle.pressed !== 'false') failures.push(`${name}: auto-scale toggle did not enter manual mode`);
      await target.locator('#chartResetView').click();
      const reset = await read();
      if (!reset.auto || reset.zoom !== 1 || reset.offset !== 0 || reset.timeZoom !== 1 || reset.timeOffset !== 0) failures.push(`${name}: reset view did not restore both price and time scales`);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, initial, dragged, candle, crosshair, wheeled, anchorBefore, anchorAfter, doubleReset, manualToggle, reset, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
