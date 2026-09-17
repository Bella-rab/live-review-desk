/* 决策引擎测试：验证五种典型场景的裁决是否正确 */
const fs = require('fs');
const path = 'C:/Users/24425/WorkBuddy/2026-09-14-20-29-26/';
const eng = fs.readFileSync(path+'engine.js','utf8');
const API = new Function(eng + '; return {decide, trendSlope, stayCvrElasticity, buildGaps, chainState, pctGap};')();
const {decide, trendSlope, stayCvrElasticity, buildGaps} = API;

let pass=0, fail=0;
const A = (name, cond, extra) => {
  if(cond){ pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra!==undefined ? '  → ' + JSON.stringify(extra) : '')); }
};
const hr = t => console.log('\n' + '─'.repeat(58) + '\n' + t);

function snap(o){
  return Object.assign({gmv:100000,views:10000,uv:10,stay:58,entry:19,cvr:9,
    refund:7,paid:30,avgOnline:120,peakOnline:300,newFans:200,score:80,issueCount:2}, o);
}

const base = {gmv:100000,uv:10,stay:58,entry:19,cvr:9,refund:7,paid:30,score:80,__n:5};
const hist = [snap({score:72}),snap({score:74}),snap({score:76}),snap({score:78}),snap({score:80})];

hr('1. 稳步上升 → 应判「继续推进」');
{
  const cur = snap({score:86,gmv:118000,stay:64,cvr:10});
  const r = decide(cur, snap({score:80}), base, hist.concat([cur]), {n:6});
  console.log('  裁决:', r.verdict.label, '|', r.verdict.headline);
  A('裁决 = 继续推进', r.verdict.k==='advance', r.verdict.k);
  A('等级 = green', r.verdict.level==='green', r.verdict.level);
  A('识别出优势环节', r.chain.filter(c=>c.state==='strong').length>=1);
  A('给了至少一条动作', r.actions.length>=1);
  A('趋势方向向上', r.slope && r.slope.rel>0, r.slope);
}

hr('2. 平稳（本场 78 分、略低于基准 80 分）→ 应判「保持节奏」，不因历史在涨就误判推进');
{
  const cur = snap({score:78});
  const r = decide(cur, snap({score:80}), base, hist.concat([cur]), {n:6});
  console.log('  裁决:', r.verdict.label, '|', r.verdict.headline);
  A('裁决 = 保持节奏', r.verdict.k==='hold', r.verdict.k);
  A('没有硬伤', r.hard.length===0, r.hard);
  A('结论里明确「不用为了改而改」', /不用为了改而改|保持/.test(r.verdict.headline+r.verdict.reason));
}

hr('2b. 关键防呆：本场明显退步（70 分 vs 基准 80）但历史斜率向上 → 不能判「继续推进」');
{
  const cur = snap({score:70});
  const r = decide(cur, snap({score:78}), base, hist.concat([cur]), {n:6});
  console.log('  裁决:', r.verdict.label, '|', r.verdict.headline);
  A('绝不能判推进', r.verdict.k!=='advance', r.verdict.k);
  A('指出低于自身基准', /基准|拖累|补短板/.test(r.verdict.headline+r.verdict.reason));
}

hr('3. 硬伤（退款 18.6% + 停留 41s）→ 应判「立即纠偏」且 P0 优先');
{
  const cur = snap({score:52,gmv:86420,stay:41,cvr:6.8,refund:18.6});
  const r = decide(cur, snap({score:80}), base, hist.concat([cur]), {n:6});
  console.log('  裁决:', r.verdict.label, '|', r.verdict.headline);
  console.log('  依据:', r.verdict.reason);
  A('裁决 = 立即纠偏', r.verdict.k==='fix', r.verdict.k);
  A('等级 = red', r.verdict.level==='red', r.verdict.level);
  A('检出 ≥2 处硬伤', r.hard.length>=2, r.hard.map(h=>h.key));
  A('退款率被检出', r.hard.some(h=>h.key==='refund'));
  A('停留被检出', r.hard.some(h=>h.key==='stay'));
  A('最弱环是停留', r.weakest && r.weakest.key==='stay', r.weakest&&r.weakest.key);
  A('有 P0 动作', r.actions.some(a=>a.p==='P0'), r.actions.map(a=>a.p));
  A('每条动作都有目标', r.actions.every(a=>!!a.target));
  A('每条动作都有责任人', r.actions.every(a=>!!a.owner));
  A('动作里有量化收益估算', r.actions.some(a=>/GMV 量级约回到|¥[\d,]{4,}/.test(a.target+a.why)));
}

hr('4. 样本不足（2 场）→ 应诚实说「先积累」，不硬给结论');
{
  const cur = snap({score:70});
  const r = decide(cur, snap({score:80}), null,
                   [snap({score:80}), cur], {n:2});
  console.log('  裁决:', r.verdict.label, '|', r.verdict.headline);
  A('裁决 = 先积累样本', r.verdict.k==='hold', r.verdict.k);
  A('没有 base 时链路不崩', r.chain.length>0);
  A('没有 base 时不误报硬伤', r.hard.length===0, r.hard);
  A('结论里说明样本不足', /样本|3 场/.test(r.verdict.headline + r.verdict.reason));
}

hr('5. 持续下滑 → 应判「纠正/优化」，并指出趋势没拐头');
{
  const cur = snap({score:64,gmv:82000,stay:48,cvr:7});
  const down = [snap({score:82}),snap({score:78}),snap({score:74}),snap({score:70}),snap({score:66}),cur];
  const r = decide(cur, snap({score:72}),
                   {gmv:104000,uv:10.4,stay:60,entry:20,cvr:9.5,refund:6.5,paid:30,score:76,__n:6},
                   down, {n:6});
  console.log('  裁决:', r.verdict.label, '|', r.verdict.headline);
  A('裁决是纠正或优化', r.verdict.k==='fix'||r.verdict.k==='optimize', r.verdict.k);
  A('趋势为负', r.slope && r.slope.rel<0, r.slope);
  A('识别到下滑', /下滑|走低|往下/.test(r.verdict.headline + r.verdict.reason));
}

hr('6. 差距明细：两个口径都要算，且逆向指标方向正确');
{
  const gaps = buildGaps(snap({gmv:120000,refund:3}),
                         snap({gmv:100000,refund:7}),
                         {gmv:100000,refund:7,uv:10,stay:58,entry:19,cvr:9,paid:30});
  const gmv = gaps.find(g=>g.key==='gmv');
  const ref = gaps.find(g=>g.key==='refund');
  A('GMV 差距 +20%', gmv && Math.abs(gmv.gapCmp-20)<0.01, gmv&&gmv.gapCmp);
  A('GMV 上升算正向', gmv && gmv.sCmp>0);
  A('退款率下降算正向', ref && ref.sCmp>0, ref&&ref.sCmp);
  A('差距按严重度排序', gaps.length<2 || gaps[0].severity>=gaps[1].severity);
  A('无对比场时不崩', buildGaps(snap({}), null, null).length===0);
}

hr('7. 边界：全空 / 全零 / 单场，不能抛异常');
{
  let ok = true, msg='';
  const cases = [
    ['全空对象', {}, {}, {}, []],
    ['全零', {gmv:0,uv:0,stay:0,entry:0,cvr:0,refund:0,paid:0,score:0}, {gmv:0},{gmv:0}, [{}]],
    ['仅一场', snap({}), null, null, [snap({})]],
    ['base 为 null', snap({}), snap({}), null, [snap({}),snap({}),snap({})]],
    ['ordered 为 null', snap({}), snap({}), base, null],
  ];
  cases.forEach(([name,cur,cmp,b,ord])=>{
    try{ decide(cur,cmp,b,ord,{n:(ord||[]).length||0}); }
    catch(e){ ok=false; msg=name+' → '+e.message; }
  });
  A('五种边界都无异常', ok, msg);
}

hr('8. 弹性系数：样本无方差时应返回 null（不给假精度）');
{
  const flat = [snap({stay:58,cvr:9}),snap({stay:58,cvr:9}),snap({stay:58,cvr:9}),snap({stay:58,cvr:9})];
  A('无方差 → null', stayCvrElasticity(flat)===null, stayCvrElasticity(flat));
  const varied = [snap({stay:40,cvr:6}),snap({stay:50,cvr:7.5}),snap({stay:60,cvr:9}),snap({stay:70,cvr:10.5})];
  const el = stayCvrElasticity(varied);
  A('有方差 → 算出正弹性', el && el.k>0 && el.k<=3, el);
  A('样本不足 4 场 → null', stayCvrElasticity(varied.slice(0,3))===null);
  console.log('  实测弹性 k =', el && el.k, '(停留每 +1%，转化约 +'+(el?el.k:'?')+'%)');
}

hr('9. 趋势斜率');
{
  const up = [snap({score:60}),snap({score:70}),snap({score:80})];
  const s = trendSlope(up,'score');
  A('上升序列斜率为正', s && s.rel>0, s&&s.rel);
  A('2 场不计算斜率', trendSlope(up.slice(0,2),'score')===null);
  A('缺字段自动跳过', trendSlope([{score:60},{x:1},{score:80},{score:90}],'score')!==null);
}

hr('10. 样本不足时的文案口径（不能误导成「数据丢了」）');
{
  // 真实浏览器回归里发现的问题：仓库里已有 4 场，但用户在看第 1 场时，
  // 裁决写「目前只有 1 场数据」——用户会以为数据丢了。
  // n 是「截止本场累积的场次」，文案必须说清是「本场之前」。
  const cur = snap({score:70});
  const r1 = decide(cur, null, null, [cur], {n:1});
  console.log('  n=1 →', r1.verdict.reason);
  A('n=1 裁决仍是先积累样本', r1.verdict.k==='hold', r1.verdict.k);
  A('n=1 文案不再说「目前只有 1 场数据」', !/目前只有/.test(r1.verdict.reason), r1.verdict.reason);
  A('n=1 文案说明这是第 1 场、没有上一场可比',
    /第 1 场|还没有上一场/.test(r1.verdict.reason), r1.verdict.reason);
  A('n=1 给出可执行的下一步（录满 3 场）', /3 场/.test(r1.verdict.reason), r1.verdict.reason);

  const r2 = decide(cur, snap({score:75}), null, [snap({score:75}), cur], {n:2});
  console.log('  n=2 →', r2.verdict.reason);
  A('n=2 文案写清「截止本场累积 n 场」', /截止这一场/.test(r2.verdict.reason), r2.verdict.reason);
  A('n=2 文案写清「能对比的只有前面 n-1 场」',
    /前面 1 场/.test(r2.verdict.reason), r2.verdict.reason);
  A('n=2 不再出现「目前只有」这类误导措辞', !/目前只有/.test(r2.verdict.reason), r2.verdict.reason);
}

hr('11. 裁决文案里不能出现未替换的变量/裸标识符');
{
  const cases = [
    decide(snap({score:70}), snap({score:75}), null, [snap({score:75}),snap({score:72}),snap({score:70})], {n:3}),
    decide(snap({score:90,refund:3}), snap({score:91}), {...base, score:89}, [snap({score:88}),snap({score:89}),snap({score:90})], {n:3}),
    decide(snap({score:50,refund:22,stay:35}), snap({score:80}), {...base, score:80}, [snap({score:80}),snap({score:65}),snap({score:50})], {n:3}),
  ];
  cases.forEach((r,i)=>{
    const blob = r.verdict.headline + ' ' + r.verdict.reason;
    A('第 '+(i+1)+' 例：文案无 undefined / NaN / [object',
      !/undefined|NaN|\[object/.test(blob), blob.slice(0,120));
    A('第 '+(i+1)+' 例：文案是完整中文句（含中文标点）',
      /[，。；：]/.test(blob), blob.slice(0,80));
  });
}

console.log('\n' + '='.repeat(58));
console.log('通过 ' + pass + ' ，失败 ' + fail);
process.exit(fail ? 1 : 0);
