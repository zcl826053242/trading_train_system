// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；需要本地静态服务 4188。
// 回放最早发布阶段状态的本地存储结构，检查后续新增的概念课字段不会清空旧进度。
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const target = await context.newPage();
  const errors = [];
  const failures = [];
  const legacyState = {
    active: 1,
    mode: 'exam',
    unlocked: [true, false, false],
    progress: [
      { questions: 3, correct: 2, trades: 1, checks: 1, replay: false, passed: true },
      { questions: 3, correct: 2, trades: 1, checks: 1, replay: false, passed: false },
      { questions: 0, correct: 0, trades: 0, checks: 0, replay: false, passed: false }
    ]
  };
  target.on('pageerror', error => errors.push(error.message));
  await target.route('https://fapi.binance.com/**', route => route.abort());
  await target.route('**/unpkg.com/**', route => route.abort());
  await context.addInitScript(saved => {
    if (localStorage.getItem('__training-route-legacy-seeded')) return;
    localStorage.setItem('__training-route-legacy-seeded', 'true');
    localStorage.setItem('trend-lab-stage-state', JSON.stringify(saved));
  }, legacyState);

  const snapshot = () => target.evaluate(() => {
    const cards = [...document.querySelectorAll('#stageCards [data-stage-select]')];
    return {
      active: stageState.active,
      mode: stageState.mode,
      foundationStarted: stageState.foundationStarted,
      foundationComplete: stageState.foundationComplete,
      foundationStep: stageState.foundationStep,
      progress: stageState.progress.map(({ questions, correct, trades, checks, replay, passed }) => ({ questions, correct, trades, checks, replay, passed })),
      unlocked: stageState.unlocked,
      cards: cards.map(card => ({ active: card.classList.contains('active'), passed: card.classList.contains('passed'), locked: card.disabled })),
      route: getTrainingRoute(),
      examMode: document.body.classList.contains('exam-mode'),
      persisted: JSON.parse(localStorage.getItem('trend-lab-stage-state') || 'null')
    };
  });
  const verify = (value, label) => {
    if (value.active !== 1 || value.mode !== 'exam') failures.push(`${label}: did not retain the selected advanced exam stage`);
    if (value.foundationStarted || value.foundationComplete || value.foundationStep !== 0) failures.push(`${label}: absent legacy concept fields were credited or started`);
    if (value.progress[0].questions !== 3 || value.progress[0].correct !== 2 || value.progress[0].trades !== 1 || value.progress[0].checks !== 1 || !value.progress[0].passed) failures.push(`${label}: completed novice progress was lost`);
    if (value.progress[1].questions !== 3 || value.progress[1].correct !== 2 || value.progress[1].trades !== 1 || value.progress[1].checks !== 1) failures.push(`${label}: partial advanced progress was lost`);
    if (value.cards[0].passed !== true || value.cards[1].locked || !value.cards[1].active || !value.cards[2].locked) failures.push(`${label}: unlocks were not derived from preserved completion criteria`);
    if (value.route.current?.id !== 'questions' || !value.route.current.detail.includes('3 / 6')) failures.push(`${label}: continue route did not resume at the next advanced question`);
    if (!value.examMode) failures.push(`${label}: exam mode UI did not restore`);
    if (value.persisted?.foundationComplete !== false || value.persisted?.foundationStep !== 0 || value.persisted?.progress?.[1]?.questions !== 3) failures.push(`${label}: migrated state was not normalized and saved`);
  };

  try {
    await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady && activeWorkspace === 'home');
    const first = await snapshot();
    verify(first, 'initial load');
    await target.reload({ waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady && activeWorkspace === 'home');
    const reloaded = await snapshot();
    verify(reloaded, 'reload');
    if (errors.length) failures.push(`page errors: ${errors.join('; ')}`);
    return { passed: failures.length === 0, beforeReload: first, afterReload: reloaded, errors, failures };
  } catch (error) {
    return { passed: false, error: error.message, failures, errors };
  } finally {
    await context.close();
  }
}
