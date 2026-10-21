// 运行：node tests/chart-drawings.cjs。验证页面真实绘图函数的锚点与坐标边界。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function source(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = html.indexOf('\n    function ', start + 1);
  assert.notEqual(end, -1);
  return html.slice(start, end);
}
const nodes = [];
const svg = { style: {}, setAttribute() {}, replaceChildren() { nodes.length = 0; }, append(...items) { nodes.push(...items); } };
const series = { coordinateToPrice: y => 200 - y, priceToCoordinate: price => 200 - price };
const chartElement = { getBoundingClientRect: () => ({ left: 0, top: 0, height: 200, bottom: 200 }) };
const stage = { ...chartElement, style: { setProperty() {} } };
const coach = { textContent: '' };
const drawingList = { innerHTML: '' };
const drawingCount = { textContent: '' };
const context = vm.createContext({
  state: { tool: 'trendline', chartType: 'candles' },
  proChart: {
    chart: {
      panes: () => [{ getHeight: () => 200 }],
      timeScale: () => ({ width: () => 300, coordinateToTime: x => Math.round(x / 10), coordinateToLogical: x => x / 10, logicalToCoordinate: logical => logical * 10, timeToCoordinate: time => time * 10 }),
      addSeries: () => { throw Error('A drawing must not add duplicate timestamps to a market series'); }
    },
    candles: series, line: { coordinateToPrice: y => 300 - y, priceToCoordinate: price => 300 - price },
    drawingOverlay: svg, drawings: [], selectedDrawingId: null, trendPoint: null, shapePoints: []
  },
  document: { getElementById: id => id === 'chartCoach' ? coach : id === 'chartStage' ? stage : id === 'drawingList' ? drawingList : id === 'drawingCount' ? drawingCount : chartElement },
  el: (tag, attributes, text) => ({ tag, attributes, text }),
  coachText: { cursor: '指针' },
  timeframeSeconds: () => 60,
  applyDrawingState() {},
  registerDrawing(label, parts, edit) {
    const drawing = { id: context.proChart.fallback ? `fallback-${context.proChart.drawings.length}` : 'test-trend', label, parts, edit, visible: true, locked: false };
    context.proChart.drawings.push(drawing);
    context.proChart.selectedDrawingId = drawing.id;
  },
  renderDrawingManager() { context.renderDrawingOverlay(); }
});
for (const name of ['chartUsesHeikinAshi', 'activeChartSeries', 'drawingSurface', 'drawingEventPoint', 'createFallbackDrawingSurface', 'drawingTimeOrder', 'drawingPoint', 'drawingCoordinatePoint', 'drawingLogicalIndex', 'drawingTimeCoordinate', 'measurementBarCount', 'measurementSummary', 'clipDrawingLine', 'drawingAngleDegrees', 'applyDrawingState', 'syncDrawingPriceLines', 'handleDrawingToolClick', 'renderDrawingOverlay', 'renderDrawingManager', 'removeDrawing', 'beginDrawingEdit', 'moveDrawingEdit', 'endDrawingEdit']) vm.runInContext(source(name), context);
vm.runInContext(source('handleDrawingManagerAction').split("\n    document.getElementById('drawingList')")[0], context);
const renderDrawingManager = context.renderDrawingManager;
context.renderDrawingManager = () => context.renderDrawingOverlay();
const event = (x, y) => ({ clientX: x, clientY: y, button: 0, pointerId: 1,
  currentTarget: { ...chartElement, style: {}, setPointerCapture() {} }, preventDefault() {}, stopImmediatePropagation() {} });
const plain = value => JSON.parse(JSON.stringify(value));
const line = () => nodes.find(node => node.tag === 'line' && node.attributes['data-drawing-id'] === 'test-trend');

// 模拟教学锚点按情景相对进度跨周期定位；真实数据及回放仍按时间戳定位。
context.state.dataMode = 'sim';
context.state.replayMode = false;
context.state.scenario = 'breakRetest';
context.proChart.visibleRows = Array.from({ length: 5 }, (_, index) => ({ time: 100 + index * 10 }));
const scenarioPoint = context.drawingPoint(20, 150, 2);
assert.equal(scenarioPoint.scenario, 'breakRetest');
assert.equal(scenarioPoint.scenarioProgress, 0.5);
const measurementStart = context.drawingPoint(110, 150, 1);
const measurementEnd = context.drawingPoint(130, 170, 3);
assert.equal(context.measurementBarCount(measurementStart, measurementEnd), 2);
context.proChart.visibleRows = Array.from({ length: 9 }, (_, index) => ({ time: 1000 + index * 5 }));
assert.equal(context.measurementBarCount(measurementStart, measurementEnd), 4,
  'measurement counts the current candles spanned by its displayed anchors after a scenario timeframe change');
assert.equal(context.measurementBarCount(measurementEnd, measurementStart), 4, 'reverse measurements count the same interval');
assert.equal(context.measurementSummary(measurementStart, measurementEnd), '+20.00 (+13.33%) · 4 根');
context.proChart.visibleRows = Array.from({ length: 9 }, (_, index) => ({ time: 100 + index * 5 }));
assert.equal(context.drawingTimeCoordinate(scenarioPoint), 1200, 'scenario progress maps to the current logical range');
const fractionalPoint = { ...scenarioPoint, scenarioProgress: 0.35 };
const fractionalScale = {
  logicalToCoordinate: () => 0,
  timeToCoordinate: time => (time - 100) * 2
};
assert.ok(Math.abs(context.drawingTimeCoordinate(fractionalPoint, fractionalScale) - 28) < 1e-9,
  'fractional progress interpolates actual adjacent candle coordinates instead of accepting a spurious logical zero');
context.state.dataMode = 'live';
context.proChart.visibleRows = [{ time: 110 }, { time: 115 }, { time: 130 }];
assert.equal(context.measurementBarCount(measurementStart, measurementEnd), 2,
  'live measurements count actual candles, ignoring teaching progress and gaps in timestamps');
assert.equal(context.drawingTimeCoordinate(scenarioPoint), 200, 'live drawings use their timestamp');
context.state.dataMode = 'sim';
context.state.replayMode = true;
assert.equal(context.measurementBarCount(measurementStart, measurementEnd), 2, 'replay measurements never use teaching progress');
assert.equal(context.drawingTimeCoordinate(scenarioPoint), 200, 'replay drawings do not remap to unrevealed bars');
assert.equal(context.drawingTimeCoordinate(scenarioPoint, {
  logicalToCoordinate: () => 123,
  timeToCoordinate: () => null
}), null, 'an unrevealed replay timestamp stays hidden rather than mapping into visible data');
context.state.replayMode = false;
context.state.dataMode = 'live';
context.proChart.visibleRows = Array.from({ length: 20 }, (_, index) => ({ time: index * 10 }));

// Trend angle is an editable two-anchor drawing whose displayed angle follows chart coordinates.
context.state.tool = 'trendAngle';
context.proChart.trendPoint = null;
context.handleDrawingToolClick(event(100, 30));
context.handleDrawingToolClick(event(200, 60));
const angleDrawing = context.proChart.drawings.at(-1);
assert.equal(angleDrawing.edit.type, 'trendAngle');
assert.equal(angleDrawing.edit.extent, 'straightSegment');
context.renderDrawingOverlay();
const angleLabel = nodes.find(node => node.attributes?.['data-angle-for'] === angleDrawing.id);
assert.match(angleLabel.text, /^-16\.7°$/);
angleDrawing.edit.points[1] = { ...angleDrawing.edit.points[1], price: 120 };
context.renderDrawingOverlay();
assert.match(nodes.find(node => node.attributes?.['data-angle-for'] === angleDrawing.id).text, /^-26\.6°$/,
  'angle label updates after an anchor changes');
context.proChart.drawings = [];
context.proChart.selectedDrawingId = null;
context.state.tool = 'trendline';

// 同一根蜡烛上的两点必须成为可编辑垂直线，而非重复时间的行情数据。
context.handleDrawingToolClick(event(100, 30));
context.handleDrawingToolClick(event(100, 90));
assert.equal(context.proChart.drawings.length, 1);
const drawing = context.proChart.drawings[0];
assert.equal(drawing.parts.length, 0);
assert.deepEqual(plain(drawing.edit.points), [{ time: 10, price: 170 }, { time: 10, price: 110 }]);
context.renderDrawingOverlay();
assert.deepEqual(['x1', 'y1', 'x2', 'y2'].map(key => line().attributes[key]), [100, 30, 100, 90]);
assert.equal(nodes.filter(node => node.attributes?.['data-anchor-index'] != null).length, 2);

// 拖过另一端点及回到相同时间，保留端点身份，不排序或改写另一个端点。
context.state.tool = 'cursor';
context.beginDrawingEdit(event(100, 30));
context.moveDrawingEdit(event(80, 40));
context.moveDrawingEdit(event(100, 50));
context.endDrawingEdit(event(100, 50));
assert.deepEqual(plain(drawing.edit.points), [{ time: 10, price: 150 }, { time: 10, price: 110 }]);

// 分时图采用当前价格坐标轴；锁定、隐藏、取消选择与零长度状态各自生效。
context.state.chartType = 'line';
context.renderDrawingOverlay();
assert.equal(line().attributes.y1, 150);
context.beginDrawingEdit(event(100, 150));
context.moveDrawingEdit(event(120, 160));
context.endDrawingEdit(event(120, 160));
assert.deepEqual(plain(drawing.edit.points), [{ time: 12, price: 140 }, { time: 10, price: 110 }]);
drawing.locked = true;
context.beginDrawingEdit(event(120, 160));
assert.equal(context.proChart.editingDrawing, null);
context.renderDrawingOverlay();
assert.equal(nodes.filter(node => node.attributes?.['data-anchor-index'] != null).length, 0);
const visibilityButton = { dataset: { drawingAction: 'visibility' }, closest: () => ({ dataset: { drawingId: drawing.id } }) };
context.handleDrawingManagerAction({ target: { closest: () => visibilityButton } });
assert.equal(drawing.visible, false);
context.renderDrawingOverlay();
assert.equal(line(), undefined);
context.handleDrawingManagerAction({ target: { closest: () => visibilityButton } });
assert.equal(drawing.visible, true);
context.renderDrawingOverlay();
assert.ok(line());
drawing.visible = true;
context.proChart.selectedDrawingId = null;
context.renderDrawingOverlay();
assert.equal(line().attributes['stroke-width'], 2);
drawing.edit.points[1] = { ...drawing.edit.points[0] };
context.renderDrawingOverlay();
assert.equal(line(), undefined);
context.renderDrawingOverlay();
context.renderDrawingManager = renderDrawingManager;
context.removeDrawing(drawing);
assert.equal(context.proChart.drawings.length, 0);
assert.equal(context.proChart.drawingOverlay.children?.length ?? nodes.length, 0);
assert.match(drawingList.innerHTML, /暂无绘图对象/);

context.proChart.drawings.push({ id: 'test-channel', visible: true, locked: false, edit: { type: 'parallelogram', points: [
  { time: 10, price: 170 }, { time: 20, price: 160 }, { time: 30, price: 70 }
] } });
context.state.chartType = 'candles';
context.renderDrawingOverlay();
const channel = nodes.find(node => node.tag === 'polygon');
assert.equal(channel.attributes.points, '100,30 200,40 300,130 200,120');

// 切换蜡烛/分时后，三类特殊形态的锚点命中必须使用当前显示系列坐标。
context.state.chartType = 'line';
context.renderDrawingManager = () => {};
for (const [type, points, pointIndex] of [
  ['horizontalRay', [{ time: 10, price: 170 }], 0],
  ['horizontalSegment', [{ time: 10, price: 170 }, { time: 20, price: 170 }], 1],
  ['verticalLine', [{ time: 10, price: 170 }], 0]
]) {
  const drawing = { id: `line-${type}`, visible: true, locked: false,
    edit: { type, series, points: points.map(item => ({ ...item })) } };
  context.proChart.drawings = [drawing];
  context.proChart.selectedDrawingId = drawing.id;
  context.proChart.editingDrawing = null;
  const target = drawing.edit.points[pointIndex];
  const original = { ...target };
  const x = target.time * 10, y = context.proChart.line.priceToCoordinate(target.price);
  context.beginDrawingEdit(event(x, y));
  assert.equal(context.proChart.editingDrawing?.pointIndex, pointIndex,
    `${type} anchor remains hittable at its visible line-chart coordinate`);
  context.moveDrawingEdit(event(x + 10, y + 10));
  context.endDrawingEdit(event(x + 10, y + 10));
  assert.notDeepEqual(plain(drawing.edit.points[pointIndex]), original, `${type} anchor moves after chart-type switch`);
}
context.state.chartType = 'candles';

// Price-line drawings migrate between candle and line series with their options and manager state intact.
const removedPriceLines = [];
const createdPriceLines = [];
const candleOwner = { removePriceLine: item => removedPriceLines.push(['candles', item]) };
const lineOwner = { createPriceLine: options => { const item = { options, applyOptions(next) { this.applied = next; } }; createdPriceLines.push(item); return item; } };
const priceDrawing = { id: 'price-drawing', visible: true, locked: true, parts: [
  { type: 'price', owner: candleOwner, item: { id: 'old' }, options: { price: 123, color: '#f0b90b', lineWidth: 1 } }
] };
context.proChart.candles = candleOwner;
context.proChart.line = lineOwner;
context.proChart.drawings = [priceDrawing];
context.state.chartType = 'line';
context.syncDrawingPriceLines();
assert.equal(removedPriceLines.length, 1);
assert.equal(priceDrawing.parts[0].owner, lineOwner);
assert.equal(priceDrawing.parts[0].item, createdPriceLines[0]);
assert.equal(createdPriceLines[0].options.price, 123);
assert.equal(createdPriceLines[0].applied.lineVisible, true);
context.proChart.drawings = [];
context.proChart.candles = series;
context.proChart.line = { coordinateToPrice: y => 300 - y, priceToCoordinate: price => 300 - price };
context.state.chartType = 'candles';

// 主图绘图对象共用锚点编辑，但各类对象在编辑后仍须保留自身几何约束。
context.renderDrawingOverlay = () => {};
context.renderDrawingManager = () => {};
const point = (time, price) => ({ time, price });
const editCases = [
  ['measurement', [point(10, 170), point(20, 140)], 1],
  ['rectangle', [point(10, 170), point(20, 140)], 1],
  ['triangle', [point(10, 170), point(20, 140), point(30, 160)], 2],
  ['parallelogram', [point(10, 170), point(20, 160), point(30, 140)], 2],
  ['circle', [point(10, 170), point(20, 140)], 1],
  ['arrow', [point(10, 170), point(20, 140)], 1],
  ['horizontalRay', [point(10, 170)], 0],
  ['horizontalSegment', [point(10, 170), point(20, 170)], 1],
  ['verticalLine', [point(10, 170)], 0],
  ['verticalRay', [point(10, 170)], 0],
  ['verticalSegment', [point(10, 170), point(10, 140)], 1],
  ['linePrimitive', [point(10, 170), point(20, 140)], 1],
  ['trendAngle', [point(10, 170), point(20, 140)], 1],
  ['threeWaves', [point(10, 170), point(20, 140), point(30, 160), point(40, 130)], 3],
  ['fiveWaves', [point(10, 170), point(20, 140), point(30, 160), point(40, 130), point(50, 150), point(60, 120)], 5],
  ['eightWaves', Array.from({ length: 9 }, (_, index) => point(10 + index * 10, 170 - index * 5)), 8],
  ['anyWaves', [point(10, 170), point(20, 140), point(30, 160)], 2]
];
const originalTimeScale = context.proChart.chart.timeScale;
context.proChart.chart.timeScale = () => ({ ...originalTimeScale(), width: () => 1000 });
editCases.forEach(([type, points, pointIndex], index) => {
  const id = `edit-${type}`;
  const drawing = { id, label: type, parts: [], visible: true, locked: false, edit: { type, series, points: points.map(item => ({ ...item })) } };
  context.proChart.drawings = [drawing];
  context.proChart.selectedDrawingId = id;
  context.state.tool = 'cursor';
  const selected = drawing.edit.points[pointIndex];
  const original = { ...selected };
  const startX = selected.time * 10, startY = 200 - selected.price;
  context.beginDrawingEdit(event(startX, startY));
  assert.equal(context.proChart.editingDrawing?.pointIndex, pointIndex, `${type} anchor is selectable`);
  context.moveDrawingEdit(event(startX + 10, startY + 10));
  context.endDrawingEdit(event(startX + 10, startY + 10));
  const moved = drawing.edit.points[pointIndex];
  if (type === 'verticalLine') {
    assert.deepEqual(plain(moved), point(original.time + 1, original.price), `${type} preserves price while moving time`);
  } else if (type === 'verticalSegment') {
    assert.deepEqual(plain(moved), point(original.time, original.price - 10), `${type} preserves the shared time column`);
  } else {
    assert.deepEqual(plain(moved), point(original.time + 1, original.price - 10), `${type} moves selected anchor`);
  }
  if (type === 'horizontalSegment') assert.ok(drawing.edit.points.every(item => item.price === moved.price));
  if (type === 'verticalSegment') assert.ok(drawing.edit.points.every(item => item.time === drawing.edit.points[0].time));
  const runManagerAction = action => {
    const button = { dataset: { drawingAction: action }, closest: () => ({ dataset: { drawingId: id } }) };
    context.handleDrawingManagerAction({ target: { closest: () => button } });
  };
  runManagerAction('visibility');
  assert.equal(drawing.visible, false, `${type} can be hidden`);
  runManagerAction('visibility');
  assert.equal(drawing.visible, true, `${type} can be shown again`);
  drawing.locked = true;
  context.beginDrawingEdit(event(startX + 10, startY + 10));
  assert.equal(context.proChart.editingDrawing, null, `${type} stays locked`);
  runManagerAction('remove');
  assert.ok(context.proChart.drawings.includes(drawing), `${type} cannot be deleted while locked`);
  runManagerAction('lock');
  runManagerAction('remove');
  assert.ok(!context.proChart.drawings.includes(drawing), `${type} can be deleted after unlocking`);
});

// Wave labels are user-facing sequence numbers, so they start at one rather than the array index.
context.proChart.drawings = [{ id: 'numbered-wave', label: '三浪标注', parts: [], visible: true, locked: false,
  edit: { type: 'threeWaves', points: [point(10, 170), point(20, 140), point(30, 160), point(40, 130)] } }];
context.proChart.selectedDrawingId = 'numbered-wave';
vm.runInContext(source('renderDrawingOverlay'), context);
context.renderDrawingOverlay();
assert.deepEqual(nodes.filter(node => node.tag === 'text').map(node => node.text), ['(1)', '(2)', '(3)', '(4)']);

// SVG 坐标适配必须跟随实际尺寸、裁切窗口和已揭示数据，不能按屏幕百分比保存锚点。
let fallbackBounds = { width: 500, height: 400 };
const fallbackRows = Array.from({ length: 20 }, (_, index) => ({ time: index * 60 }));
const fallback = context.createFallbackDrawingSurface({ getBoundingClientRect: () => fallbackBounds }, svg,
  fallbackRows, 5, 10, { x: 10, y: 40, w: 400, h: 200 }, 500, 400, 100, 200);
context.proChart.fallback = fallback;
context.proChart.visibleRows = fallbackRows;
context.state.dataMode = 'live';
context.state.chartType = 'candles';
assert.equal(context.drawingTimeCoordinate({ time: 300, price: 150 }), 20);
assert.equal(context.drawingTimeCoordinate({ time: 1200, price: 150 }), null, 'hidden future timestamp has no coordinate');
assert.equal(fallback.chart.timeScale().coordinateToTime(0), 300);
assert.equal(fallback.chart.timeScale().coordinateToTime(400), 840);
assert.equal(fallback.chart.timeScale().coordinateToTime(401), null, 'price axis is outside drawing surface');
assert.equal(fallback.series.priceToCoordinate(150), 100);
assert.equal(fallback.series.coordinateToPrice(100), 150);
assert.deepEqual(plain(context.drawingEventPoint(event(30, 140))), { x: 20, y: 100 });
fallbackBounds = { width: 250, height: 800 };
context.drawingSurface();
assert.equal(context.drawingTimeCoordinate({ time: 300, price: 150 }), 10, 'width changes remap time');
assert.equal(fallback.series.priceToCoordinate(150), 200, 'height changes remap price');
assert.equal(fallback.series.coordinateToPrice(200), 150, 'price roundtrip survives resizing');
assert.deepEqual(plain(context.drawingEventPoint(event(15, 280))), { x: 10, y: 200 });

context.window = {};
context.proChart.drawings = [];
context.proChart.editingDrawing = null;
context.proChart.trendPoint = null;
context.proChart.fibPoint = null;
context.proChart.measurePoint = null;
context.proChart.shapePoints = [];
context.syncAnyWavesFinishControl = () => {};
context.syncDrawingToolButtons = () => {};
vm.runInContext(source('finishAnyWaves'), context);
const createCases = {
  hline: 1, horizontalRay: 1, horizontalSegment: 2, verticalLine: 1, verticalRay: 1, verticalSegment: 2,
  trendline: 2, straightLine: 2, straightRay: 2, straightSegment: 2, trendAngle: 2, fib: 2, measure: 2,
  rectangle: 2, circle: 2, arrow: 2, triangle: 3, parallelogram: 3, threeWaves: 4, fiveWaves: 6, eightWaves: 9, anyWaves: 3
};
for (const [tool, count] of Object.entries(createCases)) {
  context.state.tool = tool;
  const before = context.proChart.drawings.length;
  for (let index = 0; index < count; index++) context.handleDrawingToolClick(event(20 + index * 18, 180 + index % 2 * 60));
  if (tool === 'anyWaves') context.finishAnyWaves();
  assert.equal(context.proChart.drawings.length, before + 1, `fallback ${tool} creates one managed object`);
  const created = context.proChart.drawings.at(-1);
  assert.equal(created.visible, true);
  if (tool.startsWith('straight')) assert.equal(created.edit.extent, tool, 'line/ray/segment retain distinct extents');
  context.renderDrawingOverlay();
  assert.ok(nodes.length > 0, `fallback ${tool} renders`);
}
context.state.tool = 'cursor';
const hidden = context.proChart.drawings.at(-1);
hidden.visible = false;
context.proChart.selectedDrawingId = hidden.id;
context.proChart.editingDrawing = null;
context.beginDrawingEdit(event(20, 180));
assert.equal(context.proChart.editingDrawing, null, 'hidden drawings cannot be edited');
console.log('chart-drawings: passed (professional edits, SVG coordinates and all 22 tools)');
