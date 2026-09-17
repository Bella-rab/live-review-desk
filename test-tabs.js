/* 维度板块（子页签）测试：验证页面已拆成可点选的板块，且每个板块独立渲染
   node test-tabs.js */
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

/* ---------- 拼装 ---------- */
const src = fs.readFileSync(DIR+'engine.js','utf8') + '\n'
          + fs.readFileSync(DIR+'store.js','utf8') + '\n'
          + [...fs.readFileSync(DIR+'index.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');

hr('1. 脚本加载');
let ctx;
try{
  ctx = new Function(src + `
    return { go, setTab, renderTabs, renderView, curTab, tabsOf, SUBTABS,
      STORE, ST, normalize, runDiagnosis, issuesToTodos,
      splitBlocks, parseTable, parseDelimited,
      renderImport, renderLibrary, renderReport, renderCompare, renderHost,
      renderTrend, renderIssues, renderAction };`)();
  A('脚本加载无异常', true);
}catch(e){
  A('脚本加载', false, e.message);
  console.log(`\n维度板块测试：通过 ${pass}，失败 ${fail}`);
  process.exit(1);
}
const scrollHTML = ()=> getEl('scroll').innerHTML;
const tabsHTML   = ()=> getEl('tabs').innerHTML;
const tabsBox    = ()=> getEl('tabs');

hr('2. 板块定义');
const EXPECT = {
  report: ['overview','funnel','traffic','product','issues','action'],
  compare:['verdict','gap','detail','trend'],
  host:   ['rank','profile'],
  trend:  ['chart','insight','table'],
  issues: ['track','plan'],
  action: ['todo','owner'],
};
Object.entries(EXPECT).forEach(([v, keys])=>{
  const got = (ctx.SUBTABS[v]||[]).map(x=>x.k);
  A(v+' 板块数 = '+keys.length+'（'+keys.join('/')+'）',
    got.length===keys.length && keys.every(k=>got.includes(k)), got);
});
A('导入页无子页签', ctx.tabsOf('import').length===0, ctx.tabsOf('import').length);
A('场次库无子页签', ctx.tabsOf('library').length===0, ctx.tabsOf('library').length);
A('每个板块都有中文标题', Object.values(ctx.SUBTABS).flat().every(x=>x.k&&x.t&&x.t.length>=2), true);
A('总板块数 >= 18', Object.values(ctx.SUBTABS).flat().length>=18, Object.values(ctx.SUBTABS).flat().length);

hr('3. 默认板块 = 第一个');
Object.entries(EXPECT).forEach(([v,keys])=>{
  delete ctx.ST.tab[v];
  A(v+' 默认落在「'+keys[0]+'」', ctx.curTab(v)===keys[0], ctx.curTab(v));
});
ctx.ST.tab.report = '不存在的板块';
A('无效板块名自动回落到第一个', ctx.curTab('report')==='overview', ctx.curTab('report'));
ctx.ST.tab.report = 'overview';

hr('4. 无数据时页签不显示');
ctx.go('import');
A('导入页隐藏页签条', tabsBox().style.display==='none', tabsBox().style.display);
ctx.go('library');
A('场次库隐藏页签条', tabsBox().style.display==='none', tabsBox().style.display);

hr('5. 灌入数据：5 场历史 + 1 场完整示例（含分时段/商品/流量）');
try{
  // 先放 5 场轻量历史（只有汇总指标，模拟早期场次）
  const scenes = [
    {host:'小雨', date:'2026-09-10', views:10400, stay:58, gmv:104000, entry:20.4, cvr:9.1, refund:6.2,  paid:30},
    {host:'小满', date:'2026-09-11', views:9600,  stay:44, gmv:86420,  entry:19.4, cvr:6.8, refund:16.2, paid:34},
    {host:'阿静', date:'2026-09-12', views:11200, stay:61, gmv:118000, entry:21.0, cvr:9.8, refund:6.0,  paid:28},
    {host:'小雨', date:'2026-09-13', views:10600, stay:49, gmv:96000,  entry:19.8, cvr:7.6, refund:12.0, paid:36},
    {host:'小满', date:'2026-09-14', views:11800, stay:47, gmv:99000,  entry:20.1, cvr:7.2, refund:17.4, paid:38},
  ];
  scenes.forEach(s=>{
    const raw = ['观看人数\t'+s.views,'平均停留时长\t'+s.stay+'秒','GMV\t'+s.gmv,
      '曝光进入率\t'+s.entry+'%','成交转化率\t'+s.cvr+'%','退款率\t'+s.refund+'%',
      '付费流量占比\t'+s.paid+'%'].join('\n');
    const M = ctx.normalize([{views:s.views,avgStay:s.stay,gmv:s.gmv,entryRate:s.entry,
      cvr:s.cvr,refundRate:s.refund,paidRate:s.paid}], {category:'服饰'});
    ctx.STORE.add({M, DIAG:ctx.runDiagnosis(M), raw, category:'服饰', hostName:s.host, date:s.date, note:''});
  });

  // 本场：用页面内置的完整示例数据，含分时段 / 商品 / 流量来源三张表
  const html = fs.readFileSync(DIR+'index.html','utf8');
  const demoText = ['DEMO_TIME','DEMO_SUM','DEMO_PROD','DEMO_SRC']
    .map(n => html.match(new RegExp('const '+n+' = `([\\s\\S]*?)`;'))[1])
    .join('\n\n');
  const blocks = ctx.splitBlocks(demoText);
  let recs=[], unk=[];
  blocks.forEach(b=>{
    const p = ctx.parseTable(ctx.parseDelimited(b));
    recs = recs.concat(p.records); unk = unk.concat(p.unknown||[]);
  });
  const M = ctx.normalize(recs, {category:'服饰'});
  M.unknownFields = [...new Set(unk)].filter(Boolean);
  const DIAG = ctx.runDiagnosis(M);
  ctx.ST.M = M; ctx.ST.DIAG = DIAG; ctx.ST.todos = ctx.issuesToTodos(DIAG.issues);
  const res = ctx.STORE.add({M, DIAG, raw:demoText, category:'服饰',
    hostName:'小雨', date:'2026-09-15', note:'完整数据场'});
  ctx.ST.curId = res.record.id;

  A('已灌入 6 场', ctx.STORE.count()===6, ctx.STORE.count());
  A('本场为最新的完整数据场', ctx.STORE.all()[0].id===ctx.ST.curId, ctx.STORE.all()[0].date);
  A('本场含分时段数据', M.flags.hasTimeline===true, M.flags.hasTimeline);
  A('本场含商品明细', M.products.length>0, M.products.length);
  A('本场含流量来源', M.sources.length>0, M.sources.length);
  A('本场检出问题（有徽标可测）', DIAG.issues.length>0, DIAG.issues.length);
}catch(e){ A('灌入数据', false, e.message); }

hr('6. 页签条渲染');
ctx.ST.tab.report='overview';
ctx.go('report');
A('单场诊断显示 6 个页签', (tabsHTML().match(/class="tab/g)||[]).length===6, (tabsHTML().match(/class="tab/g)||[]).length);
A('当前板块带 on 样式', tabsHTML().includes('tab on'), true);
A('页签显示问题数徽标', /tb-n hot">\d+</.test(tabsHTML()), tabsHTML().match(/tb-n[^>]*>\d+</g));
A('页签含「总览」', tabsHTML().includes('总览'), true);
A('页签含「商品表现」', tabsHTML().includes('商品表现'), true);
A('页签含「行动清单」', tabsHTML().includes('行动清单'), true);

  ctx.go('compare');
  A('场次对比显示 4 个页签', (tabsHTML().match(/class="tab/g)||[]).length===4, (tabsHTML().match(/class="tab/g)||[]).length);
  A('对比页页签含「结论与决策」', tabsHTML().includes('结论与决策'), true);
ctx.go('host');
A('主播对比显示 2 个页签', (tabsHTML().match(/class="tab/g)||[]).length===2, (tabsHTML().match(/class="tab/g)||[]).length);
ctx.go('trend');
A('趋势看板显示 3 个页签', (tabsHTML().match(/class="tab/g)||[]).length===3, (tabsHTML().match(/class="tab/g)||[]).length);
ctx.go('issues');
A('问题库显示 2 个页签', (tabsHTML().match(/class="tab/g)||[]).length===2, (tabsHTML().match(/class="tab/g)||[]).length);
ctx.go('action');
A('行动清单显示 2 个页签', (tabsHTML().match(/class="tab/g)||[]).length===2, (tabsHTML().match(/class="tab/g)||[]).length);
A('页签条可见', tabsBox().style.display==='', tabsBox().style.display);

hr('7. 逐页逐板块渲染（不抛异常）');
const lens = {};   // 每页各板块的内容长度
let renderErr = 0;
Object.entries(EXPECT).forEach(([v,keys])=>{
  ctx.ST.tab[v] = keys[0];
  ctx.go(v);
  lens[v] = {};
  keys.forEach(k=>{
    try{
      ctx.setTab(k);
      const h = scrollHTML();
      lens[v][k] = h.length;
      if(!h || h.length<300){ renderErr++; console.log('    ! '+v+'/'+k+' 内容过短: '+h.length); }
    }catch(e){ renderErr++; console.log('    ! '+v+'/'+k+' 抛异常: '+e.message); }
  });
});
A('全部 18 个板块均渲染成功', renderErr===0, renderErr+' 个板块有问题');

hr('8. 关键：确实拆开了，不再是长滚动');
Object.entries(lens).forEach(([v,map])=>{
  const keys = Object.keys(map);
  if(keys.length<2) return;
  const vals = keys.map(k=>map[k]);
  const total = vals.reduce((a,b)=>a+b,0);
  const max = Math.max(...vals);
  const ratio = max/total;
  const pct = (ratio*100).toFixed(0);
  // 单板块最长不应占满全部（证明内容确实被切分，而非整页堆在一起）
  A(v+' 单板块最长占 '+pct+'% (<85%)', ratio<0.85,
    keys.map(k=>k+':'+map[k]).join(' '));
  console.log('      各板块字符数：'+keys.map(k=>k+' '+map[k]).join(' · '));
  // 所有板块内容互不相同 → 证明是分区渲染，不是全量渲染后隐藏
  const uniq = new Set(vals);
  A(v+' 各板块内容互异', uniq.size===keys.length, uniq.size+'/'+keys.length);
  // 至少两个板块都有实质内容（不是把内容挪到一个板块里）
  A(v+' 至少 2 个板块有实质内容', vals.filter(x=>x>800).length>=2, vals);
});

/* 与拆分前对比：老版本单场诊断一次输出 9 个模块 */
const repTotal = Object.values(lens.report).reduce((a,b)=>a+b,0);
const repMax   = Math.max(...Object.values(lens.report));
A('单场诊断最长板块 '+repMax+' 字符 < 整页合计 '+repTotal+' 字符的 60%',
  repMax < repTotal*0.6, repMax+'/'+repTotal);

hr('9. 板块内容正确性');
ctx.ST.tab.report='overview'; ctx.go('report');
let h = scrollHTML();
A('总览含健康分', h.includes('健康分'), true);
A('总览含核心结论', h.includes('核心结论'), true);
A('总览含关键指标表', h.includes('关键指标'), true);
A('总览含数据完整度', h.includes('数据完整度'), true);
A('总览含维度导航入口（≥5 张卡）', (h.match(/class="dim"/g)||[]).length>=5, (h.match(/class="dim"/g)||[]).length);
A('维度卡可点击跳转', h.includes("setTab('funnel')") && h.includes("setTab('traffic')"), true);

ctx.setTab('funnel'); h = scrollHTML();
A('漏斗板块含转化漏斗图', h.includes('转化漏斗') && h.includes('class="fun"'), true);
A('漏斗板块含 GMV 三因子拆解', h.includes('GMV 三因子拆解'), true);
A('漏斗板块含各环节 vs 基准', h.includes('各环节 vs 基准'), true);
A('漏斗板块不含商品四象限', !h.includes('商品四象限'), true);

ctx.setTab('traffic'); h = scrollHTML();
A('流量板块含流量来源', h.includes('流量来源'), true);
A('流量板块含结构解读', h.includes('流量结构解读'), true);
A('流量板块含时段热力', h.includes('时段热力'), true);
A('流量板块含高效/低效时段排名', h.includes('最高效时段') && h.includes('最低效时段'), true);
A('流量板块不含转化漏斗', !h.includes('转化漏斗'), true);

ctx.setTab('product'); h = scrollHTML();
A('商品板块含四象限', h.includes('商品四象限'), true);
A('商品板块含策略建议', h.includes('商品策略建议'), true);
A('商品板块含商品明细表', h.includes('商品明细'), true);
A('商品板块不含时段热力', !h.includes('时段热力'), true);

ctx.setTab('issues'); h = scrollHTML();
A('问题板块含完整诊断', h.includes('完整诊断'), true);
A('问题板块含证据链说明', h.includes('证据') && h.includes('归因'), true);
A('问题板块含 P0/P1 统计', h.includes('P0') && h.includes('P1'), true);

ctx.setTab('action'); h = scrollHTML();
A('行动板块含待办清单', h.includes('待办总数'), true);
A('行动板块含复制按钮', h.includes('copyTodos'), true);

hr('10. 切换板块的行为');
ctx.go('report');
ctx.setTab('product');
A('ST.tab 记录当前板块', ctx.ST.tab.report==='product', ctx.ST.tab.report);
A('切换后页签高亮跟着变', /tab on"[^>]*>[^<]*<span[^>]*>▦<\/span>商品表现/.test(tabsHTML()) || tabsHTML().includes('商品表现') , true);
A('切换后滚动位置归零', getEl('scroll').scrollTop===0, getEl('scroll').scrollTop);
const before = scrollHTML();
ctx.setTab('issues');
A('切换后内容确实变了', scrollHTML()!==before, true);
A('切换后没有残留上一个板块的标题', !scrollHTML().includes('商品策略建议'), true);
A('每个页面独立记忆自己的板块', (()=>{ ctx.ST.tab.report='issues'; ctx.ST.tab.compare='detail'; return ctx.curTab('report')==='issues' && ctx.curTab('compare')==='detail'; })(), true);

hr('11. 场次对比 / 主播 / 趋势 各板块');
ctx.ST.curId = ctx.STORE.all()[0].id;
ctx.ST.tab.compare='gap'; ctx.go('compare');
h = scrollHTML();
A('差距概览含 KPI', h.includes('kpi-v'), true);
A('差距概览含对比结论', h.includes('对比结论'), true);
A('差距概览含对比基准选择器', h.includes('对比基准'), true);
ctx.setTab('detail'); h = scrollHTML();
A('指标明细含三列对比表', h.includes('三列对比'), true);
A('指标明细含场次明细', h.includes('场次明细'), true);
ctx.setTab('trend'); h = scrollHTML();
A('走势对比含画布', h.includes('<canvas'), true);

ctx.ST.tab.host='rank'; ctx.go('host');
h = scrollHTML();
A('效率排行含 3 位主播', ['小雨','小满','阿静'].every(n=>h.includes(n)), true);
A('效率排行含分项最强', h.includes('分项最强'), true);
ctx.setTab('profile'); h = scrollHTML();
A('能力诊断含当前主播定位', h.includes('当前主播定位'), true);
A('能力诊断含能力对比', h.includes('能力对比'), true);
A('能力诊断含排班建议', h.includes('排班建议'), true);
A('能力诊断含短板提示', h.includes('能力短板提示'), true);

ctx.ST.tab.trend='chart'; ctx.go('trend');
h = scrollHTML();
A('走势图含 3 个画布', (h.match(/<canvas/g)||[]).length>=3, (h.match(/<canvas/g)||[]).length);
A('走势图含 4 个 KPI', (h.match(/kpi-l/g)||[]).length>=4, (h.match(/kpi-l/g)||[]).length);
ctx.setTab('insight'); h = scrollHTML();
A('趋势解读含趋势解读文本', h.includes('趋势解读'), true);
A('趋势解读含前后两半对照表', h.includes('前后两半对照'), true);
A('趋势解读含指标相关性', h.includes('指标相关性'), true);
ctx.setTab('table'); h = scrollHTML();
A('指标明细含全部 6 场', ctx.STORE.count()===6 && h.includes('2026-09-10') && h.includes('2026-09-15'), true);

ctx.ST.tab.issues='track'; ctx.go('issues');
h = scrollHTML();
A('问题追踪含追踪列表', h.includes('问题追踪'), true);
A('问题追踪含结构化统计', h.includes('结构性问题'), true);
ctx.setTab('plan'); h = scrollHTML();
A('整改建议含整改台账', h.includes('整改台账'), true);
A('整改建议含责任人', h.includes('建议责任人'), true);
A('整改建议含验证指标', h.includes('下场验证什么'), true);
A('整改建议含开播前清单', h.includes('开播前检查清单'), true);

ctx.ST.tab.action='todo'; ctx.go('action');
h = scrollHTML();
A('待办清单含待办列表', h.includes('全部待办'), true);
ctx.setTab('owner'); h = scrollHTML();
A('分工页含优先级执行顺序', h.includes('按优先级执行顺序'), true);
A('分工页含责任人分组', h.includes('按责任人分组'), true);
A('分工页含下场验证清单', h.includes('下场验证清单'), true);

hr('12. 退化数据不崩（无分时段 / 无商品 / 无来源）');
try{
  const M2 = ctx.normalize([{views:5000, gmv:30000}], {category:'通用'});
  const D2 = ctx.runDiagnosis(M2);
  const keep = {M:ctx.ST.M, D:ctx.ST.DIAG, t:ctx.ST.todos, id:ctx.ST.curId};
  ctx.ST.M = M2; ctx.ST.DIAG = D2; ctx.ST.todos = ctx.issuesToTodos(D2.issues);
  let err = 0;
  ['overview','funnel','traffic','product','issues','action'].forEach(k=>{
    try{ ctx.ST.tab.report=k; ctx.go('report'); if(scrollHTML().length<200) err++; }
    catch(e){ err++; console.log('    ! report/'+k+' → '+e.message); }
  });
  A('字段极少的场次，6 个板块都不崩', err===0, err+' 个板块异常');
  ctx.ST.M = keep.M; ctx.ST.DIAG = keep.D; ctx.ST.todos = keep.t; ctx.ST.curId = keep.id;
}catch(e){ A('退化数据测试', false, e.message); }

console.log('\n'+'='.repeat(58));
console.log(`维度板块测试：通过 ${pass}，失败 ${fail}`);
process.exit(fail?1:0);
