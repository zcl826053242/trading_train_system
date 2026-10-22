// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 验证 SAR 在两种图表引擎、样式/副图组合、刷新和历史回放边界下的可用性。
async (page) => {
  const failures = [], results = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  for (const fallback of [false, true]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const name = `${fallback ? 'fallback' : 'professional'}-${viewport.width}x${viewport.height}`;
    const context = await page.context().browser().newContext({ viewport });
    const errors = [];
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight-charts.standalone.production.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      target.on('dialog', dialog => dialog.accept());
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      const settings = target.locator('.chart-advanced');
      if (await settings.count() && !await settings.evaluate(element => element.open)) await settings.locator('summary').click();
      await target.locator('#simDataBtn').click();
      await target.waitForFunction(() => state.dataMode === 'sim' && proChart.visibleRows.length > 0);

      await target.locator('#chartIndicatorsOpen').click();
      await target.locator('[data-indicator="psar"]').check();
      await target.locator('[data-indicator="rsi"]').check();
      await target.locator('[data-indicator="macd"]').check();
      await target.locator('[data-indicator="kdj"]').check();
      await target.locator('[data-indicator-param="psar.step"]').fill('0.04');
      await target.locator('[data-indicator-param="psar.max"]').fill('0.3');
      await target.locator('[data-indicator-param="psar.max"]').press('Tab');
      await target.locator('#chartIndicatorsClose').click();
      await target.waitForFunction(() => state.indicator.psar && state.indicator.rsi && state.indicator.macd && state.indicator.kdj);
      const readSar = () => target.evaluate(() => window.LightweightCharts
        ? proChart.psarValues.map(item => item?.value ?? null).filter(Number.isFinite)
        : [...document.querySelectorAll('#chart [data-sar-value]')].map(node => Number(node.dataset.sarValue)).filter(Number.isFinite));

      const initial = await target.evaluate(() => ({
        engine: Boolean(window.LightweightCharts), type: state.chartType,
        params: { ...state.indicatorParams.psar },
        stored: JSON.parse(localStorage.getItem('trend-lab-indicator-params') || '{}').psar,
        sarValues: window.LightweightCharts ? proChart.psarValues.filter(Boolean).length : document.querySelectorAll('#chart [data-sar-value]').length,
        fallbackDots: document.querySelectorAll('[data-sar-index]').length,
        panes: ['rsi', 'macd', 'kdj'].map(key => Boolean(document.querySelector(`[data-pane-legend="${key}"]`))),
        overflow: document.documentElement.scrollWidth - innerWidth
      }));
      check(initial.engine === !fallback, `${name}: wrong chart engine`);
      check(initial.params.step === .04 && initial.params.max === .3, `${name}: SAR parameter edit did not apply: ${JSON.stringify(initial.params)}`);
      check(initial.stored?.step === .04 && initial.stored?.max === .3, `${name}: SAR parameters were not persisted`);
      check(initial.sarValues > 0 && (fallback ? initial.fallbackDots > 0 : true), `${name}: SAR points were not rendered`);
      check(initial.panes.every(Boolean), `${name}: enabling SAR with three oscillators lost an indicator pane`);
      check(initial.overflow <= 0, `${name}: indicator combination overflowed horizontally`);

      await target.locator('[data-chart-type="heikin"]').click();
      await target.waitForFunction(() => state.chartType === 'heikin');
      const sarInitial = await readSar();
      const ha = await target.evaluate(() => ({ type: state.chartType, dots: document.querySelectorAll('[data-sar-index]').length }));
      check(sarInitial.length === initial.sarValues && (fallback ? ha.dots > 0 : true), `${name}: SAR disappeared after Heikin Ashi switch`);
      await target.locator('[data-chart-type="line"]').click();
      await target.waitForFunction(() => state.chartType === 'line');
      const sarLine = await readSar();
      const line = await target.evaluate(() => ({ type: state.chartType }));
      check(sarLine.length === initial.sarValues, `${name}: SAR disappeared in line mode`);

      const fiveMinute = target.locator('[data-time="5m"]');
      await fiveMinute.click();
      await target.waitForFunction(() => state.timeframe === '5m');
      const sarSwitched = await readSar();
      const switched = await target.evaluate(() => ({ timeframe: state.timeframe, params: { ...state.indicatorParams.psar } }));
      switched.sar = sarSwitched.length;
      check(switched.sar > 0 && switched.params.step === .04 && switched.params.max === .3, `${name}: SAR did not survive timeframe switch: ${JSON.stringify(switched)}`);

      await target.reload({ waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      if (await settings.count() && !await settings.evaluate(element => element.open)) await settings.locator('summary').click();
      await target.locator('#simDataBtn').click();
      await target.waitForFunction(() => state.dataMode === 'sim' && state.indicator.psar && state.timeframe === '5m');
      const sarRestored = await readSar();
      const restored = await target.evaluate(() => ({ params: { ...state.indicatorParams.psar }, enabled: state.indicator.psar, type: state.chartType }));
      restored.sar = sarRestored.length;
      check(restored.enabled && restored.params.step === .04 && restored.params.max === .3 && restored.sar > 0, `${name}: SAR preferences did not survive refresh: ${JSON.stringify(restored)}`);

      await target.evaluate(() => openTrainingSetup({ timeframe: '5m' }));
      await target.waitForFunction(() => document.querySelector('#trainingSetup').open && trainingSetupState.timeframe === '5m');
      await target.locator('[data-setup-length="60"]').click();
      await target.locator('#confirmTrainingStart').click();
      await target.waitForFunction(() => activeWorkspace === 'replay' && state.replayMode && state.revealCount === 24);
      const replayBefore = await target.evaluate(() => ({ sar: window.LightweightCharts
        ? proChart.psarValues.map(item => item?.value ?? null)
        : [...document.querySelectorAll('#chart [data-sar-value]')].map(node => Number(node.dataset.sarValue)),
        rows: proChart.visibleRows.length, reveal: state.revealCount, timeframe: state.timeframe }));
      check(replayBefore.rows === 24 && replayBefore.sar.some(Number.isFinite), `${name}: replay SAR did not stop at the revealed prefix: ${JSON.stringify({ rows: replayBefore.rows, sar: replayBefore.sar.length })}`);
      const replayAfter = await target.evaluate(() => {
        const read = () => window.LightweightCharts
          ? proChart.psarValues.map(item => item?.value ?? null)
          : [...document.querySelectorAll('#chart [data-sar-value]')].map(node => Number(node.dataset.sarValue));
        const before = read();
        const end = state.sessionStart + state.revealCount;
        for (let i = end; i < historicalRows.length; i++) historicalRows[i] = { ...historicalRows[i], high: 999999, low: 999998, close: 999999 };
        renderChart();
        return { before, after: read(), rows: proChart.visibleRows.length };
      });
      check(JSON.stringify(replayAfter.before) === JSON.stringify(replayAfter.after), `${name}: hidden future candles changed revealed SAR values`);
      check(replayAfter.rows === 24, `${name}: replay revealed future rows while checking SAR`);
      check(errors.length === 0, `${name}: page errors: ${errors.join('; ')}`);
      results.push({ name, initial, ha: { ...ha, sarCount: sarInitial.length }, line: { ...line, sarCount: sarLine.length }, switched, restored, replay: { rows: replayBefore.rows, sarCount: replayBefore.sar.filter(Number.isFinite).length }, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
