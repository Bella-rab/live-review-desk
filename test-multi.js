/* 多场次集成测试：模拟真实使用流程 —— node test-multi.js */
const fs = require('fs');
const DIR = 'C:/Users/24425/WorkBuddy/2026-09-14-20-29-26/';

eval(fs.readFileSync(DIR+'engine.js','utf8'));
const { createStore, createMemoryBackend } = require(DIR+'store.js');

let pass=0, fail=0;
function A(n,c,g){ c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+'  实际: '+JSON.stringify(g))); }
function hr(t){ console.log('\n─── '+t); }

const html = fs.readFileSync(DIR+'index.html','utf8');

hr('1. 界面完整性（多页面）');
['import','library','report','compare','host','trend','issues','action'].forEach(v=>{
  const fn = 'render'+v[0].toUpperCase()+v.slice(1);
  A('视图 '+fn, html.includes('function '+fn), fn);
});
const navs = (html.match(/data-v="/g)||[]).length;
A('侧栏导航 = 8 项', navs===8, navs);
A('引入 store.js', html.includes('src="store.js"'), true);
A('不再硬编码 HISTORY', !/const HISTORY\s*=/.test(html), true);
A('不再硬编码 HOSTS', !/const HOSTS\s*=/.test(html), true);

hr('2. 模拟真实使用：连续导入 4 场');
const store = createStore(createMemoryBackend());

function ingest(cfg){
  const M = normalize([{
    views:cfg.views, avgStay:cfg.stay, gmv:cfg.gmv, entryRate:cfg.entry,
    cvr:cfg.cvr, refundRate:cfg.refund, paidRate:cfg.paid||30,
  }], {category:'服饰'});
  const DIAG = runDiagnosis(M);
  const r = store.add({M, DIAG, raw:cfg.raw||'raw', hostName:cfg.host, date:cfg.date, category:'服饰', note:cfg.note||''});
  return r;
}

// 第 1 场：小雨，一般
ingest({views:9800, stay:52, gmv:88000, entry:19.2, cvr:8.2, refund:7.4, host:'小雨', date:'2026-09-09'});
A('第 1 场入库', store.count()===1, store.count());

// 第 2 场：小雨，变好
ingest({views:10400, stay:58, gmv:104000, entry:20.4, cvr:9.1, refund:6.2, host:'小雨', date:'2026-09-10'});
// 第 3 场：小满，掉链子（停留差 + 退款高）
ingest({views:9600, stay:41, gmv:86420, entry:19.4, cvr:6.8, refund:18.6, host:'小满', date:'2026-09-11'});
// 第 4 场：小雨，恢复
ingest({views:11200, stay:61, gmv:118000, entry:21.0, cvr:9.8, refund:6.0, host:'小雨', date:'2026-09-12'});
A('4 场全部入库', store.count()===4, store.count());

hr('3. 场次对比页的数据逻辑');
const all = store.all();               // 最新在前
const cur = all[0];                    // 最后导入的 09-12
A('本场 = 09-12（最后导入的）', cur.date==='2026-09-12', cur.date);
const prev = store.previous(cur.id);
A('上一场 = 09-11', prev && prev.date==='2026-09-11', prev&&prev.date);
const base = store.baseline(cur.id);
A('基准含 3 场', base.__n===3, base.__n);
// 本场 vs 上场：停留 61 vs 41 → 大幅提升
const stayGap = (cur.snapshot.stay - prev.snapshot.stay)/prev.snapshot.stay*100;
A('停留环比大幅提升', stayGap>40, stayGap.toFixed(1));
// 本场 vs 基准：退款 6.0 vs 均值(7.4+6.2+18.6)/3=10.73
const avgRefund = (7.4+6.2+18.6)/3;
A('退款率低于基准', cur.snapshot.refund < avgRefund, [cur.snapshot.refund, avgRefund.toFixed(2)]);
console.log('  本场 vs 上场 vs 基准：');
[['GMV','gmv'],['停留','stay'],['转化','cvr'],['退款','refund']].forEach(([lb,k])=>{
  console.log(`    ${lb}: ${cur.snapshot[k]} / ${prev.snapshot[k]} / ${base[k].toFixed(2)}`);
});

hr('4. 主播对比页的数据逻辑');
const hosts = store.byHost();
A('聚合出 2 位主播', hosts.length===2, hosts.length);
const xy = hosts.find(h=>h.name==='小雨');
const xm = hosts.find(h=>h.name==='小满');
A('小雨 3 场', xy.sessions===3, xy.sessions);
A('小满 1 场', xm.sessions===1, xm.sessions);
// 小雨场均停留 (52+58+61)/3=57, 小满 41
A('小雨停留高于小满', xy.stay>xm.stay, [xy.stay, xm.stay]);
A('小满退款高于小雨', xm.refund>xy.refund, [xm.refund, xy.refund]);
A('排序：小雨健康分更高', hosts[0].name==='小雨', hosts.map(h=>`${h.name}:${h.score}`));
console.log('  主播聚合：', hosts.map(h=>`${h.name}(${h.sessions}场 停留${h.stay}s 退款${h.refund}% 分${h.score})`).join(' | '));

hr('5. 趋势看板的数据逻辑');
const ordered = store.ordered();      // 从旧到新
A('4 个时间点', ordered.length===4, ordered.length);
A('首个最早', ordered[0].date==='2026-09-09', ordered[0].date);
A('末个最新', ordered[3].date==='2026-09-12', ordered[3].date);
// 前后两半对比：前段=09-09,09-10 后段=09-11,09-12
const early = ordered.slice(0,2), late = ordered.slice(-2);
const avgStayE = early.reduce((a,x)=>a+x.snapshot.stay,0)/2;
const avgStayL = late.reduce((a,x)=>a+x.snapshot.stay,0)/2;
// 09-11 那场掉链子（41），所以后段可能被拉低；这里断言序列值正确即可
A('序列停留值正确', ordered.map(x=>x.snapshot.stay).join(',')==='52,58,41,61',
  ordered.map(x=>x.snapshot.stay));
A('序列 GMV 值正确', ordered.map(x=>x.snapshot.gmv).join(',')==='88000,104000,86420,118000',
  ordered.map(x=>x.snapshot.gmv));
A('首次与末次停留反映真实（61>52 净增长）', ordered[3].snapshot.stay>ordered[0].snapshot.stay,
  [ordered[0].snapshot.stay, ordered[3].snapshot.stay]);
console.log(`  停留序列：${ordered.map(x=>x.date.slice(5)+'='+x.snapshot.stay+'s').join(' → ')}`);
console.log(`  前段均值 ${avgStayE.toFixed(1)}s / 后段均值 ${avgStayL.toFixed(1)}s`);

hr('6. 问题库的数据逻辑');
const trends = store.issueTrends();
A('追踪到问题', trends.length>=1, trends.length);
A('含 level 判定', trends.every(t=>t.level), trends.map(t=>t.level));
A('含 streak 计数', trends.every(t=>typeof t.streak==='number'), trends.map(t=>t.streak));
A('含命中率', trends.every(t=>typeof t.rate==='number'), trends.map(t=>t.rate));
console.log('  问题追踪（4 场）：');
trends.slice(0,5).forEach(t=>console.log(`    · ${t.title} — ${t.label}`));

// 专门造一个「连续 3 场同问题」的场景，验证 chronic 识别
hr('6b. 结构性问题识别（连续 3 场同问题）');
const chronStore = createStore(createMemoryBackend());
[1,2,3,4].forEach(i=>{
  // 停留 30 秒 + 退款 19% → 稳定触发同一批问题
  const mm = normalize([{views:10000, gmv:90000, avgStay:30, entryRate:20, cvr:9, refundRate:19}],{category:'服饰'});
  chronStore.add({M:mm, DIAG:runDiagnosis(mm), hostName:'小雨', date:'2026-08-0'+i, raw:'c'+i});
});
const cTrends = chronStore.issueTrends();
const chronics = cTrends.filter(t=>t.level==='chronic');
A('识别出结构性问题', chronics.length>=1, chronics.map(t=>t.title));
A('结构性问题 streak >= 3', chronics.every(t=>t.streak>=3), chronics.map(t=>t.streak));
A('结构性问题 label 含「连续」', chronics.every(t=>t.label.includes('连续')), chronics.map(t=>t.label));
console.log('  结构性问题：');
chronics.forEach(t=>console.log(`    · ${t.title} — ${t.label}（命中 ${t.hits}/${t.total}）`));

// 反向：断档一场后 streak 应该被打断
const breakStore = createStore(createMemoryBackend());
[1,2].forEach(i=>{
  const mm = normalize([{views:10000, gmv:90000, avgStay:30, entryRate:20, cvr:9, refundRate:19}],{category:'服饰'});
  breakStore.add({M:mm, DIAG:runDiagnosis(mm), hostName:'小雨', date:'2026-08-1'+i, raw:'b'+i});
});
const okmm = normalize([{views:10000, gmv:100000, avgStay:65, entryRate:20, cvr:10, refundRate:5}],{category:'服饰'});
breakStore.add({M:okmm, DIAG:runDiagnosis(okmm), hostName:'小雨', date:'2026-08-13', raw:'ok'});
const bTrends = breakStore.issueTrends();
const stayIssue = bTrends.find(t=>t.title.includes('停留'));
A('断档后 streak 归零', !stayIssue || stayIssue.streak===0, stayIssue&&stayIssue.streak);

hr('7. 关键：删除/新增后所有派生视图自动更新');
const targetId = store.all()[0].id;       // 最后导入的那场
const targetRec = store.get(targetId);
A('准备删除的是 09-12', targetRec.date==='2026-09-12', targetRec.date);
A('删除前小雨 3 场', store.byHost().find(h=>h.name==='小雨').sessions===3,
  store.byHost().find(h=>h.name==='小雨').sessions);
store.remove(targetId);
A('删除后总数 3', store.count()===3, store.count());
A('小雨场次变 2', store.byHost().find(h=>h.name==='小雨').sessions===2,
  store.byHost().find(h=>h.name==='小雨').sessions);
A('趋势序列同步变短', store.ordered().length===3, store.ordered().length);
A('基准同步更新', store.baseline(store.all()[0].id).__n===2, store.baseline(store.all()[0].id).__n);

hr('8. 持久化：关掉网站再打开数据还在');
const be = createMemoryBackend();
const sess1 = createStore(be);
const m1 = normalize([{views:10000, gmv:100000, avgStay:60, entryRate:20, cvr:9, refundRate:6}],{category:'服饰'});
sess1.add({M:m1, DIAG:runDiagnosis(m1), hostName:'小雨', date:'2026-09-01', raw:'x'});
const m2 = normalize([{views:11000, gmv:120000, avgStay:64, entryRate:21, cvr:10, refundRate:5}],{category:'服饰'});
sess1.add({M:m2, DIAG:runDiagnosis(m2), hostName:'小满', date:'2026-09-02', raw:'y'});
// 模拟关闭再打开
const sess2 = createStore(be);
A('重开后仍是 2 场', sess2.count()===2, sess2.count());
A('对比能力仍在（能定位上一场）', !!sess2.previous(sess2.all()[0].id), true);
A('主播聚合仍在', sess2.byHost().length===2, sess2.byHost().length);
A('问题追踪仍在', Array.isArray(sess2.issueTrends()), true);

hr('9. 目标达成核验：每场都留存，不互相覆盖');
console.log('  说明：旧实现每场分析都覆盖前一场（HISTORY 写死）；');
console.log('        新实现每场 append 到 store，历史永不丢失。');
const s = createStore(createMemoryBackend());
let cnt=0;
for(let i=0;i<10;i++){
  const mm = normalize([{views:10000+i*100, gmv:90000+i*1000, avgStay:50+i, entryRate:20, cvr:9, refundRate:6}],{category:'服饰'});
  const rr = s.add({M:mm, DIAG:runDiagnosis(mm), hostName:'小雨', date:'2026-09-'+String(i+1).padStart(2,'0'), raw:'r'+i});
  if(!rr.dup) cnt++;
}
A('连续导入 10 场全部留存', s.count()===10, s.count());
A('第一场仍可访问', !!s.ordered()[0], s.ordered()[0] && s.ordered()[0].date);
A('第 10 场仍在', s.ordered()[9].date==='2026-09-10', s.ordered()[9].date);
const ser = s.series();
A('趋势序列 10 点', ser.labels.length===10, ser.labels.length);
console.log('  趋势序列日期:', ser.labels.join(' '));

console.log('\n'+'='.repeat(58));
console.log(`多场次集成测试完成：通过 ${pass}，失败 ${fail}`);
console.log('='.repeat(58));
process.exit(fail>0?1:0);
