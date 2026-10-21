const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function source(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = html.indexOf('\n    function ', start + 1);
  return html.slice(start, end);
}
let saved = null, failReads = false, failWrites = false;
const context = vm.createContext({
  state: { chartType: 'candles', drawingMagnet: false, dataMode: 'live', replayMode: false, scenario: 'up' },
  proChart: { visibleRows: [], heikinRows: [] },
  localStorage: {
    getItem(key) { assert.equal(key, 'trend-lab-drawing-magnet'); if (failReads) throw Error('storage unavailable'); return saved; },
    setItem(key, value) { assert.equal(key, 'trend-lab-drawing-magnet'); if (failWrites) throw Error('quota'); saved = value; }
  },
  barTime: row => row.time,
  drawingSurface() { return context.surface; }
});
for (const name of ['loadChartDrawingMagnetPreference', 'saveChartDrawingMagnetPreference', 'chartUsesHeikinAshi', 'drawingTimeOrder', 'drawingPoint', 'drawingCoordinatePoint']) {
  vm.runInContext(source(name), context);
}
const plain = value => JSON.parse(JSON.stringify(value));
assert.equal(context.loadChartDrawingMagnetPreference(), false, 'magnet is off for a new browser');
saved = 'true'; assert.equal(context.loadChartDrawingMagnetPreference(), true, 'saved toggle is restored');
saved = 'invalid'; assert.equal(context.loadChartDrawingMagnetPreference(), false, 'unknown saved values default off');
failReads = true; assert.equal(context.loadChartDrawingMagnetPreference(), false, 'blocked storage defaults off');
failReads = false; context.state.drawingMagnet = true; context.saveChartDrawingMagnetPreference(); assert.equal(saved, 'true');
failWrites = true; assert.doesNotThrow(() => context.saveChartDrawingMagnetPreference());

const rows = [
  { time: 100, open: 100, high: 120, low: 80, close: 110 },
  { time: 110, open: 101, high: 121, low: 81, close: 111 },
  { time: 120, open: 102, high: 122, low: 82, close: 112 }
];
context.proChart.visibleRows = rows;
context.proChart.heikinRows = rows.map((row, index) => ({ ...row, open: 90 + index, high: 130 + index, low: 70 + index, close: 105 + index }));
context.surface = {
  chart: { timeScale: () => ({
    coordinateToTime: x => 100 + Math.round(x / 10) * 10,
    coordinateToLogical: x => x / 10,
    timeToCoordinate: time => (time - 100) / 10 * 10
  }) },
  series: { coordinateToPrice: y => 200 - y, priceToCoordinate: price => 200 - price }
};
context.state.drawingMagnet = false;
assert.deepEqual(plain(context.drawingCoordinatePoint(10, 92)), { time: 110, price: 108, logicalCoordinate: 1 }, 'free placement retains the pointer price and time');
context.state.drawingMagnet = true;
assert.deepEqual(plain(context.drawingCoordinatePoint(10, 91)), { time: 110, price: 111, logicalCoordinate: 1 }, 'nearest visible candle OHLC wins when cursor is within the magnet threshold');
assert.deepEqual(plain(context.drawingCoordinatePoint(10, 150)), { time: 110, price: 50, logicalCoordinate: 1 }, 'magnet leaves distant cursor positions unsnapped');
context.state.chartType = 'heikin';
assert.deepEqual(plain(context.drawingCoordinatePoint(10, 94)), { time: 110, price: 106, logicalCoordinate: 1 }, 'Heikin Ashi magnet uses the displayed synthetic OHLC');
context.state.chartType = 'line';
assert.deepEqual(plain(context.drawingCoordinatePoint(10, 89)), { time: 110, price: 111, logicalCoordinate: 1 }, 'line-chart magnet snaps to its visible close only');
context.surface.chart.timeScale = () => ({ coordinateToTime: () => null, coordinateToLogical: () => 99, timeToCoordinate: () => null });
assert.equal(context.drawingCoordinatePoint(10, 90), null, 'positions with no market timestamp are rejected');
console.log('PASS: drawing magnet preference is safe; OHLC snapping follows visible candle type, threshold and valid timestamps.');
