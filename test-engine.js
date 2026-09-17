/* 复盘台 · 引擎回归测试
   用法：node test-engine.js
   修改 engine.js 后务必跑一遍，确保没有破坏已有解析能力。
*/
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
eval(src);

let pass = 0, fail = 0;
function hr(t){ console.log('\n' + '─'.repeat(60) + '\n' + t); }
function assert(name, cond, got){
  if(cond){ pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  实际值: ${JSON.stringify(got)}`); }
}
function norm(text, cat){
  return normalize(parseTable(parseDelimited(text)).records, {category:cat||'服饰'});
}

hr('1 · 竖排键值对（俗称混用）');
const r1 = norm(`指标名称\t数值
场观\t83120
曝光量\t428600
平均停留时长\t41秒
GMV\t¥86,420
成交订单数\t654
退款率\t18.6%
进入率\t19.4%
成交转化率\t6.8%`);
assert('识别 views', r1.session.views === 83120, r1.session.views);
assert('识别 gmv(千分位)', r1.session.gmv === 86420, r1.session.gmv);
assert('识别 avgStay(41秒→41)', r1.session.avgStay === 41, r1.session.avgStay);
assert('识别 refundRate', r1.session.refundRate === 18.6, r1.session.refundRate);
assert('识别 entryRate', r1.session.entryRate === 19.4, r1.session.entryRate);
assert('识别 cvr', r1.session.cvr === 6.8, r1.session.cvr);
assert('UV价值自动补算', r1.session.uvValue === 1.04, r1.session.uvValue);

hr('2 · 竖排 + 中文「万」');
const r2 = norm(`观看人数,12.4万
最高在线,3420
支付金额,198640
客单价,158.2
商品点击率,28.6%
退货率,5.1%`, '美妆');
assert('12.4万 → 124000', r2.session.views === 124000, r2.session.views);
assert('支付金额 → gmv', r2.session.gmv === 198640, r2.session.gmv);
assert('退货率 → refundRate', r2.session.refundRate === 5.1, r2.session.refundRate);

hr('3 · 分时段明细（时间格式）');
const r3 = norm(`时间\t在线人数\t成交金额\t讲解商品
19:00\t820\t0\t开场
19:10\t1640\t120\t基础款T恤
19:20\t2480\t860\t基础款T恤
19:30\t3260\t1420\t基础款T恤
19:40\t2240\t640\t针织开衫
19:50\t1980\t410\t针织开衫
20:00\t2140\t980\t牛仔裤
20:10\t3420\t2680\t牛仔裤`);
assert('时段条数 = 8', r3.timeline.length === 8, r3.timeline.length);
assert('hasTimeline', r3.flags.hasTimeline === true, r3.flags.hasTimeline);
assert('标签 19:00', r3.timeline[0].label === '19:00', r3.timeline[0].label);
assert('标签 19:40', r3.timeline[4].label === '19:40', r3.timeline[4].label);
assert('在线人数', r3.timeline[0].online === 820, r3.timeline[0].online);
assert('成交金额', r3.timeline[3].gmv === 1420, r3.timeline[3].gmv);
assert('商品名', r3.timeline[4].item === '针织开衫', r3.timeline[4].item);

hr('4 · 横排字段名');
const r4 = norm(`观看人数\t曝光人数\t平均在线\t峰值在线\t平均停留\tGMV\t订单数\t退款率\t进入率\t成交转化率\t付费占比
83120\t428600\t1180\t3420\t41\t86420\t654\t18.6%\t19.4%\t6.8%\t34%`);
assert('字段数 ≥ 12', Object.keys(r4.session).length >= 12, Object.keys(r4.session).length);
assert('views', r4.session.views === 83120, r4.session.views);
assert('gpm 补算(千次观看)', r4.session.gpm > 900 && r4.session.gpm < 1200, r4.session.gpm);
assert('付费占比 → 自然占比', r4.session.naturalRate === 66, r4.session.naturalRate);

hr('5 · 中文单位 / 缺值 / 文字时长');
const r5 = norm(`项目,数值
gmv,"1,286,400"
观看人数,45.2万
最高在线人数,—
平均停留,1分08秒
退货率,12%`);
assert('GMV 千分位+引号', r5.session.gmv === 1286400, r5.session.gmv);
assert('45.2万 → 452000', r5.session.views === 452000, r5.session.views);
assert('横杠 → 剔除', r5.session.peakOnline === undefined, r5.session.peakOnline);
assert('1分08秒 → 68', r5.session.avgStay === 68, r5.session.avgStay);

hr('6 · 完整诊断（应有 high 级问题）');
const r6 = norm(`观看人数\t曝光人数\t平均停留\tGMV\t订单数\t退款率\t进入率\t成交转化率\t付费占比
83120\t428600\t41\t86420\t654\t18.6%\t19.4%\t6.8%\t34%`);
const d6 = runDiagnosis(r6);
assert('健康分 30-96', d6.score >= 30 && d6.score <= 96, d6.score);
assert('问题 ≥ 3', d6.issues.length >= 3, d6.issues.length);
assert('按严重度排序', d6.issues[0].sev === 'high', d6.issues[0].sev);

hr('7 · 健康场次（应少报警）');
const r7 = norm(`观看人数\t曝光人数\t平均停留\tGMV\t订单数\t退款率\t进入率\t成交转化率\t付费占比
50000\t250000\t68\t620000\t4200\t3.2%\t24.6%\t11.8%\t28%`);
const d7 = runDiagnosis(r7);
assert('健康分 > 80', d7.score > 80, d7.score);
assert('问题 ≤ 2', d7.issues.length <= 2, d7.issues.length);

hr('8 · 漏斗断点（进入率达标、成交率崩）');
const r8 = norm(`观看人数\t平均停留\tGMV\t退款率\t进入率\t成交转化率
60000\t56\t200000\t4.0%\t22.5%\t2.1%`);
const d8 = runDiagnosis(r8);
assert('检出成交率断点', d8.issues.some(i=>i.title.includes('成交率')), d8.issues.map(i=>i.title));

hr('9 · 拐点检测（人为暴跌）');
const r9 = norm(`时间\t在线人数\t成交金额\t讲解商品
20:00\t3000\t1000\tA商品
20:10\t3200\t1200\tA商品
20:20\t800\t200\tB商品
20:30\t750\t150\tB商品
20:40\t2800\t900\tC商品
20:50\t2900\t950\tC商品`);
const d9 = runDiagnosis(r9);
assert('检出在线骤降', d9.issues.some(i=>i.title.includes('骤降')), d9.issues.map(i=>i.title));

hr('10 · 边界：乱码 / 空 / 无表头');
let crashed = false;
try {
  const a = norm('这是一段没有任何表格结构的文字，随便写点什么。');
  assert('乱码不崩', true);
  assert('乱码记录为 0', a.timeline.length === 0 && Object.keys(a.session).length === 0);
  const b = norm('');
  const d = runDiagnosis(b);
  assert('空数据不崩', typeof d.score === 'number');
} catch(e){ crashed = true; console.log('  ✗ 抛出异常:', e.message); }

hr('11 · 商品明细识别');
const r11 = norm(`商品名称\t商品点击率\t成交转化率\t销售额
基础款T恤\t26.1%\t8.4%\t18240
针织开衫\t21.4%\t2.1%\t7080
牛仔外套\t31.2%\t9.4%\t14860`);
assert('商品数 = 3', r11.products.length === 3, r11.products.length);
assert('商品名正确', r11.products[1].name === '针织开衫', r11.products[1]);
assert('成交率正确', r11.products[1].cvr === 2.1, r11.products[1].cvr);
assert('销售额正确', r11.products[1].amt === 7080, r11.products[1].amt);

hr('12 · 时间戳格式');
const r12 = norm(`时间戳\t在线人数
1735689600\t1000
1735689900\t1200`);
assert('秒级时间戳可解析', r12.timeline.length === 2, r12.timeline.length);

hr('13 · 汇总行不被商品行污染');
const r13 = norm(`观看人数\t平均停留\tGMV
83120\t41\t86420

商品名称\t成交转化率\t销售额
针织开衫\t2.1%\t7080`);
assert('汇总 views 正确', r13.session.views === 83120, r13.session.views);
assert('汇总 gmv 未被商品行覆盖', r13.session.gmv === 86420, r13.session.gmv);

console.log('\n' + '='.repeat(60));
console.log(`回归测试完成：通过 ${pass}，失败 ${fail}`);
console.log('='.repeat(60));
process.exit(fail > 0 ? 1 : 0);
