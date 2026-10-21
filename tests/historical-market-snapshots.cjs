// 运行：node tests/historical-market-snapshots.cjs。校验现货课程快照与 USDⓈ-M 永续快照各自的格式、边界和来源清单。
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'historical-snapshot-manifest.json'), 'utf8'));
const configMatch = html.match(/const historicalDatasetConfigs = (\{[\s\S]*?^    \});/m);
assert.ok(configMatch, 'both market types have dataset config');
const context = vm.createContext({});
vm.runInContext(`const historicalDatasetConfigs = ${configMatch[1]};`, context);
const configs = vm.runInContext('historicalDatasetConfigs', context);
const functionStart = html.indexOf('    function parseHistorical(');
const functionBody = html.slice(functionStart, html.indexOf('\n    function ', functionStart + 1));
assert.ok(functionStart >= 0 && functionBody.includes('parseHistorical'), 'parseHistorical is present');
vm.runInContext(functionBody, context);

for (const market of ['spot', 'swap']) {
  assert.deepEqual(Object.keys(configs[market]).sort(), ['1H', '1m', '5m']);
  for (const [timeframe, config] of Object.entries(configs[market])) {
    const file = path.basename(config.file);
    const raw = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    assert.equal(raw.length, 500, `${file}: exactly 500 source rows`);
    const parsed = context.parseHistorical(raw, config);
    assert.equal(parsed.length, 499, `${file}: only the oldest 499 rows enter training`);
    assert.equal(parsed[0].openTime, Number(raw[0][0]));
    assert.equal(parsed.at(-1).openTime, Number(raw[498][0]));
    assert.ok(parsed.every((row, index) => index === 0 || row.openTime > parsed[index - 1].openTime), `${file}: timestamps increase`);
    const metadata = manifest.markets[market][timeframe];
    assert.equal(metadata.file, file);
    assert.equal(metadata.rows, 500);
    assert.equal(metadata.excludedTrailingRows, 1);
    assert.equal(metadata.intervalMs, config.intervalMs);
    if (Number.isFinite(metadata.capturedAtMs)) {
      assert.ok(parsed.every(row => row.closeTime < metadata.capturedAtMs), `${file}: all included candles were closed at capture`);
    } else {
      assert.equal(market, 'spot', `${file}: only legacy spot samples may have an unrecorded capture time`);
    }
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    assert.equal(sha256, metadata.sha256.toLowerCase(), `${file}: snapshot checksum`);
    if (market === 'swap') {
      assert.match(metadata.endpoint, /^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines\?/);
      assert.match(metadata.endpoint, /symbol=BTCUSDT/);
    }
  }
}
assert.match(html, /binance-usdm-historical-snapshot/);
assert.match(html, /data-setup-market="swap"/);
assert.match(html, /data-setup-market="spot"/);
assert.match(html, /setActiveHistoricalMarket\(market\)/);
console.log('PASS: spot and USDⓈ-M snapshots parse as separate 499-bar datasets with closed candles and verified checksums.');
