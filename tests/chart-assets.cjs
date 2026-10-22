// 运行：node tests/chart-assets.cjs。
// 图表工作台必须在外部 CDN 被拦截或不可用时仍保留可识别的工具图标。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const lucide = path.join(root, 'vendor', 'lucide.min.js');
const license = path.join(root, 'vendor', 'lucide-LICENSE.txt');

assert.ok(fs.statSync(lucide).size > 100000, 'bundled Lucide asset is unexpectedly small');
assert.ok(fs.statSync(license).size > 200, 'bundled Lucide license is missing');
assert.match(html, /<script\s+src="vendor\/lucide\.min\.js"><\/script>/, 'index must use the local Lucide asset');
assert.doesNotMatch(html, /<script\s+src="https:\/\/unpkg\.com\/lucide@/, 'index must not depend on the Lucide CDN');
const declared = (html.match(/data-lucide="[^"]+"/g) || []).length;
assert.ok(declared >= 12, `expected chart/workspace icons, found ${declared}`);

console.log(`PASS: local Lucide asset and license are present; ${declared} declared icons are CDN-independent.`);
