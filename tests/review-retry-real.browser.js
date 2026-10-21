// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
async (page) => {
  const failures = [], errors = [];
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
    await context.route('**/unpkg.com/**', route => route.abort());
    const target = await context.newPage();
    target.on('pageerror', error => errors.push(error.message));
    target.on('dialog', dialog => dialog.accept());
    await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
    await target.locator('[data-nav-target="market"]').click();
    await target.locator('#workspaceStart').click();
    await target.locator('#confirmTrainingStart').click();
    await target.waitForFunction(() => activeWorkspace === 'replay' && state.revealCount === 24 && state.sessionLength === 60);
    for (let i = 0; i < 36; i++) {
      await target.locator('#workspaceDecision').click();
      const price = await target.evaluate(() => visibleClose().close);
      await target.locator('#decisionDirection').selectOption('up');
      await target.locator('[name="decisionEvidence"][value="EMA"]').check();
      await target.locator('#decisionInvalidation').fill(String((price * 0.99).toFixed(2)));
      await target.locator('#decisionTarget').fill(String((price * 1.0025).toFixed(2)));
      await target.locator('#decisionRisk').selectOption('defined');
      await target.locator('#saveDecisionReveal').click();
    }
    const completed = await target.evaluate(() => ({ reveal: state.revealCount, decisions: replayTraining.decisions.length, saved: replayTraining.saved }));
    if (completed.reveal !== 60 || completed.decisions !== 36 || completed.saved) failures.push(`unexpected pre-finish state: ${JSON.stringify(completed)}`);
    await target.locator('#replayFinish').click();
    const report = await target.evaluate(() => ({
      workspace: activeWorkspace,
      complete: document.querySelector('#sessionReportBadge').textContent,
      count: document.querySelector('#sessionCompleteness').textContent,
      actions: [...document.querySelectorAll('#sessionNextSteps [data-review-retry-indicator]')].map(node => node.dataset.reviewRetryIndicator),
      history: JSON.parse(localStorage.getItem('trend-lab-replay-history') || '[]').length,
      mistakeText: document.querySelector('#sessionMistakes').textContent
    }));
    for (const id of ['measured-move', 'candles']) if (!report.actions.includes(id)) failures.push(`missing ${id} retry action`);
    if (report.workspace !== 'review' || report.complete !== '已完成' || report.count !== '36 次' || report.history !== 1) failures.push('report completion/archive mismatch');
    if (!report.mistakeText.includes('结构证据缺失') || !report.mistakeText.includes('低于 1R') || !report.mistakeText.includes('理由过短或为空')) failures.push('mistakes not attributed');
    await target.locator('#sessionNextSteps [data-review-retry-indicator="candles"]').click();
    const lesson = await target.evaluate(() => ({ workspace: activeWorkspace, selected: selectedIndicatorId, reportStored: JSON.parse(localStorage.getItem('trend-lab-replay-history') || '[]').length }));
    if (lesson.workspace !== 'indicators' || lesson.selected !== 'candles' || lesson.reportStored !== 1) failures.push(`retry route/report retention mismatch: ${JSON.stringify(lesson)}`);
    return { passed: failures.length === 0 && errors.length === 0, completed, report, lesson, errors, failures };
  } finally {
    await context.close();
  }
}
