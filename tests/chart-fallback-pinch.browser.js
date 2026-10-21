// 通过 Playwright browser_run_code_unsafe 的 filename 参数运行；本地服务端口 4188。
// 独立触屏上下文并禁用图表库，仅验备用图双指缩放和单指接续平移。
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const failures = [], errors = [];
  try {
    await context.route('https://fapi.binance.com/fapi/v1/klines**', route => route.abort());
    await context.route('**/unpkg.com/**', route => route.abort());
    await context.route('**/vendor/lightweight-charts*', route => route.abort());
    const target = await context.newPage();
    target.on('pageerror', error => errors.push(error.message));
    await target.goto('http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction(() => historicalReady && sessionPersistenceReady);
    await target.locator('[data-nav-target="market"]').click();
    await target.evaluate(() => { state.dataMode = 'sim'; state.replayMode = false; state.liveRows = []; state.liveError = ''; state.liveLoading = false; renderChart(); updateSimDisplay(); });
    const geometry = await target.locator('#chart .chart-fallback').evaluate(svg => {
      const rect = svg.getBoundingClientRect();
      const x = Number(svg.dataset.plotX), width = Number(svg.dataset.plotWidth);
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewWidth: svg.viewBox.baseVal.width, plotX: x, plotWidth: width };
    });
    const centerX = geometry.left + (geometry.plotX + geometry.plotWidth * .56) * geometry.width / geometry.viewWidth;
    const centerY = geometry.top + geometry.height * .3;
    const readView = () => target.evaluate(() => {
      const svg = document.querySelector('#chart .chart-fallback'), rect = svg.getBoundingClientRect();
      const rows = buildData(state.scenario, state.timeframe), visible = Math.max(16, Math.min(rows.length, Math.round(rows.length / state.chartZoom)));
      const start = Math.max(0, rows.length - visible - state.chartOffset);
      const center = (window.__pinchMidpointX - rect.left) * svg.viewBox.baseVal.width / rect.width;
      const fraction = Math.max(0, Math.min(1, (center - Number(svg.dataset.plotX)) / Number(svg.dataset.plotWidth)));
      return { zoom: state.chartZoom, offset: state.chartOffset, visible, logicalAtMidpoint: start + fraction * visible };
    });
    await target.evaluate(x => { window.__pinchMidpointX = x; }, centerX);
    const before = await readView();
    const cdp = await context.newCDPSession(target);
    const point = (id, x) => ({ id, x: Math.round(x), y: Math.round(centerY), radiusX: 2, radiusY: 2, force: 1 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, centerX - 35), point(2, centerX + 35)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, centerX - 55), point(2, centerX + 55)] });
    await target.waitForTimeout(100);
    const pinched = await readView();
    if (!(pinched.zoom > before.zoom)) failures.push(`pinch did not zoom in: ${JSON.stringify({ before, pinched })}`);
    if (Math.abs(pinched.logicalAtMidpoint - before.logicalAtMidpoint) > 1.5) failures.push(`pinch anchor drifted: ${pinched.logicalAtMidpoint - before.logicalAtMidpoint} bars`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(3, centerX - 55), point(4, centerX + 55)] });
    const zoomOutStart = await readView();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(3, centerX - 38), point(4, centerX + 38)] });
    const pinchedOut = await readView();
    if (!(pinchedOut.zoom < zoomOutStart.zoom)) failures.push('pinch did not zoom out');
    if (Math.abs(pinchedOut.logicalAtMidpoint - zoomOutStart.logicalAtMidpoint) > 1.5) failures.push(`zoom-out anchor drifted: ${pinchedOut.logicalAtMidpoint - zoomOutStart.logicalAtMidpoint} bars`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(5, centerX - 55), point(6, centerX + 55)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point(6, centerX + 55)] });
    const oneFingerStart = centerX - 55;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(5, oneFingerStart + 40)] });
    await target.waitForTimeout(100);
    const panned = await readView();
    if (panned.offset === pinchedOut.offset) failures.push('one-finger pan did not continue after pinch');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (errors.length) failures.push(...errors);
    return { passed: failures.length === 0, before, pinched, panned, zoomOutStart, pinchedOut, failures, errors };
  } finally {
    await context.close();
  }
}
