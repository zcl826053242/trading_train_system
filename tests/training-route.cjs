// 运行：node tests/training-route.cjs。直接执行应用函数，覆盖路线、进度与无损续接。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function source(name) {
  const start = html.search(new RegExp(`^    function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing function ${name}`);
  const body = html.slice(start);
  const end = body.search(/^    }\r?$/m);
  return body.slice(0, end + 5);
}
function harness() {
  const definitionsStart = html.indexOf('    const stageDefinitions = [');
  const definitionsEnd = html.indexOf('    const knowledgeSequences', definitionsStart);
  const calls = [], elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { focus: () => calls.push(['focus', id]), scrollIntoView() {}, open: false });
    return elements.get(id);
  };
  const stageState = { active: 0, foundationStarted: false, foundationComplete: false, foundationStep: 0,
    progress: Array.from({ length: 3 }, () => ({ questions: 0, correct: 0, trades: 0, checks: 0, replay: false })) };
  const state = { dataMode: 'sim', replayMode: false, lesson: 0, replayPaused: false, revealCount: 24, sessionLength: 60 };
  const c = vm.createContext({ state, stageState, lessonData: [{}, {}, {}],
    replayTraining: { id: '', saved: false, mode: 'blind', decisions: [] }, sim: { position: null, balance: 10000 },
    document: { getElementById: get, querySelector: () => get('help'), body: { classList: { add() {}, remove() {} } } },
    window: { matchMedia: () => ({ matches: false }) }, requestAnimationFrame: f => f(),
    setDataMode: mode => { calls.push(['source', mode]); if (!c.accept) return false; state.dataMode = mode; state.replayMode = false; return true; }, accept: true,
    setWorkspace: name => calls.push(['workspace', name]), saveStageState: () => calls.push(['save']),
    renderStagePanel() {}, renderTrainingHome() {},
    setLesson: index => { state.lesson = index; calls.push(['lesson', index]); },
    renderQuestion: index => calls.push(['question', index]), nextStageQuestionIndex: () => 1, stageQuestionRange: () => [0, 3],
    openTrainingSetup: options => calls.push(['setup', options.mode])
  });
  // 两个原有帮助函数是单行定义，独立抽取，避免执行后续初始化代码。
  const oneLine = name => html.match(new RegExp(`^    function ${name}\\(.*$`, 'm'))[0];
  vm.runInContext(html.slice(definitionsStart, definitionsEnd) + '\n' +
    [oneLine('stageIsComplete'), oneLine('needsFoundationLesson'), ...[
      'stageCompletionPercent', 'canResumeStageReplay', 'getTrainingRoute', 'continueTrainingRoute', 'advanceGuidedLesson', 'updateRiskSurface'
    ].map(source)].join('\n'), c);
  return { c, calls, stageState, state, get };
}
for (let index = 0; index < 3; index++) {
  const { c, stageState } = harness(); stageState.active = index;
  assert.equal(c.stageCompletionPercent(index), 0, 'A clean stage must start at 0%');
  Object.assign(stageState.progress[index], { questions: 100, correct: 100, trades: 100, checks: 100 });
  assert.equal(c.stageCompletionPercent(index), index === 2 ? 80 : 100);
  stageState.progress[index].replay = true;
  assert.equal(c.stageCompletionPercent(index), 100);
}
{
  const { c, stageState } = harness();
  const initialIds = Array.from(c.getTrainingRoute().steps, step => step.id);
  assert.deepEqual(initialIds, ['foundation', 'questions', 'trades', 'checks']);
  assert.equal(c.getTrainingRoute().current.id, 'foundation');
  stageState.foundationComplete = true;
  assert.deepEqual(Array.from(c.getTrainingRoute().steps, step => step.id), initialIds, 'Finishing concepts must not renumber the route');
  assert.equal(c.getTrainingRoute().current.id, 'questions');
  Object.assign(stageState.progress[0], { questions: 3, correct: 1 });
  assert.equal(c.getTrainingRoute().current.id, 'questions', 'A question count alone must not skip the correctness requirement');
  assert.match(c.getTrainingRoute().current.label, /补齐/);
  stageState.progress[0].correct = 2;
  assert.equal(c.getTrainingRoute().current.id, 'trades');
  stageState.progress[0].trades = 1;
  assert.equal(c.getTrainingRoute().current.id, 'checks');
  stageState.progress[0].checks = 1;
  assert.equal(c.getTrainingRoute().current, null);
}
{
  const { c, stageState } = harness(); stageState.progress[0].questions = 1;
  const concept = c.getTrainingRoute().steps[0];
  assert.equal(concept.skipped, true, 'Old question progress is compatible without pretending concepts were completed');
  assert.match(concept.detail, /补学/);
  assert.equal(c.getTrainingRoute().current.id, 'questions');
}
for (const replay of [false, true]) {
  const { c, calls, stageState, state } = harness();
  Object.assign(stageState.progress[0], { questions: 3, correct: 2 });
  state.replayMode = replay;
  c.sim.position = { entry: 100, side: 'long' };
  c.replayTraining.id = 'existing-session';
  const before = JSON.stringify({ state, account: c.sim, replay: c.replayTraining });
  c.continueTrainingRoute();
  assert.equal(JSON.stringify({ state, account: c.sim, replay: c.replayTraining }), before);
  assert.ok(!calls.some(call => call[0] === 'source'), 'Continuing a simulation must never reset a replay or account');
  assert.ok(calls.some(call => call[0] === 'workspace' && call[1] === (replay ? 'replay' : 'market')));
}
{
  const { c, calls, stageState, state } = harness();
  stageState.active = 1;
  Object.assign(stageState.progress[1], { questions: 6, correct: 4 });
  Object.assign(state, { replayMode: true });
  Object.assign(c.replayTraining, { id: 'completed-session', mode: 'blind', saved: true });
  assert.equal(c.getTrainingRoute().current.id, 'trades');
  assert.equal(c.getTrainingRoute().current.label, '开始模拟操盘', 'A saved replay must not be advertised as an active trading session');
  c.continueTrainingRoute();
  assert.equal(state.replayMode, false, 'Completed replay context must be left before entering a new simulation trade task');
  assert.deepEqual(calls, [['source', 'sim'], ['workspace', 'market']]);
}
for (const paused of [false, true]) for (const count of [25, 60]) {
  const { c, calls, stageState, state } = harness();
  stageState.active = 2;
  Object.assign(stageState.progress[2], { questions: 10, correct: 7, trades: 5, checks: 5 });
  Object.assign(state, { replayMode: true, replayPaused: paused, revealCount: count });
  Object.assign(c.replayTraining, { id: 'blind-draft', decisions: [{ reason: '尚未结束的判断' }] });
  c.sim.position = { entry: 100 };
  const before = JSON.stringify({ state, account: c.sim, replay: c.replayTraining });
  assert.match(c.getTrainingRoute().current.label, count === 60 ? /复盘/ : /继续/);
  c.continueTrainingRoute();
  assert.equal(JSON.stringify({ state, account: c.sim, replay: c.replayTraining }), before, 'Resume must preserve pause, bars, position and decisions');
  assert.deepEqual(calls.filter(call => ['workspace', 'setup', 'source'].includes(call[0])), [['workspace', 'replay']]);
}
for (const mode of ['free', 'blind']) {
  const { c, calls, stageState, state } = harness();
  Object.assign(stageState.progress[0], { questions: 3, correct: 2, trades: 1 });
  state.replayMode = true; c.replayTraining.id = 'old'; c.replayTraining.mode = mode;
  c.replayTraining.saved = mode === 'blind';
  c.continueTrainingRoute();
  assert.deepEqual(calls, [['setup', 'blind']], 'Free or saved sessions cannot masquerade as unfinished blind tasks');
}
{
  const { c, calls, stageState, state } = harness(); state.dataMode = 'live'; c.accept = false;
  c.continueTrainingRoute();
  assert.equal(stageState.foundationStarted, false);
  assert.deepEqual(calls, [['source', 'sim']], 'Cancelling a concept context switch must not advance progress or change workspace');
  c.accept = true; calls.length = 0; c.continueTrainingRoute();
  assert.equal(state.dataMode, 'sim'); assert.equal(stageState.foundationStarted, true);
  assert.ok(calls.some(call => call[0] === 'lesson' && call[1] === 0));
}
{
  const { c, stageState, state, calls } = harness(); stageState.foundationStarted = true;
  c.advanceGuidedLesson(); assert.equal(stageState.foundationStep, 1); assert.equal(state.lesson, 1);
  c.advanceGuidedLesson(); assert.equal(stageState.foundationStep, 2); assert.equal(stageState.foundationComplete, false);
  c.advanceGuidedLesson(); assert.equal(stageState.foundationComplete, true); assert.equal(stageState.foundationStarted, false);
  assert.ok(calls.some(call => call[0] === 'workspace' && call[1] === 'practice'));
  assert.equal(c.getTrainingRoute().current.id, 'questions');
}
assert.match(html, /done = stageCompletionPercent\(stageState.active\) \/ 100/, 'Stage panel must share the home progress formula');
for (let index = 0; index < 3; index++) for (const count of [25, 60]) {
  const { c, calls, stageState, state } = harness(); stageState.active = index;
  stageState.foundationComplete = true;
  Object.assign(stageState.progress[index], { questions: 100, correct: 100, trades: 100, checks: 100, replay: true });
  Object.assign(state, { replayMode: true, revealCount: count });
  c.replayTraining.id = 'still-unsaved';
  assert.equal(c.stageIsComplete(index), true, 'Stage thresholds stay independent from session completion');
  assert.equal(c.getTrainingRoute().current.id, 'session', 'A passed stage must still offer its unsaved blind session');
  c.continueTrainingRoute();
  assert.equal(stageState.active, index, 'Continue must not silently switch stage while a blind session awaits review');
  assert.deepEqual(calls, [['workspace', 'replay'], ['focus', count === 60 ? 'replayFinish' : 'workspaceDecision']]);
  c.replayTraining.saved = true; calls.length = 0;
  assert.equal(c.getTrainingRoute().current, null);
  c.continueTrainingRoute();
  assert.equal(stageState.active, Math.min(2, index + 1));
  assert.ok(calls.some(call => call[0] === 'workspace' && call[1] === (index < 2 ? 'practice' : 'review')));
}
{
  const { c, get } = harness();
  const set = values => Object.entries(values).forEach(([id, value]) => { get(id).value = String(value); });
  set({ riskAccount: 10000, riskPerTrade: 1, riskStopDistance: 2, riskLeverage: 2 });
  c.updateRiskSurface();
  assert.equal(get('riskLossOut').textContent, '-100');
  assert.equal(get('riskNotionalOut').textContent, '5,000');
  assert.equal(get('riskMarginOut').textContent, '2,500');
  assert.equal(get('riskOnePctOut').textContent, '-50');
  set({ riskLeverage: 10 }); c.updateRiskSurface();
  assert.equal(get('riskMarginOut').textContent, '500');
  assert.equal(get('riskLossOut').textContent, '-100', 'Higher leverage cannot enlarge a fixed loss budget');
  assert.equal(get('riskNotionalOut').textContent, '5,000');
  set({ riskStopDistance: 4 }); c.updateRiskSurface();
  assert.equal(get('riskNotionalOut').textContent, '2,500', 'A wider stop must reduce the position for the same risk budget');
  assert.equal(get('riskLossOut').textContent, '-100');
  set({ riskAccount: 1000, riskPerTrade: 5, riskStopDistance: .5, riskLeverage: 1 }); c.updateRiskSurface();
  assert.match(get('riskBudgetNote').textContent, /超过账户权益/);
  set({ riskPerTrade: .25 }); c.updateRiskSurface();
  assert.ok(!get('riskBudgetNote').textContent.includes('超过账户权益'), 'Feasible input must clear stale insufficient-margin advice');
}
console.log('PASS: shared stage progress and gates; local concepts; risk sizing/leverage invariants; lossless continuation; passed-stage session review before next stage.');
