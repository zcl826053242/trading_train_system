// Playwright browser_run_code_unsafe: filename 指向此文件；需本地服务端口 4190。
// 独立浏览器上下文验证永续默认选项、现货切换、来源归因及刷新续接。
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const failures = [], pageErrors = [], results = [];
  try {
    await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
    await context.route('**/unpkg.com/**', route => route.abort());
    const target = await context.newPage();
    target.on('pageerror', error => pageErrors.push(error.message));
    target.on('dialog', dialog => dialog.accept());
    await target.goto('http://127.0.0.1:4190/', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReadyByMarket.spot && historicalReadyByMarket.swap && sessionPersistenceReady);
    await target.locator('[data-nav-target="market"]').click();
    await target.locator('#workspaceStart').click();

    let setup = await target.evaluate(() => ({
      open: document.querySelector('#trainingSetup').open,
      markets: [...document.querySelectorAll('[data-setup-market]')].map(button => ({ market: button.dataset.setupMarket, pressed: button.getAttribute('aria-pressed'), disabled: button.disabled })),
      status: document.querySelector('#setupDataStatus').textContent,
      presets: [...document.querySelectorAll('[data-setup-length]')].map(button => ({ length: Number(button.dataset.setupLength), disabled: button.disabled }))
    }));
    if (!setup.open || setup.markets.find(item => item.market === 'swap')?.pressed !== 'true' || setup.markets.some(item => item.disabled)) failures.push(`perpetual should be available and selected by default: ${JSON.stringify(setup)}`);
    if (!setup.status.includes('USDⓈ-M') || setup.presets.some(item => item.disabled)) failures.push(`perpetual history not ready in setup: ${JSON.stringify(setup)}`);
    results.push({ case: 'default-perpetual-dataset', setup });

    await target.locator('#setupLengthCustom').fill('10');
    await target.locator('#confirmTrainingStart').click();
    await target.waitForFunction(() => state.replayMode && replayTraining.sourceId === 'binance-usdm-historical-snapshot');
    const swapSession = await target.evaluate(() => ({ market: state.replayMarket, sourceId: replayTraining.sourceId, marketType: replayTraining.marketType,
      rows: historicalRows.length, usesSelectedDataset: historicalRows === historicalByMarket.swap['1H'], reveal: state.revealCount,
      visibleBars: getHistoricalReplay().length, sourceLabel: document.querySelector('#dataSourceLabel').textContent,
      sourceMeta: document.querySelector('#dataSourceMeta').textContent }));
    if (swapSession.market !== 'swap' || swapSession.marketType !== '永续' || swapSession.rows !== 499 || !swapSession.usesSelectedDataset || swapSession.visibleBars !== 8) failures.push(`perpetual replay did not use its own closed snapshot: ${JSON.stringify(swapSession)}`);
    if (!swapSession.sourceMeta.includes('binance-usdm-historical-snapshot') || !swapSession.sourceMeta.includes('永续')) failures.push(`perpetual attribution missing on chart: ${JSON.stringify(swapSession)}`);
    results.push({ case: 'perpetual-replay', swapSession });

    await target.waitForFunction(() => JSON.parse(localStorage.getItem('trend-lab-session-draft') || '{}')?.context?.replayMarket === 'swap');
    await target.reload({ waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => sessionPersistenceReady && state.replayMode && state.replayMarket === 'swap');
    const restored = await target.evaluate(() => ({ market: state.replayMarket, sourceId: replayTraining.sourceId, rows: historicalRows.length,
      usesSelectedDataset: historicalRows === historicalByMarket.swap[state.timeframe], label: document.querySelector('#dataSourceLabel').textContent }));
    if (restored.sourceId !== 'binance-usdm-historical-snapshot' || !restored.usesSelectedDataset) failures.push(`refresh failed to restore perpetual source: ${JSON.stringify(restored)}`);
    results.push({ case: 'perpetual-refresh-restore', restored });

    await target.locator('#replayConfigure').click();
    await target.locator('[data-setup-market="spot"]').click();
    setup = await target.evaluate(() => ({ selected: document.querySelector('[data-setup-market="spot"]').getAttribute('aria-pressed'),
      status: document.querySelector('#setupDataStatus').textContent, hint: document.querySelector('#setupMarketHint').textContent }));
    if (setup.selected !== 'true' || !setup.status.includes('现货') || !setup.hint.includes('不等同永续')) failures.push(`spot switch did not update attribution and warning: ${JSON.stringify(setup)}`);
    await target.locator('#setupLengthCustom').fill('10');
    await target.locator('#confirmTrainingStart').click();
    await target.waitForFunction(() => state.replayMode && replayTraining.sourceId === 'binance-spot-snapshot');
    const spotSession = await target.evaluate(() => ({ market: state.replayMarket, sourceId: replayTraining.sourceId, marketType: replayTraining.marketType,
      rows: historicalRows.length, usesSelectedDataset: historicalRows === historicalByMarket.spot['1H'], meta: document.querySelector('#dataSourceMeta').textContent }));
    if (spotSession.market !== 'spot' || spotSession.marketType !== '现货' || !spotSession.usesSelectedDataset || !spotSession.meta.includes('现货')) failures.push(`spot replay was not isolated: ${JSON.stringify(spotSession)}`);
    results.push({ case: 'spot-replay-remains-available', spotSession });

    await target.evaluate(() => openTrainingSetup({ sampleIndex: 100, indicator: 'rsi' }));
    const pinned = await target.evaluate(() => ({ market: trainingSetupState.market, spotPressed: document.querySelector('[data-setup-market="spot"]').getAttribute('aria-pressed'),
      swapDisabled: document.querySelector('[data-setup-market="swap"]').disabled, length: trainingSetupState.length, startDisabled: document.querySelector('#confirmTrainingStart').disabled }));
    if (pinned.market !== 'spot' || pinned.spotPressed !== 'true' || !pinned.swapDisabled || pinned.length !== 60 || pinned.startDisabled) failures.push(`course anchor must remain pinned to spot history: ${JSON.stringify(pinned)}`);
    results.push({ case: 'course-anchor-keeps-spot', pinned });
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.join('; ')}`);
  } finally {
    await context.close();
  }
  if (failures.length) throw new Error(`${failures.join('\n')}\nResults: ${JSON.stringify(results)}`);
  return { status: 'PASS', results, pageErrors };
}
