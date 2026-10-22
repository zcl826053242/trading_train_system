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
          ? proChart.riskLines.map(line => {
            const options = line.options();
            return { title: options.title, price: options.price, color: options.color, dashed: options.lineStyle === window.LightweightCharts.LineStyle.Dashed };
          })
          : [...document.querySelectorAll('#chart [data-risk-label]')].map(node => {
            const title = node.getAttribute('data-risk-label');
            const line = document.querySelector(`#chart [data-risk-line="${title}"]`);
            return { title, priceText: node.textContent.trim(), color: node.getAttribute('fill'), dashed: line?.getAttribute('stroke-dasharray') !== 'none', labelY: Number(node.getAttribute('data-risk-label-y')) };
          });
        const expected = [sim.position.entry, sim.position.stop, sim.position.target];
        return {
          replayMode: state.replayMode,
          lines,
          expected,
          expectedLabels: expected.map(formatChartPrice),
          expectedColors: ['#f0b90b', '#f6465d', '#0ecb81']
        };
      });
      const expectedTitles = ['入场', '止损', '止盈'];
      const linesByTitle = Object.fromEntries(positionOverlay.lines.map(line => [line.title, line]));
      if (positionOverlay.replayMode || expectedTitles.some(title => !linesByTitle[title])) failures.push(`${name}: active simulated position is missing chart entry/stop/target overlays: ${JSON.stringify(positionOverlay)}`);
      expectedTitles.forEach((title, index) => {
        const line = linesByTitle[title];
        if (!line) return;
        if (line.color.toLowerCase() !== positionOverlay.expectedColors[index]) failures.push(`${name}: ${title} line color does not match its risk role: ${JSON.stringify(positionOverlay)}`);
        if (line.dashed !== (index > 0)) failures.push(`${name}: ${title} line style does not match its risk role: ${JSON.stringify(positionOverlay)}`);
        if (fallback && !line.priceText.includes(positionOverlay.expectedLabels[index])) failures.push(`${name}: fallback ${title} price label does not match the open position: ${JSON.stringify(positionOverlay)}`);
        if (!fallback && Math.abs(line.price - positionOverlay.expected[index]) > 0.000001) failures.push(`${name}: professional ${title} level does not match the open position: ${JSON.stringify(positionOverlay)}`);
      });
      if (!fallback) {
        const visibleRange = await target.evaluate(() => proChart.chart.panes()[0].priceScale('right').getVisibleRange());
        if (!visibleRange || positionOverlay.expected.some(price => price < visibleRange.from - 0.000001 || price > visibleRange.to + 0.000001)) failures.push(`${name}: professional price scale clips a simulated risk level: ${JSON.stringify({ visibleRange, expected: positionOverlay.expected })}`);
      }
      if (fallback) {
        const labelYs = positionOverlay.lines.map(line => line.labelY).sort((a, b) => a - b);
        if (labelYs.some((value, index) => !Number.isFinite(value) || (index > 0 && value - labelYs[index - 1] < 13))) failures.push(`${name}: fallback risk labels overlap: ${JSON.stringify(positionOverlay)}`);
      }
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
