// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；先启动本地 4188 服务。
// 隔离 context，以模拟 OKX candle 响应验证周期切换和手机菜单边界。
async (page) => {
  const failures = [], results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 667 }, { width: 320, height: 667 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const calls = [], errors = [], name = `${viewport.width}x${viewport.height}`;
    try {
      await context.route('https://www.okx.com/api/v5/market/candles**', async route => {
        calls.push(new URL(route.request().url()).searchParams.get('bar'));
        const now = Math.floor(Date.now() / 60000) * 60000;
        const data = Array.from({ length: 80 }, (_, i) => {
          const close = 68000 + i * 4;
          return [String(now - (79 - i) * 60000), String(close - 5), String(close + 8), String(close - 9), String(close), '12', '12', String(close * 12), '1'];
        }).reverse();
        await route.fulfill({ json: { code: '0', data } });
      });
      const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.evaluate(async () => {
        state.dataMode = 'live'; state.replayMode = false; state.timeframe = '1H'; state.liveRows = [];
        syncChartTimeframeControls(); await loadLiveMarket();
      });
      await target.locator('#chartMoreIntervals > summary').click();
      const menu = await target.evaluate(() => {
        const details = document.querySelector('#chartMoreIntervals'), rect = details.querySelector('.chart-interval-menu').getBoundingClientRect();
        return { open: details.open, width: rect.width, left: rect.left, right: rect.right,
          buttons: [...details.querySelectorAll('[data-time]')].map(button => ({ period: button.dataset.time, disabled: button.disabled })) };
      });
      if (!menu.open || menu.buttons.length !== 9) failures.push(`${name}: additional interval menu failed to open`);
      if (menu.left < -1 || menu.right > viewport.width + 1) failures.push(`${name}: interval menu leaves viewport`);
      if (await target.evaluate(() => document.documentElement.scrollWidth > innerWidth)) failures.push(`${name}: interval controls create horizontal page overflow`);
      if (menu.buttons.some(button => button.disabled)) failures.push(`${name}: live intervals unexpectedly disabled`);
      await target.locator('#chartMoreIntervals > summary').focus(); await target.keyboard.press('Escape');
      if (await target.locator('#chartMoreIntervals').evaluate(node => node.open)) failures.push(`${name}: Escape did not close the interval menu`);
      await target.locator('#chartMoreIntervals > summary').click();
      await target.locator('.price-block').click();
      if (await target.locator('#chartMoreIntervals').evaluate(node => node.open)) failures.push(`${name}: outside click did not close the interval menu`);
      await target.locator('#chartMoreIntervals > summary').click();
      await target.locator('#chartMoreIntervals [data-time="2H"]').click();
      await target.waitForFunction(() => state.timeframe === '2H' && !state.liveLoading && state.liveRows.length >= 8);
      if (calls.at(-1) !== '2H' || await target.locator('#chartIntervalLabel').textContent() !== '2H') failures.push(`${name}: 2H selection did not reach data request and chart label`);
      if (await target.locator('#chartMoreIntervals').evaluate(node => node.open)) failures.push(`${name}: menu remained open after selection`);
      await target.locator('#chartMoreIntervals > summary').click();
      await target.locator('#chartMoreIntervals [data-time="1W"]').click();
      await target.waitForFunction(() => state.timeframe === '1W' && !state.liveLoading && state.liveRows.length >= 8);
      if (calls.at(-1) !== '1W') failures.push(`${name}: weekly selection used the wrong exchange bar`);
      const replayGate = await target.evaluate(() => {
        state.replayMode = true; state.timeframe = '1H'; syncChartTimeframeControls();
        return { available: ['1m', '5m', '1H'].every(period => !document.querySelector(`[data-time="${period}"]`).disabled),
          unavailable: ['3m', '2H', '1W', '1M'].every(period => document.querySelector(`[data-time="${period}"]`).disabled),
          rejected: selectChartTimeframe('2H') === false, timeframe: state.timeframe };
      });
      if (!replayGate.available || !replayGate.unavailable || !replayGate.rejected || replayGate.timeframe !== '1H') failures.push(`${name}: unavailable historical interval leaked into replay`);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, menu, calls, replayGate, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
