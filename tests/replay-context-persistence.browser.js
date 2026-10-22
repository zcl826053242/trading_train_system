// Playwright browser_run_code_unsafe：本地 4188。覆盖长场次带仓刷新及切行情取消保护。
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const target = await context.newPage();
  const errors = [], failures = [], checkpoints = [], dialogs = [];
  let nextConfirm = 'dismiss';
  target.on('pageerror', error => errors.push(error.message));
  target.on('dialog', async dialog => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (dialog.type() === 'confirm' && nextConfirm === 'accept') await dialog.accept();
    else await dialog.dismiss();
  });
  await target.route('https://fapi.binance.com/**', route => route.abort());
  await target.route('**/unpkg.com/**', route => route.abort());

  const read = () => target.evaluate(() => ({
    workspace: activeWorkspace,
    market: state.replayMarket,
    timeframe: state.timeframe,
    replayMode: state.replayMode,
    replayId: replayTraining.id,
    revealCount: state.revealCount,
    sessionLength: state.sessionLength,
    paused: state.replayPaused,
    saved: replayTraining.saved,
    position: sim.position ? { ...sim.position } : null,
    balance: sim.balance,
    trades: sim.trades.filter(trade => trade.sessionId === replayTraining.id).length,
    openSetup: document.querySelector('#trainingSetup')?.open === true,
    dataMode: state.dataMode
  }));
  const check = (ok, message) => { if (!ok) failures.push(message); };

  try {
    await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady && activeWorkspace === 'home');
    const moreLearning = target.locator('.home-more-learning');
    if (await moreLearning.count() && !await moreLearning.evaluate(element => element.open)) {
      await moreLearning.locator('summary').click();
    }
    await target.locator('[data-loop-action="setup"]').click();
    await target.locator('[data-setup-length="300"]').click();
    await target.locator('[data-setup-mode="free"]').click();
    await target.waitForFunction(() => trainingSetupState.length === 300 && !document.querySelector('#confirmTrainingStart').disabled);
    await target.locator('#confirmTrainingStart').click();
    await target.waitForFunction(() => activeWorkspace === 'replay' && state.sessionLength === 300 && state.revealCount === 24);

    const riskSettings = target.locator('.sim-risk-settings');
    if (await riskSettings.count() && !await riskSettings.evaluate(element => element.open)) {
      await riskSettings.locator('summary').click();
    }
    await target.locator('#simStop').fill('20');
    await target.locator('#simTarget').fill('50');
    await target.locator('#openPosition').click();
    await target.waitForFunction(() => Boolean(sim.position));
    await target.locator('#replayPause').click();
    await target.waitForFunction(() => state.replayPaused);
    const beforeSwitch = await read();
    check(beforeSwitch.replayMode && beforeSwitch.sessionLength === 300 && beforeSwitch.revealCount === 24 && beforeSwitch.position,
      `long session was not active with an open position: ${JSON.stringify(beforeSwitch)}`);

    await target.locator('.chart-advanced > summary').click();
    await target.locator('#liveDataBtn').click();
    let current = await read();
    check(dialogs.some(dialog => dialog.type === 'confirm'), 'switching away from a paused open-position replay did not ask for confirmation');
    check(current.replayId === beforeSwitch.replayId && current.replayMode && current.paused && current.revealCount === 24
      && current.sessionLength === 300 && current.position?.entry === beforeSwitch.position?.entry && current.balance === beforeSwitch.balance,
      `cancelled market switch changed the active replay: ${JSON.stringify(current)}`);
    checkpoints.push({ name: 'cancelled-market-switch-keeps-300-bar-position', replayId: current.replayId, revealCount: current.revealCount, balance: current.balance });

    await target.locator('#cancelTrainingSetup').click().catch(() => {});
    // The live/sim controls are in a disclosure; navigate away and back to verify recovery from the saved draft.
    await target.locator('[data-nav-target="home"]').click();
    await target.reload({ waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady && activeWorkspace === 'home');
    current = await read();
    check(current.replayId === beforeSwitch.replayId && current.replayMode && current.paused && current.revealCount === 24
      && current.sessionLength === 300 && current.position?.entry === beforeSwitch.position?.entry && current.balance === beforeSwitch.balance,
      `paused 300-bar replay/account was not restored: ${JSON.stringify(current)}`);
    checkpoints.push({ name: 'paused-long-replay-restored-after-refresh', replayId: current.replayId, revealCount: current.revealCount, balance: current.balance, position: Boolean(current.position) });

    if (await moreLearning.count() && !await moreLearning.evaluate(element => element.open)) {
      await moreLearning.locator('summary').click();
    }
    await target.locator('[data-loop-action="replay"]').click();
    await target.waitForFunction(() => activeWorkspace === 'replay' && state.replayPaused && replayTraining.id);
    await target.locator('#replayPause').click();
    await target.waitForFunction(() => !state.replayPaused);
    const beforeReveal = await target.evaluate(() => state.revealCount);
    await target.locator('#replayNext').click();
    await target.waitForFunction(expected => state.revealCount === expected, beforeReveal + 1);
    current = await read();
    check(current.position && current.trades === 0 && current.revealCount === 25 && current.sessionLength === 300,
      `resumed free replay failed to advance once or preserve position: ${JSON.stringify(current)}`);
    checkpoints.push({ name: 'resumed-free-step-advances-once', revealCount: current.revealCount, position: Boolean(current.position), trades: current.trades });

    // Keep one completed trade in the journal, then accept a context switch while a new position is open.
    await target.locator('#closePosition').click();
    await target.waitForFunction(id => !sim.position && sim.trades.some(trade => trade.sessionId === id), beforeSwitch.replayId);
    await target.locator('#openPosition').click();
    await target.waitForFunction(() => Boolean(sim.position));
    const beforeAcceptedSwitch = await read();
    check(beforeAcceptedSwitch.replayId === beforeSwitch.replayId && beforeAcceptedSwitch.position && beforeAcceptedSwitch.trades === 1,
      `could not prepare accepted-switch state with one archived trade and one open position: ${JSON.stringify(beforeAcceptedSwitch)}`);

    await target.locator('[data-nav-target="market"]').click();
    const advanced = target.locator('.chart-advanced');
    if (await advanced.count() && !await advanced.evaluate(element => element.open)) await advanced.locator('summary').click();
    nextConfirm = 'accept';
    await target.locator('#liveDataBtn').click();
    await target.waitForFunction(() => state.dataMode === 'live' && !state.replayMode && !sim.position && replayTraining.id === '');
    await target.waitForFunction(() => {
      const context = JSON.parse(localStorage.getItem('trend-lab-session-draft') || '{}')?.context;
      return context?.dataMode === 'live' && context.replayMode === false;
    });
    current = await read();
    const archive = await target.evaluate(id => ({
      inMemory: sim.trades.filter(trade => trade.sessionId === id).length,
      persisted: JSON.parse(localStorage.getItem('trend-lab-trades') || '[]').filter(trade => trade.sessionId === id).length,
      resetBalance: sim.balance === sim.initialBalance,
      savedDraft: JSON.parse(localStorage.getItem('trend-lab-session-draft') || '{}')?.context
    }), beforeSwitch.replayId);
    check(dialogs.filter(dialog => dialog.type === 'confirm').length >= 2, 'accepted market switch did not present a confirmation');
    check(current.dataMode === 'live' && !current.replayMode && !current.position && !current.paused && current.balance === 10000,
      `accepted market switch did not reset the active simulation context: ${JSON.stringify(current)}`);
    check(archive.inMemory === 1 && archive.persisted === 1 && archive.resetBalance && archive.savedDraft?.dataMode === 'live'
      && archive.savedDraft?.replayMode === false,
      `accepted switch did not preserve the closed trade and persist the reset context: ${JSON.stringify(archive)}`);
    await target.waitForFunction(id => JSON.parse(localStorage.getItem('trend-lab-session-draft') || '{}')?.account?.trades?.some(trade => trade.sessionId === id), beforeSwitch.replayId);
    await target.reload({ waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady && activeWorkspace === 'market' && !state.replayMode);
    const afterAcceptedReload = await target.evaluate(id => ({ dataMode: state.dataMode, replayMode: state.replayMode,
      position: Boolean(sim.position), balance: sim.balance, replayId: replayTraining.id,
      archivedTrades: sim.trades.filter(trade => trade.sessionId === id).length }), beforeSwitch.replayId);
    check(afterAcceptedReload.dataMode === 'live' && !afterAcceptedReload.replayMode && !afterAcceptedReload.position
      && afterAcceptedReload.balance === 10000 && afterAcceptedReload.replayId === '' && afterAcceptedReload.archivedTrades === 1,
      `accepted context reset was not stable after refresh or lost the completed trade: ${JSON.stringify(afterAcceptedReload)}`);
    checkpoints.push({ name: 'accepted-switch-resets-active-context-preserves-trade', archive, afterAcceptedReload });
    check(errors.length === 0, `page errors: ${errors.join('; ')}`);
    return { passed: failures.length === 0, checkpoints, dialogs, errors, failures };
  } catch (error) {
    let current = null;
    try { current = await read(); } catch (_) {}
    failures.push(`${error.message} | state: ${JSON.stringify(current)}`);
    return { passed: false, checkpoints, dialogs, errors, failures };
  } finally {
    await context.close();
  }
}
