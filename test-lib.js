/* 场次库「删除」能力 —— 真实浏览器验证（无头 Chrome，六种视口）
   ------------------------------------------------------------------
   跑法：  node test-lib.js        退出码 0 / 1

   为什么必须真机：
   「按钮点不到」是布局问题 —— DOM 桩没有布局引擎，getBoundingClientRect 全是 0，
   桩环境永远测不出来。

   为什么必须用「真实坐标点击」而不是 el.click()：
   el.click() 会绕过命中测试，元素被 overflow 裁剪、或在屏幕外，照样触发 onclick。
   上一版就是栽在这：三个视口（1280/760/504）全绿，但真实用户点不到，
   因为漏掉了 vw∈[821,891] 这一段 —— 表格模式下「删」固定落在 x≈867~892，
   窗口不够宽时被 #scroll 的 overflow-x:auto 裁掉，那个坐标上根本没有可点的东西。
   现在 realClick() 在按钮中心坐标上派发真实鼠标事件，命中的元素不是按钮就判失败。

   已踩过的坑（别重复踩）：
   1. 页面里的 alert / confirm / prompt 必须 stub。无头模式下真弹窗会永久阻塞渲染进程，
      --dump-dom 永不返回、表现为「浏览器挂死」。
   2. headless 的最小布局视口约 504px：传 --window-size=390 时 window.innerWidth 仍是 504，
      但 --screenshot 会按 390 裁剪 → 截图右边缺一块是「被裁掉」不是「溢出」。
      判断溢出要用 getBoundingClientRect().right 对比 window.innerWidth。
   3. 探针脚本写在 JS 模板字符串里时，正则的 \s \d 会被吃掉，必须写成 \\s \\d。
   4. 变量别命名 top / self / parent / length —— 它们是 window 的只读内置属性，
      顶层 var 赋值会被静默忽略（top 永远是 window），于是 contains() 抛
      "parameter 1 is not of type 'Node'"。
   5. 测 elementFromPoint 前必须先 scrollIntoView，否则坐标在视口外一律返回 null，
      会把「纵向没滚到」误判成「按钮点不到」。
*/
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = __dirname;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROBE = path.join(DIR, '_tlib_probe.html');

const VIEWPORTS = [
  { tag: 'desk',   size: '1280,900', label: '桌面 1280（表格模式）' },
  { tag: 'mid900', size: '900,900',  label: '窗口 900 / vw≈882（漏网区上沿）' },
  { tag: 'mid860', size: '860,900',  label: '窗口 860 / vw≈842（漏网区中段）' },
  { tag: 'mid840', size: '840,900',  label: '窗口 840 / vw≈822（漏网区下沿）' },
  { tag: 'narrow', size: '760,900',  label: '窄屏 760（卡片式）' },
  { tag: 'phone',  size: '504,900',  label: '最窄 504（headless 下限，覆盖手机断点）' },
];

/* ---------- 种 4 场：日期递增、指标递增，便于断言「删的是最新那一场」 ---------- */
const SEED = `
function tSet(id, v){ var e = document.getElementById(id); if(e) e.value = v; }
var TAB = String.fromCharCode(9), NL = String.fromCharCode(10);
function tPaste(rows){ return rows.map(function(r){ return r[0] + TAB + r[1]; }).join(NL); }
var T_DATA = [
  ['小 A', '2026-09-11', [['观看人数','9800'],['平均停留时长','52秒'],['GMV','88000'],
    ['曝光进入率','19.2%'],['成交转化率','8.2%'],['退款率','7.4%'],['付费流量占比','32%']]],
  ['小 A', '2026-09-12', [['观看人数','10400'],['平均停留时长','58秒'],['GMV','104000'],
    ['曝光进入率','20.4%'],['成交转化率','9.1%'],['退款率','6.2%'],['付费流量占比','30%']]],
  ['小 B', '2026-09-13', [['观看人数','11200'],['平均停留时长','61秒'],['GMV','121000'],
    ['曝光进入率','21.8%'],['成交转化率','9.6%'],['退款率','5.4%'],['付费流量占比','29%']]],
  ['小 B', '2026-09-14', [['观看人数','12600'],['平均停留时长','66秒'],['GMV','143000'],
    ['曝光进入率','22.4%'],['成交转化率','10.3%'],['退款率','4.8%'],['付费流量占比','27%']]]
];
/* 走真实录入路径（粘贴 → analyze → 自动存档），而不是直接往仓库塞对象。
   区别很关键：真实路径下 raw 存的是原始粘贴文本，
   「重新载入该场」才有东西可解析 —— 用占位 raw 会让那条断言假失败。 */
function seed(){
  STORE.clearAll();
  ST.delPending = null; ST.delNote = null;
  T_DATA.forEach(function(d){
    go('import');
    ST.text = tPaste(d[2]);
    tSet('cat', '服饰'); tSet('impHost', d[0]); tSet('impDate', d[1]); tSet('impNote', '');
    analyze();
  });
  go('library');
}`;

/* ---------- 真实点击 + 两步删除的辅助函数 ---------- */
const HELPERS = `
window.__R = [];
function T(n, c, extra){
  window.__R.push((c ? 'PASS ' : 'FAIL ') + n + (extra !== undefined ? ('  ::  ' + extra) : ''));
}
function f1(v){ return (typeof v === 'number' ? v : 0).toFixed(1); }
window.confirm = function(){ return true; };   // 坑 1：必须 stub
window.alert = function(){};
window.prompt = function(){ return null; };
window.onerror = function(m, s, l){ window.__R.push('JSERR ' + m + ' @' + l); };

/* 真实点击：在元素中心坐标上派发鼠标事件，打到 elementFromPoint 命中的那个元素上。
   不能用 el.click() —— 它绕过命中测试，元素被裁剪/在屏幕外也照样触发 onclick。 */
function realClick(el){
  if(!el) return { ok:false, why:'元素不存在' };
  el.scrollIntoView({ block:'center' });          // 坑 5：不滚过去，坐标在视口外全是 null
  var r = el.getBoundingClientRect();
  var x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
  if(y < 0 || y > window.innerHeight) return { ok:false, why:'纵向不在视口内 y=' + Math.round(y) };
  var hitNode = document.elementFromPoint(x, y);   // 坑 4：别叫 top
  if(!hitNode) return { ok:false, why:'该坐标上没有可点元素 x=' + Math.round(x) };
  if(hitNode !== el && !el.contains(hitNode)){
    return { ok:false, why:'被遮挡，命中 ' + hitNode.tagName + '.' + String(hitNode.className||'').split(' ')[0] };
  }
  ['mousedown','mouseup','click'].forEach(function(t){
    hitNode.dispatchEvent(new MouseEvent(t, {
      bubbles:true, cancelable:true, view:window,
      clientX:x, clientY:y, button:0
    }));
  });
  return { ok:true };
}
function rows(){ return document.querySelectorAll('.lib-row'); }
function delBtn(i){ return rows()[i].querySelector('.mini.danger'); }
function btnByText(txt){
  return Array.prototype.slice.call(document.querySelectorAll('.mini'))
    .filter(function(b){ return b.textContent === txt; })[0];
}
/* 两步删除：点「删」（该行变成确认态）→ 点「确认删除」。两步都走真实坐标点击。 */
function clickDel(i){
  var r1 = realClick(delBtn(i));
  if(!r1.ok) return r1;
  var askB = document.querySelector('.mini.danger2');
  if(!askB) return { ok:false, why:'点「删」后没有进入待确认态' };
  return realClick(askB);
}
`;

const PROBE_BODY = `
try{
  ${SEED}
  ${HELPERS}
  seed();

  var vw = window.innerWidth;

  T('场次库渲染出 4 行', rows().length === 4, rows().length);
  T('每行 3 个操作按钮（诊断/改/删）',
    document.querySelectorAll('.lib-act .mini').length === 12,
    document.querySelectorAll('.lib-act .mini').length);

  /* --- 布局：本轮核心回归点 --- */
  var first = rows()[0];
  var act = first.querySelector('.lib-act');
  var del = first.querySelector('.mini.danger');
  var rr = first.getBoundingClientRect();
  var ar = act.getBoundingClientRect();

  window.__R.push('GEOM vw=' + vw +
    ' | row ' + f1(rr.left) + '~' + f1(rr.right) + ' (w=' + f1(rr.width) + ')' +
    ' | act ' + f1(ar.left) + '~' + f1(ar.right) +
    ' | act scrollW=' + act.scrollWidth + ' clientW=' + act.clientWidth);

  T('整行没有横向溢出视口', rr.right <= vw + 1 && rr.width <= vw + 1,
    'row.right=' + f1(rr.right) + ' vw=' + vw);
  T('操作列内容塞得下（3 个按钮不挤压）', act.scrollWidth <= act.clientWidth + 1,
    'scrollW=' + act.scrollWidth + ' clientW=' + act.clientWidth);

  var inside = Array.prototype.slice.call(rows()).map(function(r){
    var b = r.querySelector('.mini.danger').getBoundingClientRect();
    return (b.left >= -1 && b.right <= vw + 1) ? 'ok' : ('out(' + f1(b.left) + '~' + f1(b.right) + ')');
  });
  T('每一行的删除按钮都完整落在视口内', inside.every(function(x){ return x === 'ok'; }), inside.join(','));

  /* 命中测试：按钮中心坐标上到底有没有可点的按钮。
     上一版漏掉的就是这一条 —— vw 821~891 时那里命中的是容器/null。 */
  first.scrollIntoView({ block:'center' });
  var db = del.getBoundingClientRect();
  var hitNode = document.elementFromPoint((db.left + db.right) / 2, (db.top + db.bottom) / 2);
  T('删除按钮可命中（中心坐标上没有别的东西挡着）',
    !!hitNode && (hitNode === del || del.contains(hitNode)),
    hitNode ? (hitNode.tagName + '.' + String(hitNode.className || '').split(' ')[0]) : 'null');
  T('删除按钮有可点面积（>=16x14）', db.width >= 16 && db.height >= 14,
    f1(db.width) + 'x' + f1(db.height));

  /* --- 第一步：点「删」应该只进入待确认，不能直接删 --- */
  var id0 = STORE.all()[0].id;
  var before = STORE.count();
  var r1 = realClick(del);
  T('第一步点「删」落在按钮上', r1.ok, r1.why);
  T('点一下进入待确认态（出现「确认删除」）',
    ST.delPending === id0 && !!document.querySelector('.mini.danger2'),
    'pending=' + ST.delPending + ' btn=' + !!document.querySelector('.mini.danger2'));
  T('待确认时还没有删掉数据（防误删）', STORE.count() === before, STORE.count());
  var actAsk = rows()[0].querySelector('.lib-act');
  T('待确认态的「确认删除 / 取消」也塞得下',
    actAsk.scrollWidth <= actAsk.clientWidth + 1,
    'scrollW=' + actAsk.scrollWidth + ' clientW=' + actAsk.clientWidth);

  /* --- 取消 --- */
  var rc = realClick(btnByText('取消'));
  T('点「取消」能退出待确认', rc.ok && ST.delPending === null && STORE.count() === before,
    rc.why + ' pending=' + ST.delPending);

  /* --- 不依赖原生 confirm：浏览器屏蔽对话框时也必须能删 --- */
  window.confirm = function(){ return false; };   // 模拟「阻止此页面创建更多对话框」
  var n0 = STORE.count();
  var r2 = clickDel(0);
  T('confirm 被屏蔽时删除依然可用', r2.ok && STORE.count() === n0 - 1,
    (r2.why || 'ok') + ' n=' + n0 + '->' + STORE.count());
  window.confirm = function(){ return true; };

  /* --- 正常情况下完整走一遍两步删除 --- */
  var n1 = STORE.count();
  var r3 = clickDel(0);
  T('两步删除后场次真的少一场', r3.ok && STORE.count() === n1 - 1,
    (r3.why || 'ok') + ' ' + n1 + '->' + STORE.count());
  T('待确认态已清空', ST.delPending === null, String(ST.delPending));
  var bar = document.querySelector('.delbar');
  T('删除后给出回执（不再是点了没反应）',
    !!bar && /已删除/.test(bar.textContent), bar ? bar.textContent.slice(0, 46) : 'null');
  T('清单同步重渲染', rows().length === n1 - 1, rows().length);

  var key = Object.keys(localStorage).filter(function(k){ return /sessions/i.test(k); })[0];
  var dumped = -1;
  try{ dumped = JSON.parse(localStorage.getItem(key)).sessions.length; }catch(e){ dumped = 'ERR ' + e.message; }
  T('删除已落盘（回读 localStorage）', dumped === n1 - 1, 'key=' + key + ' n=' + dumped);

  /* --- 顶栏 / 侧栏计数必须同步 --- */
  var tbTxt = document.getElementById('tbRight').textContent.replace(/\\s+/g, ' ');
  T('删除后顶栏计数同步', tbTxt.indexOf((n1 - 1) + ' 场') >= 0, tbTxt.trim());
  var libC = document.getElementById('libCnt');
  T('删除后侧栏徽标同步', !libC || libC.textContent === String(n1 - 1), libC ? libC.textContent : '(无)');

  /* --- 删掉「当前正在看的那一场」 --- */
  go('report');
  var cur = ST.curId;
  T('已载入一场作为当前场次', !!ST.curId, String(ST.curId).slice(0, 12));
  go('library');
  clickDel(0);
  T('删掉当前场次后没有悬空引用', ST.curId === null || ST.curId !== cur, 'curId=' + ST.curId);
  T('删除当前场次后清单继续可用', rows().length === STORE.count(), rows().length);
  T('删除当前场次后诊断状态被清空', !ST.M, 'M=' + (ST.M ? '在' : 'null'));

  var repOk = true, repErr = '';
  try{ go('report'); }catch(e){ repOk = false; repErr = e.message; }
  T('删掉当前场次后再进诊断页不崩',
    repOk && document.getElementById('scroll').innerHTML.length > 100, repErr || 'ok');

  /* --- 删空 --- */
  go('library');
  while(STORE.count() > 0){
    var dr = clickDel(0);
    if(!dr.ok){ window.__R.push('JSERR 删空过程中失败: ' + dr.why); break; }
  }
  T('可以一直删到空', STORE.count() === 0, STORE.count());
  T('删空后回到空态引导',
    document.getElementById('scroll').innerHTML.indexOf('场次库还是空的') >= 0, '');
  T('删空后仍显示删除回执',
    !!document.querySelector('.delbar') && /已删除/.test(document.querySelector('.delbar').textContent), '');
  tbTxt = document.getElementById('tbRight').textContent.replace(/\\s+/g, ' ');
  T('删空后顶栏不残留旧场次数',
    tbTxt.indexOf('已存本机 0 场') >= 0 || tbTxt.indexOf('已存本机') < 0, tbTxt.trim());

  /* --- 删掉对比目标后，对比页不能崩 --- */
  seed();
  var oldest = STORE.all()[STORE.count() - 1];
  ST.compareId = oldest.id;
  go('library');
  clickDel(rows().length - 1);
  T('删掉的正是对比目标那一场', !STORE.get(oldest.id), 'id=' + String(oldest.id).slice(0, 12));
  var cmpOk = true, cmpErr = '';
  try{ go('compare'); }catch(e){ cmpOk = false; cmpErr = e.message; }
  T('删掉对比目标后再进对比页不崩',
    cmpOk && document.getElementById('scroll').innerHTML.length > 100, cmpErr || 'ok');
}catch(e){
  window.__R.push('FATAL ' + e.message + ' @ ' + String(e.stack || '').split('\\n')[1]);
}
var q = document.createElement('pre');
q.id = 'R';
q.textContent = window.__R.join('\\n');
document.body.appendChild(q);
`;

function buildProbe() {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const inject = '<script>' + PROBE_BODY + '<\/script>';
  if (html.indexOf('</body>') < 0) throw new Error('index.html 里找不到 </body>');
  fs.writeFileSync(PROBE, html.replace('</body>', inject + '</body>'));
}

function runViewport(vp) {
  return new Promise(resolve => {
    const profile = path.join(DIR, '_tlib_' + vp.tag);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    const p = spawn(CHROME, [
      '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--no-default-browser-check', '--disable-extensions', '--disable-dev-shm-usage',
      '--mute-audio', '--allow-file-access-from-files',
      '--window-size=' + vp.size,
      '--user-data-dir=' + profile,
      '--dump-dom', 'file:///' + PROBE.replace(/\\/g, '/'),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '', err = '', done = false;
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    const killer = setTimeout(() => { if (!done) { try { p.kill('SIGKILL'); } catch (e) {} } }, 60000);

    p.on('exit', () => {
      if (done) return; done = true; clearTimeout(killer);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
      const m = out.match(/<pre id="R">([\s\S]*?)<\/pre>/);
      resolve({
        tag: vp.tag, label: vp.label,
        text: m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                          .replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '',
        bytes: out.length, err,
      });
    });
  });
}

(async () => {
  console.log('场次库删除 · 真实浏览器验证（无头 Chrome，六种视口）');
  console.log('='.repeat(62));

  if (!fs.existsSync(CHROME)) {
    console.log('未找到 Chrome：' + CHROME);
    process.exit(1);
  }
  buildProbe();

  let pass = 0, fail = 0, silent = 0;
  for (const vp of VIEWPORTS) {
    const r = await runViewport(vp);
    console.log('\n--- ' + vp.label + ' ---');
    if (!r.text) {
      console.log('  浏览器没有返回结果（输出 ' + r.bytes + ' 字节）。');
      console.log('  最常见原因：页面 alert/confirm 没被 stub，把渲染进程阻塞了。');
      if (r.err) console.log('  stderr: ' + r.err.slice(0, 300));
      fail++; silent++;
      continue;
    }
    r.text.split('\n').forEach(line => {
      if (/^(PASS|FAIL)/.test(line)) {
        if (line.indexOf('FAIL') === 0) fail++; else pass++;
        console.log('  ' + line);
      } else if (/^GEOM|^JSERR|^FATAL/.test(line)) {
        console.log('  ' + line);
      }
    });
  }

  try { fs.rmSync(PROBE, { force: true }); } catch (e) {}
  console.log('\n' + '='.repeat(62));
  console.log('真实浏览器：通过 ' + pass + '，失败 ' + fail +
    '（' + VIEWPORTS.length + ' 种视口' + (silent ? ('，其中 ' + silent + ' 个无输出') : '') + '）');
  process.exit(fail ? 1 : 0);
})();
