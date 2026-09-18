/* 差距概览页测试：这一页的职责是「让人一眼看出数据差距在哪」，
   所以测四件事：① 差距算法与判定方向对不对 ② 排序有没有把最大的排前面
   ③ 表里每个指标的「本场 / 历史均值 / 品类基准 / 差距 / 判定」是不是都在
   ④ 有落后项时才出现归因段，全好时不硬凑
   node test-gap.js */
const fs = require('fs');
const DIR = 'C:/Users/24425/WorkBuddy/2026-09-14-20-29-26/';

let pass = 0, fail = 0;
function A(n, c, g) { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + '  实际: ' + JSON.stringify(g))); }
function hr(t) { console.log('\n─── ' + t); }

/* ---------- DOM 桩 ---------- */
const els = {};
function mkClassList() { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), toggle: (c, on) => { on ? s.add(c) : s.delete(c); }, contains: c => s.has(c) }; }
function mkEl(id) {
  const el = { id, tagName: 'DIV', _html: '', _text: '', _val: '', style: {}, dataset: {}, classList: mkClassList(),
    clientHeight: 200, clientWidth: 600, width: 600, height: 200, parentElement: null, files: [] };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); } });
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); } });
  Object.defineProperty(el, 'value', { get() { return el._val; }, set(v) { el._val = String(v); } });
  el.addEventListener = () => {}; el.removeEventListener = () => {}; el.appendChild = () => {};
  el.querySelectorAll = () => []; el.click = () => {}; el.focus = () => {}; el.remove = () => {};
  el.getContext = () => new Proxy({}, { get: (t, k) => (k === 'canvas' ? { width: 600, height: 200 } : () => {}), set: () => true });
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 200 });
  return el;
}
function getEl(id) { if (!els[id]) { els[id] = mkEl(id); els[id].parentElement = { clientHeight: 200, clientWidth: 600 }; } return els[id]; }
global.document = { getElementById: getEl, querySelectorAll: () => [], querySelector: () => null, createElement: t => mkEl(t), body: mkEl('body'), addEventListener: () => {}, documentElement: mkEl('html') };
global.window = { devicePixelRatio: 1, addEventListener: () => {}, print: () => {}, innerWidth: 1200 };
global.requestAnimationFrame = fn => { fn(); };
global.alert = () => {}; global.confirm = () => true; global.prompt = () => 'x';
global.navigator = { clipboard: { writeText: () => Promise.resolve() } };
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
global.Blob = function () {};
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
global.FileReader = function () { this.readAsText = () => {}; this.onload = null; };
global.self = global;

/* ---------- 拼装 ---------- */
const src = fs.readFileSync(DIR + 'engine.js', 'utf8') + '\n'
  + fs.readFileSync(DIR + 'store.js', 'utf8') + '\n'
  + [...fs.readFileSync(DIR + 'index.html', 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

hr('1. 脚本加载');
let ctx;
try {
  ctx = new Function(src + `
    return { go, setTab, STORE, ST, normalize, runDiagnosis, benchOf,
      cmpGapRows, cmpGapHead, cmpGapTable, cmpGapAttribution,
      gapOf, gapFmt, gapCls, gapJudge, benchValOf, fmtGapVal, gapBar,
      GAP_METRICS, GAP_TOL, GAP_ADVICE };`)();
  A('脚本加载无异常', true);
} catch (e) {
  A('脚本加载', false, e.message);
  console.log('\n差距概览测试：通过 ' + pass + '，失败 ' + fail);
  process.exit(1);
}
const scrollHTML = () => getEl('scroll').innerHTML;
const G = ctx;
const MINUS = '\u2212';                       // 数学减号

/* ============================================================
   2. 差距百分比（纯函数）
   ============================================================ */
hr('2. 差距百分比 gapOf');
A('高于基准 → 正数', G.gapOf(110, 100) === 10, G.gapOf(110, 100));
A('低于基准 → 负数', G.gapOf(90, 100) === -10, G.gapOf(90, 100));
A('持平 → 0', G.gapOf(100, 100) === 0, G.gapOf(100, 100));
A('基准为 0 → null（不硬造一个 0 出来）', G.gapOf(50, 0) === null, G.gapOf(50, 0));
A('基准为 null → null', G.gapOf(50, null) === null, G.gapOf(50, null));
A('本场值缺失 → null（不能算出 -100% 这种假差距）', G.gapOf(null, 100) === null, G.gapOf(null, 100));
A('本场值为 0 时仍按 0 算（是真实数字，不是缺失）', G.gapOf(0, 100) === -100, G.gapOf(0, 100));

hr('3. 差距文案与配色');
A('正差距带 + 号', G.gapFmt(10) === '+10.0%', G.gapFmt(10));
A('负差距用数学减号 ' + MINUS + ' 而不是连字符 -', G.gapFmt(-10) === MINUS + '10.0%', G.gapFmt(-10));
A('±3% 以内显示「持平」', G.gapFmt(2.9) === '持平', G.gapFmt(2.9));
A('缺失显示破折号', G.gapFmt(null) === '—', G.gapFmt(null));
A('越高越好的指标：正差距 = 好（绿）', G.gapCls(10, false) === 'down', G.gapCls(10, false));
A('越高越好的指标：负差距 = 差（红）', G.gapCls(-10, false) === 'up', G.gapCls(-10, false));
A('越低越好的指标：正差距 = 差（红）', G.gapCls(10, true) === 'up', G.gapCls(10, true));
A('越低越好的指标：负差距 = 好（绿）', G.gapCls(-10, true) === 'down', G.gapCls(-10, true));
A('±3% 以内不上色', G.gapCls(2, false) === 'flat', G.gapCls(2, false));

hr('4. 判定逻辑 gapJudge（用「落后 / 好于」，避免「退款率偏低」这种方向歧义）');
A('越高越好 · 两个基准都超 → 好于基准（绿）',
  G.gapJudge(10, 10, false).t === '好于基准' && G.gapJudge(10, 10, false).c === 'b-green', G.gapJudge(10, 10, false));
A('越高越好 · 两个基准都低 → 两项都落后（红）',
  G.gapJudge(-10, -10, false).t === '两项都落后' && G.gapJudge(-10, -10, false).c === 'b-red', G.gapJudge(-10, -10, false));
A('越高越好 · 只落后一个基准 → 一项落后（琥珀）', G.gapJudge(-10, 1, false).t === '一项落后', G.gapJudge(-10, 1, false));
A('越高越好 · 只落后历史均值也算一项落后', G.gapJudge(-10, null, false).t === '一项落后', G.gapJudge(-10, null, false));
A('越高越好 · 一个超一个低 → 落后优先上报', G.gapJudge(10, -10, false).t === '一项落后', G.gapJudge(10, -10, false));
A('越高越好 · 一个超一个平 → 好于基准', G.gapJudge(10, 1, false).t === '好于基准', G.gapJudge(10, 1, false));
A('越低越好 · 高于基准即落后', G.gapJudge(10, 10, true).t === '两项都落后', G.gapJudge(10, 10, true));
A('越低越好 · 低于基准即好', G.gapJudge(-10, -10, true).t === '好于基准', G.gapJudge(-10, -10, true));
A('全在容差内 → 持平（灰）',
  G.gapJudge(1, 1, false).t === '持平' && G.gapJudge(1, 1, false).c === 'b-gray', G.gapJudge(1, 1, false));
A('差距正好 3% 不算持平（边界归到偏离一侧）', G.gapJudge(3, 3, false).t === '好于基准', G.gapJudge(3, 3, false));

hr('5. 品类基准取值 benchValOf');
A('直接取 uvValue', G.benchValOf({ uvValue: 8.8 }, 'uvValue') === 8.8, G.benchValOf({ uvValue: 8.8 }, 'uvValue'));
A('付费占比用「100 − 自然流量占比」换算', G.benchValOf({ naturalRate: 55 }, 'paidFromNatural') === 45, G.benchValOf({ naturalRate: 55 }, 'paidFromNatural'));
A('基准里没有该字段 → null（不编造）', G.benchValOf({ uvValue: 8.8 }, 'refundRate') === null, G.benchValOf({ uvValue: 8.8 }, 'refundRate'));
A('基准为 null 时返回 null', G.benchValOf(null, 'uvValue') === null, G.benchValOf(null, 'uvValue'));
A('未知品类回落到「通用」基准不报错', typeof G.benchOf('不存在的品类').cvr === 'number', G.benchOf('不存在的品类').cvr);

hr('6. 数值格式 fmtGapVal');
A('GMV 带千分位', G.fmtGapVal('gmv', '¥', 123456) === '¥123,456', G.fmtGapVal('gmv', '¥', 123456));
A('UV 价值保留两位', G.fmtGapVal('uv', '¥', 8.8) === '¥8.80', G.fmtGapVal('uv', '¥', 8.8));
A('停留带 s', G.fmtGapVal('stay', 's', 58) === '58s', G.fmtGapVal('stay', 's', 58));
A('比率带 %', G.fmtGapVal('cvr', '%', 9.12) === '9.1%', G.fmtGapVal('cvr', '%', 9.12));
A('缺失显示破折号', G.fmtGapVal('uv', '¥', null) === '—', G.fmtGapVal('uv', '¥', null));

hr('7. 幅度条 gapBar');
A('有数据时渲染出条', G.gapBar(10, false, 50).includes('class="gbar"'), true);
A('正差距从中点往右画', G.gapBar(10, false, 50).includes('<i style="left:50%'), G.gapBar(10, false, 50));
A('负差距从中点往左画', G.gapBar(-50, false, 50).includes('<i style="left:0%'), G.gapBar(-50, false, 50));
A('好方向用绿色', G.gapBar(10, false, 50).includes('var(--green)'), G.gapBar(10, false, 50));
A('差方向用红色', G.gapBar(-10, false, 50).includes('var(--red)'), G.gapBar(-10, false, 50));
A('越低越好的指标配色反转', G.gapBar(10, true, 50).includes('var(--red)') && G.gapBar(-10, true, 50).includes('var(--green)'), true);
A('±3% 以内不画条，直接写「持平」', G.gapBar(2, false, 50).includes('持平') && !G.gapBar(2, false, 50).includes('gbar'), G.gapBar(2, false, 50));
A('条宽不超过半格（50%）', !/width:(5[1-9]|[6-9]\d|\d{3})/.test(G.gapBar(999, false, 1)), G.gapBar(999, false, 1));
A('中轴线一直在 50% 处', G.gapBar(-8, false, 50).includes('<u style="left:50%">'), true);

/* ============================================================
   8. 集成 A：本场表现好 —— 排序、数值、不硬凑归因段
   ============================================================ */
hr('8. 集成 A：4 场数据，本场（09-12）全面偏好');
function ingest(cfg) {
  const M = G.normalize([{
    views: cfg.views, avgStay: cfg.stay, gmv: cfg.gmv, entryRate: cfg.entry,
    cvr: cfg.cvr, refundRate: cfg.refund, paidRate: cfg.paid || 30,
  }], { category: cfg.cat || '服饰' });
  const DIAG = G.runDiagnosis(M);
  return G.STORE.add({ M, DIAG, raw: 'raw', hostName: cfg.host, date: cfg.date, category: cfg.cat || '服饰', note: '' });
}
function showGap() { G.ST.tab.compare = 'gap'; G.go('compare'); return scrollHTML(); }

ingest({ views: 9800, stay: 52, gmv: 88000, entry: 19.2, cvr: 8.2, refund: 7.4, host: '小雨', date: '2026-09-09' });
ingest({ views: 10400, stay: 58, gmv: 104000, entry: 20.4, cvr: 9.1, refund: 6.2, host: '小雨', date: '2026-09-10' });
ingest({ views: 9600, stay: 41, gmv: 86420, entry: 19.4, cvr: 6.8, refund: 18.6, host: '小满', date: '2026-09-11' });
ingest({ views: 11200, stay: 61, gmv: 118000, entry: 21.0, cvr: 9.8, refund: 6.0, host: '小雨', date: '2026-09-12' });
A('4 场入库', G.STORE.count() === 4, G.STORE.count());

const all = G.STORE.all();
G.ST.curId = all[0].id;                       // 本场 = 09-12
const curRec = G.STORE.get(G.ST.curId);
const base = G.STORE.baseline(G.ST.curId);
const bench = G.benchOf(curRec.category);
const rows = G.cmpGapRows(curRec.snapshot, base, bench);

A('品类识别为「服饰」', curRec.category === '服饰', curRec.category);
A('历史基准 = 前 3 场', base.__n === 3, base.__n);
A('明细表覆盖 7 项指标', rows.length === 7, rows.length);
A('每项都带本场值', rows.every(r => typeof r.v === 'number'), rows.map(r => r.v));
A('每项都带历史均值', rows.every(r => typeof r.a === 'number'), rows.map(r => r.a));
A('每项都算出 vs 均值', rows.every(r => r.gA != null), rows.map(r => r.gA));
A('除 GMV 外每项都带品类基准（GMV 本来就没有对应基准值）',
  rows.filter(r => r.key !== 'gmv').every(r => typeof r.b === 'number'), rows.map(r => [r.key, r.b]));
A('GMV 的品类基准就是 null，不会编一个数出来',
  rows.find(r => r.key === 'gmv').b === null, rows.find(r => r.key === 'gmv').b);

const abss = rows.map(r => Math.abs(r.gA));
A('按差距绝对值降序排列', abss.every((v, i) => i === 0 || abss[i - 1] >= v), abss.map(x => +x.toFixed(1)));

/* 已知事实核对：本场退款 6.0，前三场 7.4 / 6.2 / 18.6 → 均值 10.73，明显更低 */
const avgRefund = (7.4 + 6.2 + 18.6) / 3;
const refundRow = rows.find(r => r.key === 'refund');
A('退款率本场值 = 6.0', refundRow.v === 6.0, refundRow.v);
A('退款率历史均值 ≈ 10.73', Math.abs(refundRow.a - avgRefund) < 0.01, refundRow.a);
A('退款率差距是负的（低于均值）', refundRow.gA < 0, refundRow.gA.toFixed(1));
A('退款率的品类基准 = 7.4（服饰）', refundRow.b === 7.4, refundRow.b);
A('退款率配色是「好」（绿）', G.gapCls(refundRow.gA, true) === 'down', G.gapCls(refundRow.gA, true));
A('退款率不会被判成落后', !G.gapJudge(refundRow.gA, refundRow.gB, true).t.includes('落后'), G.gapJudge(refundRow.gA, refundRow.gB, true));

/* 已知事实核对：停留 61 vs 均值 (52+58+41)/3 = 50.33 → 明显高于 */
const stayRow = rows.find(r => r.key === 'stay');
A('停留历史均值 ≈ 50.33', Math.abs(stayRow.a - (52 + 58 + 41) / 3) < 0.01, stayRow.a);
A('停留差距为正', stayRow.gA > 0, stayRow.gA.toFixed(1));
A('停留被判成好于基准', G.gapJudge(stayRow.gA, stayRow.gB, false).t === '好于基准', G.gapJudge(stayRow.gA, stayRow.gB, false));

hr('9. 集成 A 的页面结构');
const h = showGap();
A('页面非空', h.length > 2000, h.length);
A('含结论条', /项好于均值|项低于均值|各项波动都在|各项都没有数据/.test(h), true);
A('结论条点出最突出的一项（差距最大 / 差得最多 / 领先最多）',
  /(差距最大的是|差得最多的是|领先最多的是) <b>/.test(h), true);
A('含「差距明细」表', h.includes('差距明细'), true);
A('表头含「本场」', h.includes('本场'), true);
A('表头含「历史均值」', h.includes('历史均值'), true);
A('表头含「品类基准」', h.includes('品类基准'), true);
A('表头含「vs 均值」与「vs 基准」两列', h.includes('vs 均值') && h.includes('vs 基准'), true);
A('表头含「差距幅度」列', h.includes('差距幅度'), true);
A('表头含「判定」列', h.includes('判定'), true);
A('幅度条真的渲染出来了', (h.match(/class="gbar"/g) || []).length >= 3, (h.match(/class="gbar"/g) || []).length);
A('判定徽章真的渲染出来了', /badge b-(red|amber|green|gray)">(两项都落后|一项落后|好于基准|持平)/.test(h), true);
A('标注了「越低越好」的指标', h.includes('越低越好'), true);
A('品类名出现在表头', h.includes('服饰'), true);
A('写明了差距口径与容差', h.includes('±3%') && h.includes('÷ 基准'), true);
A('含对比基准选择器', h.includes('对比基准'), true);
A('保留了原有的「对比结论」一句', h.includes('对比结论'), true);
A('不再用 4 个 KPI 卡撑页面（已换成明细表）', !h.includes('class="grid g4"'), true);
A('页面里没有残留图标字符', !/[▦◉⇄☺↗☰✓★▤◈▣▶▲▼□○▽◫✎◔]/.test(h), (h.match(/[▦◉⇄☺↗☰✓★▤◈▣▶▲▼□○▽◫✎◔]/g) || []).join(''));
A('页面里没有内联 px 字号（全部走字号变量）', !/font-size:\s*[0-9.]+px/.test(h), (h.match(/font-size:\s*[0-9.]+px/g) || []).join(' '));
A('本场全面偏好时不硬凑归因段', !h.includes('这些差距先查什么'), true);

hr('10. 每项指标在表里都有自己的一行');
G.GAP_METRICS.forEach(([label]) => { A('行 · ' + label, h.includes(label), label); });

/* ============================================================
   11. 集成 B：本场明显掉链子 —— 归因段必须出现，且先讲最差的那项
   ============================================================ */
hr('11. 集成 B：本场（09-16）退款与停留都掉链子');
G.STORE.clearAll();
ingest({ views: 10400, stay: 58, gmv: 104000, entry: 20.4, cvr: 9.1, refund: 6.2, host: '小雨', date: '2026-09-13' });
ingest({ views: 10800, stay: 60, gmv: 112000, entry: 20.8, cvr: 9.3, refund: 6.0, host: '小雨', date: '2026-09-14' });
ingest({ views: 10200, stay: 57, gmv: 108000, entry: 20.2, cvr: 9.0, refund: 6.4, host: '小雨', date: '2026-09-15' });
ingest({ views: 10600, stay: 38, gmv: 79000, entry: 19.8, cvr: 8.6, refund: 21.0, host: '小雨', date: '2026-09-16' });
A('4 场入库（B 场景）', G.STORE.count() === 4, G.STORE.count());
G.ST.curId = G.STORE.all()[0].id;              // 本场 = 09-16（差的那场）
const h2 = showGap();

const rowsB = G.cmpGapRows(G.STORE.get(G.ST.curId).snapshot, G.STORE.baseline(G.ST.curId), G.benchOf('服饰'));
A('退款率排在第一行（差距最大）', rowsB[0].key === 'refund', rowsB.map(r => r.key).join(','));
A('退款率差距为正（高于均值 = 差）', rowsB[0].gA > 0, rowsB[0].gA.toFixed(1));
A('停留也在落后项里（越低越差，差距为负）',
  rowsB.filter(r => r.gA < -3 && !r.inv).some(r => r.key === 'stay'),
  rowsB.map(r => r.key + ':' + (r.gA == null ? '-' : r.gA.toFixed(1))).join(' '));
A('结论条点名最差的那项是退款率', /(差距最大的是|差得最多的是) <b>退款率<\/b>/.test(h2), true);
A('结论条统计出有项低于均值', /项低于均值/.test(h2), true);
A('出现归因段「这些差距先查什么」', h2.includes('这些差距先查什么'), true);
A('归因段引用了退款率的建议文案', h2.includes(G.GAP_ADVICE.refund), true);
A('退款率那一行判定不是「好于基准」', !/退款率[\s\S]{0,400}好于基准/.test(h2), true);

hr('12. 单场时给出解释而不是空白');
G.STORE.clearAll();
ingest({ views: 9800, stay: 52, gmv: 88000, entry: 19.2, cvr: 8.2, refund: 7.4, host: '小雨', date: '2026-09-17' });
const h1 = showGap();
A('只有一场时不白屏', h1.length > 100, h1.length);
A('明确说明为什么看不了对比', h1.includes('还没有可对比的场次'), true);
A('给出下一步动作（再导入一场）', h1.includes('再导入一场'), true);

console.log('\n差距概览测试：通过 ' + pass + '，失败 ' + fail);
process.exit(fail ? 1 : 0);
