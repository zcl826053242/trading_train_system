// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 使用独立浏览器上下文，验证首页“三步训练闭环”在空白、进行中和已完成场次下的引导状态。
async (page) => {
  const failures = [], results = [];
  const viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

  for (const viewport of viewports) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [];
    const name = `${viewport.width}x${viewport.height}`;
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      target.on('dialog', dialog => dialog.accept());
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.waitForFunction(() => activeWorkspace === 'home');

      const loopState = () => target.evaluate(() => ({
        workspace: activeWorkspace,
        steps: [...document.querySelectorAll('#homeLoopSteps .home-loop-step')].map(step => ({
          id: step.dataset.loopStep,
          active: step.classList.contains('active'),
          done: step.classList.contains('done'),
          locked: step.classList.contains('locked'),
          disabled: step.querySelector('[data-loop-action]')?.disabled,
          label: step.querySelector('[data-loop-action]')?.textContent.trim()
        })),
        dialogOpen: document.querySelector('#trainingSetup')?.open,
        overflow: document.documentElement.scrollWidth - innerWidth
      }));

      const initialState = await loopState();
      let state = initialState;
      const moreLearning = target.locator('.home-more-learning');
      if (await moreLearning.locator('summary').textContent().then(text => !text.includes('更多练习与训练记录')) || await moreLearning.getAttribute('open') !== null) {
        failures.push(`${name}: secondary modules should be grouped behind one closed disclosure by default`);
      }
      if (await target.locator('#homeLearningLoop').isVisible()) failures.push(`${name}: standalone replay workflow should not compete with the current stage route`);
      if (await moreLearning.locator('[data-home-action]').count() !== 8) failures.push(`${name}: grouping removed or duplicated secondary destinations`);
      await moreLearning.locator('summary').click();
      if (!await target.locator('#homeLearningLoop').isVisible()) failures.push(`${name}: independent replay workflow not reachable inside secondary routes`);
      if (await moreLearning.locator('[data-home-action="indicators"]').isVisible() !== true) failures.push(`${name}: secondary learning routes are not reachable from the disclosure`);
      await moreLearning.locator('[data-home-action="indicators"]').click();
      if (await target.evaluate(() => activeWorkspace) !== 'indicators') failures.push(`${name}: grouped indicator course destination failed`);
      await target.locator('[data-nav-target="home"]').click();
      await moreLearning.locator('[data-home-action="practice"]').click();
      if (await target.evaluate(() => activeWorkspace) !== 'practice') failures.push(`${name}: grouped practice destination failed`);
      await target.locator('[data-nav-target="home"]').click();
      if (state.steps.length !== 3 || state.steps[0].active !== true || state.steps[0].disabled || state.steps[1].disabled !== true || state.steps[2].disabled !== true) {
        failures.push(`${name}: blank home loop did not expose only the setup step`);
      }
      if (state.overflow > 0) failures.push(`${name}: initial horizontal overflow ${state.overflow}px`);

      await target.locator('[data-loop-action="setup"]').click();
      if (!(await target.locator('#trainingSetup').isVisible())) failures.push(`${name}: setup action did not open training dialog`);
      await target.locator('#cancelTrainingSetup').click();
      state = await loopState();
      if (state.workspace !== 'home' || state.dialogOpen) failures.push(`${name}: cancelling setup changed home state: ${JSON.stringify(state)}`);

      if (viewport.width === 1440) {
        await target.locator('[data-loop-action="setup"]').click();
        await target.locator('#setupLengthCustom').fill('10');
        await target.waitForFunction(() => trainingSetupState.length === 10 && !document.querySelector('#confirmTrainingStart').disabled);
        await target.locator('#confirmTrainingStart').click();
        await target.waitForFunction(() => activeWorkspace === 'replay' && state.sessionLength === 10 && state.revealCount === 8);
        const started = await target.evaluate(() => ({ workspace: activeWorkspace, length: state.sessionLength, reveal: state.revealCount }));
        if (started.workspace !== 'replay' || started.length !== 10 || started.reveal !== 8) failures.push(`10-bar replay start mismatch: ${JSON.stringify(started)}`);

        await target.locator('[data-nav-target="home"]').click();
        state = await loopState();
        const replayStep = state.steps.find(step => step.id === 'replay');
        const reviewStep = state.steps.find(step => step.id === 'review');
        if (!replayStep || replayStep.disabled || !replayStep.active || reviewStep?.disabled !== true) failures.push(`active replay loop state mismatch: ${JSON.stringify(state.steps)}`);

        await target.locator('[data-loop-action="replay"]').click();
        await target.waitForFunction(() => activeWorkspace === 'replay');
        for (let i = 0; i < 2; i++) {
          await target.locator('#workspaceDecision').click();
          const price = await target.evaluate(() => visibleClose().close);
          await target.locator('#decisionDirection').selectOption('up');
          await target.locator('[name="decisionEvidence"][value="EMA"]').check();
          await target.locator('#decisionInvalidation').fill(String((price * 0.99).toFixed(2)));
          await target.locator('#decisionTarget').fill(String((price * 1.0025).toFixed(2)));
          await target.locator('#decisionRisk').selectOption('defined');
          await target.locator('#saveDecisionReveal').click();
          await target.waitForFunction(expected => state.revealCount === expected, 9 + i);
        }
        await target.waitForFunction(() => state.revealCount === state.sessionLength);
        await target.locator('#replayFinish').click();
        await target.waitForFunction(() => activeWorkspace === 'review' && replayHistory.length === 1);
        await target.locator('[data-nav-target="home"]').click();
        state = await loopState();
        const completedReplay = state.steps.find(step => step.id === 'replay');
        const completedReview = state.steps.find(step => step.id === 'review');
        if (!completedReplay || completedReplay.disabled || completedReplay.label !== '再训练' || completedReview?.disabled || !completedReview.active) {
          failures.push(`completed replay loop state mismatch: ${JSON.stringify(state.steps)}`);
        }
        await target.locator('[data-loop-action="replay"]').click();
        if (!(await target.locator('#trainingSetup').isVisible())) failures.push('completed replay should open setup for a new training run');
        await target.locator('#cancelTrainingSetup').click();
        await target.locator('[data-loop-action="review"]').click();
        await target.waitForFunction(() => activeWorkspace === 'review');
        await target.reload({ waitUntil: 'domcontentloaded' });
        await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
        if (await target.evaluate(() => activeWorkspace !== 'home')) await target.locator('[data-nav-target="home"]').click();
        state = await loopState();
        if (state.steps.find(step => step.id === 'review')?.disabled || state.steps.find(step => step.id === 'review')?.active !== true) {
          failures.push(`completed replay loop state did not survive reload: ${JSON.stringify(state.steps)}`);
        }
        const secondaryCollapsedAfterReload = await target.locator('.home-more-learning').getAttribute('open') === null;
        if (!secondaryCollapsedAfterReload) failures.push('secondary learning destinations did not start collapsed after reload');
        results.push({ case: 'completed-replay', started, reloaded: state, secondaryCollapsedAfterReload });
      }

      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ case: 'home-loop', viewport: name, initial: initialState, final: state, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }

  return { passed: failures.length === 0, results, failures };
}
