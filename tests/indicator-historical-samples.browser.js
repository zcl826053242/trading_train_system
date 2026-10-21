// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 验证指标历史案例到固定双盲回放的课程路径，不代表实盘行情验收。
async (page) => {
  const failures = [], results = [];
  const cases = [
    { entry: 'macd', indicator: 'macd', indices: [{ index: 87, expectedReadout: 'DIF 199.25' }, { index: 276, expectedReadout: 'DIF -401.29' }], metricCount: 3 },
    { entry: 'bollinger', indicator: 'bb', indices: [{ index: 174, expectedReadout: '上 85057.67' }], metricCount: 4 },
    { entry: 'kdj', indicator: 'kdj', indices: [{ index: 242, expectedReadout: 'K 18.9' }], metricCount: 3 },
    { entry: 'psar', indicator: 'psar', indices: [{ index: 255, expectedReadout: 'SAR(0.02,0.2) 82787.25' }, { index: 265, expectedReadout: 'SAR(0.02,0.2) 83681.91' }], metricCount: 1 }
  ];
  for (const { entry, indicator, indices, metricCount } of cases) for (const { index: sampleIndex, expectedReadout } of indices) for (const chartMode of ['professional', 'fallback']) {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (chartMode === 'fallback') await context.route('**/vendor/lightweight-charts.standalone.production.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      target.on('dialog', dialog => dialog.accept());
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.evaluate(() => setWorkspace('indicators'));
      await target.locator(`[data-indicator-entry="${entry}"]`).click();
      const card = target.locator(`.indicator-market-sample:has([data-pin-replay-sample="${sampleIndex}"])`);
      await card.waitFor();
      const metrics = await card.locator(`[data-${indicator}-metric]`).allTextContents();
      if (metrics.length !== metricCount) failures.push(`${entry}/${sampleIndex}: expected ${metricCount} indicator readouts`);
      if (!(await card.locator('small').first().textContent()).includes('Binance 现货 K 线')) failures.push(`${sampleIndex}: source label missing`);
      await target.evaluate(indicatorKey => {
        const group = indicatorKey === 'bb' ? 'bb' : indicatorKey;
        if (group === 'macd') state.indicatorParams.macd = { fast: 10, slow: 30, signal: 5 };
        if (group === 'bb') state.indicatorParams.bb = { period: 10, multiplier: 1.5 };
        if (group === 'kdj') state.indicatorParams.kdj = { period: 7, k: 2, d: 2 };
        if (group === 'psar') state.indicatorParams.psar = { step: .04, max: .3 };
        saveIndicatorParams();
      }, indicator);
      await card.locator('[data-pin-replay-sample]').click();
      const setup = await target.evaluate(indicatorKey => ({
        open: document.querySelector('#trainingSetup').open,
        pinned: !document.querySelector('#setupPinnedSample').hidden,
        timeframe: [...document.querySelectorAll('[data-setup-time]')].find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.setupTime,
        length: [...document.querySelectorAll('[data-setup-length]')].find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.setupLength,
        mode: [...document.querySelectorAll('[data-setup-mode]')].find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.setupMode,
        indicatorEnabled: state.indicator[indicatorKey],
        savedIndicator: JSON.parse(localStorage.getItem('trend-lab-chart-indicators') || '{}')[indicatorKey],
        params: { ...state.indicatorParams[indicatorKey === 'bb' ? 'bb' : indicatorKey] },
        notice: document.querySelector('#setupPinnedSample').textContent
      }), indicator);
      if (!setup.open || !setup.pinned || setup.timeframe !== '1H' || setup.length !== '60' || setup.mode !== 'blind' || !setup.indicatorEnabled || !setup.savedIndicator) failures.push(`${entry}/${sampleIndex}: pinned replay setup or indicator preference incorrect`);
      const expectedParams = indicator === 'macd' ? { fast: 12, slow: 26, signal: 9 } : indicator === 'bb' ? { period: 20, multiplier: 2 } : indicator === 'kdj' ? { period: 9, k: 3, d: 3 } : { step: .02, max: .2 };
      if (JSON.stringify(setup.params) !== JSON.stringify(expectedParams)) failures.push(`${entry}/${sampleIndex}: course default parameters were not applied`);
      const parameterLabel = indicator === 'macd' ? 'MACD(12,26,9)' : indicator === 'bb' ? 'BOLL(20,2)' : indicator === 'kdj' ? 'KDJ(9,3,3)' : 'SAR(0.02,0.2)';
      if (!setup.notice.includes(parameterLabel)) failures.push(`${entry}/${sampleIndex}: pinned setup does not disclose course parameters`);
      await target.locator('#confirmTrainingStart').click();
      await target.evaluate(() => updateChartOhlc(proChart.visibleRows.at(-1), proChart.visibleRows.length - 1, proChart.visibleRows));
      const replay = await target.evaluate(indicatorKey => ({
        workspace: activeWorkspace, timeframe: state.timeframe, length: state.sessionLength,
        start: state.sessionStart, reveal: state.revealCount, indicatorEnabled: state.indicator[indicatorKey], mode: replayTraining.mode,
        professional: Boolean(window.LightweightCharts), readout: document.querySelector('#chartIndicatorValues').textContent
      }), indicator);
      if (replay.workspace !== 'replay' || replay.timeframe !== '1H' || replay.length !== 60 || replay.start !== sampleIndex - 23 || replay.reveal !== 24 || !replay.indicatorEnabled || replay.mode !== 'blind') failures.push(`${entry}/${sampleIndex}: replay did not preserve sample and lesson setup`);
      if (replay.professional !== (chartMode === 'professional')) failures.push(`${entry}/${sampleIndex}/${chartMode}: chart engine selection failed`);
      if (!replay.readout.includes(expectedReadout)) failures.push(`${entry}/${sampleIndex}/${chartMode}: chart readout does not match the historical sample: ${replay.readout}`);
      let zoomReadout = '';
      if (chartMode === 'fallback') {
        await target.evaluate(() => { state.chartZoom = 2; renderChart(); });
        await target.mouse.move(4, 4); await target.waitForTimeout(40);
        zoomReadout = await target.locator('#chartIndicatorValues').textContent();
        if (!zoomReadout.includes(expectedReadout)) failures.push(`${entry}/${sampleIndex}/fallback zoom: readout lost its historical anchor: ${zoomReadout}`);
      }
      if (errors.length) failures.push(`${sampleIndex}/${chartMode}: ${errors.join('; ')}`);
      results.push({ entry, indicator, sampleIndex, chartMode, metrics, setup, replay, zoomReadout, errors });
    } catch (error) {
      failures.push(`${sampleIndex}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      target.on('dialog', dialog => dialog.accept());
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.evaluate(() => setWorkspace('indicators'));
      await target.locator('[data-indicator-entry="triangle-pattern"]').click();
      const card = target.locator('.indicator-market-sample:has([data-pin-replay-sample="83"])');
      await card.waitFor();
      const cardText = await card.textContent();
      if (!cardText.includes('2026-09-30 12:00 UTC · 1H') || !cardText.includes('收敛区间后的向上扩张（人工标注）') || !cardText.includes('85290.32') || !cardText.includes('不是自动识别')) failures.push('triangle-pattern: source, anchor, or manual-label disclosure missing');
      await card.locator('[data-pin-replay-sample]').click();
      await target.locator('#confirmTrainingStart').click();
      const replay = await target.evaluate(() => ({
        workspace: activeWorkspace, timeframe: state.timeframe, length: state.sessionLength,
        start: state.sessionStart, reveal: state.revealCount, mode: replayTraining.mode
      }));
      if (replay.workspace !== 'replay' || replay.timeframe !== '1H' || replay.length !== 60 || replay.start !== 60 || replay.reveal !== 24 || replay.mode !== 'blind') failures.push(`triangle-pattern: replay setup incorrect: ${JSON.stringify(replay)}`);
      if (errors.length) failures.push(`triangle-pattern: ${errors.join('; ')}`);
      results.push({ entry: 'triangle-pattern', sampleIndex: 83, replay, errors });
    } catch (error) {
      failures.push(`triangle-pattern: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  for (const sample of [
    { entry: 'candles', id: 113, time: '2026-10-01 18:00 UTC · 1H', title: '前高区域的长上影阴线', fact: '上影约 365.65，实体约 105.98', start: 90 },
    { entry: 'candles', id: 138, time: '2026-10-02 19:00 UTC · 1H', title: '区间低位附近的长下影阳线', fact: '下影约 286.43，实体约 53.27', start: 115 },
    { entry: 'double-top-bottom', id: 81, time: '2026-09-30 10:00 UTC · 1H', title: '相近双低收盘越过颈线（人工标注）', fact: '中间高点 N 83849.00', start: 58, points: [63, 70, 78] },
    { entry: 'double-top-bottom', id: 276, time: '2026-10-08 13:00 UTC · 1H', title: '相近双高收盘跌破颈线（人工标注）', fact: '中间低点 N 82227.56', start: 253, points: [255, 267, 270] }
  ]) for (const chartMode of ['professional', 'fallback']) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 667 }]) {
    const context = await page.context().browser().newContext({ viewport });
    const errors = [];
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      if (chartMode === 'fallback') await context.route('**/vendor/lightweight-charts.standalone.production.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      target.on('dialog', dialog => dialog.accept());
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.evaluate(() => setWorkspace('indicators'));
      await target.locator(`[data-indicator-entry="${sample.entry}"]`).click();
      const card = target.locator(`.indicator-market-sample:has([data-pin-replay-sample="${sample.id}"])`);
      await card.waitFor();
      const cardText = await card.textContent();
      if (!cardText.includes(sample.time) || !cardText.includes(sample.title) || !cardText.includes(sample.fact) || !cardText.includes('Binance 现货 K 线')) failures.push(`${sample.entry}/${sample.id}: anchor or candle facts missing`);
      if (sample.points) {
        const annotations = await card.locator('svg').evaluate(svg => {
          const anchors = [...svg.querySelectorAll('[data-sample-anchor]')].map(node => ({ index: Number(node.dataset.sampleAnchor), x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) }));
          const labels = [...svg.querySelectorAll('text')].filter(node => ['A', 'N', 'B'].includes(node.textContent)).map(node => ({ label: node.textContent, x: Number(node.getAttribute('x')), y: Number(node.getAttribute('y')) }));
          const neck = svg.querySelector('[data-sample-neckline]');
          return { viewBox: svg.getAttribute('viewBox'), anchors, labels, neck: neck && { index: Number(neck.dataset.sampleNeckline), y: Number(neck.getAttribute('y1')), y2: Number(neck.getAttribute('y2')) } };
        });
        const expectedX = sample.points.map(index => 8 + (index - sample.id + 23.5) * 304 / 24);
        const annotationsMatch = JSON.stringify(annotations.anchors.map(anchor => anchor.index)) === JSON.stringify(sample.points)
          && annotations.labels.map(label => label.label).join('') === 'ANB'
          && annotations.anchors.every((anchor, index) => Math.abs(anchor.x - expectedX[index]) < 0.001)
          && annotations.labels.every((label, index) => Math.abs(label.x - expectedX[index]) < 0.001 && label.y > 0 && label.y < 86)
          && annotations.neck?.index === sample.points[1]
          && Math.abs(annotations.neck.y - annotations.neck.y2) < 0.001
          && Math.abs(annotations.neck.y - annotations.anchors[1].y) < 0.001
          && annotations.viewBox === '0 0 320 86';
        if (!annotationsMatch) failures.push(`${sample.entry}/${sample.id}: manual A/N/B labels or neckline projection incorrect: ${JSON.stringify(annotations)}`);
      }
      await card.locator('[data-pin-replay-sample]').click();
      await target.locator('#confirmTrainingStart').click();
      const replay = await target.evaluate(() => ({ workspace: activeWorkspace, timeframe: state.timeframe, length: state.sessionLength, start: state.sessionStart, reveal: state.revealCount, mode: replayTraining.mode, professional: Boolean(window.LightweightCharts), lastClose: proChart.visibleRows.at(-1)?.close }));
      if (replay.workspace !== 'replay' || replay.timeframe !== '1H' || replay.length !== 60 || replay.start !== sample.start || replay.reveal !== 24 || replay.mode !== 'blind') failures.push(`candles/${sample.id}: replay setup incorrect: ${JSON.stringify(replay)}`);
      if (replay.professional !== (chartMode === 'professional')) failures.push(`${sample.entry}/${sample.id}: wrong chart engine`);
      const expectedClose = sample.id === 81 ? 83918.01 : sample.id === 276 ? 82182.01 : sample.id === 113 ? 84802.02 : 84315.28;
      if (replay.lastClose !== expectedClose) failures.push(`${sample.entry}/${sample.id}: last revealed price is not the anchor`);
      if (errors.length) failures.push(`candles/${sample.id}: ${errors.join('; ')}`);
      results.push({ entry: sample.entry, sampleIndex: sample.id, chartMode, viewport, replay, errors });
    } catch (error) {
      failures.push(`candles/${sample.id}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    try {
      await context.route('**/api/v5/**', route => route.abort());
      await context.route('**/unpkg.com/**', route => route.abort());
      const target = await context.newPage();
      target.on('pageerror', error => errors.push(error.message));
      await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
      await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
      await target.evaluate(() => {
        replayTraining.decisions = [0, 1].map(() => ({ outcome: '方向不符', evidence: [], reason: '', rewardRisk: .5 }));
        replayTraining.saved = false; replayTraining.completedAt = '';
        setWorkspace('review');
        renderSessionReport();
      });
      const actions = await target.locator('#sessionNextSteps [data-review-retry-indicator]').evaluateAll(nodes => nodes.map(node => node.dataset.reviewRetryIndicator));
      for (const id of ['structure', 'measured-move', 'candles', 'triangle-pattern']) if (!actions.includes(id)) failures.push(`review retry: missing ${id} lesson action`);
      await target.locator('#sessionNextSteps [data-review-retry-indicator="candles"]').click();
      const targetLesson = await target.evaluate(() => ({ workspace: activeWorkspace, selected: selectedIndicatorId }));
      if (targetLesson.workspace !== 'indicators' || targetLesson.selected !== 'candles' || !(await target.locator('[data-pin-replay-sample="113"]').count())) failures.push(`review retry: candle-case route failed: ${JSON.stringify(targetLesson)}`);
      if (errors.length) failures.push(`review retry: ${errors.join('; ')}`);
      results.push({ entry: 'review-retry', actions, targetLesson, errors });
    } catch (error) {
      failures.push(`review retry: ${error.message}`);
    } finally {
      await context.close();
    }
  }
  return { passed: failures.length === 0, results, failures };
}
