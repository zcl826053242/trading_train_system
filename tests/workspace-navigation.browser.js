// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 检查简化后的主线、学习子入口与历史训练入口，不依赖已有浏览器状态。
async (page) => {
  const failures = [], results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 667 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [], name = `${viewport.width}x${viewport.height}`;
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      target.on('dialog', dialog => dialog.accept());
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      const nav = await target.locator('.app-nav [data-nav-target]').evaluateAll(nodes => nodes.map(node => ({ target: node.dataset.navTarget, label: node.textContent.trim() })));
      if (JSON.stringify(nav.map(item => item.target)) !== JSON.stringify(['home', 'market', 'review'])) failures.push(`${name}: primary paths are not the three expected areas`);
      if (await target.title() !== '趋势训练台' || (await target.locator('.topbar h1').textContent()).trim() !== '趋势训练台') failures.push(`${name}: product identity was not updated consistently`);
      const paths = [
        ['home', 'home', '学习总览'], ['training', 'training', '阶段课程'], ['practice', 'practice', '题库与专项'],
        ['risk', 'risk', '风险实验'], ['indicators', 'indicators', '指标课程']
      ];
      const learning = [];
      for (const [targetName, expectedSub, label] of paths) {
        if (targetName === 'home') await target.locator('[data-nav-target="home"]').click();
        else await target.locator(`[data-subworkspace="${targetName}"]`).click();
        const current = await target.evaluate(() => ({
          workspace: activeWorkspace,
          route: document.querySelector('#routePill').textContent,
          primary: [...document.querySelectorAll('.app-nav [data-nav-target].active')].map(node => node.dataset.navTarget),
          secondary: [...document.querySelectorAll('#learningNav [data-subworkspace].active')].map(node => node.dataset.subworkspace),
          navHidden: document.querySelector('#learningNav').hidden
        }));
        if (current.workspace !== expectedSub || !current.primary.includes('home') || current.secondary[0] !== expectedSub || current.navHidden || current.route !== label) failures.push(`${name}: learning route ${targetName} was inconsistent: ${JSON.stringify(current)}`);
        learning.push({ targetName, ...current });
      }
      await target.locator('[data-subworkspace="training"]').click();
      const stagePage = await target.evaluate(() => ({
        panelVisible: !document.querySelector('.stage-panel').hidden,
        duplicateTitle: Boolean(document.querySelector('.workspace-hero[data-learning-view="training"]')),
        duplicateGrid: Boolean(document.querySelector('.workspace-grid[data-learning-view="training"]')),
        resetButtons: document.querySelectorAll('#resetStageProgress, #resetTraining').length,
        actions: ['topStartTraining', 'stageContinueRoute'].map(id => {
          const node = document.getElementById(id);
          return { id, text: node?.textContent.trim(), visible: Boolean(node && getComputedStyle(node).display !== 'none' && !node.hidden) };
        })
      }));
      const visibleActions = stagePage.actions.filter(item => item.visible);
      if (!stagePage.panelVisible || stagePage.duplicateTitle || stagePage.duplicateGrid || stagePage.resetButtons !== 1 || visibleActions.length !== 1 || !visibleActions[0].text.includes('概念学习')) failures.push(`${name}: stage page is not focused on one canonical next action: ${JSON.stringify(stagePage)}`);
      const continueButton = target.locator('#stageContinueRoute');
      if (await continueButton.isVisible()) await continueButton.click();
      else await target.locator('#topStartTraining').click();
      await target.waitForFunction(() => activeWorkspace === 'market' && state.lesson === 0 && stageState.foundationStarted);
      const nextAction = await target.evaluate(() => ({ workspace: activeWorkspace, lesson: state.lesson, guideOpen: document.querySelector('.market-help').open, title: document.querySelector('#guideTitle').textContent }));
      if (!nextAction.guideOpen || !nextAction.title.includes('第 1 步')) failures.push(`${name}: canonical CTA did not resume the current guided learning step: ${JSON.stringify(nextAction)}`);
      await target.locator('[data-nav-target="market"]').click();
      await target.locator('#workspaceStart').click();
      await target.locator('#confirmTrainingStart').click();
      await target.waitForFunction(() => activeWorkspace === 'replay' && state.revealCount === 24);
      const replayEntry = await target.evaluate(() => ({
        workspace: activeWorkspace,
        route: document.querySelector('#routePill').textContent,
        primary: [...document.querySelectorAll('.app-nav [data-nav-target].active')].map(node => node.dataset.navTarget)
      }));
      if (replayEntry.workspace !== 'replay' || replayEntry.route !== '历史回放' || !replayEntry.primary.includes('market')) failures.push(`${name}: replay is not grouped under chart training: ${JSON.stringify(replayEntry)}`);
      await target.locator('[data-nav-target="review"]').click();
      const review = await target.evaluate(() => ({ workspace: activeWorkspace, route: document.querySelector('#routePill').textContent, active: [...document.querySelectorAll('.app-nav [data-nav-target].active')].map(node => node.dataset.navTarget) }));
      if (review.workspace !== 'review' || review.route !== '训练复盘' || !review.active.includes('review')) failures.push(`${name}: review route failed: ${JSON.stringify(review)}`);
      const overflow = await target.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) failures.push(`${name}: horizontal overflow ${overflow}px`);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, nav, learning, replayEntry, review, overflow, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
