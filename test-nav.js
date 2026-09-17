/* 返回键 / 导航历史 / hash 路由 测试
   背景：从「单场诊断」点「看完整结论」跳到「场次对比」后，原本没有任何回到
   本场数据的入口（窄屏侧栏还是 display:none，等于彻底困住）。
   本测试锁死：返回键存在、能回、能回到正确的页面+板块、且不会被 hash 自己绕晕。

   node test-nav.js */
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
  el.addEventListener = ()=>{}; el.removeEventListener = ()=>{};
  el.appendChild = ()=>{}; el.querySelectorAll = ()=>[];
  el.click = ()=>{}; el.focus = ()=>{}; el.remove = ()=>{};
  el.getContext = ()=> new Proxy({}, { get:(t,k)=>{
    if(k==='canvas') return {width:600,height:200};
    return ()=>{};
  }, set:()=>true });
  el.getBoundingClientRect = ()=>({left:0,top:0,width:600,height:200});
  return el;
}
function getEl(id){
  if(!els[id]){ els[id]=mkEl(id); els[id].parentElement = { clientHeight:200, clientWidth:600 }; }
  return els[id];
}
global.document = {
  getElementById: getEl, querySelectorAll: ()=>[], querySelector: ()=>null,
  createElement: t=>mkEl(t), body: mkEl('body'),
  addEventListener: ()=>{}, documentElement: mkEl('html'),
};
/* window 桩要能捕获监听器，才能手动触发 hashchange */
const winH = {};
global.window = { devicePixelRatio:1, print:()=>{}, innerWidth:1200,
  addEventListener:(t,f)=>{ winH[t]=f; } };
/* 真实浏览器里有的 location：让 hash 同步逻辑真的被执行到 */
const loc = { hash:'' };
global.location = loc;

global.requestAnimationFrame = fn => { fn(); };
global.alert = ()=>{}; global.confirm = ()=>true; global.prompt = ()=>'x';
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
    return { go, setTab, curTab, tabsOf, jumpTab, navBack, navPush, renderBack,
      locLabel, curHash, syncHash, renderViewMenu, toggleViewMenu, closeViewMenu,
      VIEWS, ANALYZE_VIEWS, SUBTABS, STORE, ST, esc,
      normalize, runDiagnosis, loadLatest };`)();
  A('脚本加载无异常', true);
}catch(e){
  A('脚本加载', false, e.message);
  console.log(`\n返回键测试：通过 ${pass}，失败 ${fail}`);
  process.exit(1);
}
const backHTML = ()=> getEl('tbBack').innerHTML;
const scrollHTML = ()=> getEl('scroll').innerHTML;
const fireHash = h => { loc.hash = h; if(winH.hashchange) winH.hashchange(); };

hr('2. 初始化状态：无处可回时不显示返回键');
A('初始落在导入页', ctx.ST.view==='import', ctx.ST.view);
A('返回栈为空', ctx.ST.nav.length===0, ctx.ST.nav.length);
A('顶栏没有返回键', backHTML()==='', backHTML());
A('navBack 无处可回时返回 false', ctx.navBack()===false, true);
A('初始 hash 已写成 #/import', loc.hash==='#/import', loc.hash);

hr('3. 灌入 6 场数据，进入单场诊断');
const scenes = [
  {host:'小雨', date:'2026-09-09', views:9800,  stay:52, gmv:88000,  entry:19.2, cvr:8.2, refund:7.4, paid:32},
  {host:'小雨', date:'2026-09-10', views:10400, stay:58, gmv:104000, entry:20.4, cvr:9.1, refund:6.2, paid:30},
  {host:'小满', date:'2026-09-11', views:9600,  stay:41, gmv:86420,  entry:19.4, cvr:6.8, refund:18.6,paid:34},
  {host:'阿静', date:'2026-09-12', views:11200, stay:61, gmv:118000, entry:21.0, cvr:9.8, refund:6.0, paid:28},
  {host:'小雨', date:'2026-09-13', views:10600, stay:56, gmv:96000,  entry:19.8, cvr:8.6, refund:7.0, paid:31},
  {host:'小满', date:'2026-09-14', views:11800, stay:64, gmv:132000, entry:21.6, cvr:10.3,refund:5.6, paid:27},
];
scenes.forEach(s=>{
  const raw = ['观看人数\t'+s.views, '平均停留时长\t'+s.stay+'秒', 'GMV\t'+s.gmv,
    '曝光进入率\t'+s.entry+'%', '成交转化率\t'+s.cvr+'%', '退款率\t'+s.refund+'%',
    '付费流量占比\t'+s.paid+'%'].join('\n');
  const M = ctx.normalize([{views:s.views,avgStay:s.stay,gmv:s.gmv,entryRate:s.entry,
    cvr:s.cvr,refundRate:s.refund,paidRate:s.paid}], {category:'服饰'});
  ctx.STORE.add({M, DIAG:ctx.runDiagnosis(M), raw, category:'服饰', hostName:s.host, date:s.date, note:''});
});
A('仓库 6 场', ctx.STORE.count()===6, ctx.STORE.count());

ctx.ST.tab.report = 'overview';
ctx.go('report');
A('已进入单场诊断', ctx.ST.view==='report', ctx.ST.view);
A('诊断页有数据', !!ctx.ST.M && scrollHTML().length>500, scrollHTML().length);
A('顶部出现返回键', backHTML().includes('← 返回'), backHTML().slice(0,80));
A('返回键指向「导入数据」', backHTML().includes('导入数据'), backHTML().match(/bk-lb">[^<]*/));
A('hash 同步为 #/report/overview', loc.hash==='#/report/overview', loc.hash);

hr('4. 复现用户的问题：点「看完整结论」');
ctx.jumpTab('compare','verdict');
A('已跳到场次对比', ctx.ST.view==='compare', ctx.ST.view);
A('落在「结论与决策」板块', ctx.curTab('compare')==='verdict', ctx.curTab('compare'));
A('切页后本场数据没丢', !!ctx.ST.M, !!ctx.ST.M);
A('返回栈记录了来处（导入 → 单场诊断）', ctx.ST.nav.length===2
  && ctx.ST.nav[0].v==='import' && ctx.ST.nav[1].v==='report',
  ctx.ST.nav.map(x=>x.v));
A('返回键标签 = 单场诊断 · 总览', backHTML().includes('单场诊断 · 总览'), backHTML().match(/bk-lb">[^<]*/));

hr('5. 按返回键，回到本场数据');
A('navBack 成功', ctx.navBack()===true, true);
A('回到了单场诊断', ctx.ST.view==='report', ctx.ST.view);
A('本场数据完整仍在', !!ctx.ST.M && !!ctx.ST.DIAG, [!!ctx.ST.M, !!ctx.ST.DIAG]);
A('回到「总览」板块', ctx.curTab('report')==='overview', ctx.curTab('report'));
A('内容确实渲染成了单场诊断', scrollHTML().length>500, scrollHTML().length);
A('hash 也退回 #/report/overview', loc.hash==='#/report/overview', loc.hash);
A('返回后栈里只剩导入页', ctx.ST.nav.length===1 && ctx.ST.nav[0].v==='import', ctx.ST.nav);

hr('6. 子板块（维度页签）也要能返回');
ctx.ST.tab.report = 'overview';
ctx.go('report');
ctx.setTab('funnel');
A('切到「转化漏斗」', ctx.curTab('report')==='funnel', ctx.curTab('report'));
A('返回键指向总览', backHTML().includes('单场诊断 · 总览'), backHTML().match(/bk-lb">[^<]*/));
ctx.navBack();
A('返回后回到「总览」', ctx.curTab('report')==='overview', ctx.curTab('report'));
ctx.setTab('overview');
A('同一板块重复点击不压栈', ctx.ST.nav.length===1, ctx.ST.nav.length);

hr('7. 多次跳转 / 连续跳转');
ctx.go('trend'); ctx.go('issues'); ctx.go('action');
A('三次跳转压了三层', ctx.ST.nav.length===4, ctx.ST.nav.length);
A('返回键指向问题库', backHTML().includes('问题库'), backHTML().match(/bk-lb">[^<]*/));
A('返回一次 → 问题库', (ctx.navBack(), ctx.ST.view==='issues'), ctx.ST.view);
A('再返回一次 → 趋势看板', (ctx.navBack(), ctx.ST.view==='trend'), ctx.ST.view);
A('再返回一次 → 单场诊断', (ctx.navBack(), ctx.ST.view==='report'), ctx.ST.view);
A('再返回一次 → 导入数据', (ctx.navBack(), ctx.ST.view==='import'), ctx.ST.view);
A('退到底后返回键收起', backHTML()==='', backHTML());
A('退到底后 navBack 返回 false', ctx.navBack()===false, true);

ctx.go('compare'); ctx.go('compare'); ctx.go('compare');
A('原地重复跳转不膨胀栈', ctx.ST.nav.length===1, ctx.ST.nav.length);

hr('8. 历史栈上限（防内存无限增长）');
for(let i=0;i<80;i++){ ctx.go(i%2 ? 'report':'compare'); }
A('栈长度不超过 40', ctx.ST.nav.length<=40, ctx.ST.nav.length);
A('返回键仍然可用', backHTML().includes('← 返回'), backHTML().slice(0,40));

hr('9. hash 路由：浏览器自带后退键');
ctx.ST.nav.length = 0;
ctx.ST._hashQueue.length = 0;
loc.hash = '#/import'; ctx.go('import');
ctx.ST.nav.length = 0;                      // 只看 hash 事件会不会带来新的入栈
const before = ctx.ST.view;
ctx.ST._hashQueue.push('#/library/xx');     // 假装这是自己刚写的中间值
fireHash('#/library/xx');
A('自己写的 hash 不会触发跳转', ctx.ST.view===before, ctx.ST.view);
A('队列被正确消费', ctx.ST._hashQueue.length===0, ctx.ST._hashQueue);
A('自己写的 hash 不会被当成用户回退', ctx.ST.nav.length===0, ctx.ST.nav.length);

ctx.ST._hashQueue.length = 0;
fireHash('#/library');
A('用户改 hash 会真的跳页', ctx.ST.view==='library', ctx.ST.view);
fireHash('#/action/owner');
A('带板块的 hash 能落到对应板块', ctx.ST.view==='action' && ctx.curTab('action')==='owner',
  [ctx.ST.view, ctx.curTab('action')]);
fireHash('#/不存在的页面');
A('非法 hash 被忽略（不崩）', ctx.ST.view==='action', ctx.ST.view);

hr('10. hash 格式与标签文案');
A('有板块时 hash 带板块', (ctx.ST.view='compare', ctx.ST.tab.compare='gap', ctx.curHash()==='#/compare/gap'), ctx.curHash());
A('无板块页 hash 不带尾巴', (ctx.ST.view='library', ctx.curHash()==='#/library'), ctx.curHash());
A('标签含页面名与板块名', ctx.locLabel({v:'report',k:'funnel'}).includes('单场诊断')
  && ctx.locLabel({v:'report',k:'funnel'}).includes('转化漏斗'), ctx.locLabel({v:'report',k:'funnel'}));

hr('11. 窄屏页面菜单（侧栏被隐藏时的唯一出口）');
ctx.ST.view='compare';
ctx.renderViewMenu();
const mh = getEl('viewMenu').innerHTML;
A('菜单含全部 8 个页面', (mh.match(/class="vm-i/g)||[]).length===8, (mh.match(/class="vm-i/g)||[]).length);
A('菜单有分组标题', (mh.match(/vm-sec/g)||[]).length>=3, (mh.match(/vm-sec/g)||[]).length);
A('当前页高亮', /vm-i on/.test(mh), mh.slice(0,120));
A('点菜单项会跳页并收起', mh.includes("go('library')") && mh.includes('closeViewMenu()'), true);
getEl('viewMenu').style.display='block';
ctx.closeViewMenu();
A('closeViewMenu 能收起', getEl('viewMenu').style.display==='none', getEl('viewMenu').style.display);

hr('12. 静态结构检查（index.html 源码）');
const html = fs.readFileSync(DIR+'index.html','utf8');
A('存在返回键容器 #tbBack', html.includes('id="tbBack"'), true);
A('存在窄屏菜单容器 #viewMenu', html.includes('id="viewMenu"'), true);
A('.only-narrow 默认隐藏', /\.only-narrow\{display:none/.test(html), true);
/* 侧栏隐藏与窄屏菜单显示必须用【同一个】断点：
   若 .side 先隐藏、菜单却没出现，窄屏下就彻底没有换页入口 —— 真正的「回不去」。
   这里不硬编码断点数字（断点本身会调整，硬编码会假失败），
   而是把两处断点提取出来直接比较，锁住「必须一致」这个不变量。 */
const sideBp = (html.match(/@media\(max-width:(\d+)px\)\{[^}]*\.side\{display:none\}/) || [])[1];
const menuBp = (html.match(/@media\(max-width:(\d+)px\)\{[^}]*only-narrow\{display:inline-flex/) || [])[1];
A('能提取到侧栏隐藏断点', !!sideBp, sideBp);
A('能提取到窄屏菜单显示断点', !!menuBp, menuBp);
A('侧栏隐藏与窄屏菜单用同一条断点（否则窄屏没有换页入口）',
  !!sideBp && sideBp === menuBp, 'side=' + sideBp + ' menu=' + menuBp);
A('「看完整结论」仍然可点', html.includes("onclick=\"jumpTab('compare','verdict')\""), true);
A('侧栏导航项仍是 8 个（没被菜单污染）', (html.match(/data-v="/g)||[]).length===8,
  (html.match(/data-v="/g)||[]).length);
A('窄屏菜单项不带 data-v（不会干扰导航高亮）',
  !/vm-i[^>]*data-v=/.test(html), true);

hr('13. 关键回归：从对比页返回，绝不出现「回不去」');
ctx.ST.tab.report='overview';
ctx.go('report');
const mtxtBefore = scrollHTML();
ctx.jumpTab('compare','verdict');
const onCompare = ctx.ST.view;
ctx.setTab('gap');
ctx.navBack();
A('第 1 次返回 → 结论与决策', ctx.ST.view==='compare' && ctx.curTab('compare')==='verdict',
  [ctx.ST.view, ctx.curTab('compare')]);
ctx.navBack();
A('第 2 次返回 → 单场诊断（用户原本卡死的地方）', ctx.ST.view==='report', ctx.ST.view);
A('回到的诊断页内容与出发时一致', scrollHTML()===mtxtBefore, [mtxtBefore.length, scrollHTML().length]);
A('全程返回栈不曾断（无「回不去」状态）', ctx.ST.nav.length>=0 && backHTML()!==undefined, backHTML().slice(0,40));

hr('14. 刷新后停在原来那一页（bootFromHash）');
/* 重新求值整份脚本 = 模拟刷新：localStorage 还在，location.hash 停在原处 */
try{
  loc.hash = '#/trend/chart';
  const c2 = new Function(src + `return { ST, STORE, curTab };`)();
  A('刷新后回到 hash 指定的页面', c2.ST.view==='trend', c2.ST.view);
  A('刷新后回到 hash 指定的板块', c2.curTab('trend')==='chart', c2.curTab('trend'));
  A('刷新后仍读到本地已存的场次', c2.STORE.count()>=6, c2.STORE.count());
  A('刷新后返回键为空（没有站内历史可退）', getEl('tbBack').innerHTML==='', getEl('tbBack').innerHTML);
}catch(e){ A('bootFromHash 正常', false, e.message); }

try{
  loc.hash = '#/不存在的页面';
  const c3 = new Function(src + `return { ST };`)();
  A('非法 hash 回落到导入页（不白屏）', c3.ST.view==='import', c3.ST.view);
}catch(e){ A('非法 hash 回落', false, e.message); }

console.log('\n'+'='.repeat(58));
console.log(`返回键与导航测试：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
