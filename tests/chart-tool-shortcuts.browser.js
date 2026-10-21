// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 隔离 context，禁用外部行情并覆盖专业图/备用图的 Binance 常用绘图快捷键。
async (page) => {
  const failures = [], results = [];
  for (const fallback of [false, true]) {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
    const errors = [], name = fallback ? 'fallback' : 'professional';
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight-charts*', route => route.abort());
      const target = await context.newPage(); target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => sessionPersistenceReady && historicalReady);
      await target.locator('[data-nav-target="market"]').click();
      const point = async (x, y) => target.evaluate(({ x, y }) => {
        const rect = document.querySelector('#chart').getBoundingClientRect();
        return { x: rect.left + rect.width * x, y: rect.top + rect.height * y };
      }, { x, y });
      await target.locator('#chart').click({ position: { x: 300, y: 200 } });
      await target.keyboard.press('Alt+t');
      if (await target.evaluate(() => state.tool) !== 'trendline') failures.push(`${name}: Alt+T did not activate trendline`);
      await target.mouse.click(...Object.values(await point(.4, .5)));
      await target.mouse.click(...Object.values(await point(.65, .42)));
      if (await target.evaluate(() => proChart.drawings.at(-1)?.edit?.type) !== 'trendline') failures.push(`${name}: Alt+T did not create a trendline`);

      await target.keyboard.press('Alt+h');
      if (await target.evaluate(() => state.tool) !== 'hline') failures.push(`${name}: Alt+H did not activate horizontal line`);
      await target.mouse.click(...Object.values(await point(.55, .6)));
      if (await target.evaluate(() => proChart.drawings.at(-1)?.edit?.type) !== 'horizontal') failures.push(`${name}: Alt+H did not create a horizontal line`);

      await target.keyboard.press('Alt+v');
      if (await target.evaluate(() => state.tool) !== 'verticalLine') failures.push(`${name}: Alt+V did not activate vertical line`);
      await target.mouse.click(...Object.values(await point(.7, .5)));
      if (await target.evaluate(() => proChart.drawings.at(-1)?.edit?.type) !== 'verticalLine') failures.push(`${name}: Alt+V did not create a vertical line`);

      await target.keyboard.press('Alt+c');
      if (await target.evaluate(() => state.tool) !== 'cursor') failures.push(`${name}: Alt+C did not restore cursor`);
      await target.locator('#chartInstrument').focus();
      await target.keyboard.press('Alt+t');
      if (await target.evaluate(() => state.tool) !== 'cursor') failures.push(`${name}: shortcut stole a key from the instrument selector`);
      const summary = await target.evaluate(() => ({ drawings: proChart.drawings.map(item => item.edit?.type), tool: state.tool, errors: [] }));
      if (errors.length) failures.push(`${name}: ${errors.join('; ')}`);
      results.push({ ...summary, name, errors });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
