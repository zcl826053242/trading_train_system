// 运行：node tests/chart-price-format.cjs。图表价格轴及读数统一到市场报价精度。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('    function formatChartPrice(');
assert.notEqual(start, -1);
const end = html.indexOf('\n    function ', start + 1);
const context = vm.createContext({ Number });
vm.runInContext(html.slice(start, end), context);

assert.equal(context.formatChartPrice(83269.85), '83,269.85');
assert.equal(context.formatChartPrice(83000), '83,000.00');
assert.equal(context.formatChartPrice(0.1), '0.10');
assert.equal(context.formatChartPrice(NaN), '—');
const formatStart = html.indexOf('    function chartPriceFormat(');
assert.notEqual(formatStart, -1);
vm.runInContext(html.slice(formatStart, html.indexOf('\n    function ', formatStart + 1)), context);
assert.equal(context.chartPriceFormat().type, 'custom');
assert.equal(context.chartPriceFormat().minMove, 0.01);
assert.equal(context.chartPriceFormat().formatter(71000.5), '71,000.50');
assert.match(html, /const mainPriceFormat = chartPriceFormat\(\);/);
assert.match(html, /lastPrice'\)\.textContent = formatChartPrice\(last\)/);
assert.match(html, /\$\{prefix\}开 \$\{formatChartPrice\(visual\.open\)\}  高 \$\{formatChartPrice\(visual\.high\)\}/);
assert.match(html, /formatChartPrice\(val\)/, 'fallback price-axis ticks must use the shared formatter');
assert.match(html, /crossPrice\.textContent = formatChartPrice\(price\)/);
assert.doesNotMatch(html, /Math\.round\(val\)\.toLocaleString\(\)/, 'obsolete integer fallback ticks must not return');
console.log('PASS: Binance-style two-decimal pricing for professional axes and chart readouts.');
