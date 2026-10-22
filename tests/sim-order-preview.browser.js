// 真实 UI 验证止损/止盈净值预览与短屏交易抽屉；本地服务端口 4188。
async (page) => {
  const failures = [], results = [];
  for (const fallback of [false, true]) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 667 }, { width: 320, height: 667 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [], name = `${viewport.width}/${fallback ? 'fallback' : 'professional'}`;
    try {
      await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (fallback) await context.route('**/vendor/lightweight-charts*', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.locator('[data-nav-target="market"]').click();
      await target.waitForFunction(() => activeWorkspace === 'market');
      await target.evaluate(() => setDataMode('sim'));
      await target.waitForFunction(() => state.dataMode === 'sim' && Boolean(visibleClose()) && document.querySelector('#simOrderPreview').textContent.includes('止损触发'));

      if (viewport.width <= 1100) {
        const drawer = target.locator('#mobileTradeDrawer');
        if (await drawer.evaluate(node => !node.open)) await target.locator('#mobileTradeDrawer > summary').click();
      }
      const riskSettings = target.locator('.sim-risk-settings');
      if (!(await riskSettings.evaluate(node => node.open))) await riskSettings.locator('summary').click();

      const expected = async () => target.evaluate(() => {
        const price = visibleClose().close;
        const margin = Number(document.getElementById('simMargin').value);
        const leverage = Number(document.getElementById('simLeverage').value);
        const stopPct = Number(document.getElementById('simStop').value);
        const targetPct = Number(document.getElementById('simTarget').value);
        const side = sim.side === 'long' ? 1 : -1;
        const notional = margin * leverage;
        const entry = price * (1 + side * sim.slippage);
        const quantity = notional / entry;
        const estimate = (distance, favorable) => {
          const trigger = entry * (1 + side * distance * (favorable ? 1 : -1) / 100);
          const exit = trigger * (1 - side * sim.slippage);
          return { trigger, pnl: side * (exit - entry) * quantity - notional * sim.feeRate - exit * quantity * sim.feeRate };
        };
        const format = value => Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const stop = estimate(stopPct, false), target = estimate(targetPct, true);
        return {
          stopText: `止损触发 ${format(stop.trigger)} · 预计净损益 ${format(stop.pnl)} USDT`,
          targetText: `止盈触发 ${format(target.trigger)} · 预计净损益 +${format(target.pnl)} USDT`,
          stopPnl: stop.pnl,
          targetPnl: target.pnl
        };
      });
      const verifyPreview = async label => {
        const values = await expected();
        const text = await target.locator('#simOrderPreview').textContent();
        if (!text.includes(values.stopText) || !text.includes(values.targetText)) {
          failures.push(`${name}/${label}: preview does not match modeled fee/slippage estimate: ${text}`);
        }
        if (!(values.stopPnl < 0 && values.targetPnl > 0)) failures.push(`${name}/${label}: stop/target net PnL signs are invalid: ${JSON.stringify(values)}`);
        return text;
      };
      const longPreview = await verifyPreview('long-default');
      await target.locator('[data-side="short"]').click();
      const shortPreview = await verifyPreview('short');
      if (longPreview === shortPreview) failures.push(`${viewport.width}: side change did not update the estimate`);
      await target.locator('#simMargin').fill('400');
      await target.locator('#simLeverage').fill('5');
      await target.locator('#simStop').fill('1.5');
      await target.locator('#simTarget').fill('3.5');
      await verifyPreview('edited-parameters');
      await target.locator('#simStop').fill('100');
      if (!(await target.locator('#simOrderPreview').textContent()).includes('超出可用范围')) failures.push(`${viewport.width}: out-of-range stop distance was not rejected in preview`);
      await target.locator('#simStop').fill('1.5');

      if (viewport.width <= 1100) {
        const drawer = target.locator('#mobileTradeDrawer');
        if (await drawer.evaluate(node => !node.open)) await target.locator('#mobileTradeDrawer > summary').click();
        await target.locator('#simTarget').scrollIntoViewIfNeeded();
        const drawerState = await target.evaluate(() => {
          const drawer = document.getElementById('mobileTradeDrawer');
          const dock = document.getElementById('mobileTradeDock');
          const input = document.getElementById('simTarget').getBoundingClientRect();
          const open = document.getElementById('openPosition').getBoundingClientRect();
          const close = document.getElementById('closePosition').getBoundingClientRect();
          const box = dock.getBoundingClientRect();
          const inside = rect => rect.top >= box.top && rect.bottom <= box.bottom;
          return { open: drawer.open, targetReachable: inside(input), actionsReachable: inside(open) && inside(close), openDisabled: document.getElementById('openPosition').disabled };
        });
        if (!drawerState.open || !drawerState.targetReachable || !drawerState.actionsReachable || drawerState.openDisabled) failures.push(`${name}/mobile drawer controls not reachable: ${JSON.stringify(drawerState)}`);
      }
      await target.locator('#openPosition').click();
      await target.waitForFunction(() => Boolean(sim.position));
      const positionOverlay = await target.evaluate(() => {
        const lines = proChart.chart
          ? proChart.riskLines.map(line => line.options())
          : [...document.querySelectorAll('#chart [data-risk-label]')].map(node => ({ title: node.getAttribute('data-risk-label') }));
        return { replayMode: state.replayMode, labels: lines.map(line => line.title), prices: lines.map(line => line.price), expected: [sim.position.entry, sim.position.stop, sim.position.target] };
      });
      if (positionOverlay.replayMode || JSON.stringify(positionOverlay.labels) !== JSON.stringify(['入场', '止损', '止盈'])) failures.push(`${name}: active simulated position is missing chart entry/stop/target overlays: ${JSON.stringify(positionOverlay)}`);
      if (!fallback && positionOverlay.prices.some((price, index) => Math.abs(price - positionOverlay.expected[index]) > 0.000001)) failures.push(`${name}: professional chart overlay levels do not match the open position: ${JSON.stringify(positionOverlay)}`);
      await target.locator('#closePosition').click();
      await target.waitForFunction(() => !sim.position);
      const afterClose = await target.evaluate(() => proChart.chart ? proChart.riskLines.length : document.querySelectorAll('#chart [data-risk-label]').length);
      if (afterClose !== 0) failures.push(`${name}: position overlays remain after the position was closed`);
      if (errors.length) failures.push(`${name}: pageerror ${errors.join(' | ')}`);
      results.push({ name, longPreview, shortPreview, positionOverlay, pageErrors: errors.length });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
