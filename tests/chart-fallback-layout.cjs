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
assert.match(html, /@media\s*\(min-width:\s*901px\)\s*and\s*\(max-width:\s*1100px\)\s*\{\s*body\.market-terminal\s+\.chart-wrap\s*\{\s*height:\s*540px;\s*min-height:\s*540px;\s*flex:\s*0 0 540px;\s*\}\s*body\.market-terminal\s+#chart\s*\{\s*height:\s*100%\s*!important;\s*min-height:\s*0\s*!important;/);
assert.match(html, /@media\s*\(max-width:\s*720px\)\s*\{\s*body\.market-terminal\s+#workspaceTaskDock\s*\{\s*grid-column:\s*1;\s*grid-row:\s*2;\s*\}\s*body\.market-terminal\s+\.chart-card\s*\{\s*grid-column:\s*1;\s*grid-row:\s*1;\s*\}\s*body\.market-terminal\s+\.side\s*\{\s*grid-column:\s*1;\s*grid-row:\s*3;/);
assert.match(html, /@media\s*\(max-width:\s*560px\)\s*and\s*\(min-height:\s*780px\)\s*\{\s*body\.market-terminal\s+#chart\s*\{\s*height:\s*min\(56vh,\s*480px\)\s*!important;\s*min-height:\s*min\(56vh,\s*480px\);/);
assert.match(html, /#chart\.has-rsi-pane\.has-macd-pane\.has-kdj-pane\s*\{\s*height:\s*calc\(min\(56vh,\s*480px\)\s*\+\s*144px\)\s*!important;/);
assert.match(html, /const paneStep = 104;/);
assert.match(html, /pane\.setStretchFactor\(2\.1\);/);
assert.match(html, /const top = 406 \+ paneIndex \* paneStep, height = 100;/);
console.log('PASS: responsive stage sizing, compact short phones, chart-first tall phones, scrollable readouts, and the axis-bar layout slot remain consistent.');
