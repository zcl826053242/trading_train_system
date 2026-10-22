// 验证训练设置按浏览器保存最近选择，并与课程固定样本隔离；需要本地 4188 服务。
async (page) => {
  const failures = [], results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const target = await context.newPage();
    const errors = [];
    target.on('pageerror', error => errors.push(error.message));
    target.on('dialog', dialog => dialog.accept());
    try {
      await context.route('https://fapi.binance.com/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.locator('#workspaceStart').click();
      const read = () => target.evaluate(() => ({
        open: document.querySelector('#trainingSetup').open,
        market: document.querySelector('[data-setup-market][aria-pressed="true"]')?.dataset.setupMarket,
        timeframe: document.querySelector('[data-setup-time][aria-pressed="true"]')?.dataset.setupTime,
        length: trainingSetupState.length,
        lengthMode: trainingSetupState.lengthMode,
        mode: trainingModeState.mode,
        modePressed: document.querySelector('[data-setup-mode][aria-pressed="true"]')?.dataset.setupMode,
        hint: document.querySelector('#setupPreferenceHint')?.textContent || '',
        stored: JSON.parse(localStorage.getItem('trend-lab-training-setup') || 'null')
      }));
      await target.locator('[data-setup-market="spot"]').click();
      await target.locator('[data-setup-time="5m"]').click();
      await target.locator('[data-setup-length="120"]').click();
      await target.locator('[data-setup-mode="free"]').click();
      const selected = await read();
      if (selected.market !== 'spot' || selected.timeframe !== '5m' || selected.length !== 120 || selected.lengthMode !== 'preset' || selected.mode !== 'free' || selected.modePressed !== 'free') failures.push(`${viewport.width}: selected setup was not applied: ${JSON.stringify(selected)}`);
      if (selected.stored?.market !== 'spot' || selected.stored?.timeframe !== '5m' || selected.stored?.length !== 120 || selected.stored?.mode !== 'free') failures.push(`${viewport.width}: setup preference was not stored: ${JSON.stringify(selected.stored)}`);
      await target.locator('#cancelTrainingSetup').click();
      await target.reload({ waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.locator('#workspaceStart').click();
      const restored = await read();
      if (!restored.open || restored.market !== 'spot' || restored.timeframe !== '5m' || restored.length !== 120 || restored.lengthMode !== 'preset' || restored.mode !== 'free' || restored.modePressed !== 'free') failures.push(`${viewport.width}: setup preference did not restore after refresh: ${JSON.stringify(restored)}`);
      if (!restored.hint.includes('已恢复上次训练设置')) failures.push(`${viewport.width}: restored setup did not explain the saved preference: ${JSON.stringify(restored)}`);
      await target.locator('#cancelTrainingSetup').click();
      await target.evaluate(() => openTrainingSetup({ sampleIndex: 100, indicator: 'rsi' }));
      const pinned = await read();
      if (pinned.market !== 'spot' || pinned.timeframe !== '1H' || pinned.length !== 60 || pinned.mode !== 'blind' || pinned.modePressed !== 'blind') failures.push(`${viewport.width}: course-pinned setup did not override only the active dialog: ${JSON.stringify(pinned)}`);
      await target.locator('#cancelTrainingSetup').click();
      const afterPinnedCancel = await target.evaluate(() => JSON.parse(localStorage.getItem('trend-lab-training-setup') || 'null'));
      if (afterPinnedCancel?.market !== 'spot' || afterPinnedCancel?.timeframe !== '5m' || afterPinnedCancel?.length !== 120 || afterPinnedCancel?.mode !== 'free') failures.push(`${viewport.width}: pinned course dialog overwrote learner preference: ${JSON.stringify(afterPinnedCancel)}`);
      if (errors.length) failures.push(`${viewport.width}: page errors: ${errors.join('; ')}`);
      results.push({ viewport: `${viewport.width}x${viewport.height}`, selected, restored, pinned, afterPinnedCancel, errors });
    } catch (error) {
      failures.push(`${viewport.width}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
