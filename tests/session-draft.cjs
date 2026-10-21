// 运行：node tests/session-draft.cjs。验证页面实际草稿校验器，不访问浏览器存储。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(html, /id="replayBarsKpi">24 \/ 60<\/strong>/, 'Initial replay KPI must use the default 60-bar session length');
assert.match(html, /id="blindCaption">第 24 \/ 60 根/, 'Initial blind replay caption must use the default 60-bar session length');
assert.doesNotMatch(html, /24 \/ 72|第 24 \/ 72 根/, 'Initial replay UI must not show a stale 72-bar session length');
const replayStart = html.indexOf('    function getHistoricalReplay() {');
const replayEnd = html.indexOf('\n    function buildData(', replayStart);
assert.notEqual(replayStart, -1, 'Missing getHistoricalReplay');
assert.notEqual(replayEnd, -1, 'Cannot find end of getHistoricalReplay');
const historicalRows = Array.from({ length: 80 }, (_, i) => ({ openTime: i, close: i < 24 ? 100 + i : 900 + i }));
const replayState = { sessionStart: 0, sessionLength: 60, revealCount: 24 };
const replayContext = vm.createContext({ historicalRows, state: replayState });
const getHistoricalReplay = vm.runInContext(`(() => {\n  ${html.slice(replayStart, replayEnd)}\n  return getHistoricalReplay;\n})()`, replayContext);
const initialVisible = getHistoricalReplay();
assert.equal(initialVisible.length, 24, 'A new replay must expose only the first 24 bars');
assert.equal(initialVisible.at(-1).close, 123, 'Visible bars must not include hidden suffix values');
replayState.revealCount = 25;
const advancedVisible = getHistoricalReplay();
assert.equal(advancedVisible.length, 25, 'Advancing once must expose exactly one additional bar');
assert.equal(advancedVisible.at(-1).close, 924, 'The next bar should be revealed only after advancing');
assert.equal(replayState.sessionLength, 60, 'Advancing must not change the replay session length');
assert.equal(historicalRows.length, 80, 'Advancing must not truncate the underlying historical dataset');
const start = html.indexOf('    function normalizeSessionDraft(draft) {');
assert.notEqual(start, -1, 'Missing normalizeSessionDraft');
const end = html.indexOf('\n    function showSessionSaveProblem', start);
assert.notEqual(end, -1, 'Cannot find end of normalizeSessionDraft');
const source = html.slice(start, end).trim();
const normalize = vm.runInNewContext(`(() => {
  const sessionFieldIds = ['simMargin', 'simLeverage', 'simStop', 'simTarget', 'decisionDirection', 'decisionInvalidation', 'decisionTarget', 'decisionRisk', 'decisionReason'];
  ${source}
  return normalizeSessionDraft;
})()`);
const fingerprintStart = html.indexOf('    function historicalDatasetFingerprint(rows) {');
const fingerprintEnd = html.indexOf('\n    function currentReplayDataset()', fingerprintStart);
assert.notEqual(fingerprintStart, -1, 'Missing historicalDatasetFingerprint');
assert.notEqual(fingerprintEnd, -1, 'Cannot find replay dataset fingerprint helpers');
const { historicalDatasetFingerprint, replayDatasetMatches } = vm.runInNewContext(`(() => {
  ${html.slice(fingerprintStart, fingerprintEnd)}
  return { historicalDatasetFingerprint, replayDatasetMatches };
})()`);
assert.match(html, /if \(!replayDatasetMatches\(d, rows\) \|\| c\.sessionStart \+ c\.sessionLength \+ TRAINING_WARMUP > rows\.length\)/, 'Restoration must reject changed replay history or a session without its warmup range');
assert.match(html, /旧版回放草稿没有历史数据校验信息/, 'Legacy replay drafts must explain why they cannot be resumed');
assert.match(html, /exportSessionDraftBackup\(\)/, 'Legacy recovery must provide a draft backup export action');
assert.match(html, /已触发备份下载，原草稿仍保留/, 'Exporting a legacy draft must explicitly preserve the original');
assert.match(html, /旧版回放草稿无法校验历史数据。若尚未备份，请先导出/, 'Deleting a legacy draft must require explicit confirmation');
assert.match(html, /本地历史数据校验不匹配，不能安全续接原回放/, 'Changed replay history must explain why continuation was blocked');
const discardHandlerStart = html.indexOf("document.getElementById('discardSessionDraft').addEventListener('click'");
const discardHandlerEnd = html.indexOf("document.getElementById('exportSessionDraft').addEventListener", discardHandlerStart);
assert.notEqual(discardHandlerStart, -1, 'Missing blocked draft discard handler');
assert.notEqual(discardHandlerEnd, -1, 'Cannot find end of blocked draft discard handler');
const discardHandler = html.slice(discardHandlerStart, discardHandlerEnd);
function discardDraft({ legacy = true, accept = true, storageFails = false } = {}) {
  const calls = [], status = { hidden: false };
  const context = { sessionDraftLegacyRecovery: legacy, sessionDraftKey: 'draft',
    sessionLastSavedValue: 'old', sessionPersistenceDirty: true, sessionPersistenceBlocked: true,
    window: { confirm: () => accept },
    localStorage: { removeItem(key) { if (storageFails) throw new Error('storage denied'); calls.push(['remove', key]); } },
    location: { reload() { calls.push(['reload']); } },
    openTrainingSetup() { calls.push(['setup']); },
    showSessionSaveProblem(...args) { calls.push(['error', ...args]); },
    document: { getElementById(id) { return id === 'discardSessionDraft'
      ? { addEventListener(type, handler) { handler(); } } : status; } }
  };
  vm.runInNewContext(discardHandler, context);
  return { calls, status, context };
}
const discardedLegacy = discardDraft();
assert.deepEqual(discardedLegacy.calls, [['remove', 'draft'], ['setup']]);
assert.equal(discardedLegacy.context.sessionLastSavedValue, null);
assert.equal(discardedLegacy.context.sessionPersistenceBlocked, false);
assert.equal(discardedLegacy.status.hidden, true);
assert.deepEqual(discardDraft({ accept: false }).calls, [], 'Cancelling must preserve the draft');
const failedDiscard = discardDraft({ storageFails: true });
assert.equal(failedDiscard.calls[0][0], 'error');
assert.equal(failedDiscard.context.sessionPersistenceBlocked, true, 'Failed deletion must keep recovery blocked');
assert.deepEqual(discardDraft({ legacy: false }).calls, [['remove', 'draft'], ['reload']],
  'Discarding an active/conflicting nonlegacy draft must reload so old in-memory positions cannot be saved again');

const resetGuardStart = html.indexOf('    function replayResetNeedsConfirmation(work) {');
const resetGuardEnd = html.indexOf('\n    function confirmReplayReset()', resetGuardStart);
assert.notEqual(resetGuardStart, -1, 'Missing replay reset confirmation guard');
assert.notEqual(resetGuardEnd, -1, 'Cannot find end of replay reset confirmation guard');
const replayResetNeedsConfirmation = vm.runInNewContext(`(() => {
  const initialReplayReveal = length => Math.min(24, Math.max(8, Number(length) - 2));
  ${html.slice(resetGuardStart, resetGuardEnd)}
  return replayResetNeedsConfirmation;
})()`);
const resetWork = overrides => ({ hasPosition: false, hasSessionTrades: false, activeSession: true,
  decisionCount: 0, revealCount: 24, sessionLength: 60, hasFormDraft: false, ...overrides });
assert.equal(replayResetNeedsConfirmation(resetWork({ activeSession: false })), false, 'No active session must not prompt');
assert.equal(replayResetNeedsConfirmation(resetWork({ activeSession: true })), false, 'An untouched session must not prompt');
assert.equal(replayResetNeedsConfirmation(resetWork({ revealCount: 8, sessionLength: 10 })), false, 'A short session starts with 8 revealed candles without counting as user progress');
assert.equal(replayResetNeedsConfirmation(resetWork({ revealCount: 9, sessionLength: 10 })), true, 'Progress after the short-session start must request confirmation');
for (const [label, overrides] of [
  ['open position', { hasPosition: true }],
  ['session trade', { hasSessionTrades: true }],
  ['saved decision', { decisionCount: 1 }],
  ['replay progress', { revealCount: 25 }],
  ['unsubmitted form', { hasFormDraft: true }]
]) {
  assert.equal(replayResetNeedsConfirmation(resetWork(overrides)), true, `${label} must require confirmation`);
}

function draft() {
  return {
    version: 1,
    workspace: 'replay',
    context: {
      scenario: 'up', timeframe: '1H', dataMode: 'sim', replayMode: true, replayPaused: true,
      sessionLength: 60, revealCount: 25, sessionStart: 0, instrument: 'BTC-USDT-SWAP', chartType: 'candles'
    },
    account: {
      balance: 9987.5, initialBalance: 10000, realized: -12.5, side: 'long',
      position: { side: 1, entry: 100, qty: 1, margin: 50, leverage: 2, entryFee: 0.04, openReveal: 24, stop: 95, target: 110 },
      trades: [{ side: 'long', entry: 101, exit: 99, pnl: -2 }], log: ['已开仓']
    },
    replay: {
      id: 'test-session', mode: 'blind', saved: false,
      decisions: [{ beforeReveal: 24, referencePrice: 100, direction: 'up', evidence: ['结构', 'EMA', '量能', 'RSI'],
        invalidation: 95, target: 110, rewardRisk: 2, risk: 'defined', reason: '结构和量能确认' }]
    },
    fields: { decisionDirection: 'up', decisionReason: '尚未提交的理由' },
    evidence: ['结构', 'EMA', '量能', 'RSI'],
    events: [['第 25 根', '等待', '100.0', '记录']]
  };
}

const restored = normalize(draft());
assert.deepEqual(Array.from(restored.evidence), ['结构', 'EMA', '量能', 'RSI']);
assert.deepEqual(Array.from(restored.replay.decisions[0].evidence), ['结构', 'EMA', '量能', 'RSI']);
assert.equal(restored.account.position.entry, 100);
assert.equal(restored.account.balance, 9987.5);
assert.equal(restored.fields.decisionReason, '尚未提交的理由');
assert.equal(restored.events[0][1], '等待');
const heikinDraft = draft(); heikinDraft.context.chartType = 'heikin';
assert.equal(normalize(heikinDraft).context.chartType, 'heikin', 'Heikin Ashi view choice is valid in a resumable session');
const unsupportedChartTypeDraft = draft(); unsupportedChartTypeDraft.context.chartType = 'unknown';
assert.throws(() => normalize(unsupportedChartTypeDraft), /草稿行情位置无效/, 'Unsupported chart type drafts must be rejected');
const shortSessionDraft = draft();
shortSessionDraft.context.sessionLength = 10;
shortSessionDraft.context.revealCount = 8;
shortSessionDraft.replay.decisions = [];
assert.equal(normalize(shortSessionDraft).context.sessionLength, 10, 'Valid short custom sessions must remain resumable');
const tooShortSessionDraft = draft();
tooShortSessionDraft.context.sessionLength = 9;
tooShortSessionDraft.context.revealCount = 8;
tooShortSessionDraft.replay.decisions = [];
assert.throws(() => normalize(tooShortSessionDraft), /草稿行情位置无效/, 'Drafts below the 10-candle minimum must be rejected');

const invalidEvidence = draft();
invalidEvidence.evidence = ['structure'];
assert.deepEqual(Array.from(normalize(invalidEvidence).evidence), []);
assert.throws(() => normalize({ ...draft(), replay: { ...draft().replay, decisions: [{ ...draft().replay.decisions[0], evidence: ['structure'] }] } }), /草稿回放判断无效/);

const invalidPosition = draft();
invalidPosition.account.position.leverage = 21;
assert.throws(() => normalize(invalidPosition), /草稿持仓无效/);
const invalidContext = draft();
invalidContext.context.revealCount = 61;
assert.throws(() => normalize(invalidContext), /草稿行情位置无效/);

const rows = [
  { openTime: 1000, closeTime: 1999, open: 10, high: 12, low: 9, close: 11, volume: 20 },
  { openTime: 2000, closeTime: 2999, open: 11, high: 13, low: 10, close: 12, volume: 25 },
  { openTime: 3000, closeTime: 3999, open: 12, high: 14, low: 11, close: 13, volume: 30 }
];
const snapshot = { length: rows.length, first: rows[0].openTime, last: rows.at(-1).openTime, fingerprint: historicalDatasetFingerprint(rows) };
assert.equal(replayDatasetMatches(snapshot, rows), true);
assert.equal(replayDatasetMatches({ ...snapshot }, rows.map(row => ({ ...row }))), true);
const changedMiddleCandle = rows.map(row => ({ ...row }));
changedMiddleCandle[1].close = 11.5;
assert.equal(replayDatasetMatches(snapshot, changedMiddleCandle), false, 'Interior OHLC changes must invalidate replay continuation');
const changedVolume = rows.map(row => ({ ...row }));
changedVolume[1].volume++;
assert.equal(replayDatasetMatches(snapshot, changedVolume), false, 'Volume changes must invalidate replay continuation');
assert.equal(replayDatasetMatches({ length: rows.length, first: rows[0].openTime, last: rows.at(-1).openTime }, rows), false, 'Legacy snapshots without a fingerprint must not be trusted');

console.log('PASS: session draft validation and replay reset confirmation guard, including position, trade, decision, progress, and unsubmitted form states.');
