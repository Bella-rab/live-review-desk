/* 真实浏览器冒烟测试：在无头 Chrome 里跑完整用户路径
   用法：node test-browser.js
   退出码：0 = 全部通过，1 = 有失败

   为什么要单独有这一套（不能只靠 test-render.js 的 DOM 桩）：
   桩环境里 getContext 是个吞掉一切的 Proxy、alert/confirm 是空函数，
   所以「渲染进程直接被弹窗阻塞」「BENCHMARKS[未知品类] 崩页」这类问题
   只有在真浏览器里才暴露得出来。

   两个必须踩过的坑（写在这里免得下次重踩）：
   1. 无头模式下 alert/confirm/prompt 会**永久阻塞**渲染进程 → 探针里必须先屏蔽，
      否则 --dump-dom 永远不返回，表现为「浏览器挂死、输出 0 字节」。
   2. 不要加 --virtual-time-budget：它和页面里的动画帧冲突，同样会把进程挂死。
*/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname + '/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROBE = DIR + '_probe.html';
const PROFILE = DIR + '_cprofile';

/* ---------- 1. 生成探针页面：index.html + 一段测量脚本 ---------- */
function buildProbe() {
  let html = fs.readFileSync(DIR + 'index.html', 'utf8');
  html = html.replace('</body>', PROBE_SCRIPT + '\n</body>');
  fs.writeFileSync(PROBE, html, 'utf8');
}

const PROBE_SCRIPT = `
<script>
(function(){
  var log = [], errs = [], dialogs = [];
  window.alert   = function(m){ dialogs.push('alert: ' + m); };
  window.confirm = function(m){ dialogs.push('confirm: ' + m); return true; };
  window.prompt  = function(m, d){ dialogs.push('prompt: ' + m); return d; };
  window.onerror = function(m, s, l){ errs.push(m + ' @line' + l); };
  window.addEventListener('error', function(e){ errs.push('evt: ' + (e.message || e)); });

  var FAILS = 0;
  function T(name, cond, extra){
    if(!cond) FAILS++;
    log.push((cond ? 'PASS' : 'FAIL') + ' | ' + name +
      (extra !== undefined ? ('  →  ' + String(extra).slice(0,150)) : ''));
  }
  function txt(){ return document.getElementById('scroll').innerHTML; }
  function plain(s){ return String(s).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim(); }
  function set(id, v){ var e = document.getElementById(id); if(e) e.value = v; }
  function paste(rows){ return rows.map(function(r){ return r[0] + '\\t' + r[1]; }).join('\\n'); }
  function input(text, host, date){
    go('import');
    ST.text = text;
    set('cat', '服饰'); set('impHost', host); set('impDate', date); set('impNote', '');
    analyze();
  }

  var D1 = paste([['观看人数','12800'],['平均停留时长','47秒'],['GMV','91200'],
                  ['曝光进入率','18.2%'],['成交转化率','6.4%'],['退款率','9.8%'],['付费流量占比','38%']]);
  var D2 = paste([['观看人数','13400'],['平均停留时长','52秒'],['GMV','108000'],
                  ['曝光进入率','20.1%'],['成交转化率','7.9%'],['退款率','6.1%'],['付费流量占比','31%']]);
  var D3 = paste([['观看人数','11900'],['平均停留时长','49秒'],['GMV','96000'],
                  ['曝光进入率','19.0%'],['成交转化率','6.9%'],['退款率','8.2%'],['付费流量占比','35%']]);
  var D4 = paste([['观看人数','14100'],['平均停留时长','58秒'],['GMV','126000'],
                  ['曝光进入率','21.3%'],['成交转化率','9.4%'],['退款率','6.3%'],['付费流量占比','28%']]);
  var D5 = paste([['观看人数','15200'],['平均停留时长','61秒'],['GMV','138000'],
                  ['曝光进入率','22.4%'],['成交转化率','10.1%'],['退款率','5.9%'],['付费流量占比','26%']]);

  try{
    /* ===== 1. 冷启动 ===== */
    STORE.clearAll();
    T('冷启动仓库为空', STORE.all().length === 0, STORE.all().length);
    T('冷启动时页面正常渲染', txt().length > 200, txt().length);

    /* ===== 2. 真实路径：粘贴 → 分析 → 自动存档 ===== */
    input(D1, '小雨', '2026-09-14');
    T('录入 1 场后仓库有 1 条', STORE.all().length === 1, STORE.all().length);
    var got = JSON.parse(localStorage.getItem('fupantai.sessions.v3') || '{}');
    T('第 1 场已真实落盘 localStorage', !!(got.sessions && got.sessions.length === 1),
      got.sessions ? got.sessions.length : 'null');
    T('落盘的原始文本可回读（能重新分析）',
      !!(got.sessions && got.sessions[0].raw && got.sessions[0].raw.length > 20),
      got.sessions && got.sessions[0].raw ? got.sessions[0].raw.length : 'null');
    T('落盘含解析后的指标快照',
      !!(got.sessions && got.sessions[0].snapshot && got.sessions[0].snapshot.gmv),
      got.sessions && got.sessions[0].snapshot ? got.sessions[0].snapshot.gmv : 'null');
    T('保存回执说明「已记录为第 N 场」', /已记录为第 \\d+ 场/.test(plain(saveNoteBar())),
      plain(saveNoteBar()).slice(0,90));

    /* ===== 3. 连续跨天录入 ===== */
    input(D2, '小满', '2026-09-15');
    input(D3, '小雨', '2026-09-16');
    input(D4, '小雨', '2026-09-17');
    T('连续 4 天录入后共 4 场', STORE.all().length === 4, STORE.all().length);
    var o = STORE.ordered();
    T('4 场按日期旧→新排列', o.length === 4 && o[0].date < o[3].date,
      o.map(function(x){ return x.date; }).join(' → '));
    T('4 个不同日期互不覆盖', new Set(o.map(function(x){ return x.date; })).size === 4,
      o.map(function(x){ return x.date; }).join(','));

    /* ===== 4. 重复导入：不新增、且要说清切到哪一场 ===== */
    input(D1, '小雨', '2026-09-14');
    T('同一份数据重复导入不新增场次', STORE.all().length === 4, STORE.all().length);
    var dupNote = plain(saveNoteBar());
    T('重复导入回执点明「第 N 场」', /第 \\d+ 场/.test(dupNote), dupNote.slice(0,120));
    T('重复导入回执说清「已切到那一场」', dupNote.indexOf('已切到那一场') >= 0, dupNote.slice(0,120));
    T('重复导入回执不误导（不出现「目前只有」）', dupNote.indexOf('目前只有') < 0, dupNote.slice(0,120));

    /* ===== 5. 新一天的记录必须成为最新一场 ===== */
    input(D5, '小雨', '2026-09-18');
    T('新一天录入后共 5 场', STORE.all().length === 5, STORE.all().length);
    T('当前场次是 09-18（没被去重拉回旧场）', STORE.get(ST.curId).date === '2026-09-18',
      STORE.get(ST.curId).date);
    T('保存回执说明记为第 5 场', plain(saveNoteBar()).indexOf('第 5 场') >= 0,
      plain(saveNoteBar()).slice(0,90));

    /* ===== 6. 8 个页面真实渲染 ===== */
    var views = ['import','library','report','compare','host','trend','issues','action'];
    views.forEach(function(v){
      try{ go(v); T('页面「' + v + '」有内容', txt().length > 200, txt().length + ' 字符'); }
      catch(e){ T('页面「' + v + '」有内容', false, e.message); }
    });

    /* ===== 7. 全部维度板块逐个切换（真实 DOM + Canvas） ===== */
    var okTabs = 0, badTabs = [];
    views.forEach(function(v){
      try{
        go(v);
        (tabsOf(v) || []).forEach(function(t){
          try{
            setTab(t.k);
            if(txt().length > 120) okTabs++; else badTabs.push(v + '/' + t.k + '(空)');
          }catch(e){ badTabs.push(v + '/' + t.k + '(' + e.message + ')'); }
        });
      }catch(e){ badTabs.push('page:' + v + '(' + e.message + ')'); }
    });
    T('全部维度板块可切换且都渲染出内容', badTabs.length === 0 && okTabs >= 18,
      okTabs + ' 个板块正常' + (badTabs.length ? ' / 异常: ' + badTabs.join('; ') : ''));

    /* ===== 8. 裁决：该优化还是继续走 ===== */
    go('compare'); setTab('verdict');
    var d = cmpDecide();
    T('有数据时 cmpDecide 返回决策', !!d, d && d.verdict && d.verdict.k);
    T('裁决落在四档之一', !!d && d.verdict && ['advance','hold','optimize','fix'].indexOf(d.verdict.k) >= 0,
      d && d.verdict && d.verdict.k);
    T('裁决有中文档名', !!(d && d.verdict && d.verdict.label), d && d.verdict && d.verdict.label);
    T('裁决给出可读结论（headline）', !!(d && d.verdict && d.verdict.headline),
      d && d.verdict && String(d.verdict.headline).slice(0,80));
    T('裁决说明了判断依据（reason）', !!(d && d.verdict && d.verdict.reason),
      d && d.verdict && String(d.verdict.reason).slice(0,90));
    T('5 场数据下样本量足够（不再说「样本还不够」）',
      !!d && d.sample >= 3 && String(d.verdict.reason).indexOf('样本还不够') < 0,
      d && ('sample=' + d.sample));
    var chainWeak = d && d.chain && d.chain.filter(function(x){ return x.rank < 0; });
    T('链路有弱点时必指认最弱环',
      !(chainWeak && chainWeak.length) || !!(d && d.weakest),
      d && d.weakest ? (d.weakest.label + ' 偏离 ' + d.weakest.d + '%')
                     : ('无弱点，链路各环都正常'));
    T('给出了可执行动作', !!(d && d.actions && d.actions.length > 0), d && d.actions && d.actions.length);
    T('链路各环都有状态', !!(d && d.chain && d.chain.length >= 5),
      d && d.chain && d.chain.map(function(x){ return x.key + '=' + x.state; }).join(' '));
    var vh = txt();
    T('结论与决策板块真实渲染出裁决', vh.length > 400 &&
      /继续推进|定向优化|立即纠偏|保持节奏|先积累/.test(vh), vh.length + ' 字符');
    log.push('');
    log.push('  ── 5 场数据下的实测裁决 ──');
    log.push('  档位：[' + (d && d.verdict && d.verdict.label) + ']');
    log.push('  结论：' + (d && d.verdict && d.verdict.headline));
    log.push('  依据：' + (d && d.verdict && d.verdict.reason));
    log.push('  最弱环：' + (d && d.weakest ? (d.weakest.label + '（偏离 ' + d.weakest.d + '%）')
                                            : '无（各环都在正常区间）'));
    (d && d.actions || []).forEach(function(a){ log.push('  动作[' + a.p + '] ' + (a.do || a.text || '')); });
    log.push('');

    /* ===== 9. 未知品类不能把诊断页打崩 ===== */
    var catBackup = ST.cat;
    ['不存在的品类','', null, '__proto__', 'constructor'].forEach(function(cat){
      ST.cat = cat;
      var ok = true, msg = '';
      try{ go('report'); if(txt().length < 300){ ok = false; msg = '内容过短'; } }
      catch(e){ ok = false; msg = e.message; }
      T('品类「' + String(cat) + '」时诊断页不崩', ok, msg);
    });
    ST.cat = catBackup;
    T('未知品类回落到通用基准', benchOf('不存在').entryRate === 19, benchOf('不存在').entryRate);
    T('原型链键不被当成基准', benchOf('__proto__').entryRate === 19, benchOf('__proto__').entryRate);
    T('已知品类仍取到自己的基准', benchOf('食品').entryRate === 21.2, benchOf('食品').entryRate);

    /* ===== 10. 保存状态可视化 ===== */
    go('library');
    T('顶栏保存状态指示可渲染', saveBadge().length > 10, saveBadge().length);
    T('顶栏已注入保存状态', document.getElementById('tbRight').innerHTML.length > 20,
      document.getElementById('tbRight').innerHTML.slice(0, 70));
    T('存储正常时不渲染环境预警', envWarn() === '', String(envWarn()).slice(0, 40));
    T('未导出时 exportAge 为 null', exportAge() === null, exportAge());
    markExported();
    T('标记导出后 exportAge 可读', exportAge() !== null, exportAge());

    /* ===== 11. 模拟「第二天重新打开页面」 ===== */
    var S2 = createStore(createLocalBackend());
    T('新开的 store 能读到之前存的 5 场', S2.all().length === 5, S2.all().length);
    var p = S2.progress();
    T('进度统计说清「录了几天、攒了几场」', p.n === 5 && p.days === 5, JSON.stringify(p));
    var h = S2.health();
    T('存储健康度可读', !!h && typeof h.ok === 'boolean', JSON.stringify(h).slice(0, 120));
    T('健康度判定为可用', h.level === 'ok' || h.level === 'warn', h.level);

    /* ===== 12. 返回键：点「看完整结论」之后必须回得来 =====
       这一节复现用户报的问题：从单场诊断点进「看完整结论」→ 场次对比，
       然后没有任何入口回到本场数据。全程用真实 DOM 点击，不直调函数。 */
    ST.tab.report = 'overview';
    go('report');
    var backBox = document.getElementById('tbBack');
    T('顶栏出现返回键', !!backBox && backBox.innerHTML.indexOf('← 返回') >= 0,
      backBox && plain(backBox.innerHTML).slice(0, 50));
    // 上一页是哪个取决于前面跑到哪儿了，所以只验证「确实指向某个真实页面」
    var backTxt = plain(backBox ? backBox.innerHTML : '');
    var pageNames = ['导入数据','场次库','单场诊断','场次对比','主播对比','趋势看板','问题库','行动清单'];
    T('返回键带上了要回到的页面名',
      pageNames.some(function(n){ return backTxt.indexOf(n) >= 0; }), backTxt);
    var reportHTML = txt();

    var vbtn = Array.prototype.filter.call(
      document.querySelectorAll('#scroll button'),
      function(b){ return b.textContent.indexOf('看完整结论') >= 0; })[0];
    T('诊断页能找到「看完整结论」按钮', !!vbtn, vbtn && vbtn.textContent);
    if(vbtn){
      vbtn.click();                                   // 真实点击
      T('点击后进入场次对比', ST.view === 'compare', ST.view);
      T('落在「结论与决策」板块', curTab('compare') === 'verdict', curTab('compare'));
      T('hash 已同步为 #/compare/verdict',
        String(location.hash) === '#/compare/verdict', location.hash);
      T('切页后本场数据没有丢', !!ST.M && !!ST.DIAG, [!!ST.M, !!ST.DIAG]);
      T('返回键改为指向「单场诊断」',
        plain(document.getElementById('tbBack').innerHTML).indexOf('单场诊断') >= 0,
        plain(document.getElementById('tbBack').innerHTML));

      var bbtn = document.querySelector('#tbBack button');
      T('返回键是真实可点的按钮', !!bbtn, bbtn && bbtn.textContent);
      if(bbtn){
        bbtn.click();                                 // 真实点击返回
        T('点返回后回到单场诊断', ST.view === 'report', ST.view);
        T('回到离开前那个板块（总览）', curTab('report') === 'overview', curTab('report'));
        T('诊断内容与离开时逐字节一致（数据确实没丢）', txt() === reportHTML,
          txt().length + ' 字符 vs 出发时 ' + reportHTML.length + ' 字符');
        T('hash 退回 #/report/overview',
          String(location.hash) === '#/report/overview', location.hash);
      }
    }
    /* 顶栏窄屏换页入口（窄屏下侧栏是 display:none，没有它就没法换页） */
    T('顶栏带窄屏换页入口', !!document.querySelector('#tbRight .only-narrow'), true);
    T('换页菜单容器存在且初始收起',
      !!document.getElementById('viewMenu') && document.getElementById('viewMenu').style.display === 'none',
      document.getElementById('viewMenu') && document.getElementById('viewMenu').style.display);

    log.push('');
    log.push('小结：' + (FAILS === 0 ? '全部通过' : (FAILS + ' 项失败')));
  }catch(e){
    log.push('FAIL | 探针整体异常 | ' + e.message + '\\n'
      + String(e.stack || '').split('\\n').slice(0, 4).join(' / '));
  }

  var out = document.createElement('pre');
  out.id = 'probeOut';
  out.textContent = '###ERR###\\n' + (errs.length ? errs.join('\\n') : '(无 JS 运行时错误)') +
                    '\\n###DIALOG###\\n' + (dialogs.length ? dialogs.join('\\n') : '(无弹窗)') +
                    '\\n###LOG###\\n' + log.join('\\n');
  document.body.appendChild(out);
})();
</script>
`;

/* ---------- 1b. 窄屏探针：验证 820px 以下不会「出不去」 ----------
   窄屏时 .side 是 display:none，侧栏导航完全消失。这条路径在宽屏和 DOM 桩里
   都测不到，必须用真实窄视口跑一遍：确认返回键和换页菜单都在。 */
const NARROW = DIR + '_probe_narrow.html';
const NARROW_PROFILE = DIR + '_cnarrow';

function buildNarrowProbe() {
  let html = fs.readFileSync(DIR + 'index.html', 'utf8');
  html = html.replace('</body>', NARROW_SCRIPT + '\n</body>');
  fs.writeFileSync(NARROW, html, 'utf8');
}

const NARROW_SCRIPT = `
<script>
(function(){
  var log = [], errs = [];
  window.onerror = function(m, s, l){ errs.push(m + ' @line' + l); };
  window.alert = function(){}; window.confirm = function(){ return true; };
  function T(n, c, e){ log.push((c ? 'PASS' : 'FAIL') + ' | ' + n +
    (e !== undefined ? ('  →  ' + String(e).slice(0, 130)) : '')); }
  function vis(el){ return !!(el && getComputedStyle(el).display !== 'none'); }
  try{
    var iw = window.innerWidth;
    var side = document.querySelector('.side');
    var wrap = document.querySelector('#tbRight .only-narrow');
    var btn  = wrap && wrap.querySelector('button');
    var menu = document.getElementById('viewMenu');

    T('窄视口生效（落在窄屏断点 960 以内）', iw <= 960, iw);
    T('窄屏下侧栏被隐藏（和宽屏行为一致）', side && getComputedStyle(side).display === 'none',
      side && getComputedStyle(side).display);
    T('窄屏下顶栏换页入口可见（否则完全出不去）', vis(wrap) && !!btn,
      wrap && getComputedStyle(wrap).display);
    T('菜单初始收起', !!menu && menu.style.display === 'none', menu && menu.style.display);

    if(btn){
      btn.click();
      T('点一下能展开菜单', menu.style.display !== 'none', menu.style.display);
      var items = menu.querySelectorAll('.vm-i');
      T('菜单里 8 个页面都在', items.length === 8, items.length);
      T('菜单有分组标题', (menu.innerHTML.match(/vm-sec/g) || []).length >= 3,
        (menu.innerHTML.match(/vm-sec/g) || []).length);
      T('菜单贴着视口内（fixed 定位没被顶栏裁掉）',
        menu.getBoundingClientRect().width > 100 && menu.getBoundingClientRect().right <= iw + 1,
        JSON.stringify(menu.getBoundingClientRect()));

      if(items[1]) items[1].click();               // 第 2 项 = 场次库（无需数据，不会被重定向）
      T('点菜单项能真的换页', ST.view === 'library', ST.view);
      T('换页后菜单自动收起', menu.style.display === 'none', menu.style.display);
      T('换页后顶栏出现返回键', document.getElementById('tbBack').innerHTML.indexOf('← 返回') >= 0,
        document.getElementById('tbBack').innerHTML.slice(0, 50));
      var bb = document.querySelector('#tbBack button');
      T('返回键在窄屏下可见', vis(document.getElementById('tbBack')), true);
      if(bb){
        bb.click();
        T('窄屏下返回键能把人带回去', ST.view === 'import' || ST.view === 'report' || ST.view === 'library',
          ST.view);
      }
    }
  }catch(e){ log.push('FAIL | 窄屏探针异常 | ' + e.message); }
  var out = document.createElement('pre');
  out.id = 'probeOut';
  out.textContent = '###ERR###\\n' + (errs.length ? errs.join('\\n') : '(无 JS 运行时错误)') +
                    '\\n###LOG###\\n' + log.join('\\n');
  document.body.appendChild(out);
})();
</script>
`;

/* ---------- 2. 拉起无头 Chrome，硬超时兜底 ---------- */
function runChrome(timeoutMs, opts) {
  opts = opts || {};
  const probePath = opts.probe || PROBE;
  const profile = opts.profile || PROFILE;
  const args = [
    '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-dev-shm-usage',
    '--mute-audio', '--allow-file-access-from-files',
    '--user-data-dir=' + profile,
    '--dump-dom', 'file:///' + probePath,
  ];
  if (opts.size) args.splice(1, 0, '--window-size=' + opts.size);
  return new Promise(resolve => {
    if (!fs.existsSync(CHROME)) {
      resolve({ ok: false, reason: '未找到 Chrome：' + CHROME });
      return;
    }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '', err = '', done = false;
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    const killer = setTimeout(() => { if (!done) { try { p.kill('SIGKILL'); } catch (e) {} } }, timeoutMs);

    p.on('exit', () => {
      if (done) return; done = true; clearTimeout(killer);
      const m = out.match(/<pre id="probeOut">([\s\S]*?)<\/pre>/);
      resolve({
        ok: true,
        dumped: !!m,
        bytes: out.length,
        text: m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                          .replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '',
        err,
      });
    });
  });
}

/* ---------- 3. 主流程 ---------- */
function summarize(r) {
  const lines = r.text.split('\n');
  const results = lines.filter(l => /^(PASS|FAIL)/.test(l));
  const fails = results.filter(l => l.indexOf('FAIL') === 0);
  return { lines, results, fails, pass: results.length - fails.length };
}
function printRun(title, r, splitDialog) {
  const s = summarize(r);
  console.log('\n' + '─'.repeat(58));
  console.log(title);
  console.log('─'.repeat(58));
  s.lines.filter(l => /^(PASS|FAIL)/.test(l) || /^\s*─|^\s*档位|^\s*结论|^\s*依据|^\s*动作/.test(l))
         .forEach(l => console.log('  ' + l));
  const head = splitDialog ? r.text.split('###DIALOG###')[0] : r.text.split('###LOG###')[0];
  console.log('\n' + head.replace('###ERR###', '运行时错误：').trim());
  console.log(title + ' → 通过 ' + s.pass + '，失败 ' + s.fails.length);
  return s;
}

(async () => {
  console.log('真实浏览器冒烟测试（无头 Chrome）');
  console.log('='.repeat(58));

  /* --- 宽屏：完整用户路径 --- */
  buildProbe();
  const wide = await runChrome(60000, { size: '1280,900' });
  if (!wide.ok) { console.log('无法运行：' + wide.reason); process.exit(1); }
  if (!wide.dumped) {
    console.log('浏览器未返回探针结果（输出 ' + wide.bytes + ' 字节）。');
    console.log('最常见原因：页面里的 alert/confirm 没被屏蔽，把渲染进程阻塞了。');
    if (wide.err) console.log('stderr: ' + wide.err.slice(0, 400));
    process.exit(1);
  }
  const w = printRun('真实浏览器 1280px', wide, true);

  /* --- 窄屏：侧栏消失后是否还能换页 / 返回 --- */
  buildNarrowProbe();
  const narrow = await runChrome(45000, { size: '760,900', probe: NARROW, profile: NARROW_PROFILE });
  let n = { fails: [], pass: 0, results: [] };
  if (!narrow.ok || !narrow.dumped) {
    console.log('\n窄屏探针未能返回结果（' + (narrow.reason || narrow.bytes + ' 字节') + '）');
    n = { fails: [{ length: 1 }], pass: 0, results: [{}, {}] };
  } else {
    n = printRun('真实浏览器 760px（窄屏）', narrow, false);
  }

  const totalPass = w.pass + n.pass;
  const totalFail = w.fails.length + n.fails.length;
  console.log('\n' + '='.repeat(58));
  console.log('真实浏览器合计：通过 ' + totalPass + '，失败 ' + totalFail);

  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(NARROW_PROFILE, { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(PROBE, { force: true }); } catch (e) {}
  try { fs.rmSync(NARROW, { force: true }); } catch (e) {}
  process.exit(totalFail ? 1 : 0);
})();
