// Playwright browser_run_code_unsafe: filename 指向此文件；本地服务端口 4188。
// 验证币安式十字线读数在专业图/备用图和桌面/窄屏的同一状态下保持一致。
async (page) => {
  const failures = [], checks = [];
  const percent = (value, signed = true) => `${signed && value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  for (const fallback of [false, true]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 667 }]) {
    const name = `${viewport.width}/${fallback ? 'fallback' : 'professional'}`;
    const context = await page.context().browser().newContext({ viewport });
    const errors = [];
    const check = (ok, message) => { if (!ok) failures.push(`${name}: ${message}`); };
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
      await target.waitForTimeout(120);
      const teaching = await target.evaluate(() => ({
        ohlc: document.getElementById('chartOhlc').textContent,
        stats: document.getElementById('chartCandleStats').textContent,
        aria: document.getElementById('chartCandleReadout').getAttribute('aria-label'),
        overflow: document.documentElement.scrollWidth - innerWidth,
        scrollable: getComputedStyle(document.getElementById('chartCandleReadout')).overflowX,
        ohlcScrollable: getComputedStyle(document.getElementById('chartOhlc')).overflowX,
        statsScrollable: getComputedStyle(document.getElementById('chartCandleStats')).overflowX,
        sections: ['chartOhlc','chartCandleStats'].map(id => { const el = document.getElementById(id); return { id, width: el.clientWidth, contentWidth: el.scrollWidth, overflowX: getComputedStyle(el).overflowX }; })
      }));
      check(teaching.stats.includes('涨跌幅') && teaching.stats.includes('振幅') && teaching.stats.includes('样本第'), 'teaching readout is missing candle statistics or anonymous sample index');
      check(!teaching.stats.includes('时间 20'), 'synthetic teaching data exposed a calendar timestamp');
      check(teaching.aria.includes('涨跌幅') && teaching.aria.includes('振幅'), 'readout group aria label omits the new fields');
      check(teaching.overflow <= 0, 'teaching readout introduced horizontal page overflow');
      if (viewport.width <= 560) {
        const overflowingSections = teaching.sections.filter(section => section.contentWidth > section.width);
        check(overflowingSections.every(section => ['auto','scroll'].includes(section.overflowX)), 'mobile readout text overflows without a horizontal scroll affordance');
        if (viewport.width <= 360) check(overflowingSections.length > 0, '320px readout unexpectedly clipped/fitted without measurable scrollable text');
      }
      if (!fallback) await target.screenshot({ path: `.playwright-mcp/candle-readout-${viewport.width}x${viewport.height}-20261023.png`, fullPage: true });

      const liveRow = { openTime: 1790769600000, open: 100, high: 106, low: 98, close: 102, volume: 10, closeTime: 1790773199999 };
      await target.evaluate(row => {
        state.dataMode = 'live'; state.replayMode = false; state.liveRows = [row]; state.liveError = ''; state.liveLoading = false;
        state.chartType = 'candles'; renderChart();
      }, liveRow);
      await target.waitForTimeout(120);
      const live = await target.evaluate(() => ({
        ohlc: document.getElementById('chartOhlc').textContent,
        stats: document.getElementById('chartCandleStats').textContent,
        expected: chartCandleReadoutValues(proChart.visibleRows[0], 0, proChart.visibleRows[0]),
        overflow: document.documentElement.scrollWidth - innerWidth
      }));
      check(live.stats.includes('涨跌幅 +2.00%') && live.stats.includes('振幅 8.00%'), `live percentages are wrong: ${live.stats}`);
      check(live.stats.includes('时间 '), 'live readout is missing the candle open time');
      check(live.expected.timeLabel.startsWith('时间 '), 'live readout helper did not classify public live time');
      check(live.overflow <= 0, 'live readout introduced horizontal page overflow');

      await target.evaluate(() => {
        state.chartType = 'heikin'; renderChart();
      });
      await target.waitForTimeout(120);
      const heikin = await target.evaluate(() => {
        const raw = proChart.visibleRows[0], visual = proChart.heikinRows[0];
        return { stats: document.getElementById('chartCandleStats').textContent, expected: chartCandleReadoutValues(raw, 0, visual), badge: document.getElementById('chartModeBadge').textContent };
      });
      check(heikin.badge.includes('HA'), 'HA mode badge is not visible');
      check(heikin.stats.includes(`涨跌幅 ${percent(heikin.expected.changePercent)}`) && heikin.stats.includes(`振幅 ${percent(heikin.expected.amplitudePercent, false)}`), `HA percentages do not use synthetic OHLC: ${heikin.stats}`);
      check(heikin.stats.includes('HA') === false, 'HA statistics should stay compact; mode is communicated by the badge');

      const replay = await target.evaluate(() => {
        state.replayMode = true; updateChartOhlc(proChart.visibleRows[0], 0, proChart.visibleRows);
        return { stats: document.getElementById('chartCandleStats').textContent, aria: document.getElementById('chartCandleStats').getAttribute('aria-label') };
      });
      check(replay.stats.includes('回放第') && !replay.stats.includes('时间 20'), 'blind replay exposed public calendar time');
      check(!replay.aria.includes('DATE') && !replay.aria.includes('UTC'), 'blind replay aria text exposed a timestamp');
      checks.push({ name, teaching, live, heikin, replay, errors });
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0 && checks.every(item => item.errors.length === 0), failures, checks, errors: checks.flatMap(item => item.errors) };
}
