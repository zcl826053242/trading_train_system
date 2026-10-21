// 运行：node tests/chart-fallback-layout.cjs。锁定专业图与备用图共用的布局约束。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

assert.match(html, /#chart\.chart-fallback-mode\s*\{[^}]*height:\s*100%\s*!important;[^}]*min-height:\s*0\s*!important;[^}]*flex:\s*1 1 auto;/);
assert.match(html, /\.chart-axis-bar\.fallback-placeholder\s*\{\s*visibility:\s*hidden;\s*\}/);
assert.match(html, /axisBar\.hidden\s*=\s*false;\s*axisBar\.classList\.add\('fallback-placeholder'\);/);
assert.match(html, /axisBar\.classList\.remove\('fallback-placeholder'\);\s*axisBar\.hidden\s*=\s*!available;/);
assert.doesNotMatch(html, /setProperty\('--fallback-height'/);
assert.match(html, /body\.market-terminal\s+#chart\s*\{\s*height:\s*max\(280px,\s*min\(45vh,\s*360px\)\)\s*!important;\s*min-height:\s*max\(280px,\s*min\(45vh,\s*360px\)\);/);
assert.match(html, /#chart\.has-rsi-pane\.has-macd-pane\.has-kdj-pane\s*\{\s*height:\s*calc\(max\(280px,\s*min\(45vh,\s*360px\)\)\s*\+\s*144px\)\s*!important;/);
assert.match(html, /\.chart-pane-legend\s*\{[^}]*overflow-x:\s*auto;[^}]*scrollbar-width:\s*none;[^}]*touch-action:\s*pan-x;/);
assert.match(html, /\.chart-pane-legend::\-webkit-scrollbar\s*\{\s*display:\s*none;\s*\}/);
assert.match(html, /body\.market-terminal \.chart-indicator-values\s*\{[^}]*overflow-x:\s*auto;[^}]*scrollbar-width:\s*none;/);
assert.match(html, /body\.market-terminal \.chart-indicator-values::\-webkit-scrollbar\s*\{\s*display:\s*none;\s*\}/);
assert.match(html, /@media\s*\(min-width:\s*561px\)\s*and\s*\(max-width:\s*1100px\)\s*\{\s*body\.market-terminal\s+\.chart-wrap\s*\{\s*height:\s*680px;\s*min-height:\s*680px;\s*flex:\s*0 0 680px;\s*\}\s*body\.market-terminal\s+#chart\s*\{\s*height:\s*100%\s*!important;\s*min-height:\s*0\s*!important;/);
assert.match(html, /@media\s*\(max-width:\s*720px\)\s*\{\s*body\.market-terminal\s+#workspaceTaskDock\s*\{\s*grid-column:\s*1;\s*grid-row:\s*2;\s*\}\s*body\.market-terminal\s+\.chart-card\s*\{\s*grid-column:\s*1;\s*grid-row:\s*1;\s*\}\s*body\.market-terminal\s+\.side\s*\{\s*grid-column:\s*1;\s*grid-row:\s*3;/);
assert.match(html, /@media\s*\(max-width:\s*560px\)\s*and\s*\(min-height:\s*780px\)\s*\{\s*body\.market-terminal\s+#chart\s*\{\s*height:\s*min\(56vh,\s*480px\)\s*!important;\s*min-height:\s*min\(56vh,\s*480px\);/);
assert.match(html, /#chart\.has-rsi-pane\.has-macd-pane\.has-kdj-pane\s*\{\s*height:\s*calc\(min\(56vh,\s*480px\)\s*\+\s*144px\)\s*!important;/);
// 验证真实布局函数：最窄/短屏和全屏，各指标数量均给图例留下26px。
const vm = require('node:vm');
const start = html.indexOf('    function fallbackChartLayout(');
assert.notEqual(start, -1);
const context = vm.createContext({});
vm.runInContext(html.slice(start, html.indexOf('\n    function ', start + 1)), context);
for (const width of [264, 334, 859, 1048, 1392]) {
  for (const height of [280, 300, 396, 444, 497, 537, 606, 617, 900]) {
    for (let count = 0; count <= 3; count++) {
      // 各视口需保留足够空间供图例和振荡曲线同时辨读。
      if (height < 280 + count * 48) continue;
      const {plot, volumeTop, paneStart, paneStep} = context.fallbackChartLayout(width, height, count);
      assert.ok(plot.w > 0 && plot.x + plot.w + 64 <= width);
      assert.ok(plot.y >= 3 + 26 + 3, 'main legend has independent space');
      assert.ok(plot.y + plot.h < volumeTop, 'main data stays above the volume legend');
      assert.ok(plot.volY >= volumeTop + 26 + 3, 'volume data stays below its legend');
      assert.ok(plot.volY + plot.volH <= paneStart, 'volume data stays in its pane');
      assert.ok(paneStart + count * paneStep <= height - 28 + 1e-6, 'panes stay above time axis');
      const minimumCurveHeight = height >= 442 ? 35 : height >= 394 ? 20 : 9;
      for (let i = 0; i < count; i++) {
        const top = paneStart + i * paneStep;
        const height = paneStep - 5;
        const curveTop = top + height - Math.max(1, height - 32);
        assert.ok(curveTop >= top + 3 + 26 + 3 - 1e-6, 'oscillator curves clear the legend');
        assert.ok(height - 32 >= minimumCurveHeight, 'oscillators retain a viewport-appropriate usable drawing height');
      }
    }
  }
}
// 短屏三副图在固定外框内保留35px曲线，同时保住主图/量能，不能用溢出来通过。
for (const height of [444, 512, 537, 606, 617]) {
  const layout = context.fallbackChartLayout(334, height, 3);
  assert.ok(layout.paneStep - 37 >= 35);
  assert.ok(layout.plot.h >= 88 && layout.plot.volH >= 28, 'main and volume remain readable');
}
const scaleStart = html.indexOf('    function fallbackIndicatorScale(');
assert.notEqual(scaleStart, -1);
vm.runInContext(html.slice(scaleStart, html.indexOf('\n    function ', scaleStart + 1)), context);
for (const values of [[], [null, NaN, Infinity], [0, 0, 0], [-2, 3, 8], [-50, -1], [1, 20]]) {
  const scale = context.fallbackIndicatorScale('macd', values);
  assert.ok(Number.isFinite(scale.min) && Number.isFinite(scale.max) && scale.max > scale.min);
  assert.ok(scale.min <= 0 && scale.max >= 0, 'MACD keeps its zero baseline');
  assert.ok(values.filter(Number.isFinite).every(value => value >= scale.min && value <= scale.max));
}
for (const name of ['rsi', 'kdj']) {
  const scale = context.fallbackIndicatorScale(name, [-12, 130]);
  assert.ok(scale.min <= -12 && scale.max >= 130, 'KDJ overflow is not clipped');
  const neutral = context.fallbackIndicatorScale(name, [50]);
  assert.equal(neutral.min, 0); assert.equal(neutral.max, 100);
}
assert.match(html, /const H = container\.clientHeight \|\| 540;/);
assert.match(html, /Math\.abs\(svg\.viewBox\.baseVal\.height - chart\.clientHeight\) > \.5/);
assert.match(html, /pane\.setStretchFactor\(2\.1\);/);
assert.match(html, /volumePane\.setStretchFactor\(3\.5\);/);
console.log('PASS: responsive stage, pixel-based fallback geometry, non-overlapping panel readouts and usable short-screen oscillators.');
