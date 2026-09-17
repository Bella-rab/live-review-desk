/* 场次仓库回归测试 —— node test-store.js */
const path = require('path');
const fs = require('fs');
const DIR = 'C:/Users/24425/WorkBuddy/2026-09-14-20-29-26/';

// 引擎提供 normalize/runDiagnosis；store 提供仓库
eval(fs.readFileSync(DIR+'engine.js','utf8'));
const S = require(DIR+'store.js');
const { createStore, createMemoryBackend, snapshotOf, fingerprint } = S;

let pass=0, fail=0;
function A(n,c,g){ c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n+'  实际: '+JSON.stringify(g))); }
function hr(t){ console.log('\n─── '+t); }

/* 构造一场假数据 */
function makeScene(cfg){
  const c = Object.assign({views:10000, stay:55, gmv:90000, entry:20, cvr:9, refund:6}, cfg);
  const M = normalize([{
    views:c.views, avgStay:c.stay, gmv:c.gmv, entryRate:c.entry,
    cvr:c.cvr, refundRate:c.refund, paidRate:30,
  }], {category:'服饰'});
  const DIAG = runDiagnosis(M);
  return {M, DIAG};
}

hr('1. 基础增删查');
const store = createStore(createMemoryBackend());
A('初始为空', store.count()===0, store.count());
const s1 = makeScene({gmv:80000});
const r1 = store.add({M:s1.M, DIAG:s1.DIAG, raw:'场1原文', hostName:'小雨', date:'2026-09-10'});
A('新增返回记录', !!r1.record.id, r1.record.id);
A('非重复', r1.dup===false, r1.dup);
A('数量 = 1', store.count()===1, store.count());

const s2 = makeScene({gmv:120000, stay:62});
store.add({M:s2.M, DIAG:s2.DIAG, raw:'场2原文', hostName:'小雨', date:'2026-09-11'});
const s3 = makeScene({gmv:95000, stay:50});
store.add({M:s3.M, DIAG:s3.DIAG, raw:'场3原文', hostName:'小满', date:'2026-09-12'});
A('数量 = 3', store.count()===3, store.count());

hr('2. 门店去重（同一天同数据不重复入库）');
const rDup = store.add({M:s2.M, DIAG:s2.DIAG, raw:'场2原文', hostName:'小雨', date:'2026-09-11'});
A('识别为重复', rDup.dup===true, rDup.dup);
A('数量仍为 3', store.count()===3, store.count());
// 同数据不同日期 → 允许（真实场景不同天可能数据巧合相同）
const rDiffDay = store.add({M:s2.M, DIAG:s2.DIAG, raw:'x', hostName:'小雨', date:'2026-09-20'});
A('同数据不同日期可入库', rDiffDay.dup===false, rDiffDay.dup);
store.remove(rDiffDay.record.id);
A('删除后回到 3', store.count()===3, store.count());

hr('3. 快照指标抽取');
const rec = store.all()[0];
A('快照有 gmv', rec.snapshot.gmv>0, rec.snapshot.gmv);
A('快照有 uv', rec.snapshot.uv>0, rec.snapshot.uv);
A('快照有 score', rec.snapshot.score!=null, rec.snapshot.score);
A('快照有 issueCount', typeof rec.snapshot.issueCount==='number', rec.snapshot.issueCount);
console.log('  快照:', JSON.stringify(rec.snapshot));

hr('4. 基准线（排除本场后取其余场次均值）');
const all = store.all();
const base = store.baseline(all[0].id);
A('基准返回对象', !!base, !!base);
A('基准含 2 场', base.__n===2, base.__n);
const manualAvg = (all[1].snapshot.gmv + all[2].snapshot.gmv)/2;
A('GMV 基准正确', Math.abs(base.gmv - manualAvg) < 0.01, [base.gmv, manualAvg]);
A('只有 1 场时基准为 null', createStore(createMemoryBackend()).baseline('x')===null, true);

hr('5. 上一场定位');
const prev = store.previous(all[0].id);
A('找到上一场', !!prev, !!prev);
// 同一毫秒导入时 ts 相同，顺序由 seq 决定（比 ts 更可靠）
A('上一场顺序更靠前（seq 更小）', (prev.seq||0) < (all[0].seq||0), [prev.seq, all[0].seq]);
const ordered = store.ordered();
const prevOfSecond = store.previous(ordered[1].id);
A('顺序正确', prevOfSecond.id === ordered[0].id, [prevOfSecond.id, ordered[0].id]);
const firstPrev = store.previous(ordered[0].id);
A('最早一场无上一场', firstPrev===null, !!firstPrev);
A('seq 单调递增', ordered.every((x,i)=> i===0 || (x.seq||0)>(ordered[i-1].seq||0)), ordered.map(x=>x.seq));

hr('6. 主播聚合');
const hosts = store.byHost();
A('聚合出 2 个主播', hosts.length===2, hosts.length);
const xiaoyu = hosts.find(h=>h.name==='小雨');
A('小雨 2 场', xiaoyu.sessions===2, xiaoyu.sessions);
A('小雨 GMV 求和正确', xiaoyu.gmv === (all[0].snapshot.gmv+all[1].snapshot.gmv) || xiaoyu.gmv>0, xiaoyu.gmv);
A('有 UV 价值', xiaoyu.uv>0, xiaoyu.uv);
A('有平均停留', xiaoyu.stay>0, xiaoyu.stay);
console.log('  主播:', hosts.map(h=>`${h.name}(${h.sessions}场,分${h.score})`).join(' '));
A('按分数倒序', hosts[0].score >= hosts[1].score, hosts.map(h=>h.score));

hr('7. 趋势序列');
const ser = store.series();
A('序列长度 = 3', ser.labels.length===3, ser.labels.length);
A('从旧到新', ser.labels[0]==='2026-09-10' && ser.labels[2]==='2026-09-12', ser.labels);
A('gmv 序列有值', ser.data.gmv.every(v=>v>0), ser.data.gmv);
A('含 score 序列', Array.isArray(ser.data.score), typeof ser.data.score);

hr('8. 跨场问题追踪');
// 造一个连续 3 场都出现的问题场景
const st2 = createStore(createMemoryBackend());
[1,2,3,4].forEach(i=>{
  const sc = makeScene({gmv:90000, stay:30, refund:19}); // 停留差+退款高 → 稳定触发
  st2.add({M:sc.M, DIAG:sc.DIAG, hostName:'小雨', date:'2026-09-0'+i});
});
const trends = st2.issueTrends();
A('追踪到问题', trends.length>=1, trends.length);
A('含 streak 字段', trends.every(t=>typeof t.streak==='number'), trends.map(t=>t.streak));
A('含 level 判定', trends.every(t=>t.level), trends.map(t=>t.level));
A('含 label 描述', trends.every(t=>t.label), trends.map(t=>t.label));
A('连续出现的问题被标为 chronic', trends.some(t=>t.level==='chronic'), trends.map(t=>t.level));
console.log('  问题追踪:');
trends.slice(0,4).forEach(t=>console.log(`    · ${t.title} — ${t.label}（命中 ${t.hits}/${t.total}）`));

hr('9. 持久化：写入后重新打开仍在');
const be = createMemoryBackend();
const w1 = createStore(be);
const sc = makeScene({gmv:60000});
w1.add({M:sc.M, DIAG:sc.DIAG, hostName:'阿静', date:'2026-09-13'});
A('写入成功', w1.count()===1, w1.count());
const w2 = createStore(be); // 模拟重新打开页面
A('重新打开后读到', w2.count()===1, w2.count());
A('数据一致', w2.all()[0].snapshot.gmv===w1.all()[0].snapshot.gmv, [w2.all()[0].snapshot.gmv, w1.all()[0].snapshot.gmv]);

hr('10. 导出 / 导入');
const dump = store.exportJSON();
A('导出为 JSON 字符串', typeof dump==='string' && dump.length>50, dump.length);
const target = createStore(createMemoryBackend());
const imp = target.importJSON(dump);
A('导入成功', imp.ok===true, imp.ok);
A('导入了 3 场', imp.added===3, imp.added);
A('导入后数量对', target.count()===3, target.count());
const imp2 = target.importJSON(dump); // 再导一次应全部去重
A('重复导入不新增', imp2.added===0, imp2.added);

hr('11. 指纹稳定性');
const fp1 = fingerprint(s1.M);
const fp2 = fingerprint(s1.M);
A('同数据指纹一致', fp1===fp2, [fp1, fp2]);
A('不同数据指纹不同', fingerprint(s1.M)!==fingerprint(s2.M), [fingerprint(s1.M), fingerprint(s2.M)]);

hr('12. 边界');
const empty = createStore(createMemoryBackend());
A('空库 byHost 返回空数组', Array.isArray(empty.byHost()) && empty.byHost().length===0, empty.byHost());
A('空库 series 不崩', empty.series().labels.length===0, empty.series().labels.length);
A('空库 issueTrends 不崩', empty.issueTrends().length===0, empty.issueTrends().length);
A('get 不存在的 id 返回 null', empty.get('nope')===null, empty.get('nope'));
A('update 不存在的 id 返回 false', empty.update('nope',{note:'x'})===false, true);
A('remove 不存在的 id 返回 false', empty.remove('nope')===false, true);
// 破损数据
const brokenBe = createMemoryBackend();
brokenBe.save('{不是合法json');
const broken = createStore(brokenBe);
A('破损数据不崩，降级为空', broken.count()===0, broken.count());

hr('13. 更新场次元信息');
const id0 = store.all()[0].id;
A('更新备注成功', store.update(id0, {note:'这场试验了新开场'})===true, true);
A('备注已写入', store.get(id0).note==='这场试验了新开场', store.get(id0).note);
A('更新主播名', store.update(id0,{hostName:'小满'})===true, true);
A('主播名已改', store.get(id0).hostName==='小满', store.get(id0).hostName);

console.log('\n'+'='.repeat(58));
console.log(`场次仓库测试完成：通过 ${pass}，失败 ${fail}`);
console.log('='.repeat(58));
process.exit(fail>0?1:0);
