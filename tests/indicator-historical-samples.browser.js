// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 验证 MACD 历史案例到固定双盲回放的课程路径，不代表实盘行情验收。
async (page) => {
  const failures = [], results = [];
  for (const sampleIndex of [87, 276]) {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      target.on('dialog', dialog => dialog.accept());
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.evaluate(() => setWorkspace('indicators'));
      await target.locator('[data-indicator-entry="macd"]').click();
      const card = target.locator(`.indicator-market-sample:has([data-pin-replay-sample="${sampleIndex}"])`);
      await card.waitFor();
      const metrics = await card.locator('[data-macd-metric]').allTextContents();
      if (metrics.length !== 3) failures.push(`${sampleIndex}: expected DIF/DEA/histogram readouts`);
      if (!(await card.locator('small').first().textContent()).includes('Binance 现货 K 线')) failures.push(`${sampleIndex}: source label missing`);
      await card.locator('[data-pin-replay-sample]').click();
      const setup = await target.evaluate(() => ({
        open: document.querySelector('#trainingSetup').open,
        pinned: !document.querySelector('#setupPinnedSample').hidden,
        timeframe: [...document.querySelectorAll('[data-setup-time]')].find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.setupTime,
        length: [...document.querySelectorAll('[data-setup-length]')].find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.setupLength,
        mode: [...document.querySelectorAll('[data-setup-mode]')].find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.setupMode,
        macdEnabled: state.indicator.macd,
        savedMacd: JSON.parse(localStorage.getItem('trend-lab-chart-indicators') || '{}').macd
      }));
      if (!setup.open || !setup.pinned || setup.timeframe !== '1H' || setup.length !== '60' || setup.mode !== 'blind' || !setup.macdEnabled || !setup.savedMacd) failures.push(`${sampleIndex}: pinned replay setup or MACD preference incorrect`);
      await target.locator('#confirmTrainingStart').click();
      const replay = await target.evaluate(() => ({
        workspace: activeWorkspace, timeframe: state.timeframe, length: state.sessionLength,
        start: state.sessionStart, reveal: state.revealCount, macd: state.indicator.macd, mode: replayTraining.mode
      }));
      if (replay.workspace !== 'replay' || replay.timeframe !== '1H' || replay.length !== 60 || replay.start !== sampleIndex - 23 || replay.reveal !== 24 || !replay.macd || replay.mode !== 'blind') failures.push(`${sampleIndex}: replay did not preserve sample and lesson setup`);
      if (errors.length) failures.push(`${sampleIndex}: ${errors.join('; ')}`);
      results.push({ sampleIndex, metrics, setup, replay, errors });
    } catch (error) {
      failures.push(`${sampleIndex}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
