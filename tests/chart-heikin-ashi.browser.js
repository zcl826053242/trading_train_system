// Playwright browser_run_code_unsafe：filename 指向此文件；本地服务端口 4188。
// 独立浏览器 context，分别验证专业图/备用 SVG、桌面/窄屏、模拟行情和历史盲测前缀隔离。
async (page) => {
  const failures = [], results = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  const format = value => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const fallback of [false, true]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 667 }]) {
    const name = `${fallback ? 'fallback' : 'professional'}-${viewport.width}x${viewport.height}`;
    const context = await page.context().browser().newContext({ viewport });
    const errors = [];
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight-charts*', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/');
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.evaluate(() => {
        state.dataMode = 'sim'; state.replayMode = false; state.liveRows = []; state.liveError = ''; state.liveLoading = false;
        state.chartType = 'candles'; renderChart();
      });
      const before = await target.evaluate(() => ({
        latest: document.getElementById('lastPrice').textContent,
        indicator: document.getElementById('chartIndicatorValues').textContent,
        raw: proChart.visibleRows.at(-1),
        count: proChart.visibleRows.length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }));
      await target.locator('[data-chart-type="heikin"]').click();
      const after = await target.evaluate(() => ({
        type: state.chartType,
        pressed: document.querySelector('[data-chart-type="heikin"]').getAttribute('aria-pressed'),
        badgeVisible: !document.getElementById('chartModeBadge').hidden,
        badgeTitle: document.getElementById('chartModeBadge').title,
        raw: proChart.visibleRows.at(-1),
        ha: proChart.heikinRows.at(-1),
        ohlc: document.getElementById('chartOhlc').textContent,
        latest: document.getElementById('lastPrice').textContent,
        indicator: document.getElementById('chartIndicatorValues').textContent,
        svgType: document.querySelector('#chart svg.chart-fallback')?.dataset.chartType || null,
        seriesSelected: !window.LightweightCharts || activeChartSeries() === proChart.heikin,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        plot: document.querySelector('#chart svg.chart-fallback') ? {
          rect: document.querySelector('#chart svg.chart-fallback').getBoundingClientRect().toJSON(),
          viewBox: (() => { const box = document.querySelector('#chart svg.chart-fallback').viewBox.baseVal; return { width: box.width, height: box.height }; })(),
          plotX: Number(document.querySelector('#chart svg.chart-fallback').dataset.plotX),
          plotW: Number(document.querySelector('#chart svg.chart-fallback').dataset.plotWidth),
          plotY: Number(document.querySelector('#chart svg.chart-fallback').dataset.plotY),
          plotH: Number(document.querySelector('#chart svg.chart-fallback').dataset.plotHeight),
          visible: proChart.visibleRows.length,
          start: Math.max(0, proChart.visibleRows.length - Math.max(16, Math.min(proChart.visibleRows.length, Math.round(proChart.visibleRows.length / state.chartZoom))) - state.chartOffset)
        } : null
      }));
      check(after.type === 'heikin' && after.pressed === 'true', `${name}: Heikin Ashi control selection is not synchronized`);
      check(after.badgeVisible && /原始 K 线/.test(after.badgeTitle), `${name}: synthetic-vs-source disclosure is missing`);
      check(after.svgType === (fallback ? 'heikin' : null), `${name}: chart rendered using the wrong backend or mode`);
      check(after.seriesSelected, `${name}: professional chart did not select the Heikin Ashi series`);
      check(after.latest === before.latest && after.indicator === before.indicator, `${name}: raw latest price or indicator readout changed with visual style`);
      check(after.ohlc.includes(`HA 开 ${format(after.ha.open)}`) && after.ohlc.includes(`收 ${format(after.ha.close)}`), `${name}: crosshair OHLC does not show the synthetic candle values`);
      check(after.scrollWidth === after.clientWidth, `${name}: chart mode introduced horizontal overflow`);
      if (fallback && after.plot) {
        const tooltipPoint = await target.evaluate(() => {
          const svg = document.querySelector('#chart svg.chart-fallback'), rect = svg.getBoundingClientRect(), box = svg.viewBox.baseVal;
          const count = proChart.visibleRows.length, start = Math.max(0, count - Math.max(16, Math.min(count, Math.round(count / state.chartZoom))) - state.chartOffset);
          const visible = Math.max(16, Math.min(count, Math.round(count / state.chartZoom)));
          const local = visible - 1, x = Number(svg.dataset.plotX) + (local + .5) * Number(svg.dataset.plotWidth) / visible;
          const y = Number(svg.dataset.plotY) + Number(svg.dataset.plotHeight) * .55;
          return { x: rect.left + x / box.width * rect.width, y: rect.top + y / box.height * rect.height, start, count };
        });
        await target.mouse.move(tooltipPoint.x, tooltipPoint.y);
        const tooltip = await target.locator('#chartTooltip').textContent();
        check(tooltip.includes('原始开') && tooltip.includes('HA 开'), `${name}: fallback tooltip does not distinguish raw and synthetic OHLC`);
      }

      await target.reload();
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      const restored = await target.evaluate(() => ({
        type: state.chartType,
        pressed: document.querySelector('[data-chart-type="heikin"]').getAttribute('aria-pressed'),
        badgeVisible: !document.getElementById('chartModeBadge').hidden
      }));
      check(restored.type === 'heikin' && restored.pressed === 'true' && restored.badgeVisible, `${name}: selected chart style did not survive refresh`);

      // 真实回放用全历史前缀递推；只修改未揭示尾部后，已揭示 HA 与原始读数应保持不变。
      const replayBefore = await target.evaluate(() => {
        state.dataMode = 'sim'; state.timeframe = '1H'; state.replayMode = true; state.sessionStart = 40; state.sessionLength = 60; state.revealCount = 12;
        historicalRows = historicalByTimeframe['1H'].map(row => ({ ...row }));
        state.chartType = 'heikin'; renderChart();
        const expected = calculateHeikinAshi(historicalRows.slice(0, state.sessionStart + state.revealCount)).slice(state.sessionStart);
        return { rows: proChart.visibleRows.length, ha: proChart.heikinRows.map(row => [row.open, row.high, row.low, row.close]), expected: expected.map(row => [row.open, row.high, row.low, row.close]), latest: document.getElementById('lastPrice').textContent };
      });
      check(replayBefore.rows === 12 && JSON.stringify(replayBefore.ha) === JSON.stringify(replayBefore.expected), `${name}: replay Heikin Ashi warmup does not match the revealed-only history prefix`);
      const replayAfter = await target.evaluate(() => {
        const before = proChart.heikinRows.map(row => [row.open, row.high, row.low, row.close]);
        const visibleEnd = state.sessionStart + state.revealCount;
        for (let i = visibleEnd; i < historicalRows.length; i++) {
          historicalRows[i] = { ...historicalRows[i], open: 999999, high: 1000000, low: 999998, close: 999999 };
        }
        renderChart();
        return { before, after: proChart.heikinRows.map(row => [row.open, row.high, row.low, row.close]), latest: document.getElementById('lastPrice').textContent };
      });
      check(JSON.stringify(replayAfter.before) === JSON.stringify(replayAfter.after), `${name}: hidden future candles changed revealed Heikin Ashi values`);
      check(replayAfter.latest === replayBefore.latest, `${name}: hidden future candles changed replay latest price`);
      check(errors.length === 0, `${name}: page errors: ${errors.join('; ')}`);
      results.push({ name, before: { latest: before.latest, count: before.count }, after: { latest: after.latest, type: after.type, badgeVisible: after.badgeVisible, ohlc: after.ohlc }, replayRows: replayBefore.rows, errors });
      await target.close();
    } finally { await context.close(); }
  }
  return { passed: failures.length === 0, results, failures };
}
