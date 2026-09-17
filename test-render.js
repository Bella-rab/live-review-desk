/* 渲染冒烟测试：无头 DOM 桩，验证 8 个页面渲染不抛异常且内容正确
   node test-render.js */
const fs = require('fs');
const DIR = 'C:/Users/24425/WorkBuddy/2026-09-14-20-29-26/';

let pass=0, fail=0;
function A(n,c,g){ c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+'  实际: '+JSON.stringify(g))); }
function hr(t){ console.log('\n─── '+t); }

/* ---------- DOM 桩 ---------- */
const els = {};
function mkClassList(){ const s=new Set(); return {add:c=>s.add(c),remove:c=>s.delete(c),toggle:(c,on)=>{on?s.add(c):s.delete(c)},contains:c=>s.has(c)}; }
function mkEl(id){
  const el = {
    id, tagName:'DIV', _html:'', _text:'', _val:'',
    style:{}, dataset:{}, classList:mkClassList(),
    clientHeight:200, clientWidth:600, width:600, height:200,
    parentElement:null, files:[],
  };
  Object.defineProperty(el,'innerHTML',{get(){return el._html},set(v){el._html=String(v)}});
  Object.defineProperty(el,'textContent',{get(){return el._text},set(v){el._text=String(v)}});
  Object.defineProperty(el,'value',{get(){return el._val},set(v){el._val=String(v)}});
  el.addEventListener = ()=>{};
  el.removeEventListener = ()=>{};
  el.appendChild = ()=>{};
  el.querySelectorAll = ()=>[];
  el.click = ()=>{}; el.focus = ()=>{}; el.remove = ()=>{};
  el.getContext = ()=> new Proxy({}, { get:(t,k)=>{
    if(k==='canvas') return {width:600,height:200};
    return ()=>{};
  }, set:()=>true });
  el.getBoundingClientRect = ()=>({left:0,top:0,width:600,height:200});
  return el;
}
function getEl(id){
  if(!els[id]){
    els[id]=mkEl(id);
    els[id].parentElement = { clientHeight:200, clientWidth:600 };
  }
  return els[id];
}
global.document = {
  getElementById: getEl,
  querySelectorAll: ()=>[],
  querySelector: ()=>null,
  createElement: t=>mkEl(t),
  body: mkEl('body'),
  addEventListener: ()=>{},
  documentElement: mkEl('html'),
};
global.window = { devicePixelRatio:1, addEventListener:()=>{}, print:()=>{}, innerWidth:1200 };
global.requestAnimationFrame = fn => { fn(); };
global.alert = ()=>{};
global.confirm = ()=>true;
global.prompt = ()=>'x';
global.navigator = { clipboard:{ writeText:()=>Promise.resolve() } };
global.localStorage = { _d:{}, getItem(k){return this._d[k]||null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
global.Blob = function(){};
global.URL = { createObjectURL:()=>'blob:x', revokeObjectURL:()=>{} };
global.FileReader = function(){ this.readAsText=()=>{}; this.onload=null; };
global.self = global;

/* ---------- 拼装脚本 ---------- */
const engineSrc = fs.readFileSync(DIR+'engine.js','utf8');
const storeSrc  = fs.readFileSync(DIR+'store.js','utf8');
const pageSrc   = [...fs.readFileSync(DIR+'index.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const src = engineSrc + '\n' + storeSrc + '\n' + pageSrc;

hr('1. 脚本整体加载');
let ctx;
try{
  ctx = new Function(src + `
    return { go, STORE, ST, esc, fmtK, todayStr, updateBadges, setTab, curTab, tabsOf, SUBTABS,
      renderImport, renderLibrary, renderReport, renderCompare, renderHost,
      renderTrend, renderIssues, renderAction, loadSession, switchCompare,
      loadLatest, readImportMeta, analyze, seedDemoHistory,
      saveBadge, saveNoteBar, verdictBar, cmpDecide, renderVerdict, markExported, exportAge, envWarn,
      benchOf, BENCHMARKS,
      normalize, runDiagnosis, issuesToTodos, splitBlocks, parseTable, parseDelimited };
  `)();
  A('脚本无语法/运行错误', true);
}catch(e){
  A('脚本无语法/运行错误', false, e.message);
  console.log('\n'+'='.repeat(58));
  console.log(`渲染冒烟测试：通过 ${pass}，失败 ${fail}`);
  process.exit(1);
}

const scrollHTML = ()=> getEl('scroll').innerHTML;

hr('2. 空仓库时各页面渲染');
try{
  ctx.renderImport();
  A('导入页（空库）', scrollHTML().length>500, scrollHTML().length);
  ctx.renderLibrary();
  A('场次库（空库显示引导）', scrollHTML().includes('场次库还是空的'), scrollHTML().slice(0,60));
  // 空库时分析页会被重定向到导入页（正确行为），所以直接调渲染函数而非 go()
  ctx.renderCompare(); A('场次对比（空库显示引导）', scrollHTML().includes('还没有可对比的场次'));
  ctx.renderTrend();   A('趋势看板（空库显示引导）', scrollHTML().includes('趋势需要至少 2 场'));
  ctx.renderIssues();  A('问题库（空库显示引导）', scrollHTML().includes('问题库需要多场数据'));
  ctx.renderHost();    A('主播对比（空库显示引导）', scrollHTML().includes('还没有主播数据'));
}catch(e){ A('空库渲染', false, e.message); }

hr('3. 灌入 6 场真实历史');
try{
  const scenes = [
    {host:'小雨', date:'2026-09-09', views:9800,  stay:52, gmv:88000,  entry:19.2, cvr:8.2, refund:7.4,  paid:32},
    {host:'小雨', date:'2026-09-10', views:10400, stay:58, gmv:104000, entry:20.4, cvr:9.1, refund:6.2,  paid:30},
    {host:'小满', date:'2026-09-11', views:9600,  stay:41, gmv:86420,  entry:19.4, cvr:6.8, refund:18.6, paid:34},
    {host:'阿静', date:'2026-09-12', views:11200, stay:61, gmv:118000, entry:21.0, cvr:9.8, refund:6.0,  paid:28},
    {host:'小雨', date:'2026-09-13', views:10600, stay:56, gmv:96000,  entry:19.8, cvr:8.6, refund:7.0,  paid:31},
    {host:'小满', date:'2026-09-14', views:11800, stay:64, gmv:132000, entry:21.6, cvr:10.3,refund:5.6,  paid:27},
  ];
  scenes.forEach(s=>{
    const raw = ['观看人数\t'+s.views, '平均停留时长\t'+s.stay+'秒', 'GMV\t'+s.gmv,
      '曝光进入率\t'+s.entry+'%', '成交转化率\t'+s.cvr+'%', '退款率\t'+s.refund+'%',
      '付费流量占比\t'+s.paid+'%'].join('\n');
    const M = ctx.normalize([{views:s.views,avgStay:s.stay,gmv:s.gmv,entryRate:s.entry,
      cvr:s.cvr,refundRate:s.refund,paidRate:s.paid}], {category:'服饰'});
    ctx.STORE.add({M, DIAG:ctx.runDiagnosis(M), raw, category:'服饰', hostName:s.host, date:s.date, note:''});
  });
  A('已灌入 6 场', ctx.STORE.count()===6, ctx.STORE.count());
  A('每场都有健康分', ctx.STORE.all().every(x=>x.snapshot.score!=null), ctx.STORE.all().map(x=>x.snapshot.score));
  // 设为当前场次
  ctx.ST.curId = ctx.STORE.all()[0].id;
  ctx.ST.M = ctx.normalize([{views:11800,avgStay:64,gmv:132000,entryRate:21.6,cvr:10.3,refundRate:5.6,paidRate:27}],{category:'服饰'});
  ctx.ST.DIAG = ctx.runDiagnosis(ctx.ST.M);
  ctx.ST.todos = ctx.issuesToTodos(ctx.ST.DIAG.issues);
  A('当前场次已设定', !!ctx.ST.curId, ctx.ST.curId);
}catch(e){ A('灌入示例历史', false, e.message); }

hr('4. 有数据后渲染全部页面');
['library','compare','host','trend','issues','action','report'].forEach(v=>{
  try{
    ctx.go(v);
    const h = scrollHTML();
    A('渲染 '+v+'（'+h.length+' 字符）', h.length>800, h.length);
  }catch(e){ A('渲染 '+v, false, e.message); }
});

hr('5. 页面内容结构校验');
try{
  ctx.go('library');
  let h = scrollHTML();
  A('场次库含全部日期', ['2026-09-09','2026-09-14'].every(d=>h.includes(d)), true);
  A('场次库含 3 位主播', ['小雨','小满','阿静'].every(n=>h.includes(n)), true);
  A('场次库含操作按钮', h.includes('诊断') && h.includes('改') && h.includes('删'), true);
  A('场次库含累计 GMV 概览', h.includes('累计 GMV'), true);

  ctx.go('compare');
  h = scrollHTML();
  A('对比页含「对比基准」选择器', h.includes('对比基准'), true);
  // 对比页默认落在「结论与决策」板块
  A('对比页默认板块 = 结论与决策', h.includes('本场裁决'), true);
  A('裁决板块含链路拆解', h.includes('差距在哪一环'), true);
  A('裁决板块含差距明细', h.includes('比出了什么'), true);
  A('裁决板块含下一步动作', h.includes('下一步怎么做'), true);
  A('裁决板块给出明确裁决语', /继续推进|保持节奏|定向优化|立即纠偏|先积累样本/.test(h), true);
  ctx.setTab('gap');
  h = scrollHTML();
  A('对比页·差距概览含对比结论', h.includes('对比结论'), true);
  ctx.setTab('detail');
  h = scrollHTML();
  A('对比页·指标明细含三列对比表', h.includes('三列对比'), true);
  A('对比页·指标明细含场次明细表', h.includes('场次明细'), true);

  ctx.go('trend');
  h = scrollHTML();
  A('趋势页 KPI >= 4', (h.match(/kpi-v/g)||[]).length>=4, (h.match(/kpi-v/g)||[]).length);
  A('趋势页含 3 个画布', (h.match(/<canvas/g)||[]).length>=3, (h.match(/<canvas/g)||[]).length);
  ctx.setTab('insight');
  h = scrollHTML();
  A('趋势页·趋势解读板块含解读', h.includes('趋势解读'), true);

  ctx.go('host');
  h = scrollHTML();
  A('主播页含 3 位主播', ['小雨','小满','阿静'].every(n=>h.includes(n)), true);
  A('主播页默认板块含效率排行', h.includes('主播效率排行'), true);
  ctx.setTab('profile');
  h = scrollHTML();
  A('主播页·能力诊断含排班建议', h.includes('排班建议'), true);
  A('主播页·能力诊断含当前主播定位', h.includes('当前主播定位'), true);

  ctx.go('issues');
  h = scrollHTML();
  A('问题库含追踪列表', h.includes('问题追踪'), true);
  ctx.setTab('plan');
  h = scrollHTML();
  A('问题库·整改建议含开播前检查清单', h.includes('开播前检查清单'), true);

  ctx.go('action');
  h = scrollHTML();
  A('行动清单含待办', h.includes('待办') || h.includes('行动'), true);
}catch(e){ A('内容结构检查', false, e.message); }

hr('6. 关键交互');
try{
  const all = ctx.STORE.all();
  // loadSession：从库里载入某场
  let ok = true, err='';
  try{ ctx.loadSession(all[1].id); }catch(e){ ok=false; err=e.message; }
  A('loadSession 可调用', ok, err);
  A('loadSession 后 curId 更新', ctx.ST.curId===all[1].id, ctx.ST.curId);
  A('loadSession 后诊断可用', !!ctx.ST.DIAG, !!ctx.ST.DIAG);

  // switchCompare
  ok=true; err='';
  try{ ctx.switchCompare(all[0].id); }catch(e){ ok=false; err=e.message; }
  A('switchCompare 可调用', ok, err);
  A('switchCompare 后对比页重渲染', scrollHTML().includes('对比基准'), true);

  // updateBadges
  ok=true; err='';
  try{ ctx.updateBadges(); }catch(e){ ok=false; err=e.message; }
  A('updateBadges 可调用', ok, err);
  A('场次库徽标显示 6', getEl('libCnt').textContent==='6', getEl('libCnt').textContent);

  A('fmtK 格式化正确', ctx.fmtK(132000)==='13.2万', ctx.fmtK(132000));
  A('esc 转义正确', ctx.esc('<b>&')==='&lt;b&gt;&amp;', ctx.esc('<b>&'));
  A('todayStr 格式正确', /^\d{4}-\d{2}-\d{2}$/.test(ctx.todayStr()), ctx.todayStr());
}catch(e){ A('交互函数', false, e.message); }

hr('7. 数据一致性：页面数字必须与仓库一致');
try{
  const all = ctx.STORE.all();
  const newest = all[0];   // 2026-09-14, gmv 132000
  ctx.go('library');
  const h = scrollHTML();
  A('场次库显示 13.2万（最新场 GMV）', h.includes('13.2万'), true);
  A('总场次数 6 出现', h.includes('>6<'), true);
  ctx.go('compare');
  const h2 = scrollHTML();
  const curSnap = ctx.STORE.get(ctx.ST.curId).snapshot;
  A('对比页本场 GMV 与仓库一致',
    h2.includes(Math.round(curSnap.gmv).toLocaleString()) || h2.includes(ctx.fmtK(curSnap.gmv)), curSnap.gmv);
}catch(e){ A('数据一致性', false, e.message); }

hr('10. 数据可靠性界面：用户能不能看见「数据存住了没」');
try{
  // 保存状态徽标（顶栏）
  const sb = ctx.saveBadge();
  A('保存状态徽标已渲染', sb.length > 10, sb.slice(0,60));
  A('正常时显示「已存本机」', sb.includes('已存本机'), sb);
  A('徽标里的场次数与仓库一致', sb.includes(String(ctx.STORE.count())), [sb, ctx.STORE.count()]);

  // 存档回执（导入后立刻显示）
  ctx.ST.saveNote = {k:'ok', txt:'已记录为第 3 场（2026-09-14 · 小雨）。下次导入会自动和这一场对比。'};
  A('存档成功有明确回执', ctx.saveNoteBar().includes('已记录为第 3 场'), ctx.saveNoteBar().slice(0,70));
  A('回执里说清了「下次会自动对比」', ctx.saveNoteBar().includes('自动'), true);
  ctx.ST.saveNote = {k:'bad', txt:'没能写进本机存储'};
  A('保存失败回执带导出按钮', ctx.saveNoteBar().includes('导出'), true);
  ctx.ST.saveNote = {k:'dup', txt:'这一场和已存过的数据完全一致'};
  A('重复导入有专门说明（不拉偏均值）', ctx.saveNoteBar().includes('重复') || ctx.saveNoteBar().includes('一致'), true);
  ctx.ST.saveNote = null;
  A('无回执时不渲染空条', ctx.saveNoteBar()==='', ctx.saveNoteBar());

  // 走真实 analyze() 路径复现「同一份数据导两遍」：
  // 回执必须说清「切到了哪一场」，否则用户会以为「我刚导的数据怎么变成旧场次的结论了」
  const SAME = [
    '观看人数\t12800','平均停留时长\t47秒','GMV\t91200',
    '曝光进入率\t18.2%','成交转化率\t6.4%','退款率\t9.8%','付费流量占比\t38%',
  ].join('\n');
  const importOnce = () => {
    ctx.go('import');
    ctx.ST.text = SAME;
    getEl('impHost').value = '小雨';
    getEl('impDate').value = '2026-09-14';
    ctx.analyze();
  };
  importOnce();
  const nAfterFirst = ctx.STORE.count();
  const seqFirst = ctx.STORE.all().find(s=>s.date==='2026-09-14').seq;
  importOnce();                                  // 同一份数据再导一遍
  A('同一份数据二次导入不新增场次', ctx.STORE.count() === nAfterFirst, [nAfterFirst, ctx.STORE.count()]);
  const dupTxt = ctx.ST.saveNote && ctx.ST.saveNote.txt || '';
  A('重复导入回执类型为 dup', ctx.ST.saveNote && ctx.ST.saveNote.k === 'dup', ctx.ST.saveNote && ctx.ST.saveNote.k);
  A('重复导入回执点明「第 N 场」（数字）', /第 \d+ 场/.test(dupTxt), dupTxt);
  A('回执里的场次号与仓库一致', dupTxt.includes('第 ' + seqFirst + ' 场'), [dupTxt, seqFirst]);
  A('回执点明是哪一天的哪一场', dupTxt.includes('2026-09-14'), dupTxt);
  A('回执说明「已切到那一场」避免误解', /已切到那一场/.test(dupTxt), dupTxt);
  A('回执仍解释为什么不去重会拉偏均值', /拉偏|均值/.test(dupTxt), dupTxt);

  // 场次库 · 数据安全面板
  ctx.go('library');
  let hh = scrollHTML();
  A('场次库含「数据保存在哪」面板', hh.includes('数据保存在哪'), true);
  A('面板说明了存储介质', /本机浏览器|内存/.test(hh), true);
  A('面板显示已积累场次与天数', hh.includes('已积累') && hh.includes('场'), true);
  A('面板显示占用容量', hh.includes('KB'), true);
  A('面板给出安全余量估算', hh.includes('还能存约'), true);
  A('面板有导出备份入口', hh.includes('导出备份'), true);
  A('面板有保存自检入口', hh.includes('检查保存状态'), true);

  // 备份时效提醒
  A('从未导出时 exportAge = null', ctx.exportAge() === null, ctx.exportAge());
  ctx.markExported();
  const age = ctx.exportAge();
  A('标记导出后能读到时间', age !== null && age < 5000, age);
  ctx.go('library');
  const hh2 = scrollHTML();
  A('导出后面板显示「今天导出过备份」', hh2.includes('今天导出过备份'), true);

  // 导入前环境自检：存储正常时不该吓唬用户
  A('存储正常时不显示环境警告', ctx.envWarn() === '', ctx.envWarn().slice(0,60));
  ctx.go('import');
  A('导入页渲染成功且无预警', scrollHTML().length > 800 && !scrollHTML().includes('这个浏览器存不住数据'), true);
}catch(e){ A('数据可靠性界面', false, e.message); }

hr('11. 裁决板块：对比之后有没有告诉我该怎么办');
try{
  const d = ctx.cmpDecide();
  A('cmpDecide 能算出决策', !!d, !!d);
  const vh = ctx.renderVerdict();
  A('裁决板块渲染成功', vh.length > 1500, vh.length);
  A('含四档裁决之一', /继续推进|保持节奏|定向优化|立即纠偏|先积累样本/.test(vh), true);
  A('含裁决依据', vh.includes('对比场') && vh.includes('历史基准'), true);
  A('含链路拆解 6 环', ['曝光进入率','平均停留','成交转化率','UV价值','退款率','付费占比'].every(x=>vh.includes(x)), true);
  A('含差距明细（7 项指标）',
    ['GMV','UV价值','平均停留','曝光进入率','成交转化率','退款率','付费占比'].every(x=>vh.includes(x)), true);
  A('含两个对比口径表头', vh.includes('vs 对比场') && vh.includes('vs 均值'), true);
  A('含下一步动作', vh.includes('下一步怎么做'), true);
  A('动作带责任人', vh.includes('责任人'), true);
  A('动作带「怎么做」', vh.includes('怎么做'), true);
  A('动作带「目标」', vh.includes('目标'), true);
  A('含判断方法说明（可被质询）', vh.includes('这套判断是怎么来的'), true);
  A('含样本量说明', vh.includes('样本量'), true);

  // 单场诊断顶部摘要条
  ctx.go('report');
  const rh = scrollHTML();
  A('诊断页顶部有裁决摘要条', rh.includes('本场裁决') || rh.includes('这是第 1 场'), true);
  A('摘要条有跳转完整结论的入口', rh.includes('看完整结论'), true);
}catch(e){ A('裁决板块渲染', false, e.message); }

hr('12. 退化输入不能把页面打崩（未知品类 / 空值）');
{
  // 真实浏览器回归发现的崩溃点：BENCHMARKS[ST.cat] 没有兜底，
  // 品类键不在基准表里时 B 为 undefined，一个 B.uvValue 就让整个诊断页白屏。
  const savedCat = ctx.ST.cat;
  const savedM = ctx.ST.M;
  ['不存在的品类', '', null, undefined, 'FUZZ', '__proto__', '通用'].forEach(cat=>{
    ctx.ST.cat = cat;
    let ok = true, err = '';
    try{ ctx.go('report'); if(scrollHTML().length < 300) { ok=false; err='内容过短'; } }
    catch(e){ ok = false; err = e.message; }
    A('品类「'+String(cat)+'」时诊断页不崩', ok, err);
  });
  ctx.ST.cat = savedCat; ctx.ST.M = savedM;
  // 基准兜底本身：未知键（含原型链上的键）都必须落到「通用」
  A('未知品类回落到通用基准', ctx.benchOf('不存在').entryRate === 19, ctx.benchOf('不存在').entryRate);
  A('空品类回落到通用基准', ctx.benchOf('').entryRate === 19, ctx.benchOf('').entryRate);
  A('null 品类回落到通用基准', ctx.benchOf(null).entryRate === 19, ctx.benchOf(null).entryRate);
  A('原型链键 __proto__ 不被当成基准', ctx.benchOf('__proto__').entryRate === 19,
    ctx.benchOf('__proto__').entryRate);
  A('原型链键 constructor 不被当成基准', ctx.benchOf('constructor').entryRate === 19,
    ctx.benchOf('constructor').entryRate);
  A('已知品类仍取到自己的基准', ctx.benchOf('食品').entryRate === 21.2, ctx.benchOf('食品').entryRate);
}

hr('13. 标签平衡：脚本体里的 div 开闭');
{
  const hh = fs.readFileSync(DIR+'index.html','utf8');
  const js = [...hh.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
  const o = (js.match(/<div/g)||[]).length, c = (js.match(/<\/div>/g)||[]).length;
  A('脚本体 div 开闭平衡', o === c, [o, c]);
  const ho = (hh.match(/<div/g)||[]).length, hc = (hh.match(/<\/div>/g)||[]).length;
  A('整个 index.html div 开闭平衡', ho === hc, [ho, hc]);
}

console.log('\n'+'='.repeat(58));
console.log(`渲染冒烟测试完成：通过 ${pass}，失败 ${fail}`);
console.log('='.repeat(58));
process.exit(fail>0?1:0);
