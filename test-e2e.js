/* 端到端验证 v2：检查新引擎 + 界面完整性 */
const fs = require('fs');
const DIR = 'C:/Users/24425/WorkBuddy/2026-09-14-20-29-26/';
let pass=0, fail=0;
function A(n,c,g){ c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+'  实际: '+JSON.stringify(g))); }
function hr(t){ console.log('\n─── '+t); }

const html = fs.readFileSync(DIR+'index.html','utf8');
const engine = fs.readFileSync(DIR+'engine.js','utf8');

hr('语法检查');
try { new Function(engine); console.log('  ✓ engine.js 语法通过'); }
catch(e){ fail++; console.log('  ✗ engine.js 语法错误: '+e.message); }
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
scripts.forEach((s,i)=>{
  try { new Function(s); console.log(`  ✓ index.html script[${i}] 语法通过`); }
  catch(e){ fail++; console.log(`  ✗ script[${i}] 错误: ${e.message}`); }
});

hr('界面完整性');
const needIds = ['topbar','tbTitle','tbMeta','tbRight','scroll','navCnt'];
needIds.forEach(id=>A(`存在 #${id}`, html.includes(`id="${id}"`), id));
const views = ['import','library','report','compare','host','trend','issues','action'];
views.forEach(v=>A(`视图函数 render${v[0].toUpperCase()+v.slice(1)}`, html.includes(`function render${v[0].toUpperCase()+v.slice(1)}`), v));
const navs = (html.match(/data-v="/g)||[]).length;
A('侧栏导航项 = 8', navs===8, navs);
A('引入场次仓库 store.js', html.includes('src="store.js"'), true);
A('不再硬编码历史数据', !/const HISTORY\s*=/.test(html) && !/const HOSTS\s*=/.test(html), true);
const canvases = (html.match(/<canvas/g)||[]).length;
A('Canvas 图表 ≥ 3 处', canvases>=3, canvases);

// 标签平衡
const od=(html.match(/<div/g)||[]).length, cd=(html.match(/<\/div>/g)||[]).length;
A(`div 平衡 (${od}/${cd})`, od===cd, [od,cd]);

hr('引擎加载与完整分析');
eval(engine);
const DEMO = [html.match(/const DEMO_TIME = `([\s\S]*?)`;/)[1],
              html.match(/const DEMO_SUM = `([\s\S]*?)`;/)[1],
              html.match(/const DEMO_PROD = `([\s\S]*?)`;/)[1],
              html.match(/const DEMO_SRC = `([\s\S]*?)`;/)[1]].join('\n\n');
console.log('  示例数据:', DEMO.length, '字符');

function splitBlocks(text){
  const raw=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n'); const out=[];
  raw.split(/\n\s*\n+/).forEach(p=>{
    const c=p.split('\n').filter(l=>!/^\s*【.*】\s*$/.test(l)).join('\n');
    if(c.trim()) out.push(c);
  });
  return out;
}
const blocks = splitBlocks(DEMO);
console.log('  切块:', blocks.length);
A('切出 4 个数据块', blocks.length===4, blocks.length);

let recs=[], unk=[];
blocks.forEach(b=>{ const p=parseTable(parseDelimited(b));
  recs=recs.concat(p.records); unk=unk.concat(p.unknown||[]); });
const M = normalize(recs, {category:'服饰'});
M.unknownFields=[...new Set(unk)].filter(Boolean);

console.log('  字段数:', Object.keys(M.session).length,
  '| 时段:', M.timeline.length, '| 商品:', M.products.length, '| 来源:', M.sources.length);
A('时段 = 24', M.timeline.length===24, M.timeline.length);
A('商品 = 7', M.products.length===7, M.products.length);
A('流量来源 = 5', M.sources.length===5, M.sources.length);
A('hasSources', M.flags.hasSources===true, M.flags.hasSources);

hr('深度分析');
const D = runDiagnosis(M);
console.log('  健康分:', D.score, '| 问题数:', D.issues.length);
A('健康分范围', D.score>=28 && D.score<=96, D.score);
A('问题 ≥ 5', D.issues.length>=5, D.issues.length);
A('含时段分析 A', !!D.analyses.A, !!D.analyses.A);
A('含商品分析 PQ', !!D.analyses.PQ, !!D.analyses.PQ);
A('含流量分析 SRC', !!D.analyses.SRC, !!D.analyses.SRC);
A('含退款分析 RF', !!D.analyses.RF, !!D.analyses.RF);

if(D.analyses.A){
  const Aa=D.analyses.A;
  console.log('  颗粒度:', Aa.gap+'分钟 | 效率均值:', Aa.avgEff.toFixed(2));
  A('时段最佳有值', Aa.best.length>0, Aa.best.length);
  A('时段最差有值', Aa.worst.length>0, Aa.worst.length);
  A('商品时段统计', Aa.itemStats.length>0, Aa.itemStats.length);
}
if(D.analyses.PQ){
  const P=D.analyses.PQ;
  console.log('  商品均转化:', P.avgCvr, '| 均段数:', P.avgSeg);
  A('商品四象限已分类', P.list.every(p=>p.quadrant), P.list.map(p=>p.quadrant));
}
if(D.analyses.RF){
  const R=D.analyses.RF;
  console.log('  退款率:', R.rate+'% | 基准:', R.bench+'% | 侵蚀 GMV: ¥'+(R.lostGmv||0));
  A('退款侵蚀 GMV 有值', R.lostGmv>0, R.lostGmv);
  A('真实 GMV 有值', R.realGmv>0, R.realGmv);
}

hr('诊断项质量检查');
let allHaveEv=true, allHaveWhy=true, allHaveAct=true, planCnt=0;
D.issues.forEach(it=>{
  if(!it.evidence || !it.evidence.length) allHaveEv=false;
  if(!it.why || it.why.length<30) allHaveWhy=false;
  if(!it.act || !it.act.length) allHaveAct=false;
  if(it.plan) planCnt++;
});
A('每项都有证据', allHaveEv);
A('每项都有归因(>30字)', allHaveWhy);
A('每项都有动作', allHaveAct);
A('含执行方案的问题 ≥ 3', planCnt>=3, planCnt);
console.log('  含方案的问题:', planCnt, '/', D.issues.length);
D.issues.forEach((it,i)=>{
  console.log(`  ${i+1}. [${it.sev}][${it.category||'-'}] ${it.title}`);
  if(it.plan) console.log(`     方案: ${it.plan.title}` + (it.plan.schedule?'（含'+it.plan.schedule.length+'条排期）':'') + (it.plan.steps?'（含'+it.plan.steps.length+'步）':''));
});

hr('方案生成器');
const stayPlan = D.issues.find(i=>i.plan && i.plan.schedule);
A('停留方案含排期表', !!stayPlan, !!stayPlan);
if(stayPlan) stayPlan.plan.schedule.forEach(r=>{
  A(`  排期项 ${r.time} 有商品/话术/目的`, !!(r.item&&r.words&&r.goal));
});

hr('跨场问题库');
const hist = buildHistory(D.issues, '服饰');
console.log('  历史问题:', hist.length, '项');
A('问题库 ≥ 4 项', hist.length>=4, hist.length);
A('含命中次数', hist.every(x=>x.c && x.t), hist.map(x=>x.c));
hist.forEach(x=>console.log(`  · ${x.title} —— 近 ${x.t} 场命中 ${x.c} 次（${x.trend}）`));

hr('行动清单');
const todos = issuesToTodos(D.issues);
A('行动项至少 1 条且不被截断', todos.length>=1 && todos.length<=30, todos.length);
A('含责任人', todos.every(t=>t.owner), todos.map(t=>t.owner));
A('含来源标记', todos.every(t=>t.from), '');
console.log('  共', todos.length, '条');
todos.slice(0,5).forEach(t=>console.log(`  [${t.p}][${t.owner}] ${t.t.slice(0,40)}`));

hr('边界回归');
const empty = normalize(parseTable(parseDelimited('随便写的内容')).records, {category:'通用'});
const dEmpty = runDiagnosis(empty);
A('空数据不崩', typeof dEmpty.score==='number', dEmpty.score);
A('空数据问题为 0', dEmpty.issues.length===0, dEmpty.issues.length);

const onlySum = normalize(parseTable(parseDelimited(`观看人数\t83120\n曝光人数\t428600\n平均停留时长\t41秒\nGMV\t86420\n退款率\t18.6%`)).records,{category:'服饰'});
const dSum = runDiagnosis(onlySum);
A('无分时段仍出诊断', dSum.issues.length>=1, dSum.issues.length);
A('无分时段 A 为 null', dSum.analyses.A===null, !!dSum.analyses.A);

console.log('\n'+'='.repeat(58));
console.log(`端到端完成：通过 ${pass}，失败 ${fail}`);
console.log('='.repeat(58));
process.exit(fail>0?1:0);
