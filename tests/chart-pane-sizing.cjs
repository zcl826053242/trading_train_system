// 运行：node tests/chart-pane-sizing.cjs。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = name => {
  const start = html.search(new RegExp(`^    function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const body = html.slice(start), end = body.search(/^    }\r?$/m);
  assert.ok(end >= 0, name);
  return body.slice(0, end + 5);
};
let saved = null;
const context = vm.createContext({ localStorage: { getItem: () => saved } });
for (const name of ['loadChartPaneLayouts', 'chartPaneMinimums', 'distributeChartPaneHeights', 'fallbackChartLayout']) vm.runInContext(source(name), context);
for (const raw of [null, '{bad', '[]', 'null', '{}', '{"version":2,"layouts":{}}']) {
  saved = raw;
  assert.equal(JSON.stringify(context.loadChartPaneLayouts()), '{}');
}
saved = JSON.stringify({ version: 1, layouts: {
  'main,volume': [.8, .2],
  'main,volume,rsi': [.1, .2, .1],
  'main,volume,macd,rsi': [.4, .2, .2, .2],
  'main,volume,unknown': [.5, .3, .2],
  'main,volume,kdj': [.7, 0, .3],
  'main,volume,rsi,macd': [.5, .3],
  'main,volume,rsi,kdj': [.5, '.2', .2, .1]
} });
const loaded = context.loadChartPaneLayouts();
assert.deepEqual(Object.keys(loaded).sort(), ['main,volume', 'main,volume,rsi']);
assert.equal(JSON.stringify(loaded['main,volume,rsi']), '[0.25,0.5,0.25]');
for (const fallback of [false, true]) for (let count = 0; count <= 3; count++) {
  const names = ['main', 'volume', ...['rsi', 'macd', 'kdj'].slice(0, count)];
  for (const total of [100, 220, 310, 416, 578, 872]) {
    const mins = context.chartPaneMinimums(names, total, fallback);
    for (let focus = 0; focus < names.length; focus++) {
      const weights = names.map((_, i) => i === focus ? .999 : .001);
      const heights = context.distributeChartPaneHeights(total, weights, mins);
      assert.ok(Math.abs(heights.reduce((a, b) => a + b, 0) - total) < 1e-6, 'never overflows the time axis');
      heights.forEach((height, i) => assert.ok(Number.isFinite(height) && height >= mins[i] - 1e-6, 'minimum readable pane space'));
      if (fallback && total >= 198 + count * 72) {
        const layout = context.fallbackChartLayout(334, total + 28, count, 72, heights);
        assert.deepEqual(Array.from(layout.heights), Array.from(heights));
        assert.ok(layout.plot.y + layout.plot.h < layout.volumeTop);
        assert.ok(layout.plot.volY + layout.plot.volH <= layout.paneStart + 1e-6 || total < 198);
        for (let i = 0; i < heights.length; i++) assert.ok(Math.abs(layout.tops[i] - heights.slice(0, i).reduce((a, b) => a + b, 0)) < 1e-6);
      }
    }
  }
}
assert.match(html, /chartPaneSeparators\.addEventListener\('pointercancel'/);
assert.match(html, /chartPaneSeparators\.addEventListener\('lostpointercapture'/);
assert.match(html, /pane\.moveTo\(i \+ 2\)/);
console.log('PASS: pane preferences validate/normalize safely; allocation enforces readable minima, fixed total, canonical order, and fallback coordinates.');
