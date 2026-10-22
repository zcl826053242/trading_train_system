// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；验证首页能力卡不制造旁路，所有入口都回到既有学习主线。
async (page) => {
  const failures = [], results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
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
      await target.locator('[data-nav-target="home"]').click();
      const cards = await target.locator('[data-home-action]').evaluateAll(nodes => nodes.map(node => ({ action: node.dataset.homeAction, label: node.textContent.trim() })));
      const expectedActions = ['training', 'practice', 'indicators', 'risk', 'replay', 'review'];
      if (cards.length !== expectedActions.length || expectedActions.some(action => cards.filter(card => card.action === action).length !== 1)) failures.push(`${name}: module destinations are missing or duplicated: ${JSON.stringify(cards)}`);
      if (await target.locator('#homeStackTitle').textContent() !== '按目标选择训练模块') failures.push(`${name}: secondary module area is not clearly named`);
      if (await target.locator('.home-stack-grid').locator('.home-stack-card').count() !== 6) failures.push(`${name}: module directory should expose six implemented destinations`);
      if (await target.locator('.home-more-learning').getAttribute('open') !== null) failures.push(`${name}: secondary destinations should start collapsed`);
      await target.locator('.home-more-learning > summary').click();
      const routes = [['training', 'training'], ['practice', 'practice'], ['risk', 'risk'], ['indicators', 'indicators'], ['review', 'review']];
      for (const [action, expected] of routes) {
        await target.locator('[data-nav-target="home"]').click();
        if (!await target.locator('.home-more-learning').evaluate(element => element.open)) await target.locator('.home-more-learning > summary').click();
        await target.locator(`[data-home-action="${action}"]`).first().click();
        const actual = await target.evaluate(() => activeWorkspace);
        if (actual !== expected) failures.push(`${name}: home action ${action} routed to ${actual}`);
        await target.reload({ waitUntil: 'domcontentloaded' });
        await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
        const restored = await target.evaluate(() => activeWorkspace);
        if (restored !== expected) failures.push(`${name}: home action ${action} did not restore ${expected} after refresh (got ${restored})`);
      }
      await target.locator('[data-nav-target="home"]').click();
      if (!await target.locator('.home-more-learning').evaluate(element => element.open)) await target.locator('.home-more-learning > summary').click();
      await target.locator('[data-home-action="replay"]').first().click();
      if (!await target.locator('#trainingSetup').isVisible()) failures.push(`${name}: replay card did not open the existing setup dialog`);
      await target.locator('#cancelTrainingSetup').click();
      const layout = await target.evaluate(() => ({ workspace: activeWorkspace, overflow: document.documentElement.scrollWidth - innerWidth }));
      if (layout.workspace !== 'market' || layout.overflow > 0) failures.push(`${name}: replay cancel did not return to chart workspace cleanly: ${JSON.stringify(layout)}`);
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ name, cards, layout, errors });
    } catch (error) { failures.push(`${name}: ${error.message}`); }
    finally { await context.close(); }
  }
  return { passed: failures.length === 0, results, failures };
}
