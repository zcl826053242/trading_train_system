// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；需要本地静态服务 4188。
// 从空白浏览器配置出发，按真实可见 UI 完成新手、进阶、Pro 路线；不预置阶段进度。
async (page) => {
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const target = await context.newPage();
  const errors = [];
  const failures = [];
  const stages = [];
  let checkpoint = 'launch';
  target.on('pageerror', error => errors.push(error.message));
  target.on('dialog', dialog => dialog.accept());
  await target.route('https://fapi.binance.com/**', route => route.abort());
  await target.route('https://www.okx.com/**', route => route.abort());
  await target.route('**/unpkg.com/**', route => route.abort());

  const readProgress = () => target.evaluate(() => ({
    activeWorkspace,
    stage: stageState.active,
    progress: stageState.progress.map(item => ({ ...item })),
    foundationComplete: stageState.foundationComplete,
    replayCount: replayHistory.length,
    sessionLength: state.sessionLength,
    revealCount: state.revealCount,
    replayId: replayTraining.id
  }));
  const expect = (condition, message) => { if (!condition) failures.push(message); };
  const goHome = async () => {
    if (await target.evaluate(() => activeWorkspace) !== 'home') {
      await target.locator('[data-nav-target="home"]').click();
      await target.waitForFunction(() => activeWorkspace === 'home');
    }
  };
  const answerStageQuestions = async (stageIndex, count) => {
    await target.waitForFunction(index => stageState.active === index && activeWorkspace === 'practice', stageIndex);
    for (let answered = 0; answered < count; answered++) {
      const answer = await target.evaluate(() => {
        const question = questions[trainingState.index];
        return { index: trainingState.index, good: question.good, evidence: question.evidence };
      });
      for (const evidence of answer.evidence) await target.locator(`.evidence-check input[value="${evidence}"]`).check();
      await target.locator('#continueToDecision').click();
      await target.locator(`.answer-btn[data-answer="${answer.good}"]`).click();
      await target.locator('#submitAnswer').click();
      await target.waitForFunction(({ stage, expected }) => stageState.progress[stage].questions === expected,
        { stage: stageIndex, expected: answered + 1 });
      if (answered < count - 1) await target.locator('#nextQuestion').click();
      else {
        expect((await target.locator('#nextQuestion').textContent()).includes('查看下一步'), `stage ${stageIndex}: final question did not offer the next route step`);
        await target.locator('#nextQuestion').click();
        await target.waitForFunction(() => activeWorkspace === 'home');
      }
    }
    const progress = await readProgress();
    const minimumCorrect = [2, 4, 7][stageIndex];
    expect(progress.progress[stageIndex].correct >= minimumCorrect, `stage ${stageIndex}: answers did not meet the correctness threshold`);
  };
  const completeTrades = async (stageIndex, count) => {
    await goHome();
    expect((await target.locator('#homeContinue').textContent()).includes('模拟操盘'), `stage ${stageIndex}: route did not guide to simulated trading`);
    await target.locator('#homeContinue').click();
    await target.waitForFunction(() => activeWorkspace === 'market');
    const before = await target.evaluate(() => sim.trades.length);
    for (let i = 0; i < count; i++) {
      await target.locator('#openPosition').click();
      await target.waitForFunction(() => Boolean(sim.position));
      await target.locator('#closePosition').click();
      await target.waitForFunction(expected => sim.trades.length === expected, before + i + 1);
    }
    const progress = await readProgress();
    expect(progress.progress[stageIndex].trades === count, `stage ${stageIndex}: only ${progress.progress[stageIndex].trades}/${count} closed trades counted`);
  };
  const completeReplay = async (stageIndex, length, requiredChecks) => {
    await goHome();
    expect((await target.locator('#homeContinue').textContent()).includes('历史盲测'), `stage ${stageIndex}: route did not guide to blind replay`);
    await target.locator('#homeContinue').click();
    await target.waitForFunction(() => document.querySelector('#trainingSetup')?.open === true);
    await target.locator('#setupLengthCustom').fill(String(length));
    await target.waitForFunction(() => trainingSetupState.length === Number(document.querySelector('#setupLengthCustom').value)
      && !document.querySelector('#confirmTrainingStart').disabled);
    await target.locator('#confirmTrainingStart').click();
    await target.waitForFunction(expected => activeWorkspace === 'replay' && state.sessionLength === expected, length);
    const initial = await readProgress();
    expect(initial.revealCount === Math.min(24, Math.max(8, length - 2)), `stage ${stageIndex}: unexpected initial replay boundary ${initial.revealCount}/${length}`);

    let decisions = 0;
    while ((await target.evaluate(() => state.revealCount)) < length) {
      await target.locator('#workspaceDecision').click();
      await target.waitForFunction(() => document.querySelector('#workspaceRecordsDialog')?.open === true);
      const price = await target.evaluate(() => visibleClose()?.close);
      await target.locator('#decisionDirection').selectOption('up');
      await target.locator('[name="decisionEvidence"][value="结构"]').check();
      await target.locator('#decisionInvalidation').fill((price * 0.99).toFixed(2));
      await target.locator('#decisionTarget').fill((price * 1.02).toFixed(2));
      await target.locator('#decisionRisk').selectOption('defined');
      await target.locator('#decisionReason').fill('按结构记录方向，并预先定义失效位与风险。');
      await target.waitForFunction(() => !document.querySelector('#saveDecisionReveal').disabled);
      const previous = await target.evaluate(() => state.revealCount);
      await target.locator('#saveDecisionReveal').click();
      await target.waitForFunction(expected => state.revealCount === expected, previous + 1);
      decisions++;
    }
    expect(decisions >= requiredChecks, `stage ${stageIndex}: ${decisions} judgments did not reach ${requiredChecks} required checks`);
    expect((await readProgress()).progress[stageIndex].checks === requiredChecks, `stage ${stageIndex}: counted risk checks did not match the stage threshold`);
    await target.locator('#replayFinish').click();
    await target.waitForFunction(() => activeWorkspace === 'review' && replayHistory.length > 0 && replayTraining.saved);
    const after = await readProgress();
    expect(after.progress[stageIndex].passed === true, `stage ${stageIndex}: stage did not pass after the required UI path`);
    expect(after.replayCount === stageIndex + 1, `stage ${stageIndex}: completed replay did not persist exactly once`);
    stages.push({ stage: stageIndex, length, decisions, progress: after.progress[stageIndex], replayCount: after.replayCount });
  };

  try {
    await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    checkpoint = 'startup';
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady && activeWorkspace === 'home');
    let initial = await readProgress();
    expect(initial.stage === 0 && initial.progress.every(item => item.questions === 0 && item.trades === 0 && item.checks === 0), 'test must start from a genuinely empty stage profile');

    // 完整走完新手概念引导，不改写 localStorage 或阶段字段。
    await target.locator('#homeContinue').click();
    checkpoint = 'foundation-start';
    await target.waitForFunction(() => activeWorkspace === 'market' && stageState.foundationStarted);
    for (let step = 1; step <= 3; step++) {
      await target.locator('#guideNext').click();
      if (step < 3) await target.waitForFunction(expected => stageState.foundationStep === expected, step);
      else await target.waitForFunction(() => stageState.foundationComplete && activeWorkspace === 'practice');
    }
    expect((await readProgress()).foundationComplete, 'foundation concepts were not completed through the guided lesson controls');

    checkpoint = 'novice-questions';
    await answerStageQuestions(0, 3);
    checkpoint = 'novice-trades';
    await completeTrades(0, 1);
    checkpoint = 'novice-replay';
    await completeReplay(0, 25, 1);
    checkpoint = 'novice-promotion';
    await target.locator('#reviewContinue').click();
    await target.waitForFunction(() => stageState.active === 1 && activeWorkspace === 'practice');

    checkpoint = 'advanced-questions';
    await answerStageQuestions(1, 6);
    checkpoint = 'advanced-trades';
    await completeTrades(1, 3);
    checkpoint = 'advanced-replay';
    await completeReplay(1, 27, 3);
    checkpoint = 'advanced-promotion';
    await target.locator('#reviewContinue').click();
    await target.waitForFunction(() => stageState.active === 2 && activeWorkspace === 'practice');

    checkpoint = 'pro-questions';
    await answerStageQuestions(2, 10);
    checkpoint = 'pro-trades';
    await completeTrades(2, 5);
    checkpoint = 'pro-replay';
    await completeReplay(2, 29, 5);
    checkpoint = 'pro-finish';
    await target.locator('#reviewContinue').click();
    await target.waitForFunction(() => activeWorkspace === 'home');
    await target.reload({ waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady && activeWorkspace === 'home');
    const final = await readProgress();
    expect(final.stage === 2, 'refresh did not preserve the active final stage');
    expect(final.progress.every(item => item.passed), 'refresh did not preserve all three completed stages');
    expect(final.replayCount === 3, 'completed blind replay records were not preserved exactly once per stage');
    expect(errors.length === 0, `page errors: ${errors.join('; ')}`);
  } catch (error) {
    let progress = null;
    try { progress = await readProgress(); } catch (_) {}
    failures.push(`${checkpoint}: ${error.message}`);
    stages.push({ checkpoint, progress });
  } finally {
    await context.close();
  }
  return { passed: failures.length === 0, stages, final: stages.length ? stages.at(-1) : null, errors, failures };
}
