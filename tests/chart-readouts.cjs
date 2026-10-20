// 运行：node tests/chart-readouts.cjs。读数计算、字段完整性及无未来数据回归。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const state = {
  sma: {5:true,10:true,20:true,60:true,120:true}, volumeSma: {5:true,10:true,20:true}, show20:true, show60:true,
  indicator: {rsi:true,macd:true,kdj:true,bb:true,psar:true},
  indicatorParams: {rsi:{period:14},macd:{fast:12,slow:26,signal:9},kdj:{period:9,k:3,d:3},bb:{period:20,multiplier:2},psar:{step:.02,max:.2}}
};
const ctx = vm.createContext({state, Intl});
for (const name of ['ema','sma','formatVolume','calcParabolicSar','calcRsi','calcKdj','calcMacd','calcBollinger','calculateChartReadoutData','chartReadoutGroups']) {
  const start = html.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, name);
  vm.runInContext(html.slice(start, html.indexOf('\n    function ', start + 1)), ctx);
}
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
// 手算 MACD(2,3,2)：首值为0，第2根 DIF=1/6、DEA=1/9、柱=1/18。
const macd = ctx.calcMacd([1,2,3],{fast:2,slow:3,signal:2});
near(macd.dif[0],0); near(macd.dif[1],1/6); near(macd.dea[1],1/9); near(macd.histogram[1],1/18);
near(macd.dif[2],11/36); near(macd.dea[2],13/54); near(macd.histogram[2],7/108);
const boll = ctx.calcBollinger([1,2,3,4],{period:3,multiplier:2});
assert.equal(boll[1],null); near(boll[2].mid,2); near(boll[2].upper,2+2*Math.sqrt(2/3)); near(boll[2].lower,2-2*Math.sqrt(2/3));
const raw = JSON.parse(fs.readFileSync(path.join(__dirname,'..','btc-usdt-1h.json'),'utf8'));
const rows = raw.slice(0,499).map(r=>({open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5]}));
const all = ctx.calculateChartReadoutData(rows);
// 完整已揭示历史和任意前缀在同一时间的读数相同，后续价格不能回写旧值。
for (const count of [1,8,14,20,60,120,240,499]) {
  const prefix = rows.slice(0,count), data = ctx.calculateChartReadoutData(prefix);
  assert.deepEqual(ctx.chartReadoutGroups(prefix,count-1,data),ctx.chartReadoutGroups(rows,count-1,all));
}
const warm = ctx.chartReadoutGroups(rows,0,all);
assert.equal(warm.rsi[0].value,'—'); assert.equal(warm.kdj[0].value,'—'); assert.equal(warm.main.find(x=>x.label==='MA120').value,'—');
const groups = ctx.chartReadoutGroups(rows,150,all);
assert.deepEqual(Array.from(groups.macd,x=>x.label),['MACD(12,26,9) DIF','DEA','柱']);
assert.equal(groups.macd[0].value,all.macd.dif[150].toFixed(2));
assert.equal(groups.macd[1].value,all.macd.dea[150].toFixed(2));
assert.equal(groups.macd[2].value,all.macd.histogram[150].toFixed(2));
assert.equal(groups.main.find(x=>x.label==='中').value,all.bb[150].mid.toFixed(2));
assert.equal(groups.main.some(x=>x.label.startsWith('VOL')),false);
state.indicatorParams.macd={fast:10,slow:30,signal:5};
const changed=ctx.calculateChartReadoutData(rows);
assert.notEqual(changed.macd.dea[150],all.macd.dea[150]);
assert.equal(ctx.chartReadoutGroups(rows,150,changed).macd[0].label,'MACD(10,30,5) DIF');
Object.keys(state.indicator).forEach(key=>state.indicator[key]=false);
const off=ctx.chartReadoutGroups(rows,150,ctx.calculateChartReadoutData(rows));
assert.equal(off.macd.length+off.rsi.length+off.kdj.length,0);
console.log('PASS: MACD/BOLL hand values, readout fields, warm-up, parameter changes, disabled panes and historical prefix invariance.');
