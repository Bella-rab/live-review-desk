/* ============================================================
   跨天使用模拟测试
   ------------------------------------------------------------
   直接回答用户提的三个问题：
     1) 我今天录入，明天打开还在吗？        → 第 2~5 节
     2) 第二天、第三天再录入，能对比吗？      → 第 6 节
     3) 对比之后有没有告诉我该怎么办？        → 第 7 节
     4) 万一存不住，我会不会知道？            → 第 8 节（关键防呆）
   ============================================================ */
const fs = require('fs');
const DIR = 'C:/Users/24425/WorkBuddy/2026-09-14-20-29-26/';
const eng = fs.readFileSync(DIR+'engine.js','utf8');
const sto = fs.readFileSync(DIR+'store.js','utf8');
const SRC = eng + '\n' + sto;

let pass=0, fail=0;
const A = (name, cond, extra) => {
  if(cond){ pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra!==undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const hr = t => console.log('\n' + '─'.repeat(60) + '\n' + t);

/* 一个可控的 localStorage 模拟：能正常用、能抛错、能静默丢弃 */
function mkStorage(mode){
  const d = {};
  return {
    _d: d,
    getItem(k){ return (k in d) ? d[k] : null; },
    setItem(k, v){
      if(mode === 'throw'){ const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      if(mode === 'silent') return;              // 假装写了，其实没写
      d[k] = String(v);
    },
    removeItem(k){ delete d[k]; },
  };
}

/* 用一套源码构造运行环境（每次调用都是全新的「一次页面加载」） */
function boot(){
  const API = new Function(SRC + `; return {createStore, createLocalBackend, createMemoryBackend,
    normalize, runDiagnosis, decide, snapshotOf, pctGap, trendSlope};`)();
  return API;
}

/* 造一场数据：走真实的 normalize 链路 */
function makeSession(API, s){
  const M = API.normalize([{
    views:s.views, avgStay:s.stay, gmv:s.gmv, entryRate:s.entry,
    cvr:s.cvr, refundRate:s.refund, paidRate:s.paid, avgOnline:s.online||120,
  }], {category:'服饰'});
  return {M, DIAG:API.runDiagnosis(M)};
}

/* 四天的数据：前两天爬坡，第三天最好，第四天回落且停留明显变差 */
const DAYS = [
  {date:'2026-09-14', host:'小雨', views:9800,  stay:52, gmv:88000,  entry:19.2, cvr:8.2, refund:7.4,  paid:32},
  {date:'2026-09-15', host:'小雨', views:10400, stay:58, gmv:104000, entry:20.4, cvr:9.1, refund:6.2,  paid:30},
  {date:'2026-09-16', host:'小雨', views:11200, stay:64, gmv:126000, entry:21.2, cvr:10.1,refund:5.4,  paid:28},
  {date:'2026-09-17', host:'小雨', views:10100, stay:47, gmv:91000,  entry:19.6, cvr:7.4, refund:8.2,  paid:31},
];

hr('1. 后端能力：正常存储、回读校验、失败可见');
{
  global.localStorage = mkStorage('ok');
  const API = boot();
  const S = API.createStore(API.createLocalBackend());
  const {M,DIAG} = makeSession(API, DAYS[0]);
  const r = S.add({M, DIAG, raw:'x', category:'服饰', hostName:'小雨', date:DAYS[0].date});
  A('写入成功', r.saved === true, r.saved);
  A('health 报告正常', S.health().level === 'ok', S.health().level);
  A('后端类型可识别', S.saveState().backend === 'localStorage', S.saveState().backend);
  A('后端可用性探测通过', S.health().available === true);
}

hr('2. 关键防呆：localStorage 静默丢弃时，必须报错而不是假装成功');
{
  // 这是最危险的情况：setItem 不抛异常，但数据根本没存进去。
  // 旧实现只 try/catch，会当成成功——用户第二天才发现数据没了。
  global.localStorage = mkStorage('silent');
  const API = boot();
  const S = API.createStore(API.createLocalBackend());
  const {M,DIAG} = makeSession(API, DAYS[0]);
  const r = S.add({M, DIAG, raw:'x', category:'服饰', hostName:'小雨', date:DAYS[0].date});
  A('静默丢弃被识别为保存失败', r.saved === false, r.saved);
  A('health 标记为 bad', S.health().level === 'bad', S.health().level);
  A('错误信息说明了原因', /读回为空|截断|配额|存储/.test(S.saveState().error || ''), S.saveState().error);
  A('内存里仍有记录（不会凭空消失）', S.count() === 1, S.count());
}

hr('3. 关键防呆：配额写满（抛异常）时也要说清楚');
{
  global.localStorage = mkStorage('throw');
  const API = boot();
  const S = API.createStore(API.createLocalBackend());
  const {M,DIAG} = makeSession(API, DAYS[0]);
  const r = S.add({M, DIAG, raw:'x', category:'服饰', hostName:'小雨', date:DAYS[0].date});
  A('抛异常时 saved=false', r.saved === false);
  A('错误提示可读（提到存储空间）', /存储空间|已满|quota/i.test(S.saveState().error || ''), S.saveState().error);
}

hr('4. 跨天留存：今天存进去，明天（新一次页面加载）还在吗');
{
  global.localStorage = mkStorage('ok');
  let API = boot();
  // ---- 第 1 天 ----
  let S = API.createStore(API.createLocalBackend());
  const d1 = makeSession(API, DAYS[0]);
  S.add({M:d1.M, DIAG:d1.DIAG, raw:'day1', category:'服饰', hostName:'小雨', date:DAYS[0].date});
  A('第 1 天：存了 1 场', S.count() === 1, S.count());
  S = null;   // 关掉页面

  // ---- 第 2 天：全新加载，同一份本机存储 ----
  API = boot();
  S = API.createStore(API.createLocalBackend());
  A('第 2 天：昨天那场还在', S.count() === 1, S.count());
  A('第 2 天：日期数据完整', S.all()[0] && S.all()[0].date === '2026-09-14', S.all()[0] && S.all()[0].date);
  A('第 2 天：原始文本也在（可重新解析）', !!S.all()[0].raw, S.all()[0].raw);
  A('第 2 天：快照指标可用', S.all()[0].snapshot.gmv === 88000, S.all()[0].snapshot.gmv);

  // 导入第 2 场
  const d2 = makeSession(API, DAYS[1]);
  S.add({M:d2.M, DIAG:d2.DIAG, raw:'day2', category:'服饰', hostName:'小雨', date:DAYS[1].date});
  A('第 2 天：变成 2 场，第 1 场没被覆盖', S.count() === 2, S.count());
  S = null;

  // ---- 第 3 天 ----
  API = boot();
  S = API.createStore(API.createLocalBackend());
  A('第 3 天：前两天都还在', S.count() === 2, S.count());
  const d3 = makeSession(API, DAYS[2]);
  S.add({M:d3.M, DIAG:d3.DIAG, raw:'day3', category:'服饰', hostName:'小雨', date:DAYS[2].date});
  A('第 3 天：3 场', S.count() === 3, S.count());
  A('第 3 天：进度统计正确', S.progress().days === 3, S.progress());
  S = null;

  // ---- 第 4 天 ----
  API = boot();
  S = API.createStore(API.createLocalBackend());
  A('第 4 天：前三天都还在', S.count() === 3, S.count());
  const d4 = makeSession(API, DAYS[3]);
  S.add({M:d4.M, DIAG:d4.DIAG, raw:'day4', category:'服饰', hostName:'小雨', date:DAYS[3].date});
  A('第 4 天：4 场', S.count() === 4, S.count());

  // ---- 第 5 天再看一次：确认没有"越用越少" ----
  S = null;
  API = boot();
  S = API.createStore(API.createLocalBackend());
  A('第 5 天打开：4 场完整保留', S.count() === 4, S.count());
  A('第 5 天：时间顺序正确（旧→新）',
    S.ordered().map(x=>x.date).join(',') === '2026-09-14,2026-09-15,2026-09-16,2026-09-17',
    S.ordered().map(x=>x.date));
  global.__S = S; global.__API = API;
}

hr('5. 去重：同一天同一份数据重复导入，不应该把均值拉偏');
{
  const S = global.__S, API = global.__API;
  const before = S.count();
  const d4 = makeSession(API, DAYS[3]);
  const r = S.add({M:d4.M, DIAG:d4.DIAG, raw:'day4', category:'服饰', hostName:'小雨', date:DAYS[3].date});
  A('识别为重复', r.dup === true, r.dup);
  A('场次数没变', S.count() === before, [before, S.count()]);
}

hr('6. 对比：第 4 天打开时，前 3 天的数据能拿来比吗');
{
  const S = global.__S;
  const all = S.all();
  const cur = all[0];
  A('本场 = 最新一场 09-17', cur.date === '2026-09-17', cur.date);

  const prev = S.previous(cur.id);
  A('找得到上一场 = 09-16', prev && prev.date === '2026-09-16', prev && prev.date);

  const base = S.baseline(cur.id);
  A('历史基准含 3 场', base.__n === 3, base.__n);

  // 停留：本场 47，上场 64，基准 (52+58+64)/3=58
  A('停留基准算对', Math.abs(base.stay - 58) < 0.01, base.stay);
  const gapPrev = (cur.snapshot.stay - prev.snapshot.stay)/prev.snapshot.stay*100;
  A('停留环比上场明显下降', gapPrev < -20, gapPrev.toFixed(1));
  const gapBase = (cur.snapshot.stay - base.stay)/base.stay*100;
  A('停留低于基准', gapBase < 0, gapBase.toFixed(1));

  console.log('    本场 / 上场 / 基准：GMV ' + cur.snapshot.gmv + ' / ' + prev.snapshot.gmv + ' / ' + Math.round(base.gmv));
  console.log('    停留 ' + cur.snapshot.stay + 's / ' + prev.snapshot.stay + 's / ' + base.stay.toFixed(1) + 's');

  // 跨场趋势（到这行为止）
  A('趋势序列含 4 场', S.ordered().length === 4, S.ordered().length);
  A('问题追踪返回数组', Array.isArray(S.issueTrends()), true);
  A('主播聚合可用', S.byHost().length === 1, S.byHost().length);
}

hr('7. 决策：对比之后，有没有告诉我「该优化还是继续往下走」');
{
  const S = global.__S, API = global.__API;
  const all = S.all();
  const cur = all[0], prev = S.previous(cur.id), base = S.baseline(cur.id);
  const ordered = S.ordered().map(x=>x.snapshot);

  const d = API.decide(cur.snapshot, prev.snapshot, base, ordered, {n:ordered.length});

  console.log('    裁决：[' + d.verdict.label + '] ' + d.verdict.headline);
  console.log('    依据：' + d.verdict.reason.slice(0, 110) + '…');
  console.log('    最弱环：' + (d.weakest ? d.weakest.label + '（' + d.weakest.stateLabel + '）' : '无'));
  console.log('    动作 ' + d.actions.length + ' 条：');
  d.actions.forEach(a=>console.log('      [' + a.p + '] ' + a.do));

  A('给出了明确裁决', !!d.verdict.k && !!d.verdict.label, d.verdict.k);
  A('裁决属于四档之一', ['advance','hold','optimize','fix'].includes(d.verdict.k), d.verdict.k);
  A('有一句话结论', (d.verdict.headline||'').length > 10, (d.verdict.headline||'').length);
  A('说明了判断依据', (d.verdict.reason||'').length > 20, (d.verdict.reason||'').length);
  A('链路各环都有状态', d.chain.length === 6 && d.chain.every(x=>!!x.state), d.chain.map(x=>x.key+':'+x.state));
  A('识别出链路有弱点', !!(d.weakest && d.weakest.rank < 0), d.weakest && d.weakest.key);
  A('最弱环取偏离最大的那项（退款率 +29%）', d.weakest && d.weakest.key === 'refund', d.weakest && d.weakest.key);
  // 关键回归：链路有断点时，绝不能判「继续推进／各项都稳」
  {
    const broken = d.chain.filter(x=>x.state==='broken');
    const contradiction = (d.verdict.k==='advance' || d.verdict.k==='hold') && broken.length>0;
    A('裁决与链路状态不矛盾（有断点就不说"都稳"）', !contradiction,
      contradiction ? ('断点 ' + broken.map(x=>x.label).join(',') + ' 却判 ' + d.verdict.k) : 'ok');
  }
  // 健康分应能反映指标偏离，而不是只数规则命中
  A('健康分已反映指标偏离（<90）', cur.snapshot.score < 90, cur.snapshot.score);
  {
    const S2 = global.__S, AP2 = global.__API;
    const chk = AP2.runDiagnosis(makeSession(AP2, DAYS[3]).M);
    A('偏离惩罚确实生效（penalty > 0）', chk.penalty > 0, chk.penalty);
    console.log('    健康分 ' + chk.score + '（规则扣分后，再扣指标偏离 ' + chk.penalty + ' 分）');
  }
  A('给出 ≥1 条动作', d.actions.length >= 1, d.actions.length);
  A('每条动作有目标/责任人/做法', d.actions.every(a=>a.target && a.owner && a.how));
  A('动作有优先级分级', d.actions.every(a=>['P0','P1','P2'].includes(a.p)), d.actions.map(a=>a.p));
  A('有差距明细（两个口径）', d.gaps.length >= 1 && d.gaps.every(g=>g.key), d.gaps.length);
  A('样本量被记录', d.sample === 4, d.sample);
}

hr('8. 换电脑/清缓存后，靠备份文件能不能救回来');
{
  global.localStorage = mkStorage('ok');
  let API = boot();
  let S = API.createStore(API.createLocalBackend());
  const d1 = makeSession(API, DAYS[0]);
  S.add({M:d1.M, DIAG:d1.DIAG, raw:'day1', category:'服饰', hostName:'小雨', date:DAYS[0].date});
  const backup = S.exportJSON();
  A('导出的备份是合法 JSON', (()=>{ try{ JSON.parse(backup); return true; }catch(e){ return false; } })());

  // 模拟清空浏览器数据 → 换台机器重新导入备份
  global.localStorage = mkStorage('ok');
  API = boot();
  S = API.createStore(API.createLocalBackend());
  A('新环境初始为空', S.count() === 0, S.count());
  const r = S.importJSON(backup);
  A('导入备份成功', r.ok === true && r.added === 1, r);
  A('数据完整恢复', S.count() === 1 && S.all()[0].snapshot.gmv === 88000, S.count());

  // 重复导入备份不应翻倍
  const r2 = S.importJSON(backup);
  A('重复导入不会翻倍', r2.added === 0 && S.count() === 1, r2);
}

hr('9. 边界：空仓库、单场、异常后端都不能崩');
{
  let ok = true, msg = '';
  try{
    global.localStorage = mkStorage('ok');
    const API = boot();
    const S = API.createStore(API.createLocalBackend());
    S.all(); S.ordered(); S.baseline(); S.byHost(); S.issueTrends();
    S.progress(); S.health(); S.saveState(); S.exportJSON();
    S.importJSON('not json'); S.importJSON('{}'); S.importJSON('[]');
    S.previous('nope'); S.get('nope'); S.remove('nope'); S.update('nope', {});
    if(S.count() !== 0) { ok = false; msg = '空仓库被污染'; }
  }catch(e){ ok = false; msg = e.message; }
  A('空仓库 + 各种异常输入都能安全处理', ok, msg);
}

console.log('\n' + '='.repeat(60));
console.log('通过 ' + pass + ' ，失败 ' + fail);
process.exit(fail ? 1 : 0);
