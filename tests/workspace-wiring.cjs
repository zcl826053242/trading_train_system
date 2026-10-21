// 运行：node tests/workspace-wiring.cjs。验证工作台实际函数的切换边界与单 DOM 接线。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function source(name) {
  const start = html.search(new RegExp(`^    function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing function ${name}`);
  // 顶层函数右花括号为四空格缩进，避免把其后的事件监听一起放入测试。
  const body = html.slice(start), end = body.search(/^    }\r?$/m);
  assert.ok(end >= 0, `Missing function boundary ${name}`);
  return body.slice(0, end + 5);
}
class Element {
  constructor(id) {
    Object.assign(this, { id, value: '', checked: false, hidden: false, disabled: false, open: false,
      textContent: '', innerHTML: '', dataset: {}, children: [], parentElement: null, scrollTop: 12 });
    const classes = new Set();
    this.classList = { toggle: (name, value) => value ? classes.add(name) : classes.delete(name) };
  }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, before) {
    if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
    const index = before ? this.children.indexOf(before) : this.children.length;
    assert.ok(index >= 0, 'Reference must belong to the parent');
    this.children.splice(index, 0, node); node.parentElement = this; return node;
  }
  querySelector(selector) { return this.children.find(node => node.selector === selector) || null; }
  showModal() { this.open = true; }
  focus(options) { this.focusOptions = options; }
}
function harness() {
  const elements = new Map(), calls = [];
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const evidence = [new Element('structure')];
  const state = { replayMode: true, dataMode: 'sim', timeframe: '1H', scenario: 'range', revealCount: 25,
    sessionLength: 60, sessionStart: 100, replayPaused: true, liveRows: [{ close: 100 }] };
  const sim = { initialBalance: 10000, balance: 9749, realized: -1, position: { side: 'long', entry: 100 },
    log: ['opened'], trades: [{ id: 'saved-trade', sessionId: 'old-session' }] };
  const replayTraining = { id: 'session-1', mode: 'blind', decisions: [{ direction: 'up' }], saved: false, completedAt: 123 };
  const drawingButtons = ['cursor', 'trendline'].map(tool => {
    const button = new Element(tool); button.dataset.tool = tool; button.attributes = {};
    button.classList = { toggle() {} }; button.setAttribute = () => {};
    return button;
  });
  const c = vm.createContext({
    state, sim, replayTraining, liveRefreshTimer: 7,
    proChart: { editingDrawing: {}, measurePoint: {}, shapePoints: [{}], measurePreview: {}, fibPoint: {}, trendPoint: {} },
    liveBars: { '1m': '1m', '5m': '5m', '15m': '15m', '1H': '1H', '4H': '4H', '1D': '1D' },
    historicalByTimeframe: { '1H': [{}], '5m': [{}], '1m': [{}] },
    document: { getElementById: get, querySelectorAll: selector => selector === '[name="decisionEvidence"]' ? evidence : selector === '[data-tool]' ? drawingButtons : [],
      querySelector: selector => selector === '.layout .side' ? get('side') : null },
    window: { confirm: message => { calls.push(['confirm', message]); return c.accept; } }, accept: false,
    setInterval: () => 8, clearInterval: () => {},
    openTrainingSetup: options => calls.push(['setup', { ...options }]),
    loadLiveMarket: () => calls.push(['load']), stopLiveMarket: () => calls.push(['stop']),
    updateDataSourceUI: () => calls.push(['source']), updateSimDisplay: () => calls.push(['account']),
    renderChart: () => calls.push(['chart']), syncChartTimeframeControls: () => calls.push(['timeframes']),
    clearReplayDecision: () => {
      for (const id of ['decisionDirection', 'decisionInvalidation', 'decisionTarget', 'decisionRisk', 'decisionReason']) get(id).value = '';
      evidence.forEach(input => input.checked = false);
    },
    syncAnyWavesFinishControl: () => {},
    syncDrawingToolButtons: () => {},
    renderReplayHistory: () => {}, updateReplayGate: () => {},
    questions: [{ tag: '样本', period: '1H', title: '题目', body: '说明', chips: [['EMA', '向上', 'green']] }],
    trainingState: {}, stageState: { mode: 'guided' }, renderPracticeChart: () => {},
    setPracticeStep: () => {}, updateTrainingCoach: () => {}, renderKnowledgeChain: () => {}, updateAiCoach: () => {}
  });
  vm.runInContext(['setDataMode', 'confirmSimulationContextChange', 'resetSimulationContext', 'cancelPendingDrawingDraft', 'selectChartTimeframe',
    'setScenario', 'renderQuestion', 'syncReplayWorkspace', 'openWorkspaceRecords', 'dockWorkspaceControls'].map(source).join('\n'), c);
  return { c, get, calls, evidence, snapshot: () => JSON.stringify({ state, sim, replayTraining,
    draft: ['decisionDirection', 'decisionReason'].map(id => get(id).value), evidence: evidence.map(input => input.checked) }) };
}

// 初始化不能再监听已移除节点；使用 HTML 而非脚本内模板统计实际节点。
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const ids = [...markup.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'HTML ids must be unique');
for (const match of html.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)\.addEventListener\(/g)) {
  assert.ok(ids.includes(match[1]), `Listener target ${match[1]} is missing`);
}
assert.ok(!html.includes('revealNext'), 'Removed replay control cannot retain JS references');
assert.match(html, /workspace-session-actions\[hidden\]\s*{\s*display:\s*none\s*!important/);
assert.ok(html.includes("document.querySelectorAll('[data-time]').forEach(button => button.addEventListener('click', () => selectChartTimeframe(button.dataset.time)))"),
  'Period buttons must use the guarded entry');

// 历史无对应数据、同周期和未知周期不能修改场次；有效周期只打开设置。
for (const timeframe of ['15m', '4H', '1D', '1H', 'unknown']) {
  const { c, snapshot, calls } = harness(), before = snapshot();
  assert.equal(c.selectChartTimeframe(timeframe), false);
  assert.equal(snapshot(), before); assert.equal(calls.length, 0);
}
{
  const { c, snapshot, calls } = harness(), before = snapshot();
  c.selectChartTimeframe('5m');
  assert.equal(snapshot(), before);
  assert.deepEqual(calls, [['setup', { timeframe: '5m', mode: 'blind' }]]);
}

// 模拟换周期必须确认；实时同品种换周期保留账户，不重置持仓或已保存成交。
for (const accept of [false, true]) {
  const { c, snapshot, calls } = harness(); c.state.replayMode = false; c.accept = accept;
  const before = snapshot(), trades = c.sim.trades;
  assert.equal(c.selectChartTimeframe('5m'), accept);
  if (!accept) assert.equal(snapshot(), before);
  else {
    assert.equal(c.state.timeframe, '5m'); assert.equal(c.sim.position, null);
    assert.equal(c.sim.balance, 10000); assert.equal(c.sim.realized, 0); assert.equal(c.replayTraining.id, '');
    assert.equal(c.sim.trades, trades); assert.ok(calls.some(call => call[0] === 'chart'));
  }
}
{
  const { c, calls } = harness(); c.state.replayMode = false; c.state.dataMode = 'live';
  const account = JSON.stringify(c.sim);
  assert.equal(c.selectChartTimeframe('5m'), true);
  assert.equal(JSON.stringify(c.sim), account); assert.equal(c.state.liveRows.length, 0);
  assert.deepEqual(calls.map(call => call[0]), ['timeframes', 'load']);
}
{
  const { c } = harness(); c.state.replayMode = false; c.state.dataMode = 'live';
  c.state.tool = 'trendline'; c.state.pendingDraw = ['unfinished'];
  assert.equal(c.selectChartTimeframe('5m'), true);
  assert.equal(c.state.tool, 'cursor'); assert.equal(c.state.pendingDraw.length, 0);
  assert.equal(JSON.stringify([c.proChart.editingDrawing, c.proChart.measurePoint, c.proChart.shapePoints,
    c.proChart.measurePreview, c.proChart.fibPoint, c.proChart.trendPoint]), JSON.stringify([null, null, [], null, null, null]),
  'timeframe changes clear unfinished drawing anchors while leaving committed drawings intact');
}

// 切源取消须完整保留状态与表单，确认只重置当前账户，不删除成交档案。
for (const mode of ['sim', 'live']) for (const accept of [false, true]) {
  const { c, get, evidence, calls, snapshot } = harness(); c.accept = accept;
  get('decisionDirection').value = 'up'; get('decisionReason').value = '未提交理由'; evidence[0].checked = true;
  const before = snapshot(), trades = c.sim.trades;
  assert.equal(c.setDataMode(mode), accept);
  if (!accept) { assert.equal(snapshot(), before); assert.equal(calls.length, 1); }
  else {
    assert.equal(c.state.dataMode, mode); assert.equal(c.state.replayMode, false); assert.equal(c.state.replayPaused, false);
    assert.equal(c.sim.position, null); assert.equal(c.sim.balance, 10000); assert.equal(c.sim.realized, 0);
    assert.equal(c.sim.trades, trades); assert.equal(c.replayTraining.id, ''); assert.equal(c.replayTraining.decisions.length, 0);
    assert.equal('completedAt' in c.replayTraining, false); assert.equal(get('decisionReason').value, '');
    assert.ok(calls.some(call => call[0] === (mode === 'live' ? 'load' : 'stop')));
  }
}
{
  const { c, snapshot, calls } = harness(), before = snapshot();
  assert.equal(c.setDataMode('unsupported'), false); assert.equal(snapshot(), before); assert.equal(calls.length, 0);
}

// 场景/课程入口取消不得偷偷换情景、周期或账户；题目自身使用独立图。
for (const mode of ['replay', 'sim', 'live']) {
  const { c, snapshot } = harness();
  c.state.replayMode = mode === 'replay'; c.state.dataMode = mode === 'live' ? 'live' : 'sim';
  const before = snapshot(); assert.equal(c.setScenario('up', '5m'), false); assert.equal(snapshot(), before);
  c.renderQuestion(0); assert.equal(snapshot(), before);
}

// 回放结束前无“完成”按钮，记录与判断弹窗视图明确、焦点不使页面跳动。
{
  const { c, get } = harness();
  c.syncReplayWorkspace(); assert.equal(get('replayFinish').hidden, true); assert.equal(get('workspaceSessionActions').hidden, false);
  c.state.revealCount = 60; c.syncReplayWorkspace();
  assert.equal(get('replayFinish').hidden, false); assert.equal(get('replayFinish').disabled, false);
  c.replayTraining.saved = true; c.syncReplayWorkspace(); assert.equal(get('replayFinish').disabled, true);
  c.state.replayMode = false; c.syncReplayWorkspace();
  assert.equal(get('workspaceSessionActions').hidden, true); assert.equal(get('replayFinish').hidden, true);
  c.openWorkspaceRecords({ decision: true });
  assert.equal(get('workspaceRecordsDialog').dataset.view, 'decision'); assert.equal(get('workspaceRecordsDialog').scrollTop, 0);
  assert.equal(get('decisionDirection').focusOptions.preventScroll, true); assert.equal(get('replayPlan').open, true);
  c.openWorkspaceRecords(); assert.equal(get('workspaceRecordsDialog').dataset.view, 'records');
}

// 移动/桌面往返移动同一个 DOM，不能克隆出重复按钮或丢失交易面板。
{
  const { c, get } = harness(), side = get('side'), task = get('workspaceTask'), actions = get('workspaceSessionActions');
  const analysis = get('analysis'); analysis.selector = '.market-analysis';
  side.appendChild(get('marketTradeDock')); side.appendChild(analysis);
  for (let i = 0; i < 3; i++) {
    c.dockWorkspaceControls(true);
    assert.equal(task.parentElement, get('workspaceTaskDock')); assert.equal(actions.parentElement, task);
    assert.equal(get('workspaceSessionMore').open, false);
    c.dockWorkspaceControls(false);
    assert.equal(task.parentElement, side); assert.equal(actions.parentElement, side);
    assert.deepEqual(side.children.map(node => node.id), ['workspaceTask', 'marketTradeDock', 'workspaceSessionActions', 'analysis']);
    assert.equal(get('workspaceSessionMore').open, true);
  }
}
console.log('PASS: guarded timeframe/source/scenario switches; cancel preserves session/account/draft; records/finish/docking and HTML wiring.');
