// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；需要本地静态服务 4188。
// 从旧版进阶阶段的部分进度续学，覆盖答题、持仓和暂停回放刷新，不预置当前版本字段。
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const target = await context.newPage();
  const errors = [];
  const failures = [];
  const checkpoints = [];
  const stageSeed = {
    active: 1,
    mode: 'teach',
    unlocked: [true, true, false],
    foundationStarted: false,
    foundationComplete: false,
    foundationStep: 0,
    progress: [
      { questions: 3, correct: 2, trades: 1, checks: 1, replay: false, passed: true },
      { questions: 3, correct: 2, trades: 1, checks: 1, replay: false, passed: false },
      { questions: 0, correct: 0, trades: 0, checks: 0, replay: false, passed: false }
    ]
  };
  target.on('pageerror', error => errors.push(error.message));
  target.on('dialog', dialog => dialog.accept());
  await target.route('https://fapi.binance.com/**', route => route.abort());
  await target.route('**/unpkg.com/**', route => route.abort());
  await context.addInitScript(saved => {
    if (localStorage.getItem('__training-route-resume-seeded')) return;
    localStorage.setItem('__training-route-resume-seeded', 'true');
    localStorage.setItem('trend-lab-stage-state', JSON.stringify(saved));
  }, stageSeed);

  const read = () => target.evaluate(() => ({
    activeWorkspace,
    stage: stageState.active,
    progress: stageState.progress.map(item => ({ ...item })),
    route: getTrainingRoute(),
    questionIndex: trainingState.index,
    dataMode: state.dataMode,
    replayMode: state.replayMode,
    replayId: replayTraining.id,
    replayCount: replayHistory.length,
    replayPaused: state.replayPaused,
    revealCount: state.revealCount,
    sessionLength: state.sessionLength,
    position: sim.position ? { ...sim.position } : null,
    balance: sim.balance,
    direction: document.querySelector('#decisionDirection')?.value,
    evidence: [...document.querySelectorAll('[name="decisionEvidence"]:checked')].map(input => input.value),
    invalidation: document.querySelector('#decisionInvalidation')?.value,
    target: document.querySelector('#decisionTarget')?.value,
    risk: document.querySelector('#decisionRisk')?.value,
    reason: document.querySelector('#decisionReason')?.value
  }));
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const reload = async () => {
    await target.reload({ waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
  };
  const goHome = async () => {
    if (await target.evaluate(() => activeWorkspace) !== 'home') {
      await target.locator('[data-nav-target="home"]').click();
      await target.waitForFunction(() => activeWorkspace === 'home');
    }
  };
  const answerCurrentQuestion = async ({ correct }) => {
    const before = await target.evaluate(() => stageState.progress[1].questions);
    const question = await target.evaluate(() => ({
      index: trainingState.index,
      good: questions[trainingState.index].good,
      evidence: questions[trainingState.index].evidence
    }));
    for (const evidence of question.evidence) await target.locator(`.evidence-check input[value="${evidence}"]`).check();
    await target.locator('#continueToDecision').click();
    const chosen = correct ? question.good : await target.locator('.answer-btn').evaluateAll(buttons => buttons.find(button => button.dataset.answer !== questions[trainingState.index].good).dataset.answer);
    await target.locator(`.answer-btn[data-answer="${chosen}"]`).click();
    await target.locator('#submitAnswer').click();
    await target.waitForFunction(expected => stageState.progress[1].questions === expected, before + 1);
    return question;
  };
  const submitDecision = async () => {
    await target.locator('#workspaceDecision').click();
    await target.waitForFunction(() => document.querySelector('#workspaceRecordsDialog')?.open === true);
    const price = await target.evaluate(() => visibleClose()?.close);
    await target.locator('#decisionDirection').selectOption('up');
    await target.locator('[name="decisionEvidence"][value="结构"]').check();
    await target.locator('#decisionInvalidation').fill((price * 0.99).toFixed(2));
    await target.locator('#decisionTarget').fill((price * 1.02).toFixed(2));
    await target.locator('#decisionRisk').selectOption('defined');
    await target.locator('#decisionReason').fill('按结构记录假设，并预先定义失效位和风险。');
    await target.waitForFunction(() => !document.querySelector('#saveDecisionReveal').disabled);
    const previous = await target.evaluate(() => state.revealCount);
    await target.locator('#saveDecisionReveal').click();
    await target.waitForFunction(expected => state.revealCount === expected, previous + 1);
  };

  try {
    await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady && activeWorkspace === 'home');
    let current = await read();
    check(current.stage === 1 && current.progress[1].questions === 3 && current.route.current.id === 'questions', 'legacy advanced progress did not resume at questions');

    await target.locator('#homeContinue').click();
    await target.waitForFunction(() => activeWorkspace === 'practice' && trainingState.index === 6);
    await answerCurrentQuestion({ correct: false });
    current = await read();
    check(current.progress[1].questions === 4 && current.progress[1].correct === 2, 'wrong answer was not counted as attempted-but-not-correct');
    checkpoints.push({ name: 'wrong-answer-before-refresh', questions: current.progress[1].questions, correct: current.progress[1].correct });
    await reload();
    current = await read();
    check(current.progress[1].questions === 4 && current.progress[1].correct === 2 && current.activeWorkspace === 'practice', 'partial question progress/workspace did not survive reload');
    await goHome();
    await target.locator('#homeContinue').click();
    await target.waitForFunction(() => activeWorkspace === 'practice' && trainingState.index === 7);
    for (let index = 0; index < 2; index++) {
      const before = await target.evaluate(() => stageState.progress[1].questions);
      const q = await target.evaluate(() => ({ good: questions[trainingState.index].good, evidence: questions[trainingState.index].evidence }));
      for (const evidence of q.evidence) await target.locator(`.evidence-check input[value="${evidence}"]`).check();
      await target.locator('#continueToDecision').click();
      await target.locator(`.answer-btn[data-answer="${q.good}"]`).click();
      await target.locator('#submitAnswer').click();
      await target.waitForFunction(expected => stageState.progress[1].questions === expected, before + 1);
      if (index === 0) await target.locator('#nextQuestion').click();
      else {
        await target.locator('#nextQuestion').click();
        await target.waitForFunction(() => activeWorkspace === 'home');
      }
    }
    current = await read();
    check(current.progress[1].questions === 6 && current.progress[1].correct === 4 && current.route.current.id === 'trades', 'advanced question gate did not resume at trading');

    await target.locator('#homeContinue').click();
    await target.waitForFunction(() => activeWorkspace === 'market' && state.dataMode === 'sim');
    await target.locator('#openPosition').click();
    await target.waitForFunction(() => Boolean(sim.position));
    const beforePositionRefresh = await read();
    await target.locator('[data-nav-target="home"]').click();
    await reload();
    await goHome();
    current = await read();
    check(current.position?.entry === beforePositionRefresh.position?.entry, 'open simulated position was not restored after refresh');
    check(current.balance === beforePositionRefresh.balance && current.route.current.label === '继续模拟操盘', 'trade continuation lost account state or CTA');
    checkpoints.push({ name: 'open-position-after-refresh', entry: current.position?.entry, balance: current.balance, trades: current.progress[1].trades });
    await target.locator('#homeContinue').click();
    await target.waitForFunction(() => activeWorkspace === 'market' && Boolean(sim.position));
    await target.locator('#closePosition').click();
    await target.waitForFunction(() => stageState.progress[1].trades === 2 && !sim.position);
    await target.locator('#openPosition').click();
    await target.waitForFunction(() => Boolean(sim.position));
    await target.locator('#closePosition').click();
    await target.waitForFunction(() => stageState.progress[1].trades === 3 && !sim.position);
    await target.locator('[data-nav-target="home"]').click();
    current = await read();
    check(current.route.current.id === 'checks', 'trade gate did not route to historical risk checks');

    await target.locator('#homeContinue').click();
    await target.waitForFunction(() => document.querySelector('#trainingSetup')?.open === true);
    await target.locator('#setupLengthCustom').fill('10');
    await target.waitForFunction(() => trainingSetupState.length === 10 && !document.querySelector('#confirmTrainingStart').disabled);
    await target.locator('#confirmTrainingStart').click();
    await target.waitForFunction(() => state.replayMode && activeWorkspace === 'replay' && state.sessionLength === 10 && state.revealCount === 8);
    await target.locator('#replayPause').click();
    await target.waitForFunction(() => state.replayPaused);
    await target.locator('#workspaceDecision').click();
    await target.waitForFunction(() => document.querySelector('#workspaceRecordsDialog')?.open === true);
    const price = await target.evaluate(() => visibleClose()?.close);
    await target.locator('#decisionDirection').selectOption('up');
    await target.locator('[name="decisionEvidence"][value="结构"]').check();
    await target.locator('#decisionInvalidation').fill((price * 0.99).toFixed(2));
    await target.locator('#decisionTarget').fill((price * 1.02).toFixed(2));
    await target.locator('#decisionRisk').selectOption('defined');
    await target.locator('#decisionReason').fill('刷新前保存：已暂停并保留未提交判断。');
    const pending = await read();
    const pendingReplayId = pending.replayId;
    const pendingPrice = pending.invalidation;
    await reload();
    current = await read();
    check(current.replayId === pendingReplayId && current.replayPaused && current.revealCount === 8 && current.sessionLength === 10, 'paused replay identity or reveal boundary changed after refresh');
    check(current.direction === 'up' && current.evidence.includes('结构') && current.invalidation === pendingPrice && current.risk === 'defined' && current.reason === '刷新前保存：已暂停并保留未提交判断。', 'unsubmitted decision form was not restored');
    check(current.route.current.id === 'checks' && current.route.current.detail.includes('已暂停'), 'home route did not expose the paused replay state');
    checkpoints.push({ name: 'paused-replay-and-unsubmitted-decision-restored', replayId: current.replayId, revealCount: current.revealCount, sessionLength: current.sessionLength, direction: current.direction, invalidation: current.invalidation });

    await goHome();
    await target.locator('#homeContinue').click();
    await target.waitForFunction(() => activeWorkspace === 'replay' && state.replayPaused && replayTraining.id);
    await target.locator('#replayPause').click();
    await target.waitForFunction(() => !state.replayPaused);
    await submitDecision();
    await submitDecision();
    current = await read();
    check(current.progress[1].checks === 3 && current.progress[1].passed && current.revealCount === 10, 'resumed replay did not finish advanced risk checks without duplication');
    await target.locator('#replayFinish').click();
    await target.waitForFunction(() => activeWorkspace === 'review' && replayTraining.saved);
    current = await read();
    check(current.progress[1].passed && current.progress[1].trades === 3 && current.progress[1].checks === 3, 'completed resumed route changed stage totals');
    check(current.replayCount === 1, 'completed resumed replay was not saved exactly once');
    await target.reload({ waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady && activeWorkspace === 'review');
    current = await read();
    check(current.progress[1].passed && current.progress[1].questions === 6 && current.progress[1].correct === 4
      && current.progress[1].trades === 3 && current.progress[1].checks === 3, 'advanced completion state did not survive final refresh');
    check(current.replayCount === 1, 'finished replay was duplicated or lost after final refresh');
    check(errors.length === 0, `page errors: ${errors.join('; ')}`);
    checkpoints.push({ name: 'resumed-stage-complete', stage: current.stage, progress: current.progress[1], replayCount: current.replayCount });
    return { passed: failures.length === 0, checkpoints, errors, failures };
  } catch (error) {
    let current = null;
    try { current = await read(); } catch (_) {}
    failures.push(`${error.message} | state: ${JSON.stringify(current)}`);
    return { passed: false, checkpoints, errors, failures };
  } finally {
    await context.close();
  }
}
