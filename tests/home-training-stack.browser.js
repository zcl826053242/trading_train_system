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
      if (cards.length !== 8 || new Set(cards.map(card => card.action)).size !== 6) failures.push(`${name}: home stack/loop actions are missing or duplicated unexpectedly`);
      if (await target.locator('.home-more-learning').getAttribute('open') !== null) failures.push(`${name}: secondary destinations should start collapsed`);
      await target.locator('.home-more-learning > summary').click();
      const routes = [['training', 'training'], ['practice', 'practice'], ['risk', 'risk'], ['indicators', 'indicators'], ['review', 'review']];
      for (const [action, expected] of routes) {
        await target.locator('[data-nav-target="home"]').click();
        await target.locator(`[data-home-action="${action}"]`).first().click();
        const actual = await target.evaluate(() => activeWorkspace);
        if (actual !== expected) failures.push(`${name}: home action ${action} routed to ${actual}`);
      }
      await target.locator('[data-nav-target="home"]').click();
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
