// Playwright browser_run_code_unsafe: filename 指向此文件；本地服务端口 4188。
// 使用独立浏览器存储并拦截外部行情，仅验证本地历史训练配置。
async (page) => {
  const failures = [], results = [];
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
    await target.locator('[data-nav-target="market"]').click();
    await target.locator('#workspaceStart').click();

    const setupSummary = () => target.evaluate(() => ({
      open: document.querySelector('#trainingSetup').open,
      max: document.querySelector('#setupLengthCustom').max,
      min: document.querySelector('#setupLengthCustom').min,
      value: document.querySelector('#setupLengthCustom').value,
      customDisabled: document.querySelector('#setupLengthCustom').disabled,
      invalid: document.querySelector('#setupLengthCustom').getAttribute('aria-invalid'),
      startDisabled: document.querySelector('#confirmTrainingStart').disabled,
      length: trainingSetupState.length,
      lengthMode: trainingSetupState.lengthMode,
      presets: [...document.querySelectorAll('[data-setup-length]')].map(button => ({ length: Number(button.dataset.setupLength), pressed: button.getAttribute('aria-pressed') === 'true', disabled: button.disabled })),
      unavailablePeriods: [...document.querySelectorAll('[data-setup-time="1D"], [data-setup-time="1W"], [data-setup-time="1M"]')].map(button => ({ period: button.dataset.setupTime, disabled: button.disabled, title: button.title })),
      hint: document.querySelector('#setupLengthHint').textContent
    }));
    let summary = await setupSummary();
    if (!summary.open || summary.max !== '475' || summary.min !== '10' || summary.startDisabled) failures.push(`1H defaults/upfront upper bound incorrect: ${JSON.stringify(summary)}`);
    if (summary.unavailablePeriods.some(item => !item.disabled || !item.title.includes('尚未载入'))) failures.push(`Unloaded daily/weekly/monthly periods should be disabled with a reason: ${JSON.stringify(summary.unavailablePeriods)}`);
    results.push({ case: 'dynamic-cap-and-unavailable-periods', summary });

    await target.locator('#setupLengthCustom').fill('475');
    summary = await setupSummary();
    if (summary.length !== 475 || summary.startDisabled || summary.invalid !== 'false') failures.push(`Valid max length 475 was not enabled: ${JSON.stringify(summary)}`);
    await target.locator('#confirmTrainingStart').click();
    await target.waitForFunction(() => activeWorkspace === 'replay' && state.sessionLength === 475 && state.revealCount === 24);
    results.push({ case: 'start-at-real-maximum', session: await target.evaluate(() => ({ length: state.sessionLength, reveal: state.revealCount, rows: replayWindow().length, start: state.sessionStart })) });

    await target.locator('#replayConfigure').click();
    await target.locator('#setupLengthCustom').fill('476');
    summary = await setupSummary();
    if (summary.startDisabled !== true || summary.invalid !== 'true') failures.push(`Out-of-range 476 was not blocked: ${JSON.stringify(summary)}`);
    await target.locator('#setupLengthCustom').fill('120');
    summary = await setupSummary();
    if (summary.length !== 120 || summary.startDisabled || summary.presets.some(item => item.pressed)) failures.push(`Custom value must update length but not select a preset: ${JSON.stringify(summary)}`);
    await target.locator('[data-setup-length="120"]').click();
    summary = await setupSummary();
    if (summary.value !== '120' || summary.length !== 120 || !summary.presets.find(item => item.length === 120)?.pressed) failures.push(`Preset must sync its custom field and pressed state: ${JSON.stringify(summary)}`);
    const beforeCancel = await target.evaluate(() => ({ length: state.sessionLength, reveal: state.revealCount, start: state.sessionStart, id: replayTraining.id, workspace: activeWorkspace }));
    await target.locator('#cancelTrainingSetup').click();
    const afterCancel = await target.evaluate(() => ({ length: state.sessionLength, reveal: state.revealCount, start: state.sessionStart, id: replayTraining.id, workspace: activeWorkspace }));
    if (JSON.stringify(beforeCancel) !== JSON.stringify(afterCancel)) failures.push(`Cancelling configuration mutated the active replay: ${JSON.stringify({ beforeCancel, afterCancel })}`);
    results.push({ case: 'invalid-preset-sync-and-cancel', invalid476: { disabled: true, ariaInvalid: 'true' }, custom120: 'accepted without preset selection', beforeCancel, afterCancel });

    await target.locator('#replayConfigure').click();
    await target.locator('#setupLengthCustom').fill('10');
    summary = await setupSummary();
    if (summary.startDisabled || summary.length !== 10) failures.push(`Minimum length 10 should be usable: ${JSON.stringify(summary)}`);
    await target.locator('#confirmTrainingStart').click();
    await target.waitForFunction(() => activeWorkspace === 'replay' && state.sessionLength === 10 && state.revealCount === 8);
    const shortSession = await target.evaluate(() => ({ length: state.sessionLength, reveal: state.revealCount, visibleRows: getHistoricalReplay().length,
      windowRows: replayWindow().length, start: state.sessionStart, maxStart: historicalRows.length - state.sessionLength - TRAINING_WARMUP }));
    if (shortSession.visibleRows !== 8 || shortSession.windowRows !== 10 || shortSession.start > shortSession.maxStart) failures.push(`10-bar replay did not start with 8 visible bars and 2 future bars: ${JSON.stringify(shortSession)}`);
    results.push({ case: 'minimum-short-session-reveal', shortSession });

    await target.evaluate(() => openTrainingSetup({ sampleIndex: 100, indicator: 'rsi' }));
    summary = await setupSummary();
    if (summary.length !== 60 || summary.value !== '60' || !summary.customDisabled || summary.startDisabled) failures.push(`Course-pinned sample must remain 60 bars and disable custom length: ${JSON.stringify(summary)}`);
    await target.locator('#confirmTrainingStart').click();
    await target.waitForFunction(() => activeWorkspace === 'replay' && state.sessionLength === 60 && state.revealCount === 24 && state.sessionStart === 77);
    results.push({ case: 'course-pinned-length-remains-60', session: await target.evaluate(() => ({ length: state.sessionLength, reveal: state.revealCount, start: state.sessionStart, mode: replayTraining.mode })) });
    if (errors.length) failures.push(`Browser errors: ${errors.join('; ')}`);
  } finally {
    await context.close();
  }
  if (failures.length) throw new Error(`${failures.join('\n')}\nResults: ${JSON.stringify(results)}`);
  return { status: 'PASS', results, errors };
}
