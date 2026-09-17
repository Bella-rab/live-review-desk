/* 行动清单（待办）—— 真实浏览器验证
   ------------------------------------------------------------------
   跑法：  node test-todos.js        退出码 0 / 1

   为什么必须真机：
   本页的关键行为全在 localStorage 与真实渲染之间 —— 勾选能不能留住、
   刷新后还在不在、KPI 会不会跟着变。DOM 桩里 localStorage 是假的，
   测「持久化」等于测桩自己。

   本测试用 **两次独立启动浏览器** 来验证「刷新后还在」：
     Phase 1  种数据 → 勾选 → 手动加入决策动作 → 结束（不清库）
     Phase 2  全新进程、同一 profile → 只读 localStorage + 重建 → 断言
   同一进程内调 loadLatest() 只能算「重新载入」，不算刷新。

   已踩过的坑（别重复踩）：
   1. 页面的 alert/confirm 必须 stub，否则无头模式永久阻塞、dump-dom 永不返回。
   2. 探针脚本写在 JS 模板字符串里时，正则的 \s \d 必须写成 \\s \\d。
   3. 别用 el.click() 当「真实点击」—— 它绕过命中测试，会造出假绿。
   4. finish() 里要显式输出，否则 dump-dom 拿不到结果。
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = path.join(DIR, '_tt_profile');
const PA = path.join(DIR, '_tt_a.html');
const PB = path.join(DIR, '_tt_b.html');

const HEAD = `
window.alert = function(){ (window.__ALERTS = window.__ALERTS||[]).push(String(arguments[0])); return undefined; };
window.confirm = function(){ return true; };
window.prompt = function(){ return null; };
window.__R = [];
function P(name, cond, extra){ window.__R.push((cond?'PASS ':'FAIL ') + name + (extra!==undefined?('  → '+extra):'')); }
function tSet(id, v){ var e = document.getElementById(id); if(e) e.value = v; }
var TAB = String.fromCharCode(9), NL = String.fromCharCode(10);
function tPaste(rows){ return rows.map(function(r){ return r[0] + TAB + r[1]; }).join(NL); }
function importOne(host, date, rows){
  go('import'); ST.text = tPaste(rows);
  tSet('cat','服饰'); tSet('impHost', host); tSet('impDate', date); tSet('impNote','');
  analyze();
}
function finish(){
  var pre = document.createElement('pre');
  pre.id = 'probeOut';
  pre.textContent = window.__R.join(NL);
  document.body.appendChild(pre);
}
/* 有问题的场 */
var BAD = [['观看人数','9000'],['平均停留时长','38秒'],['GMV','72000'],
  ['曝光进入率','16%'],['成交转化率','5.2%'],['退款率','12%'],['付费流量占比','62%']];
/* 指标全在基准内的场 */
var GOOD = [['观看人数','11000'],['平均停留时长','58秒'],['GMV','128000'],
  ['曝光进入率','20%'],['成交转化率','9.3%'],['退款率','5.5%'],['付费流量占比','28%']];
`;

/* ---------------- Phase 1：写入 ---------------- */
const A = HEAD + `
try {
  STORE.clearAll();
  importOne('小 A','2026-09-15', GOOD);
  var goodId = ST.curId;
  importOne('小 A','2026-09-16', BAD);      // 最新场 = BAD

  P('两场都已入库', STORE.count()===2, STORE.count());
  var derived = ST.todos.filter(function(t){return !t.manual;}).length;
  var issueActs = 0;
  ST.DIAG.issues.forEach(function(it){ issueActs += (it.act||[]).length; });
  P('派生待办 = 本场问题动作总数（不再截断到 10）', derived === issueActs, derived+' vs '+issueActs);
  P('派生待办都带来源标记 from', ST.todos.every(function(t){return !!t.from;}), '');

  /* 勾选第 1 条 */
  toggleTodo(0);
  var doneNow = ST.todos.filter(function(t){return t.done;}).length;
  P('勾选后内存里已完成 1 条', doneNow===1, doneNow);

  /* KPI 联动：勾选后行动清单页的「已完成」应立刻变 */
  var actTxt = document.getElementById('scroll').textContent;
  P('勾选后 KPI 立刻刷新（页面已是行动清单）', /已完成 1 项/.test(actTxt.replace(/\\s+/g,' ')),
    (actTxt.replace(/\\s+/g,' ').match(/已完成 \\d+ 项/)||['(未匹配)'])[0]);

  /* 手动加入决策动作 */
  go('compare'); setTab('verdict');
  var before = ST.todos.length;
  addDecideTodos();
  var manualNow = ST.todos.filter(function(t){return t.manual;}).length;
  P('「加入行动清单」把决策动作加进来了', ST.todos.length > before,
    before + ' → ' + ST.todos.length + '（手动 ' + manualNow + ' 条）');
  P('加入后有明确回执', (window.__ALERTS||[]).some(function(s){return /已加入|已经都在/.test(s);}),
    (window.__ALERTS||[]).slice(-1)[0]);

  window.__PHASE1 = {
    count: STORE.count(), curId: ST.curId,
    todos: ST.todos.length, done: doneNow, manual: manualNow,
    firstText: ST.todos[0].t
  };
} catch(e) {
  P('Phase1 无异常', false, e.message + ' @ ' + String(e.stack||'').split('\\n')[1]);
}
window.__R.push('###JSON###' + JSON.stringify(window.__PHASE1||{}));
finish();
`;

/* ---------------- Phase 2：全新进程，只读 ---------------- */
const B = HEAD + `
try {
  /* 1. 跨会话：数据本身还在 */
  P('重启后场次仍在（localStorage 落盘）', STORE.count() === __EXPECT__.count,
    STORE.count() + ' / 期望 ' + __EXPECT__.count);

  loadLatest();
  P('重启后待办条数一致', ST.todos.length === __EXPECT__.todos,
    ST.todos.length + ' / 期望 ' + __EXPECT__.todos);
  P('★ 重启后勾选状态还在（以前会全丢）',
    ST.todos.filter(function(t){return t.done;}).length === __EXPECT__.done,
    ST.todos.filter(function(t){return t.done;}).length + ' / 期望 ' + __EXPECT__.done);
  P('★ 重启后手动加入的决策动作还在',
    ST.todos.filter(function(t){return t.manual;}).length === __EXPECT__.manual,
    ST.todos.filter(function(t){return t.manual;}).length + ' / 期望 ' + __EXPECT__.manual);

  /* 2. 切场次再回来，勾选不能串场、也不能丢 */
  var otherId = STORE.all().filter(function(x){return x.id!==ST.curId;})[0].id;
  loadSession(otherId);
  var otherDone = ST.todos.filter(function(t){return t.done;}).length;
  loadSession(__EXPECT__.curId);
  P('切到别的场次再切回来，本场勾选仍在',
    ST.todos.filter(function(t){return t.done;}).length === __EXPECT__.done,
    ST.todos.filter(function(t){return t.done;}).length);
  P('别的场次不会串到本场的勾选', otherDone === 0, '另一场已完成 ' + otherDone);

  /* 3. 取消勾选也要落盘 */
  var di = -1;
  ST.todos.forEach(function(t,i){ if(t.done && di<0) di=i; });
  if(di>=0) toggleTodo(di);
  loadLatest();
  P('取消勾选后重启仍是未完成', ST.todos.filter(function(t){return t.done;}).length === 0,
    ST.todos.filter(function(t){return t.done;}).length);

  /* 4. 行动清单页渲染 */
  go('action');
  var txt = document.getElementById('scroll').textContent.replace(/\\s+/g,' ');
  var html = document.getElementById('scroll').innerHTML;
  P('行动清单页正常渲染', html.length > 800, html.length + ' 字符');
  P('页面上说明了待办从哪来', /诊断自动 \\d+ 条/.test(txt), (txt.match(/诊断自动 \\d+ 条[^。]{0,20}/)||['(未匹配)'])[0]);
  P('页面上说明了勾选会留存', /刷新和切场次都不会丢/.test(txt), '');
  P('手动项在页面上单独标注', /决策动作/.test(txt), '');

  /* 5. 诊断页 →「行动清单」子页签（repActionSec 路径）不能崩 */
  go('report'); setTab('action');
  var rh = document.getElementById('scroll').innerHTML;
  var rt = document.getElementById('scroll').textContent.replace(/\\s+/g,' ');
  P('单场诊断→行动清单 板块渲染不崩', rh.length > 500, rh.length + ' 字符');
  P('该板块也用同一份来源说明', /诊断自动 \\d+ 条|来源：本场诊断/.test(rt), '');
  P('两个板块的待办条数一致',
    (rh.match(/id="td\\d+"/g)||[]).length === ST.todos.length,
    (rh.match(/id="td\\d+"/g)||[]).length + ' / ' + ST.todos.length);

  /* 6. 空态必须解释原因，而不是只写「无待办项」 */
  STORE.clearAll();
  ST.DIAG = null; ST.M = null; ST.curId = null; ST.todos = [];
  var e1 = renderTodoList();
  P('无数据空态：说清是「还没录数据」', /一场数据都还没录/.test(e1.replace(/<[^>]*>/g,'')), '');
  P('无数据空态：给出下一步按钮', /go\\('import'\\)/.test(e1), '');

  /* 有数据但本场没命中问题 */
  importOne('小 B','2026-09-17', GOOD);
  P('指标全正常的场：命中的问题数 = 0', ST.DIAG.issues.length === 0, ST.DIAG.issues.length);
  P('指标全正常的场：待办 = 0', ST.todos.length === 0, ST.todos.length);
  go('action');
  var gt = document.getElementById('scroll').textContent.replace(/\\s+/g,' ');
  P('★ 空态解释了「为什么没有待办」', /诊断没命中任何问题/.test(gt), '');
  P('★ 空态明确「这是好消息，不是数据丢了」', /不是数据丢了/.test(gt), '');
  P('空态说明待办何时才生成', /偏离基准/.test(gt), '');
  P('空态给出核对路径', /问题诊断/.test(gt) && /转化漏斗/.test(gt), '');
  P('空态没有渲染出空数字占位问题', !/undefined|NaN|\\[object/.test(gt), '');

  /* 7. 只有一场时点「加入行动清单」必须有提示，不能静默 */
  STORE.clearAll();
  importOne('小 B','2026-09-18', BAD);
  window.__ALERTS = [];
  go('compare'); setTab('verdict');
  var threw = null;
  try { addDecideTodos(); } catch(e){ threw = e.message; }
  P('仅一场时点「加入行动清单」不抛异常', threw === null, threw||'');
  var msg = (window.__ALERTS||[]).join(' | ');
  P('★ 仅一场时给出明确提示（以前是静默 return）', msg.length > 0, msg.slice(0, 70));
  P('提示说明了原因（需要两场）', /两场/.test(msg), '');
  P('提示顺带告知已有的待办条数', /\\d+ 条待办/.test(msg), '');

  /* 8. 删场次要连它的待办记录一起清 */
  {
    importOne('小 C','2026-09-19', BAD);
    var sid = ST.curId;
    toggleTodo(0);
    var raw = localStorage.getItem('fupantai.todos.v1')||'';
    P('勾选后本机确实落盘了待办状态', raw.indexOf(sid) >= 0, raw.length + ' 字节');
    delSession(sid); delSession(sid);          // 两步确认
    var raw2 = localStorage.getItem('fupantai.todos.v1')||'';
    P('删掉场次后它的待办记录被一并清掉', raw2.indexOf(sid) < 0, raw2.length + ' 字节');
  }
} catch(e) {
  P('Phase2 无异常', false, e.message + ' @ ' + String(e.stack||'').split('\\n')[1]);
}
finish();
`;

/* ---------------- 跑浏览器 ---------------- */
function run(probeFile, timeoutMs) {
  return new Promise(resolve => {
    const p = spawn(CHROME, [
      '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--no-default-browser-check', '--disable-extensions', '--mute-audio',
      '--allow-file-access-from-files',
      '--user-data-dir=' + PROFILE,
      '--dump-dom', 'file:///' + probeFile,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    const killer = setTimeout(() => { if (!done) { try { p.kill('SIGKILL'); } catch (e) {} } }, timeoutMs);
    p.on('exit', () => {
      if (done) return; done = true; clearTimeout(killer);
      const m = out.match(/<pre id="probeOut">([\s\S]*?)<\/pre>/);
      resolve(m ? m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&') : null);
    });
  });
}

(async () => {
  console.log('行动清单（待办）真机测试 —— 两次独立启动，验证刷新后勾选还在');
  console.log('='.repeat(64));
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}

  /* ---- Phase 1：写入 ---- */
  fs.writeFileSync(PA, fs.readFileSync(path.join(DIR, 'index.html'), 'utf8')
    .replace('</body>', '<script>' + A + '<\/script></body>'));
  const outA = await run(PA, 60000);
  if (!outA) {
    console.log('Phase 1 未返回结果 —— 最常见原因是页面里的 alert/confirm 没被 stub，阻塞了渲染进程。');
    process.exit(1);
  }
  const [bodyA, jsonA] = outA.split('###JSON###');
  const linesA = bodyA.split('\n').filter(l => /^(PASS|FAIL)/.test(l));
  const p1 = JSON.parse(jsonA || '{}');
  console.log('【Phase 1 · 写入】');
  linesA.forEach(l => console.log('  ' + l));
  console.log('  阶段小结: ' + JSON.stringify(p1));

  if (!p1.count) { console.log('\nPhase 1 没能种下数据，后续断言无意义，中止。'); process.exit(1); }

  /* ---- Phase 2：全新进程，只读 ---- */
  fs.writeFileSync(PB, fs.readFileSync(path.join(DIR, 'index.html'), 'utf8')
    .replace('</body>', '<script>var __EXPECT__ = ' + JSON.stringify(p1) + ';<\/script>'
      + '<script>' + B + '<\/script></body>'));
  const outB = await run(PB, 60000);
  if (!outB) { console.log('Phase 2 未返回结果。'); process.exit(1); }
  const linesB = outB.split('\n').filter(l => /^(PASS|FAIL)/.test(l));

  console.log('\n【Phase 2 · 全新进程（等同刷新/重开）】');
  linesB.forEach(l => console.log('  ' + l));

  const all = linesA.concat(linesB);
  const fails = all.filter(l => l.indexOf('FAIL') === 0);
  console.log('\n' + '='.repeat(64));
  console.log('行动清单测试：通过 ' + (all.length - fails.length) + ' / 失败 ' + fails.length);
  if (fails.length) fails.forEach(f => console.log('  ' + f));

  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(PA, { force: true }); fs.rmSync(PB, { force: true }); } catch (e) {}
  process.exit(fails.length ? 1 : 0);
})();
