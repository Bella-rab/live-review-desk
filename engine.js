/* ============================================================
   复盘台 · 诊断引擎 v2
   新增：时段热力、商品四象限、流量结构、退货归因、
        跨场问题库、排期方案生成、话术建议
   ============================================================ */

/* ---------- 1. 字段同义词字典 ---------- */
const FIELD_SYNONYMS = {
  views:        ['观看人数','场观','总观看','观看人次','累计观看人数','uv','viewers'],
  exposure:     ['曝光人数','曝光量','商品曝光人数','展现人数','impressions','曝光次数'],
  avgOnline:    ['平均在线','平均在线人数','人均在线','平均同时在线','avg_online'],
  peakOnline:   ['最高在线','峰值在线','最高同时在线','在线峰值','peak_online','最高在线人数'],
  avgStay:      ['平均停留','平均停留时长','人均停留时长','人均观看时长','停留时长','average_stay','平均在线时长'],
  comments:     ['评论数','评论人数','弹幕数','互动评论','comments'],
  likes:        ['点赞数','点赞人数','likes'],
  newFans:      ['新增粉丝','涨粉数','新增关注','关注人数','new_fans','新增粉丝数'],
  shares:       ['分享数','分享次数','shares'],

  gmv:          ['gmv','成交金额','销售额','支付金额','成交额','直播销售额','成交总额','营业额'],
  orders:       ['订单数','成交订单数','支付订单数','成交单量','订单量'],
  buyers:       ['成交人数','支付人数','下单人数','成交用户数','买家数'],
  aov:          ['客单价','客单','平均客单价','人均消费','aov'],
  refund:       ['退款金额','退款额','退货金额'],
  refundRate:   ['退款率','退货率','退款占比'],
  items:        ['成交件数','销售件数','件数','item_count'],
  cartAdd:      ['加购人数','加购数','加购件数','add_cart'],

  entryRate:    ['进入率','曝光进入率','曝光-进入率','曝光转化率','直播间进入率'],
  ctr:          ['点击率','商品点击率','商品曝光点击率','曝光点击率','点击转化率'],
  cvr:          ['成交转化率','转化率','点击成交率','支付转化率','下单转化率'],
  naturalRate:  ['自然流量占比','自然推荐占比','推荐流量占比','自然流量比例'],
  paidRate:     ['付费流量占比','千川占比','付费占比','付费流量比例'],
  gpm:          ['千次观看成交额','gpm','千次曝光成交额'],

  timeSlot:     ['时间','时段','分钟','时间点','时间区间','切片时间'],
  onlineAt:     ['在线人数','同时在线','实时在线','在看人数'],
  gmvAt:        ['成交金额','时段成交','gmv','成交额'],
  itemAt:       ['讲解商品','当前商品','正在讲解','上架商品','商品名称','商品'],
  productName:  ['商品名','品名','货品名称'],
  sourceName:   ['流量来源','渠道','来源','入口','流量类型'],
  sourceViews:  ['观看人数','人数','流量人数','uv'],
  sourceEntry:  ['进入率','转化率'],
  hostName:     ['主播','主播姓名','主播名','场次主播'],
};

/* ---------- 2. 行业基准库 ---------- */
const BENCHMARKS = {
  '服饰': {entryRate:18.6, stay:58, ctr:24.8, cvr:8.7, refundRate:7.4, naturalRate:55, uvValue:8.8, aov:135},
  '食品': {entryRate:21.2, stay:46, ctr:31.5, cvr:11.4, refundRate:4.2, naturalRate:58, uvValue:6.2, aov:68},
  '美妆': {entryRate:19.8, stay:63, ctr:27.2, cvr:9.1, refundRate:5.8, naturalRate:52, uvValue:9.6, aov:186},
  '家居': {entryRate:17.4, stay:61, ctr:23.1, cvr:7.2, refundRate:6.1, naturalRate:54, uvValue:10.4, aov:242},
  '日用': {entryRate:22.6, stay:42, ctr:33.8, cvr:13.2, refundRate:5.4, naturalRate:60, uvValue:5.1, aov:52},
  '通用': {entryRate:19.0, stay:55, ctr:26.0, cvr:9.0, refundRate:6.5, naturalRate:55, uvValue:8.0, aov:120},
};

/* 取品类基准的唯一入口。
   任何未知品类（用户手输、外部导入的 JSON、老数据里的旧品类名）都必须回落到「通用」，
   否则 B 会是 undefined，一个 `B.uvValue` 就能把整个单场诊断页打崩。
   用 hasOwnProperty 而不是 `BENCHMARKS[cat]` 直接取：
   'constructor' / '__proto__' 这类键会命中原型链上的成员（值是真值但没有业务字段），
   直接取会把一个「看似有值、实则没字段」的对象当成基准传下去。 */
function benchOf(cat){
  return (cat && Object.prototype.hasOwnProperty.call(BENCHMARKS, cat))
    ? BENCHMARKS[cat] : BENCHMARKS['通用'];
}

/* ---------- 3. 清洗工具 ---------- */
function splitLines(text){
  // 去掉 UTF-8 BOM：Excel 导出的 CSV/TXT 常带 BOM，
  // 不剥的话第一列表头永远匹配不上（\uFEFF观看人数 ≠ 观看人数）
  return text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n')
    .split('\n').filter(l=>l.trim()!=='');
}
/* 分隔符判定：在前几行里投票，而不是只看第一行。
   只看第一行的话，首行是标题（「直播间数据汇总」）时就退化成单列，
   整块数据全丢。 */
function detectDelimiter(line){
  const text = String(line == null ? '' : line);
  const cands = [
    {d:'\t', n:(text.match(/\t/g)||[]).length},
    {d:',',  n:(text.match(/,/g)||[]).length - (text.match(/\d,\d{3}/g)||[]).length}, // 扣掉千分位逗号
    {d:'|',  n:(text.match(/\|/g)||[]).length},
    {d:'，', n:(text.match(/，/g)||[]).length},
    {d:/\s{2,}/, n:(text.match(/\s{2,}/g)||[]).length},
  ];
  cands.sort((a,b)=>b.n-a.n);
  return cands[0].n > 0 ? cands[0].d : '\t';
}
/* 在最多 8 行里投票选分隔符：标题行（0 个分隔符）不会因为排第一而胜出 */
function detectDelimiterFromRows(lines){
  const head = lines.slice(0, 8);
  let best = null, bestScore = 0;
  const candidates = ['\t', ',', '|', '，'];
  candidates.forEach(d=>{
    // 得分 = 出现该分隔符的行数（一致性）优先，总出现次数次之
    const rowsHit = head.filter(l=>l.indexOf(d) >= 0).length;
    const total = head.reduce((a,l)=>a + (l.match(new RegExp(d === '|' ? '\\|' : d, 'g'))||[]).length, 0);
    const score = rowsHit * 100 + total;
    if(rowsHit >= 2 && score > bestScore){ best = d; bestScore = score; }
  });
  if(best) return best;
  // 退回单行判定
  for(const l of head){ const d = detectDelimiter(l); if(d) return d; }
  return '\t';
}
/* 按 CSV 规则切一行：引号内不切分，且保留空单元格。
   以前用 /"[^"]*"|[^,]+/ 匹配，匹配不到空字段 —— Excel 里一个空格子
   会让后面所有列整体左移，指标全错位。

   千分位逗号：`1,234,567` 里的逗号不是分隔符。判据是「逗号后面紧跟 3 位数字
   且再往后不是数字」—— 只有这种情况才当作千分位，其余仍切开。
   不用占位符替换是因为占位符可能和真实内容撞车。 */
function isThousandsComma(s, i){
  const rest = s.slice(i + 1);
  // 后面必须是恰好 3 位数字，且之后不是数字（1,234 → 是；1,23 → 否）
  return /^\d{3}(?!\d)/.test(rest) && /\d$/.test(s.slice(0, i));
}
function smartSplit(line, delim){
  const d = (delim === /\s{2,}/) ? null : delim;
  if(!d){
    return String(line).split(delim).map(c=>c.trim().replace(/^"|"$/g,''));
  }
  const s = String(line);
  // 逗号分隔时先判断这一行到底有没有「真·逗号分隔符」：
  // 整行只有千分位逗号（如 `成交金额,1,234,567` 这种其实是 tab 分隔被误判）
  // 就不该按逗号切。
  const cells = [];
  let cur = '', inQuote = false;
  for(let i=0;i<s.length;i++){
    const ch = s[i];
    if(inQuote){
      if(ch === '"'){
        // 转义的双引号 ""
        if(s[i+1] === '"'){ cur += '"'; i++; }
        else inQuote = false;
      } else cur += ch;
      continue;
    }
    if(ch === '"'){ inQuote = true; continue; }
    if(ch === d){
      if(d === ',' && isThousandsComma(s, i)){ cur += ch; continue; }
      cells.push(cur); cur = ''; continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map(c=>c.trim());
}
function parseDelimited(text){
  const lines = splitLines(text);
  if(!lines.length) return [];
  const delim = detectDelimiterFromRows(lines);
  return lines.map(l=>smartSplit(l, delim).map(c=>c.trim().replace(/^"|"$/g,'')));
}

function toNum(v){
  if(v===null||v===undefined) return null;
  if(typeof v === 'number') return isNaN(v)?null:v;
  let s = String(v).trim();
  if(!s || /^(—|-|--|N\/A|暂无|无)$/i.test(s)) return null;
  if(/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s;
  const dur = s.match(/^(?:(\d+(?:\.\d+)?)\s*小时)?\s*(?:(\d+(?:\.\d+)?)\s*分)?\s*(?:(\d+(?:\.\d+)?)\s*秒)?$/);
  if(dur && (dur[1]||dur[2]||dur[3]) && /[分秒时]/.test(s)){
    return Math.round((parseFloat(dur[1]||0)*3600) + (parseFloat(dur[2]||0)*60) + parseFloat(dur[3]||0));
  }
  s = s.replace(/[¥$,\s，%]/g,'');
  let mult = 1;
  if(/万$/.test(s)){ mult=10000; s=s.replace(/万$/,''); }
  else if(/亿$/.test(s)){ mult=100000000; s=s.replace(/亿$/,''); }
  else if(/[kK]$/.test(s)){ mult=1000; s=s.replace(/[kK]$/,''); }
  const n = parseFloat(s);
  if(isNaN(n)) return null;
  return n*mult;
}
function isTimeValue(v){
  if(typeof v === 'number') return false;
  const s = String(v).trim();
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(s) || /^\d{10}$|^\d{13}$/.test(s);
}
/* 通用短表头的显式消歧。
   这些词在多张表里都合法，但后台导出最常用的是右边那个含义：
   - 「转化率」在直播后台默认指成交转化率（曝光转化率会写成「曝光进入率」）
   - 「商品」单列时是商品名，不是点击率
   显式写死比让模糊匹配去猜可靠 —— 猜错的代价是整列指标错位。 */
const HEADER_OVERRIDE = {
  '转化率': 'cvr',
  '商品':   'itemAt',
  '商品名': 'itemAt',
  '销售额': 'gmv',
  '主播':   'hostName',
};
/* 表头归一化：去掉空白与括号等装饰符号 */
function normHeader(s){
  return String(s == null ? '' : s).toLowerCase().replace(/[\s()（）\[\]【】\-_/：:]/g,'');
}
/* 字段匹配。优先级：显式消歧 > 完全相等 > 同义词互相包含。
   两个硬约束（都是踩过的坑）：
   1. 归一键为空（表头是 "()" / "-" / "  "）时直接返回 null。
      空串是任何字符串的子串，会命中字典里的第一个字段，
      结果空表头被当成 exposure，整张表错位。
   2. 用「长度占比」而不是纯双向 includes。
      "S" 会命中 exposure（"impressions" 里含 s），
      "A" 会命中 avgStay（"average_stay" 里含 a）。
      所以要求：单向命中时，较短一方 ≥2 字符，且覆盖较长方一半以上。 */
function matchField(rawName, context){
  if(!rawName) return null;
  const k = normHeader(rawName);
  if(!k) return null;                       // 空表头不映射
  // 上下文提示：流量来源表里，「观看人数」应归到 sourceViews
  if(context === 'source' && /观看人数|流量人数|人数|uv/.test(k)) return 'sourceViews';
  if(context === 'source' && /进入率|转化率/.test(k)) return 'sourceEntry';

  if(Object.prototype.hasOwnProperty.call(HEADER_OVERRIDE, k)) return HEADER_OVERRIDE[k];

  let best=null, bestScore=-1;
  for(const [canon, syns] of Object.entries(FIELD_SYNONYMS)){
    for(const syn of syns){
      const s = normHeader(syn);
      if(!s) continue;
      let score = -1;
      if(k === s){
        score = 1000 + s.length;            // 完全相等最优先
      } else {
        const shorter = Math.min(k.length, s.length);
        const longer  = Math.max(k.length, s.length);
        // 短的一侧必须 ≥2 字符，且占长的一侧一半以上
        if(shorter >= 2 && shorter / longer >= 0.5){
          if(k.includes(s) || s.includes(k)) score = shorter;
        }
      }
      if(score > bestScore){ best = canon; bestScore = score; }
    }
  }
  return best;
}

/* 表头行里是否含流量来源特征 */
function isSourceTable(headerRow){
  return headerRow.some(c=>/流量来源|渠道|来源|入口|流量类型/.test(String(c||'')));
}

/* ---------- 3.5 数值合理性校验 ---------- */
/* 后台导出和手工粘贴都可能带脏值（负数播放量、300% 的退款率、把 0.194 当
   19.4% 写）。这些值进入规则引擎会产出荒谬文案（「平均停留 -10 秒，低于基准
   117%」），所以入库前先夹到物理上可能的区间。
   返回 {value, clamped}：clamped 用于在 UI 上提示「这个值被修正过」。 */
const RANGE_RULES = {
  // [最小值, 最大值, 是否允许小数]
  views:      [0, 1e10], exposure:   [0, 1e11],
  avgOnline:  [0, 1e8],  peakOnline: [0, 1e8],
  avgStay:    [0, 100000], gmv:      [0, 1e11],
  orders:     [0, 1e9],  buyers:     [0, 1e9],
  refund:     [0, 1e11], items:      [0, 1e9],
  comments:   [0, 1e10], likes:      [0, 1e10],
  newFans:    [0, 1e9],  shares:     [0, 1e9],
  cartAdd:    [0, 1e9],  aov:        [0, 1e8],
};
/* 百分比类字段：上限 100%，负值无意义。
   注意「付费占比 100%」「退款率 100%」是可能的，所以上界取 100 而不是 99。 */
const PERCENT_KEYS = ['entryRate','ctr','cvr','refundRate','naturalRate','paidRate'];

function clampValue(key, v){
  if(v == null || typeof v !== 'number' || !isFinite(v)) return v;
  if(PERCENT_KEYS.includes(key)){
    // 百分比：超过 100 或为负都是数据本身错了，夹到边界
    return Math.min(100, Math.max(0, v));
  }
  const r = RANGE_RULES[key];
  if(!r) return v;
  return Math.min(r[1], Math.max(r[0], v));
}
/* 哪些值应当直接丢弃而不是夹到边界。
   负数观看人数、负数 GMV 不是「很小」，是「这一格填错了」——
   夹成 0 会被当成「这场 0 人观看」，那是一个比缺失更糟的错误结论。
   这里返回 null 表示「这个值不可用」，parseTable 会跳过它。 */
function rejectValue(key, v){
  if(v == null || typeof v !== 'number' || !isFinite(v)) return v;
  // 计数类与金额类不允许负数
  const nonNegative = ['views','exposure','avgOnline','peakOnline','avgStay','gmv',
                       'orders','buyers','refund','items','comments','likes','newFans',
                       'shares','cartAdd','aov'];
  if(nonNegative.includes(key) && v < 0) return null;
  // 百分比类：负数无意义；超过 100 也说明填错了（如把 250 当成 2.5）
  if(PERCENT_KEYS.includes(key)){
    if(v < 0) return null;
    // 明显超出 100 的，判定为录入错误而不是真实值
    if(v > 100) return null;
  }
  return clampValue(key, v);
}

/* ---------- 4. 解析 ---------- */
function locateHeader(rows){
  let bestIdx=0, bestScore=-1;
  rows.slice(0,8).forEach((row,i)=>{
    const isSrc = isSourceTable(row);
    const score = row.filter(c=>matchField(c, isSrc?'source':null)).length;
    if(score>bestScore){ bestScore=score; bestIdx=i; }
  });
  if(bestScore<=0) return null;
  const isSrc = isSourceTable(rows[bestIdx]);
  return {
    headerRow: bestIdx,
    headers: rows[bestIdx].map(h=>matchField(h, isSrc?'source':null)),
    rows: rows.slice(bestIdx+1),
  };
}
/* 竖排（指标名 \t 数值）判定。
   必须同时满足，否则一张普通商品表会被误判成竖排、整表报废：
   - 总行数 ≥2，且首列能匹配字段的行占比 ≥ 0.5
   - 没有时间值（有时间说明是分时段明细）
   - 首行必须能匹配字段（竖排的第一行就是指标名；商品表首行是表头）
   - 首列不得出现「像数据」的值：纯数字（含 8.1% / ¥100）、
     或长度 ≤2 的字母数字组合（A / C / S / M / L 这类 SKU 或尺码）
   这一条是核心：商品表首列是商品名，SKU 编码和尺码会命中 A→avgStay、
   C→items 之类的短同义词，导致 3 个商品被解析成 {avgStay:8.1, items:9}。 */
function looksLikeDataValue(v){
  const s = String(v == null ? '' : v).trim();
  if(!s) return true;                                   // 空也算「非表头」
  if(/^[-+]?[\d,]+(\.\d+)?%?$/.test(s)) return true;     // 纯数字/百分比
  if(/^[¥$]/.test(s)) return true;                       // 货币
  if(/^\d{1,2}:\d{2}/.test(s)) return true;              // 时间
  // 1-2 位 ASCII 只在「不是常见指标名缩写」时才算数据。
  // 直接按长度判会把 "GMV" 这类三字母指标误杀；这里只拦 1-2 位
  // （A / C / S / M / L 这类 SKU 或尺码）。
  if(/^[\x00-\x7F]{1,2}$/.test(s)) return true;
  return false;
}
/* 竖排表的表头对：`指标名称 / 数值`、`项目 / 值` 这类。
   竖排数据经常带一行表头，不能因为它首列匹配不上就否掉整张表。 */
const KV_HEADER_LABEL = /^(指标名称|指标|项目|字段|名称|维度|类目|统计项)$/;
const KV_HEADER_VALUE = /^(数值|值|数据|金额|结果|指标值)$/;
function isKVHeaderRow(row){
  if(!row || row.length < 2) return false;
  const a = String(row[0] == null ? '' : row[0]).trim();
  const b = String(row[1] == null ? '' : row[1]).trim();
  return KV_HEADER_LABEL.test(a) || KV_HEADER_VALUE.test(b);
}
function detectVerticalKV(rows){
  const usable = (rows||[]).filter(r=>r && r.length>=2);
  if(usable.length < 2) return false;
  const hasTime = usable.some(r=>r.some(c=>isTimeValue(c)));
  if(hasTime) return false;
  // 首行如果是「指标名称 / 数值」这类竖排表头，跳过它再判断数据行
  const body = isKVHeaderRow(usable[0]) ? usable.slice(1) : usable;
  if(body.length < 2) return false;
  // 首列不能看起来像数据（SKU / 尺码 / 纯数字）。
  // 这一条是核心：商品表首列是商品名，A→avgStay、C→items 之类的短同义词
  // 会让 3 个商品被解析成 {avgStay:8.1, items:9}。
  const dataLike = body.filter(r=>looksLikeDataValue(r[0])).length;
  if(dataLike > 0) return false;
  let hits = 0;
  body.forEach(r=>{ if(matchField(r[0])) hits++; });
  return hits / body.length >= 0.5;
}
/* 文本字段：不参与数值校验（商品名、渠道名可以是任意字符串） */
const TEXT_FIELDS = ['itemAt','productName','sourceName','hostName'];

/* 竖排键值对解析。
   注意这里也要走 rejectValue 校验 —— 竖排是后台导出最常见的格式
   （「观看人数 \t 9600」一行一项），如果只校验横排，
   一列负数的观看人数、300% 的退款率照样会进规则引擎，
   产出「平均停留 -10 秒，低于基准 117%」这种荒谬结论。
   被拒绝的值记进 rejected，由调用方汇总后提示用户。 */
function parseVerticalKV(rows, rejected){
  const obj={};
  rows.forEach(r=>{
    if(r.length<2) return;
    const f = matchField(r[0]);
    if(!f) return;
    for(let i=1;i<r.length;i++){
      const raw = r[i];
      if(!raw) continue;
      const v = toNum(raw);
      if(v===null) continue;
      if(typeof v === 'number' && !TEXT_FIELDS.includes(f) && f !== 'timeSlot'){
        const fixed = rejectValue(f, v);
        if(fixed === null){
          // 明显填错：丢弃并记录，不当成 0 参与后续计算
          if(rejected) rejected.push({field:f, from:v, to:null, rejected:true});
          return;
        }
        if(fixed !== v){
          if(rejected) rejected.push({field:f, from:v, to:fixed});
        }
        obj[f] = fixed;
      } else {
        obj[f] = v;
      }
      break;
    }
  });
  return obj;
}
function parseTable(rows){
  if(!rows || !rows.length) return {records:[],fields:[],unknown:[],mode:'none'};

  if(detectVerticalKV(rows)){
    const rejected = [];
    const rec = parseVerticalKV(rows, rejected);
    if(Object.keys(rec).length>=2){
      const unknown = rows.filter(r=>r[0] && !matchField(r[0])).map(r=>r[0])
        .filter(x=>x && !/^(指标|项目|名称|序号)$/.test(x));
      return {records:[rec], fields:Object.keys(rec), unknown, mode:'vertical', clamped:rejected};
    }
  }

  const loc = locateHeader(rows);
  if(!loc) return {records:[],fields:[],unknown:[],mode:'none'};
  const {headers, rows:body} = loc;

  // 流量来源表需要上下文识别（避免「观看人数」被归到全场 views）
  const ctx = isSourceTable(rows[loc.headerRow]) ? 'source' : null;
  const mapped = ctx === 'source'
    ? rows[loc.headerRow].map(h=>matchField(h,'source'))
    : headers;

  const records=[];
  const clamped=[];
  body.forEach(r=>{
    const obj={};
    let hit=0;
    mapped.forEach((f,i)=>{
      if(!f) return;
      const raw = r[i];
      if(raw===undefined||raw===null||String(raw).trim()==='') return;
      let v;
      if(f==='timeSlot'){
        v = isTimeValue(raw) ? String(raw).trim() : toNum(raw);
      } else if(TEXT_FIELDS.includes(f)){
        const t = String(raw).trim();
        v = /^(—|-|--|N\/A|暂无|无)$/i.test(t) ? null : t;
      } else {
        v = toNum(raw);
        if(typeof v === 'number'){
          const fixed = rejectValue(f, v);
          if(fixed === null){
            // 明显填错的值直接丢弃，并记下来让 UI 提示；
            // 夹到 0 会被当成「这场 0 人观看」，比缺失更糟
            clamped.push({field:f, from:v, to:null, rejected:true});
            return;
          }
          if(fixed !== v){ clamped.push({field:f, from:v, to:fixed}); v = fixed; }
        }
      }
      if(v===null||v===undefined) return;
      obj[f]=v; hit++;
    });
    if(hit>=2) records.push(obj);
  });
  const fields=[...new Set(mapped.filter(Boolean))];
  const unknown = rows[loc.headerRow] ? rows[loc.headerRow].filter((h,i)=>h && !mapped[i]) : [];
  return {records, fields, unknown, mode:'horizontal', clamped};
}

/* ---------- 5. 归一化 ---------- */
function formatSlot(v){
  if(v===null||v===undefined) return '';
  if(typeof v==='string' && /^\d{1,2}:\d{2}/.test(v.trim())) return v.trim().slice(0,5);
  const raw = String(v).trim();
  if(/^\d{1,2}:\d{2}/.test(raw)) return raw.slice(0,5);
  const n = toNum(v);
  if(n===null) return String(v);
  if(typeof n==='string') return n.slice(0,5);
  if(n>1000000000000){ const d=new Date(n); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
  if(n>1000000000){ const d=new Date(n*1000); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
  if(n>=100 && n<=2400 && Number.isInteger(n)){
    const s=String(n).padStart(4,'0');
    const hh=parseInt(s.slice(0,2),10), mm=parseInt(s.slice(2,4),10);
    if(hh<=23 && mm<=59) return s.slice(0,2)+':'+s.slice(2,4);
  }
  if(n>=0 && n<=1440){
    const h=Math.floor(n/60), m=Math.round(n%60);
    return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  }
  return String(v);
}

function normalize(allRecords, meta){
  const M = {
    session:{}, timeline:[], products:[], sources:[],
    flags:{}, unknownFields:[], meta:meta||{},
  };
  const sumKeys = ['views','exposure','avgOnline','peakOnline','avgStay','comments','likes','newFans','shares',
                   'gmv','orders','buyers','aov','refund','refundRate','items','cartAdd',
                   'entryRate','ctr','cvr','naturalRate','paidRate','gpm'];

  // 汇总行选取。
  // 商品行（itemAt + ctr/cvr/gmv）和分时段行也带 gmv/ctr/cvr，
  // 只按「命中的 sumKeys 数量」排序会让商品行赢过真正的汇总行 ——
  // 结果一整个商品被当成整场 GMV，或者根本没有汇总数据时凭空造出一场。
  // 所以先排除带商品名/时段的行，再按命中数取最高的那条。
  const nonRowKeys = ['itemAt','productName','sourceName','timeSlot'];
  const isDetailRow = r => nonRowKeys.some(k=>r[k] !== undefined);
  const sumCand = allRecords.filter(r=>!isDetailRow(r) && r.views !== undefined);
  const pool = sumCand.length ? sumCand : allRecords.filter(r=>!isDetailRow(r));
  const scored = pool.map(r=>({r, c:sumKeys.filter(k=>r[k]!==undefined).length}))
                     .sort((a,b)=>b.c-a.c);
  // 至少 2 个汇总字段才认为是「整场数据」，单个零散字段不足以代表一场
  if(scored.length && scored[0].c>=2) M.session = {...scored[0].r};

  // 分时段
  const tlRecs = allRecords.filter(r=>r.timeSlot!==undefined);
  if(tlRecs.length){
    M.timeline = tlRecs.map(r=>({
      label: formatSlot(r.timeSlot),
      ts: r.timeSlot,
      online: r.onlineAt!==undefined ? r.onlineAt : (r.avgOnline!==undefined ? r.avgOnline : null),
      gmv: r.gmvAt!==undefined ? r.gmvAt : (r.gmv!==undefined ? r.gmv : null),
      item: r.itemAt || null,
    })).filter(t=>t.online!==null || t.gmv!==null);
    // 按时间排序：后台导出的分时段表未必有序。
    // 跨零点（23:50 → 00:00）不能简单按「一天中的分钟数」排 —— 那会把 00:00
    // 排到最前面。判断是否跨天：原始顺序里有没有相邻两条回退了 12 小时以上，
    // 有就说明跨零点，保持原顺序；没有才按分钟排序。
    const mins = M.timeline.map(t=>parseMin(t.label));
    const spansMidnight = mins.some((m,i)=> i>0 && m!=null && mins[i-1]!=null && (mins[i-1]-m) > 720);
    if(!spansMidnight && M.timeline.every((t,i)=>mins[i]!=null)){
      M.timeline.sort((a,b)=>parseMin(a.label) - parseMin(b.label));
    }
  }

  // 商品
  const prodRecs = allRecords.filter(r=>
    r.timeSlot===undefined && r.views===undefined && r.exposure===undefined &&
    (r.productName!==undefined || r.itemAt!==undefined ||
     ((r.ctr!==undefined||r.cvr!==undefined) && r.gmv!==undefined && r.exposure===undefined))
  );
  prodRecs.forEach((r,i)=>{
    M.products.push({
      name: r.productName || r.itemAt || `商品 ${i+1}`,
      ctr: r.ctr!==undefined ? r.ctr : null,
      cvr: r.cvr!==undefined ? r.cvr : null,
      amt: r.gmv!==undefined ? r.gmv : null,
      exposure: r.exposure!==undefined ? r.exposure : null,
    });
  });

  // 流量来源
  const srcRecs = allRecords.filter(r=>r.sourceName!==undefined);
  srcRecs.forEach(r=>{
    M.sources.push({
      name: r.sourceName,
      views: r.sourceViews!==undefined ? r.sourceViews : null,
      rate: r.sourceEntry!==undefined ? r.sourceEntry : null,
    });
  });

  // 缺失标记
  ['views','avgStay','gmv','entryRate','cvr'].forEach(k=>{ M.flags[k] = M.session[k]===undefined; });
  M.flags.hasTimeline = M.timeline.length >= 4;   // 与 analyzeTimeline 的门槛保持一致
  M.flags.hasProducts = M.products.length >= 2;
  M.flags.hasSources = M.sources.length >= 2;

  // 衍生指标（全部加除零保护）
  const s = M.session;
  if(s.uvValue===undefined && s.views && s.gmv!==undefined) s.uvValue = +(s.gmv/s.views).toFixed(2);
  if(s.aov===undefined && s.gmv!==undefined && s.orders) s.aov = +(s.gmv/s.orders).toFixed(1);
  if(s.gpm===undefined && s.views && s.gmv!==undefined) s.gpm = +(s.gmv/s.views*1000).toFixed(1);
  if(s.refundRate===undefined && s.refund!==undefined && s.gmv) s.refundRate = +(s.refund/s.gmv*100).toFixed(2);
  if(s.naturalRate===undefined && s.paidRate!==undefined) s.naturalRate = +(100-s.paidRate).toFixed(1);
  if(s.buyers===undefined && s.orders!==undefined) s.buyers = s.orders;

  return M;
}

/* ---------- 6. 深度分析：交叉洞察 ---------- */

/* 时段效率：每个时段的分钟产出、流量利用效率 */
function analyzeTimeline(M){
  const tl = M.timeline;
  if(tl.length < 4) return null;

  // 推断颗粒度（分钟）
  let gap = 10;
  if(tl.length >= 2){
    const a = parseMin(tl[0].label), b = parseMin(tl[1].label);
    if(a!=null && b!=null && b>a) gap = b - a;
  }
  const totalOnline = tl.reduce((s,p)=>s+(p.online||0), 0) || 1;
  const totalGmv = tl.reduce((s,p)=>s+(p.gmv||0), 0);

  const slots = tl.map((p,i)=>({
    ...p,
    idx: i,
    onlineShare: (p.online||0)/totalOnline*100,
    gmvShare: totalGmv ? (p.gmv||0)/totalGmv*100 : 0,
    // 效率 = 成交占比 / 流量占比，>1 说明这个时段的流量转化效率高于平均
    efficiency: totalGmv && p.online ? ((p.gmv||0)/totalGmv*100) / ((p.online/totalOnline)*100) : 0,
  }));

  // 找效率最好和最差的时段
  const valid = slots.filter(s=>s.online>0 && s.gmv>0);
  const sorted = [...valid].sort((a,b)=>b.efficiency-a.efficiency);
  const best = sorted.slice(0,2);
  const worst = sorted.slice(-2).reverse();

  // 浪费的流量：在线高但成交为 0 或极低的时段
  const avgEff = valid.length ? valid.reduce((s,x)=>s+x.efficiency,0)/valid.length : 1;
  const wasted = valid.filter(s=>s.efficiency < avgEff*0.4)
                      .sort((a,b)=>b.online-a.online).slice(0,3);

  // 按商品聚合：每个品讲了几段、累计停留、累计成交
  const NON_ITEM = /^(开场|暖场|开场暖场|收尾|结束|下播|休息|闲聊|互动|过渡|转场|福利预告|抽奖|答疑|催单|憋单|逼单|过款|返场|上链接|无|—|-|\/)$/;
  const byItem = {};
  slots.forEach(s=>{
    if(!s.item || NON_ITEM.test(String(s.item).trim())) return;
    const k = s.item;
    if(!byItem[k]) byItem[k] = {name:k, segs:0, onlineSum:0, gmvSum:0, slots:[]};
    byItem[k].segs++;
    byItem[k].onlineSum += s.online||0;
    byItem[k].gmvSum += s.gmv||0;
    byItem[k].slots.push(s.label);
  });
  const itemStats = Object.values(byItem).map(x=>({
    ...x,
    onlineShare: x.onlineSum/totalOnline*100,
    gmvShare: totalGmv ? x.gmvSum/totalGmv*100 : 0,
    efficiency: totalGmv && x.onlineSum ? (x.gmvSum/totalGmv*100)/((x.onlineSum/totalOnline)*100) : 0,
    avgPerSeg: x.onlineSum/Math.max(x.segs,1),
  })).sort((a,b)=>b.gmvSum-a.gmvSum);

  return {gap, slots, best, worst, wasted, itemStats, avgEff, totalGmv};
}
function parseMin(label){
  const m = String(label).match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  return parseInt(m[1],10)*60 + parseInt(m[2],10);
}

/* 商品四象限：讲解时长 vs 转化率 */
function analyzeProducts(M, A){
  if(!M.products.length && !(A && A.itemStats.length)) return null;
  let list = M.products.map(p=>({...p}));
  // 分时段里按「讲解商品」统计出的段数/在线/成交，与商品明细按名对齐
  const statByName = {};
  if(A && A.itemStats) A.itemStats.forEach(x=>{ statByName[String(x.name).trim()] = x; });
  function matchStat(name){
    if(!name) return null;
    const k = String(name).trim();
    if(statByName[k]) return statByName[k];
    // 模糊兜底：去空格后互含
    const kk = k.replace(/\s/g,'');
    return A && A.itemStats ? (A.itemStats.find(x=>{
      const n = String(x.name).replace(/\s/g,'');
      return n && (n.includes(kk) || kk.includes(n));
    }) || null) : null;
  }
  // 商品明细存在时，从分时段补齐段数/在线份额/效率；不存在时整体用分时段统计兜底
  if(list.length){
    list.forEach(p=>{
      const st = matchStat(p.name);
      if(st){
        if(p.segs == null) p.segs = st.segs;
        if(p.amt == null) p.amt = st.gmvSum;
        p.fromTimeline = true;
        p.slots = st.slots;
        p.onlineShare = st.onlineShare;
        p.gmvShare = st.gmvShare;
        p.efficiency = st.efficiency;
      }
    });
  } else if(A){
    list = A.itemStats.map(x=>({
      name: x.name, ctr: null, cvr: null, amt: x.gmvSum,
      segs: x.segs, onlineShare: x.onlineShare, gmvShare: x.gmvShare, efficiency: x.efficiency,
      fromTimeline: true, slots: x.slots,
    }));
  }
  const cvrs = list.map(p=>p.cvr).filter(v=>v!=null);
  const avgCvr = cvrs.length ? cvrs.reduce((a,b)=>a+b,0)/cvrs.length : null;
  const segs = list.map(p=>p.segs).filter(v=>v!=null);
  const avgSeg = segs.length ? segs.reduce((a,b)=>a+b,0)/segs.length : null;

  list.forEach(p=>{
    if(p.cvr!=null && avgCvr!=null){
      p.quadrant = (p.cvr>=avgCvr ? 'high' : 'low') + (p.segs!=null && avgSeg!=null && p.segs>=avgSeg ? 'Time' : 'ShortTime');
    } else {
      p.quadrant = 'unknown';
    }
  });
  return {list, avgCvr, avgSeg};
}

/* 流量结构诊断 */
function analyzeSources(M){
  if(!M.sources.length) return null;
  const total = M.sources.reduce((s,x)=>s+(x.views||0),0) || 1;
  const list = M.sources.map(x=>({
    ...x,
    share: (x.views||0)/total*100,
  })).sort((a,b)=>b.share-a.share);
  const paid = list.filter(x=>/付费|千川|广告|投放/.test(x.name)).reduce((s,x)=>s+x.share,0);
  const natural = list.filter(x=>/自然|推荐|feed/i.test(x.name)).reduce((s,x)=>s+x.share,0);
  return {list, paid, natural};
}

/* 退货归因（基于能否拿到退款时间分布） */
function analyzeRefund(M){
  const s = M.session;
  if(s.refundRate==null) return null;
  const B = benchOf(M.meta.category);
  const base = s.refundRate;
  return {
    rate: s.refundRate,
    bench: B.refundRate,
    gap: +(s.refundRate - B.refundRate).toFixed(1),
    lostGmv: s.gmv ? Math.round(s.gmv * s.refundRate/100) : null,
    realGmv: s.gmv ? Math.round(s.gmv * (1-s.refundRate/100)) : null,
  };
}

/* ---------- 7. 规则引擎 ---------- */
function runDiagnosis(M){
  const B = benchOf(M.meta.category);
  const base = k => (M.meta.ownBaseline && M.meta.ownBaseline[k]!=null) ? M.meta.ownBaseline[k] : B[k];
  const issues = [];
  const s = M.session;
  const A = analyzeTimeline(M);
  const PQ = analyzeProducts(M, A);
  const SRC = analyzeSources(M);
  const RF = analyzeRefund(M);
  const push = o => issues.push(o);

  /* 没有任何可判断的指标时直接返回「无结论」，不给分。
     以前空 session 扣不了分、一路返回 96 —— 用户粘一堆没表格的文本进来，
     场次库显示「健康分 96」，看着一切良好，实际一个指标都没读到。
     注意：分时段表 / 商品表 / 流量来源表也是数据，不能只看 session ——
     只上传一张分时段表时，拐点与时段效率规则必须照常工作。 */
  const METRIC_KEYS = ['views','gmv','avgStay','entryRate','cvr','refundRate','paidRate','uvValue'];
  const hasSummary = METRIC_KEYS.some(k=>s[k]!=null && isFinite(s[k]));
  const hasDetail = M.timeline.length > 0 || M.products.length > 0 || M.sources.length > 0;
  if(!hasSummary && !hasDetail){
    return {
      issues, score:null, penalty:0, benchmark: base, benchName: M.meta.category||'通用',
      analyses:{A, PQ, SRC, RF}, empty:true,
    };
  }
  // 只有明细、没有汇总时也要给分，否则场次库那条记录永远没有健康分
  const hasAnyMetric = true;

  /* 规则 1：停留时长 */
  if(s.avgStay != null){
    const bs = base('stay');
    const gap = bs ? (s.avgStay-bs)/bs*100 : 0;
    if(bs && gap < -10){
      push({
        sev: gap<-30?'high':'mid',
        category:'人',
        title:`平均停留 ${s.avgStay} 秒，低于基准 ${Math.abs(gap).toFixed(0)}%`,
        short:'停留不足，流量承接失效',
        meta:'人 · 内容承接',
        evidence:[
          ['本场平均停留', s.avgStay+' 秒'],
          ['类目基准', bs+' 秒'],
          ['差距', gap.toFixed(1)+'%'],
          ['进入率', s.entryRate!=null?s.entryRate+'%':'未提供'],
        ],
        why: s.entryRate!=null && s.entryRate >= base('entryRate')
          ? `进入率 ${s.entryRate}% 达标（基准 ${base('entryRate')}%），说明封面与曝光环节没问题——人愿意点进来。断点发生在进入之后的 30 秒内：用户进来了但没有留下来的理由。`
          : `进入率与停留同时偏低，说明前 3 秒的封面吸引力和进入后的内容承接都存在问题，需要一起修。`,
        plan: buildStayPlan(M, A),
        act:['开场前 10 分钟固定为「福利款 + 价格锚点」结构，不放入常规款',
             '把利益点前置到开播 30 秒内，明确说清「今天什么最便宜」',
             '助播专职盯弹幕，价格类提问 10 秒内响应',
             '每 15 分钟设一个互动钩子（抽奖/问答），打断留人流失'],
      });
    }
  }

  /* 规则 2：退款率 + 归因
     阈值口径必须与 decide 的 detectHard 对齐（都以品类基准为锚），
     否则同一份数据在「单场诊断」是 P1、在「结论与决策」是硬伤，两页打架。 */
  if(RF && RF.bench && RF.rate > RF.bench*1.4){
    const hardRefund = RF.rate >= Math.max(15, RF.bench*2.2);
    push({
      sev: hardRefund ? 'high' : 'mid',
      category:'货',
      title:`退款率 ${RF.rate}%，高于基准 ${RF.gap}pp，侵蚀 GMV ¥${RF.lostGmv?.toLocaleString()||'—'}`,
      short:'退款侵蚀成交',
      meta:'货 · 履约与品质',
      evidence:[
        ['本场退款率', RF.rate+'%'],
        ['类目基准', RF.bench+'%'],
        ['超出', RF.gap+'pp'],
        ['被吃掉的 GMV', '¥'+(RF.lostGmv||0).toLocaleString()],
        ['真实落袋 GMV', '¥'+(RF.realGmv||0).toLocaleString()],
      ],
      why:`退款率显著偏离基准。判断方向的关键是退款发生的时间：直播当场退款多为话术过度承诺（如「绝对不贵」「闭眼入」），下播后 24-72 小时退款多为发货时效、实物与描述不一致或售后体验问题。建议先拉退款时间分布再定责，不要直接归因给主播。`,
      plan:{
        title:'退款归因三步法',
        steps:[
          {label:'第 1 步 · 拉数据', detail:'导出近 7 天全部退款记录，按「退款原因」和「退款时间」两个维度分类。'},
          {label:'第 2 步 · 分责任', detail:'直播中退款 >40% → 话术问题，改主播；下播后退款 >60% → 履约问题，改供应链与详情页；两阶段都有且原因集中 → 该品本身有问题。'},
          {label:'第 3 步 · 定动作', detail:'话术问题：禁用绝对化表述，带货说清「实物与图片的差异点」。履约问题：核对发货时效承诺、抽检实物一致性。商品问题：考虑下架或换供应商。'},
        ],
        template:'客服退场话术：「亲，方便说下具体是哪方面不合适吗？我们记录一下，后续会改进」——用开放式提问把原因收集完整。',
      },
      act:['导出退款原因标签，按「描述不符/发货慢/质量」三类归因',
           '抽查退款占比最高单品的实物与详情页一致性',
           '客服侧强制标注退款原因，为下一轮归因留数据'],
    });
  }

  /* 规则 3：漏斗断点 */
  if(s.entryRate != null && s.cvr != null){
    const eGap = base('entryRate') ? (s.entryRate-base('entryRate'))/base('entryRate')*100 : 0;
    const cGap = base('cvr') ? (s.cvr-base('cvr'))/base('cvr')*100 : 0;
    const worst = Math.min(eGap, cGap);
    if(worst < -18){
      const isEntry = worst === eGap;
      push({
        sev: worst<-40?'high':'mid',
        category: isEntry?'场':'货',
        title: isEntry
          ? `曝光进入率 ${s.entryRate}%，偏低 ${Math.abs(eGap).toFixed(0)}%`
          : `点击成交率 ${s.cvr}%，偏低 ${Math.abs(cGap).toFixed(0)}%`,
        short: isEntry?'封面吸引力不足':'成交承接不足',
        meta: isEntry?'场 · 封面与开播':'货 · 价格与促单',
        evidence:[
          ['曝光进入率', s.entryRate+'%（基准 '+base('entryRate')+'%）'],
          ['点击成交率', s.cvr+'%（基准 '+base('cvr')+'%）'],
          ['断点环节', isEntry?'曝光 → 进入':'点击 → 支付'],
          ['受影响人数', s.views!=null?Math.round(s.views*(Math.abs(worst)/100))+' 人':'—'],
        ],
        why: isEntry
          ? '曝光量足够但点击进入比例低，问题在「第一眼」：封面图、直播间标题、开播画面的信息密度。用户划过时只有约 1 秒决策时间。'
          : '人进来了、商品也点了，但没付款。问题在「最后一步」：价格锚点不清、促单节奏慢、库存紧迫感不足、或小黄车价格与口播不一致。',
        plan: isEntry ? {
          title:'封面优化具体做法',
          steps:[
            {label:'封面三要素', detail:'必须包含：①价格数字（大字）②使用场景（真人/实拍）③一个悬念词（「居然」「才知道」）。三者缺一不可。'},
            {label:'A/B 测试', detail:'同一场次准备 2-3 张封面，每 30 分钟轮换，对比进入率。留存最优的那张固化为模板。'},
            {label:'标题要点', detail:'标题前 8 个字最关键，把价格或品类放最前，不要写「欢迎来到我的直播间」这类无信息量内容。'},
          ],
          template:'封面文案示例：「同款 ¥399 → 今天 ¥99」（价格对比）、「这个面料我摸了 100 遍」（体验悬念）',
        } : {
          title:'促单节奏改造',
          steps:[
            {label:'价格锚点前置', detail:'讲品先说原价再报直播价，制造落差。「专柜 ¥599，今天直播间 ¥199」，不要让用户自己算。'},
            {label:'缩短逼单周期', detail:'单品的逼单不超过 3 分钟。超过 3 分钟没成交就过品，把机会留给下一款，避免拖死流量。'},
            {label:'一致性检查', detail:'开播前逐品核对小黄车价格与口播价格，不一致是转化杀手。'},
          ],
          template:'逼单话术：「这个价格只有今天的 100 单，拍完就恢复原价。想要的扣个 1，我看下还有多少库存」——用具体数字 + 互动指令缩短决策时间。',
        },
        act: isEntry
          ? ['下场准备 3 张不同风格的封面做 A/B 测试','标题把价格或品类前置到前 8 个字']
          : ['开播前逐品核对小黄车价格与口播价格一致','把单品逼单时长控制在 3 分钟内，未成交即过品'],
      });
    }
  }

  /* 规则 4：付费依赖 */
  if(s.paidRate != null && s.paidRate > 50){
    push({
      sev: s.paidRate>70?'high':'low',
      category:'流量',
      title:`付费流量占比 ${s.paidRate}%，自然流量依赖度不足`,
      short:'流量结构风险',
      meta:'流量 · 投放结构',
      evidence:[
        ['付费流量占比', s.paidRate+'%'],
        ['健康区间', '30%–50%'],
        ['自然流量占比', s.naturalRate!=null?s.naturalRate+'%':'未提供'],
        ['付费 ROI', M.session.roi!=null?M.session.roi:'未提供'],
      ],
      why:'付费占比过高意味着增长依赖投放成本。一旦 ROI 下滑或预算收紧，GMV 会立刻承压。更危险的是：付费流量进入后如果承接不住（停留低、转化差），平台会降低自然流量推荐权重，形成恶性循环。',
      plan:{
        title:'流量结构调整路径',
        steps:[
          {label:'先修承接再放量', detail:'停留时长和转化率没修好之前，不要增加投放。否则就是花更多钱买同样留不住的流量。'},
          {label:'付费前置', detail:'千川计划前置到开场 30 分钟内启动，用付费流量把开场的互动和停留数据做起来，撬动自然流量进入推荐池。'},
          {label:'监控付费质量', detail:'盯「付费流量进入后 30 秒留存率」，低于 45% 说明人群包不精准，需要重新定向。'},
        ],
        template:'千川定向建议：优先投「近 7 天直播间互动未成交」人群，这类人已有认知，转化成本低于纯新客。',
      },
      act:['暂停增量投放，先修停留与转化','千川计划前置到开场 30 分钟内',
           '监控付费进入后 30 秒留存率，低于 45% 则重定向'],
    });
  }

  /* 规则 5：UV 价值 */
  if(s.uvValue != null){
    const bu = base('uvValue');
    if(bu && s.uvValue < bu*0.75){
      push({
        sev:'mid',
        category:'流量',
        title:`UV 价值 ¥${s.uvValue}，低于基准 ${((bu-s.uvValue)/bu*100).toFixed(0)}%`,
        short:'单流量变现效率低',
        meta:'流量 · 变现效率',
        evidence:[
          ['本场 UV 价值', '¥'+s.uvValue],
          ['类目基准', '¥'+bu],
          ['GMV', '¥'+(s.gmv||0).toLocaleString()],
          ['客单价', s.aov!=null?'¥'+s.aov:'未提供'],
          ['GPM', s.gpm!=null?'¥'+s.gpm:'未提供'],
        ],
        why:'UV 价值 = 每个进入直播间的人平均贡献多少 GMV，是最能反映「流量质量 × 承接能力」的综合指标。偏低有三种可能：客单价不够（货盘问题）、转化效率不够（话术问题）、流量不精准（投放问题）。结合客单价判断能快速定位。',
        plan: buildUvPlan(M, PQ),
        act:['对比商品效率，砍掉讲解时长高但转化低的品','检查货盘客单价分布，是否有凑单/连带销售设计',
             '核对投放人群包与货盘定位是否匹配'],
      });
    }
  }

  /* 规则 6：商品四象限 */
  if(PQ && PQ.list.length >= 3){
    const waste = PQ.list.filter(p=>p.quadrant==='lowTime');
    if(waste.length){
      const names = waste.map(p=>p.name).join('、');
      push({
        sev:'mid',
        category:'货',
        title:`${waste.length} 个商品「讲得久卖不动」，占用时长挤占其他品机会`,
        short:'排品资源错配',
        meta:'货 · 排品结构',
        evidence: waste.slice(0,4).map(p=>[
          p.name,
          `${p.segs!=null?p.segs+' 段讲解 · ':''}转化 ${p.cvr!=null?p.cvr+'%':'—'}${p.gmvShare!=null?' · 贡献 '+p.gmvShare.toFixed(1)+'%':''}`
        ]),
        why:`这些商品讲解时长高于平均，但转化率低于平均（平均转化 ${PQ.avgCvr!=null?PQ.avgCvr.toFixed(1)+'%':'—'}）。直播间时长是零和资源——讲它们的时间本可以用来讲高效品。注意区分：若商品本身转化高于均值但仍被划入，说明判断阈值偏严，需要人工复核。`,
        plan: buildItemPlan(M, PQ),
        act:[`压缩「${waste[0].name}」的讲解段数至平均以下`,
             '把释放的时段让给效率最高的商品',
             '观望 2 场仍无改善则该品从常备货盘移除'],
      });
    }
    const stars = PQ.list.filter(p=>p.quadrant==='highShortTime');
    if(stars.length){
      push({
        sev:'low',
        category:'货',
        title:`${stars.length} 个商品「讲得少卖得好」，建议增加曝光`,
        short:'潜力品待放量',
        meta:'货 · 增长机会',
        evidence: stars.slice(0,4).map(p=>[
          p.name,
          `${p.segs!=null?p.segs+' 段 · ':''}转化 ${p.cvr!=null?p.cvr+'%':'—'}${p.gmvShare!=null?' · 贡献 '+p.gmvShare.toFixed(1)+'%':''}`
        ]),
        why:'这些商品在较少的讲解时长内达到了高于平均的转化率，说明品本身与直播间人群匹配度高。增加讲解时长和曝光位置，有望直接带来增量。',
        plan: buildItemPlan(M, PQ),
        act:[`将「${stars[0].name}」前置到流量高位时段讲解`,'增加讲解次数，观察是否维持高转化'],
      });
    }
  }

  /* 规则 7：在线人数骤降（显式拐点） */
  if(M.flags.hasTimeline){
    const tl = M.timeline;
    const drops = [];
    for(let i=1;i<tl.length;i++){
      const prev = tl[i-1].online, cur = tl[i].online;
      if(prev && cur && cur < prev*0.75){
        drops.push({idx:i, prev, cur, pct:(cur-prev)/prev*100, item:tl[i].item, label:tl[i].label});
      }
    }
    drops.sort((a,b)=>a.pct-b.pct).slice(0,2).forEach(d=>{
      const itemHint = d.item ? '当时正在讲解「' + d.item + '」，' : '';
      const gapMin = A ? A.gap : 10;
      push({
        sev:'mid',
        category:'场',
        title:`${d.label} 在线人数骤降 ${Math.abs(d.pct).toFixed(0)}%${d.item?'（切换至「'+d.item+'」）':''}`,
        short:'在线骤降',
        meta:'场 · 节奏异常',
        evidence:[
          ['时刻', d.label],
          ['在线人数', `${d.prev} → ${d.cur}`],
          ['降幅', d.pct.toFixed(1)+'%'],
          ['流失人数', String(d.prev-d.cur)],
          ['该时段商品', d.item||'未提供'],
        ],
        why:`该时刻在线人数在 ${gapMin} 分钟内骤降 ${Math.abs(d.pct).toFixed(0)}%。${itemHint}常见原因：某商品讲太久迟迟不给价格、憋单失败引发不满离开、场景或声音出现异常、或前一个高价品失败导致信任流失。`,
        plan:{
          title:'骤降排查清单',
          steps:[
            {label:'① 回看录播', detail:`回看 ${d.label} 前后 5 分钟的录播，记录主播当时在说什么、做什么动作。`},
            {label:'② 对照弹幕', detail:'调取该时段弹幕记录。若集中出现「多少钱」「走了」「贵」等词，说明是价格或节奏问题。'},
            {label:'③ 检查技术', detail:'确认该时段是否有掉线、卡顿、声音异常。技术问题造成的流失最容易被误判为主播问题。'},
            {label:'④ 定责定动作', detail:'价格/节奏问题 → 调整该品讲解时长与给价时机；技术问题 → 检查设备与网络；商品问题 → 考虑替换该品。'},
          ],
          template:'防骤降规则：单品的「只讲不给价」时间不超过 90 秒；超过就立刻给价格，先稳住在线再说。',
        },
        act:['回看该时段录播，确认是话术、价格还是场景问题',
             '调取该时段弹幕，检查是否有集中负面反馈',
             '若为商品问题，下场调整该品讲解位置与时长'],
      });
    });
  }

  /* 规则 8：时段效率 */
  if(A && A.wasted.length){
    const w = A.wasted[0];
    push({
      sev:'mid',
      category:'场',
      title:`${w.label} 时段流量效率偏低，在线 ${w.online} 人但成交占比仅 ${w.gmvShare.toFixed(1)}%`,
      short:'时段效率洼地',
      meta:'场 · 节奏把控',
      evidence: A.wasted.map(x=>[
        x.label + (x.item?`（${x.item}）`:''),
        `在线 ${x.online} · 成交 ¥${x.gmv} · 效率 ${x.efficiency.toFixed(2)}`
      ]),
      why:`效率系数 = 成交占比 ÷ 流量占比。低于 0.4 说明该时段「人多但不出单」——流量在自己的直播间里被浪费了。常见原因是讲了低效品、长时间憋单不出价、或主播状态下滑。`,
      plan: buildSlotPlan(M, A),
      act:['把高效品安排到流量高位时段','避免在在线人数高时讲长篇幅低效品',
           '在线人数高时优先做促单，不要讲产品故事'],
    });
  }
  /* 时段效率好的，也给正面提示 */
  if(A && A.best.length && A.best[0].efficiency > 1.5){
    push({
      sev:'low',
      category:'场',
      title:`${A.best[0].label} 时段效率最高（系数 ${A.best[0].efficiency.toFixed(2)}），可复用该打法`,
      short:'高效时段可复制',
      meta:'场 · 经验沉淀',
      evidence: A.best.map(x=>[
        x.label + (x.item?`（${x.item}）`:''),
        `在线 ${x.online} · 成交 ¥${x.gmv} · 效率 ${x.efficiency.toFixed(2)}`
      ]),
      why:'该时段单位流量的产出效率显著高于全场平均。若能识别出当时的打法（讲了什么品、用了什么话术、配合了什么动作），把它固化成标准动作，能整体拉高 UV 价值。',
      plan:{
        title:'高效时段复制方法',
        steps:[
          {label:'回看定位', detail:`回看 ${A.best[0].label} 前后的录播片段，记录当时的完整动作序列。`},
          {label:'提炼要素', detail:'拆出三件事：讲的品、用的价格策略、做的互动动作。'},
          {label:'标准化', detail:'把这三件事写成可复用的「时段脚本」，在下一场同一时间点复现，验证是否稳定。'},
        ],
        template:'复盘问自己三个问题：当时为什么人多？为什么出单快？这套动作用在别的时段还灵不灵？',
      },
      act:[`回看 ${A.best[0].label} 录播，提炼该时段的话术与动作`,
           '把高效打法写成时段脚本，下场原样复现验证'],
    });
  }

  /* 规则 8：流量来源结构 */
  if(SRC && SRC.list.length >= 3){
    const low = SRC.list.filter(x=>x.rate!=null && x.rate < base('entryRate')*0.7);
    if(low.length){
      push({
        sev:'low',
        category:'流量',
        title:`${low.length} 个流量渠道进入率低于大盘，存在低质流量`,
        short:'渠道质量差异大',
        meta:'流量 · 渠道优化',
        evidence: SRC.list.slice(0,5).map(x=>[
          x.name,
          `${x.share.toFixed(1)}% 占比${x.rate!=null?' · 进入率 '+x.rate+'%':''}`
        ]),
        why:'不同渠道的人群意图差异很大。搜索进来的用户目的明确，转化通常最好；泛推荐流量大但精准度差。若某渠道占比高但进入率低，说明拉来的人对直播间主题不感兴趣，属于无效曝光。',
        plan:{
          title:'渠道优化策略',
          steps:[
            {label:'识别低效渠道', detail:'对比各渠道进入率，低于大盘 70% 的渠道标记为低效。'},
            {label:'收缩低效投放', detail:'若低效渠道来自付费，先缩减预算，把资源移到高效渠道。'},
            {label:'强化高效渠道', detail:'若搜索渠道效率高，优化直播间标题和商品关键词，获取更多搜索流量。'},
          ],
          template:'优化直播间标题时，把品类词和核心卖点写进去——搜索流量靠的是关键词匹配，不是创意文案。',
        },
        act:['对比各渠道进入率，找出低效渠道','缩减低效渠道的投放预算，资源向高效渠道倾斜'],
      });
    }
  }

  /* 规则 9：互动与转化关系 */
  if(s.comments != null && s.views){
    const interactionRate = s.comments/s.views*100;
    if(interactionRate < 3){
      push({
        sev:'low',
        category:'人',
        title:`互动率 ${interactionRate.toFixed(2)}%，偏低（健康值 >5%）`,
        short:'互动不足影响推流',
        meta:'人 · 互动运营',
        evidence:[
          ['评论数', s.comments.toLocaleString()],
          ['观看人数', s.views.toLocaleString()],
          ['互动率', interactionRate.toFixed(2)+'%'],
          ['健康区间', '>5%'],
        ],
        why:'互动率直接影响平台的推流判断。评论、点赞、分享、停留时长共同构成推荐算法的权重。互动率低会削弱自然推流，形成「人越来越少」的下滑螺旋。',
        plan:{
          title:'互动率提升动作',
          steps:[
            {label:'设置互动指令', detail:'每讲一个品，明确给一个互动动作：「想要的扣 1」「打『要』字我看看有多少人」。'},
            {label:'降低互动门槛', detail:'不要问需要思考的问题。用「扣 1」「打 88」这类零成本动作。'},
            {label:'即时回应', detail:'助播必须回应弹幕，被回应的用户互动意愿会提升数倍。'},
          ],
          template:'互动话术模板：「现在在线的姐妹扣个 1，我看看有多少人想要这款，超过 50 个人我直接上链接」——把互动和转化挂钩。',
        },
        act:['每个商品讲解时设置一个明确的互动指令','助播实时回应弹幕，优先回应价格和尺码类提问'],
      });
    }
  }

  const rank = {high:0, mid:1, low:2};
  issues.sort((a,b)=>rank[a.sev]-rank[b.sev]);

  let score = 100;
  issues.forEach(i=>{
    if(i.sev==='high') score -= 14;
    else if(i.sev==='mid') score -= 7;
    else if(i.sev==='low') score -= 3;
  });

  // ---- 指标偏离惩罚 ----
  // 规则是离散的（命中/不命中），指标是连续的。
  // 只靠规则会让分数虚高：一份只含汇总、没有分时段和商品明细的数据几乎不触发规则，
  // 结果停留掉了 20%、退款率涨了 30%，健康分还是 93 —— 这会直接污染下游的决策判断。
  // 所以这里对关键指标相对行业基准的偏离再扣一次分，让分数对真实表现敏感。
  const sM = M.session || {};
  const natRate = base('naturalRate');                 // base 是取值函数，不是对象
  const paidBench = natRate != null ? (100 - natRate) : null;
  const devs = [
    {v:sM.entryRate,  b:base('entryRate'),  inv:false, w:0.5},
    {v:sM.avgStay,    b:base('stay'),       inv:false, w:0.8},
    {v:sM.cvr,        b:base('cvr'),        inv:false, w:0.8},
    {v:sM.refundRate, b:base('refundRate'), inv:true,  w:0.6},
    {v:sM.paidRate,   b:paidBench,          inv:true,  w:0.4},
  ];
  let penalty = 0;
  devs.forEach(d=>{
    if(d.v==null || d.b==null || !d.b) return;
    let gap = (d.v - d.b)/d.b*100;
    if(d.inv) gap = -gap;                 // 逆向指标：升高视为变差
    if(gap >= -8) return;                 // 持平或更好的，不扣
    const over = Math.abs(gap) - 8;       // 超出 8% 的部分才算
    penalty += Math.min(d.w * 12, over / 10 * d.w * 8);
  });
  score = Math.round(score - penalty);
  score = Math.max(28, Math.min(96, score));

  return {issues, score, penalty: Math.round(penalty), benchmark: base, benchName: M.meta.category||'通用', analyses:{A, PQ, SRC, RF}};
}

/* ---------- 8. 方案生成器 ---------- */

/* 停留改造：给出开场排期表 */
function buildStayPlan(M, A){
  const s = M.session;
  const items = A ? A.itemStats : [];
  const best = items.length ? items[0].name : '爆款单品';
  const cheap = items.length > 1 ? items[items.length-1].name : '福利款';
  // 用实际开播时段推导排期时间轴，而不是写死 00:00
  const slots = (A && A.slots) ? A.slots : [];
  const gap = (A && A.gap) ? A.gap : 10;
  let labels = [];
  if(slots.length){
    const first = parseMin(slots[0].label);
    if(first != null){
      // 0/2/5/7/10 分钟五个刻度：4 段
      labels = [0, 2, 5, 7, 10].map(o=>{
        const t = first + o;
        return String(Math.floor(t/60)).padStart(2,'0') + ':' + String(t%60).padStart(2,'0');
      });
    }
  }
  // 时间标签兜底：无法推导时用相对分钟
  const tl = labels.length >= 5 ? labels : null;
  const seg = (i)=> tl ? `${tl[i]} – ${tl[i+1]}` : ['开场 0–2 分','开场 2–5 分','开场 5–7 分','开场 7–10 分'][i];
  return {
    title:'开场排期表（按实际开播时段对齐）',
    schedule:[
      {time:seg(0) || `开场 0–${gap} 分`, item:`${cheap}（引流款）`, words:'「先别划走，前 100 单 9 块 9，拍完就恢复原价」', goal:'把人留住，把在线人数做起来'},
      {time:seg(1), item:`${best}（主推款）`, words:'「专柜 ¥599，今天直播间 ¥199，只有今天的量」', goal:'建立价格认知，给出停留理由'},
      {time:seg(2), item:'互动 + 福利预告', words:'「扣 1 的姐妹我都记下了，整点准时上福利」', goal:'用预告制造停留预期'},
      {time:seg(3), item:`${cheap} 第二波`, words:'「刚才没抢到的，我再放 50 单，就 50 单」', goal:'兑现承诺，建立信任'},
    ],
    template:'开场第一句话禁止：「欢迎来到我的直播间，今天给大家带来很多好货」——这是最无效的开场。正确做法：直接报价格或直接上福利。',
  };
}

/* UV 价值提升方案 */
function buildUvPlan(M, PQ){
  const s = M.session;
  const steps = [];
  if(s.aov != null){
    const bAov = benchOf(M.meta.category).aov;
    if(s.aov < bAov){
      steps.push({label:'客单价偏低', detail:`当前 ¥${s.aov}，类目基准 ¥${bAov}。设计连带销售：主推款 + 低价配件组合，或设置满减门槛（如满 199 减 20）引导凑单。`});
    } else {
      steps.push({label:'客单价达标', detail:`当前 ¥${s.aov}，高于类目基准 ¥${bAov}。说明货盘定价没问题，UV 价值低的原因在转化效率，重点改话术和促单节奏。`});
    }
  }
  if(PQ && PQ.list.length){
    const low = PQ.list.filter(p=>p.quadrant==='lowTime');
    if(low.length) steps.push({label:'排品结构问题', detail:`「${low[0].name}」等 ${low.length} 个品讲解效率低，压缩它们的时长能直接提升整体 UV 价值。`});
  }
  steps.push({label:'流量精准度', detail:'核对投放人群包与货盘定位。若卖高端服饰却投了低价人群，转化必然差。'});
  return {title:'UV 价值提升三方向', steps, template:null};
}

/* 排品方案 */
function buildItemPlan(M, PQ){
  const list = PQ.list || [];
  const hi = list.filter(p=>p.quadrant==='highTime' || (p.cvr!=null && PQ.avgCvr!=null && p.cvr>PQ.avgCvr))
                 .sort((a,b)=>(b.cvr||0)-(a.cvr||0));
  const lo = list.filter(p=>p.quadrant==='lowTime');
  const rows = [];
  if(hi.length) rows.push(`【加大】${hi.slice(0,3).map(p=>p.name).join('、')}——转化高于均值，安排到流量高位时段，增加讲解次数`);
  if(lo.length) rows.push(`【压缩】${lo.slice(0,3).map(p=>p.name).join('、')}——转化低于均值，讲解次数压到平均以下，仅在流量峰值时短时上架`);
  return {
    title:'下场排品调整建议',
    steps: rows.length ? rows.map(r=>({label:r.split('】')[0].replace('【',''), detail:r.split('】')[1]})) : [],
    template:'排品顺序原则：引流款开场 → 主推款高位 → 高转化品反复上 → 低效品最多 2 次。不要把低效品放在流量峰值时段。',
  };
}

/* 时段排期方案 */
function buildSlotPlan(M, A){
  if(!A) return null;
  const best = A.best[0], worst = A.worst[0];
  return {
    title:'下场时段排期优化',
    steps:[
      {label:`重点时段：${best?best.label:'—'}`, detail:`本场该时段效率 ${best?best.efficiency.toFixed(2):'—'}，是全场的产出高峰。下场必须把最强的主推款和最优的话术状态安排在这个时段。`},
      {label:`问题时段：${worst?worst.label:'—'}`, detail:`该时段效率仅 ${worst?worst.efficiency.toFixed(2):'—'}，在线 ${worst?worst.online:0} 人却几乎不出单。下场这个时段要么上高转化品，要么做纯互动拉停留，不要讲低效品。`},
      {label:'通用原则', detail:'流量高位时段（在线人数峰值附近）只做促单，不做产品故事和闲聊。产品介绍放在流量平稳时段。'},
    ],
    template:'中控节奏表：每 10 分钟标注「当前在线 / 当前品 / 目标成交」，实时对照，偏离就立刻调整。',
  };
}

/* ---------- 9. 行动清单 ---------- */
function issuesToTodos(issues){
  const todos = [];
  const catMap = {人:'主播', 货:'货盘', 场:'中控', 流量:'投流'};
  issues.forEach(it=>{
    (it.act||[]).forEach(a=>{
      todos.push({
        t: a,
        p: it.sev==='high'?'P0':(it.sev==='mid'?'P1':'P2'),
        cat: it.category||'通用',
        owner: catMap[it.category]||'运营',
        from: it.short || it.title.slice(0,10),
        done: false,
      });
    });
  });
  // 不截断：一场可能命中 4 个问题、合计十几条动作，砍掉会让用户少看到几条却毫不知情
  return todos;
}

/* ---------- 10. 跨场问题库 ----------
   buildHistory() 曾在这里硬编码一份「7 天假历史」（停留不足 c:4、退款 c:2 …），
   它会凭空造出「持续恶化的趋势」。真实跨场追踪已由 store.issueTrends() 承担，
   这里的假实现没有任何调用点，已删除 —— 留着只会被误用。 */

/* ============================================================
   9. 决策引擎
   ------------------------------------------------------------
   回答三个问题（也是运营每天真正要的答案）：
     1) 这一场比出了什么      → gaps
     2) 差距在哪一环          → chain / broken
     3) 我该优化还是继续往下走 → verdict + actions

   纯函数：输入都是 snapshot 形状的扁平对象，不依赖 DOM、不依赖 store，
   所以浏览器和 Node 都能跑、都能测。

   裁决不是拍脑袋，是一条条阈值判出来的（见 pickVerdict 注释）。
   ============================================================ */

/* 相对偏离百分比。基准为 0 或缺失时返回 null（而不是 0）——
   这一点很重要：null 表示「不可比」，0 表示「持平」，混在一起会给出错误结论 */
function pctGap(v, b){
  if(v==null || b==null) return null;
  if(!isFinite(v) || !isFinite(b) || b===0) return null;
  return (v-b)/b*100;
}

/* 把偏离度映射成状态档位。inv=true 表示逆向指标（退款率、付费占比：越低越好） */
function chainState(gap, inv){
  if(gap==null) return {k:'na', label:'无基准', rank:0};
  const g = inv ? -gap : gap;
  if(g >= 8)  return {k:'strong', label:'优势', rank:2};
  if(g > -8)  return {k:'ok',     label:'正常', rank:1};
  if(g > -20) return {k:'weak',   label:'偏弱', rank:-1};
  return {k:'broken', label:'断点', rank:-2};
}

/* 最小二乘斜率 → 换成「每场相对变化 %」，比绝对值更好读 */
function trendSlope(ordered, key){
  const arr = (ordered||[]).map(x=> x ? x[key] : null).filter(v=>v!=null && isFinite(v));
  if(arr.length < 3) return null;
  const n = arr.length;
  const mx = (n-1)/2;
  const my = arr.reduce((a,b)=>a+b,0)/n;
  if(!my) return null;
  let num=0, den=0;
  arr.forEach((y,i)=>{ num += (i-mx)*(y-my); den += (i-mx)*(i-mx); });
  const slope = den ? num/den : 0;
  return { slope, rel:+(slope/my*100).toFixed(2), n, first:arr[0], last:arr[n-1] };
}

/* 停留 → 转化率 的弹性：停留每变动 1%，转化率大约跟着变动多少 %。
   用自己的历史数据回归，比用行业经验值更贴合这个直播间。 */
function stayCvrElasticity(ordered){
  const pts = (ordered||[]).filter(x=> x && x.stay>0 && x.cvr>0);
  if(pts.length < 4) return null;
  const ms = pts.reduce((a,b)=>a+b.stay,0)/pts.length;
  const mc = pts.reduce((a,b)=>a+b.cvr,0)/pts.length;
  let num=0, den=0;
  pts.forEach(x=>{
    const ds=(x.stay-ms)/ms, dc=(x.cvr-mc)/mc;
    num += ds*dc; den += ds*ds;
  });
  if(!den) return null;
  const k = num/den;
  // 系数落在离谱区间说明样本还在噪声里，宁可不给
  if(!isFinite(k) || k<=0 || k>3) return null;
  return {k:+k.toFixed(2), n:pts.length, ms:+ms.toFixed(1), mc:+mc.toFixed(2)};
}

/* 链路拆解：进来 → 留住 → 转化 → 变现。哪一环断了，一眼能看到 */
function buildChain(cur, base){
  const defs = [
    {key:'entry', label:'曝光进入率', unit:'%', d:1, inv:false,
     why:'人进不进得来。偏低一般是封面/标题或投放人群不匹配。'},
    {key:'stay',  label:'平均停留',   unit:'s', d:0, inv:false,
     why:'进来后留不留得住。偏低是开场没抓住人，或讲品节奏拖沓。'},
    {key:'cvr',   label:'成交转化率', unit:'%', d:1, inv:false,
     why:'留下来的人买不买。偏低多是排品顺序、价格锚点或逼单节奏的问题。'},
    {key:'uv',    label:'UV价值',     unit:'',  d:2, pfx:'¥', inv:false,
     why:'每份流量最终产出多少，是前三环共同作用的结果。'},
    {key:'refund',label:'退款率',     unit:'%', d:1, inv:true,
     why:'卖出去的量能不能留住。偏高要查货品描述一致性和发货时效。'},
    {key:'paid',  label:'付费占比',   unit:'%', d:1, inv:true,
     why:'流量结构是否健康。偏高说明自然流量在萎缩，获客成本会走高。'},
  ];
  return defs.map(d=>{
    const v = cur[d.key], b = base ? base[d.key] : null;
    const gap = pctGap(v, b);
    const st = chainState(gap, d.inv);
    return {
      key:d.key, label:d.label, unit:d.unit, d:d.d, pfx:d.pfx||'', inv:d.inv, why:d.why,
      v, b, gap, state:st.k, stateLabel:st.label, rank:st.rank,
    };
  });
}

/* 硬伤检测：这些不是「可以再优化」，是必须先止血的
   注意：健康分下滑不在这里判——它由 pickVerdict 的分支统一处理，
   否则既算硬伤又算下滑，措辞会打架。 */
function detectHard(cur, base, ordered){
  const out = [];
  // 退款率：与单场诊断规则 2 同一口径（品类基准 ×2.2，且不低于 15%）。
  // 单一固定阈值会让不同类目出现「诊断报警 / 决策不认」的矛盾。
  const refundBench = (base && base.refund > 0) ? base.refund : null;
  const refundLine = refundBench != null ? Math.max(15, refundBench*2.2) : 15;
  if(cur.refund!=null && cur.refund >= refundLine){
    const bTxt = refundBench
      ? '，历史均值 '+(+refundBench).toFixed(1)+'%' : '';
    out.push({key:'refund', label:'退款率', value:cur.refund, unit:'%', d:1,
      text:'退款率 '+cur.refund.toFixed(1)+'%'+bTxt+'，已进入伤客又伤利润的区间'});
  }
  // 停留跌破自身历史均值的 75%（约 -25%）视为前端承接破位
  if(cur.stay!=null && base && base.stay>0 && cur.stay < base.stay*0.75){
    out.push({key:'stay', label:'平均停留', value:cur.stay, unit:'s', d:0,
      text:'停留只有 '+cur.stay+'s，只有历史均值（'+(+base.stay).toFixed(0)+'s）的 '
        + Math.round(cur.stay/base.stay*100) + '%，前端承接已明显破位'});
  }
  if(cur.paid!=null && cur.paid>55){
    out.push({key:'paid', label:'付费占比', value:cur.paid, unit:'%', d:1,
      text:'付费占比 '+cur.paid.toFixed(1)+'%，自然流量在萎缩，一停投就断崖'});
  }
  return out;
}

/* 裁决：优先级从高到低，命中即返回。
   核心原则：说「在变好」必须有本场的证据撑腰，不能只靠历史斜率——
   否则会出现「这场其实退步了，但因为前几场在涨，系统还说继续推进」的荒谬结论。 */
function pickVerdict(cur, base, chain, slope, hard, n){
  const baseScore = (base && base.score>0) ? base.score : null;
  // 本场健康分相对自身基准的偏离（%）。没有基准时按 0 处理（不惩罚也不加分）
  const relBase = baseScore ? (cur.score - baseScore)/baseScore*100 : 0;
  // 链路里是否存在断点：有断点就不能说「各项都稳」，哪怕分数还行
  const hasBroken = chain.some(x=>x.state === 'broken');

  // 1) 样本不足 —— 这时候任何结论都是噪声，诚实地说「先别判断」
  // 注意：n 是「截止本场为止累积的场次」，不是仓库总场次。
  // 看历史场次时 n 天然偏小，文案必须说清是「本场之前」，否则用户会以为数据丢了。
  if(n < 3){
    return {k:'hold', label:'先积累样本', level:'blue',
      headline:'先别急着下判断 —— 样本还不够',
      reason: n <= 1
        ? '这是第 1 场，还没有上一场可比，趋势线无从谈起。按天连续录满 3 场，对比和结论才有意义。'
        : '截止这一场一共积累了 '+n+' 场，能拿来对比的只有前面 '+(n-1)+' 场。单场双场的波动太大，看不出方向。按天连续录满 3 场再回来看结论。'};
  }
  // 2) 硬伤优先 —— 有出血点就不要谈增长
  if(hard.length){
    return {k:'fix', label:'立即纠偏', level:'red',
      headline:'先别追增长，先止血 —— 有 '+hard.length+' 处硬伤在持续放血',
      reason: hard.map(x=>x.text).join('；')+'。这些问题的特点是：不解决它会一直拖累后面每一场，修掉的收益比重投流量确定得多。'};
  }
  // 3) 明确下滑 —— 趋势向下时加大投入等于放大亏损
  if(slope && slope.rel <= -3){
    const soft = cur.score>=70;
    return {k: soft?'optimize':'fix', label: soft?'定向优化':'立即纠偏', level: soft?'amber':'red',
      headline:'整体在往下走 —— 先找出掉的那一环补上，再谈放大',
      reason:'健康分以每场约 '+slope.rel+'% 的速度走低（'+slope.first+' → '+slope.last+'），趋势还没拐头。这种情况下加大投放等于把亏损放大。'};
  }
  // 4) 上升通道：趋势向上 + 本场不弱于基准 + 链路无断点
  if(cur.score>=78 && slope && slope.rel >= 2 && relBase >= -2 && !hasBroken){
    return {k:'advance', label:'继续推进', level:'green',
      headline:'可以继续往下走 —— 整体在变好，把有效动作固定成标准再放大',
      reason:'健康分 '+slope.first+' → '+slope.last+'（每场约 +'+slope.rel+'%），本场 '+cur.score+' 分也不低于自身基准。方向向上时最该做的是把跑赢的动作找出来、写进 SOP，而不是换新玩法。'};
  }
  // 5) 健康且平稳（本场不明显弱于基准，且链路没有断点）
  if(cur.score>=75 && relBase >= -5 && !hasBroken){
    const strong = cur.score>=85;
    return {k: strong?'advance':'hold', label: strong?'继续推进':'保持节奏', level: strong?'green':'blue',
      headline: strong ? '可以继续往下走 —— 各项都稳，重点是复制到更多场次'
                       : '保持当前节奏 —— 没有明显短板，不用为了改而改',
      reason:'健康分 '+cur.score+'，链路各环都在正常区间。没有短板的时候频繁调整排品和话术，反而会引入新的波动。'};
  }
  // 6) 有短板但没崩
  const weak = chain.filter(x=>x.rank<0);
  const relTxt = (baseScore && relBase < -5)
    ? '本场健康分 '+cur.score+'，比自身基准低 '+Math.abs(relBase).toFixed(1)+'%。' : '';
  if(!weak.length){
    // 每一环单独看都正常，但综合分明显低于基准 —— 典型的多项小幅回落的累积效应
    return {k:'optimize', label:'定向优化', level:'amber',
      headline:'先别放大 —— 没有哪一环崩了，但合起来比自己的常规水平低'
        + (baseScore ? ' ' + Math.abs(relBase).toFixed(1) + '%' : ''),
      reason: '健康分 '+cur.score+(baseScore?('（基准 '+baseScore+'）'):'')
        + '。链路各环单独看都在正常区间，说明问题不是某一环断裂，而是几项同时小幅回落叠加出来的。'
        + '这种下滑最容易被忽略，建议把最近 3 场的链路指标并排看，找同时变差的那一两项。'};
  }
  return {k:'optimize', label:'定向优化', level:'amber',
    headline:'先补短板再放大 —— 链路里有 '+weak.length+' 环低于自己的历史水平',
    reason: relTxt + weak.map(x=>x.label+'（'+x.stateLabel+'）').join('、')
      + ' 是当前拖累项。把它拉到均值比继续加大流量更划算。'};
}

/* 收益估算：把「某环提升到均值」换算成 GMV 的量级。
   用链路乘法模型 GMV ≈ 观看人数 × 进入率 × 转化率 × 客单价，
   所以单环的相对提升会近似等比传导到 GMV。停留不直接进乘法链，
   它通过转化率起作用，用历史弹性折算。 */
function estimateGain(cur, base, key, el){
  if(!base || !cur.gmv) return null;
  const b = base[key], v = cur[key];
  if(b==null || v==null || !isFinite(b) || !isFinite(v) || v<=0) return null;
  const dRel = (b-v)/v*100;                  // 需要提升多少 %
  if(dRel<=0) return null;                   // 已经达标就不用估算
  let kCvr = 1;
  if(key==='stay'){
    kCvr = el ? el.k : 0.6;                  // 没有实测弹性时用保守经验值
  } else if(key==='entry'){
    kCvr = 1;                                // 进入率直接等比放大 GMV
  } else if(key==='cvr'){
    kCvr = 1;
  } else if(key==='uv'){
    kCvr = 1;
  } else {
    return null;                             // 退款率/付费占比不走这个模型
  }
  const dGmv = dRel * kCvr;
  // 保守一点：按 70% 折算，避免给用户过度承诺
  const cons = dGmv * 0.7;
  const newGmv = cur.gmv * (1 + cons/100);
  return {
    key, needRel:+dRel.toFixed(1), kCvr:+kCvr.toFixed(2),
    gmvPct:+cons.toFixed(1), gmvFrom:Math.round(cur.gmv), gmvTo:Math.round(newGmv),
    elas: el ? el.k : null, elasN: el ? el.n : 0,
  };
}

/* 下一步动作：按硬伤 → 最弱环 → 优势保持 的顺序生成，每条都带目标 */
function buildNextActions(cur, base, chain, hard, el, verdict){
  const acts = [];
  const seen = new Set();
  const bstay = base && base.stay>0 ? (+base.stay).toFixed(0) : null;
  const bref  = base && base.refund>0 ? (+base.refund).toFixed(1) : null;

  // ---- 硬伤：最高优先级 ----
  hard.forEach(h=>{
    if(h.key==='refund' && !seen.has('refund')){ seen.add('refund');
      acts.push({p:'P0', owner:'货盘 / 客服', key:'refund',
        do:'把退款率压回 '+(bref?bref+'%':'10%')+' 以内（当前 '+h.value.toFixed(1)+'%）',
        how:'拉退款原因标签榜，锁定 Top2 原因。若是「描述不符」，把主图、口播里的材质/尺码/赠品说明改到与实物一致；若是「发货慢」，把时效承诺写进口播。',
        target:'退款率 ≤ '+(bref?bref+'%':'10%'),
        why:'退款率每降 1pp，同流量下净成交就多约 1pp，是当期最确定的收益来源。'});
    }
    if(h.key==='stay' && !seen.has('stay')){ seen.add('stay');
      const g = estimateGain(cur, base, 'stay', el);
      acts.push({p:'P0', owner:'主播 / 场控', key:'stay',
        do:'把平均停留从 '+(+h.value).toFixed(0)+'s 拉回 '+(bstay||'50')+'s 以上',
        how:'开场 0-10 分钟换成「福利款 + 直接报价」结构，禁止寒暄式开场；每 10 分钟设一次停留钩子（抽奖、限量、下轮福利预告）；单品讲解不超过 6 分钟就换品。',
        target:'停留 ≥ '+(bstay||'50')+'s'+(g?('，GMV 量级约回到 ¥'+g.gmvTo.toLocaleString()):''),
        why:'停留是转化的前置指标，它不达标时任何逼单话术都救不回来。'});
    }
    if(h.key==='paid' && !seen.has('paid')){ seen.add('paid');
      acts.push({p:'P0', owner:'投放', key:'paid',
        do:'把付费占比从 '+h.value.toFixed(1)+'% 降到 45% 以下',
        how:'先砍掉 ROI 最低的计划，把预算集中在已验证的高 ROI 计划；同时把直播间自然流量入口做起来——短视频预告、粉丝群开播提醒、搜索关键词优化。',
        target:'付费占比 ≤ 45%',
        why:'付费占比过高时，投得越多利润越薄，而且一停投就没有流量，等于把生意的开关交在别人手上。'});
    }
    if(h.key==='trend' && !seen.has('trend')){ seen.add('trend');
      acts.push({p:'P0', owner:'主播 / 货盘', key:'trend',
        do:'立即做一次全场复盘，找出掉分的起点',
        how:'把最近 3 场的分时段数据按时间对齐，找在线人数第一次明显下滑的那个时间点，回看当时在讲什么品、说什么话。连续下滑通常是同一个动作在反复犯错。',
        target:'最近 3 场健康分止跌（不再逐场下降）',
        why:'连续下滑不打断，就会变成新的常态水平，后面再拉回来的成本会成倍增加。'});
    }
  });

  // ---- 最弱的环节（最多两条：再多就变成噪音，运营也执行不过来）----
  const weakPool = chain.filter(x=>!seen.has(x.key) && x.rank<0 && x.state!=='na')
    .sort((a,b)=>a.rank-b.rank)
    .slice(0, 2);

  // 每一环对应一个可执行动作模板。注意逆向指标（退款率、付费占比）也要有——
  // 否则它们成为最弱环时会「诊断出来但没有动作」，用户只看到问题看不到办法。
  const actOf = (w)=>{
    if(w.key==='entry') return {
      owner:'场控 / 投放',
      do:'把曝光进入率从 '+(+w.v).toFixed(1)+'% 提到 '+(+w.b).toFixed(1)+'% 以上',
      how:'换封面首帧（真人 + 价格数字比纯产品图进人率高），标题前 8 个字带明确利益点；投放定向收窄到近 30 天成交人群的相似人群。'};
    if(w.key==='stay') return {
      owner:'主播 / 场控',
      do:'把平均停留从 '+(+w.v).toFixed(0)+'s 提到 '+(+w.b).toFixed(0)+'s',
      how:'按「福利款开场 → 主推款给价格锚点 → 互动预告 → 兑现承诺」重排前 10 分钟；语速压紧，单个卖点不超过 40 秒；每 10 分钟设一个停留钩子。'};
    if(w.key==='cvr') return {
      owner:'主播 / 货盘',
      do:'把成交转化率从 '+(+w.v).toFixed(1)+'% 提到 '+(+w.b).toFixed(1)+'%',
      how:'排品顺序改成「引流款拉停留 → 主推款承接 → 利润款收尾」；每个品讲完必须有一次明确的价格锚点对比（专柜价 vs 直播价）；催单具体到数量和时限。'};
    if(w.key==='uv') return {
      owner:'货盘 / 主播',
      do:'把 UV 价值从 ¥'+(+w.v).toFixed(2)+' 提到 ¥'+(+w.b).toFixed(2),
      how:'优先抬客单价——组合装、满减、加价购往上顶；同时把转化最差的品从主推位换下来，减少无效讲解占用。'};
    if(w.key==='refund') return {
      owner:'货盘 / 客服',
      do:'把退款率从 '+(+w.v).toFixed(1)+'% 压回 '+(+w.b).toFixed(1)+'% 以内',
      how:'拉退款原因标签榜锁定 Top2。若因「描述不符」，把材质/尺码/赠品说明改到与实物一致；若因「发货慢」，把时效承诺写进口播并给确定时间。'};
    if(w.key==='paid') return {
      owner:'投放',
      do:'把付费占比从 '+(+w.v).toFixed(1)+'% 降到 '+(+w.b).toFixed(0)+'% 以下',
      how:'砍掉 ROI 最低的计划，预算集中到已验证的高 ROI 计划；同时把自然流量入口做起来——短视频预告、粉丝群开播提醒、搜索关键词优化。'};
    return null;
  };

  weakPool.forEach((w, idx)=>{
    seen.add(w.key);
    const m = actOf(w);
    if(!m) return;
    const g = estimateGain(cur, base, w.key, el);
    const gainTxt = g ? ('，GMV 量级约回到 ¥'+g.gmvTo.toLocaleString()+'（保守估计）') : '';
    // 这里的 kCvr 是「该指标 1% 相对提升 → GMV 传导比」，不是转化率。
    // 以前写成「约带来 +100% 转化」，把 GMV 弹性说成了转化率，语义是错的。
    let elasTxt = '';
    if(g){
      if(w.key === 'stay'){
        elasTxt = ' 按你历史实测的停留→转化弹性（k=' + g.kCvr.toFixed(2)
          + (g.elasN ? '，' + g.elasN + ' 场样本' : '，经验值')
          + '），停留补到均值后 GMV 量级可回到 ¥' + g.gmvTo.toLocaleString() + '。';
      } else {
        elasTxt = ' 该环节按乘法链路近似等比传导到 GMV，补到均值后 GMV 量级可回到 ¥'
          + g.gmvTo.toLocaleString() + '（已按 70% 保守折算）。';
      }
    }
    const whyTxt = w.why + elasTxt;
    acts.push({
      p: idx===0 ? 'P1' : 'P2',
      owner:m.owner,
      key:w.key,
      do:m.do,
      how:m.how,
      target:'达到自身历史均值 ' + (+w.b).toFixed(w.d) + (w.unit||'') + gainTxt,
      why:whyTxt,
    });
  });

  // ---- 优势保持 ----
  const strongest = chain.filter(x=>!seen.has(x.key) && x.rank===2)[0];
  if(strongest){
    acts.push({p:'P2', owner:'场控 / 场记', key:strongest.key,
      do:strongest.label+'（'+(+strongest.v).toFixed(strongest.d)+(strongest.unit||'')+'）高于自身均值 '+(+strongest.gap).toFixed(1)+'%，把它固化成标准动作',
      how:'回看这一段的录屏，把它拆成可复制的步骤（什么时间点、说什么句、配什么品），写进下场脚本，并要求团队照做。跑赢的部分最容易被无意改掉。',
      target:'下场 ' + strongest.label + ' 不低于本场水平',
      why:'唯一能让人确认「有效」的，是它被重复做出来过。'});
  }

  // 兜底：没有任何明确短板时，也要给一条可执行的事
  if(!acts.length){
    acts.push({p:'P2', owner:'场记', key:'baseline',
      do:'连续再录 3 场，把样本攒到能看出趋势',
      how:'保持现有排品和话术不变，只做记录。样本量不足时，任何「优化」都无法判断是真有效还是噪声。',
      target:'再积累 3 场完整数据',
      why:'对比的价值随样本量上升。目前各环都正常，此时最该做的是稳定采集、而不是频繁调整。'});
  }
  return acts;
}

/* 主入口 */
function decide(cur, cmp, base, ordered, opts){
  const o = opts || {};
  const n = o.n != null ? o.n : ((ordered||[]).length || 1);
  const chain = buildChain(cur, base);
  const slope = trendSlope(ordered, 'score');
  const hard  = detectHard(cur, base, ordered);
  const el    = stayCvrElasticity(ordered);
  const v     = pickVerdict(cur, base, chain, slope, hard, n);
  const gaps  = buildGaps(cur, cmp, base);
  const acts  = buildNextActions(cur, base, chain, hard, el, v);
  const weakest = chain.filter(x=>x.state!=='na' && x.rank<0).sort((a,b)=>a.rank-b.rank)[0] || null;

  return {
    verdict:v,                 // {k,label,level,headline,reason}
    chain,                     // 链路各环
    weakest,                   // 最弱一环（没有则为 null）
    broken: chain.filter(x=>x.state==='broken'),
    gaps,                      // 差距明细（vs 对比场 / vs 历史均值）
    slope,                     // 健康分趋势
    elasticity: el,            // 停留→转化弹性
    hard,                      // 硬伤
    actions: acts,             // 下一步动作
    sample: n,                 // 样本场次数
  };
}

/* 差距明细：同时算「vs 对比场」和「vs 历史均值」两个口径 */
function buildGaps(cur, cmp, base){
  const defs = [
    ['GMV','gmv','¥',0,false], ['UV价值','uv','¥',2,false], ['平均停留','stay','',0,false],
    ['曝光进入率','entry','%',1,false], ['成交转化率','cvr','%',1,false],
    ['退款率','refund','%',1,true], ['付费占比','paid','%',1,true],
  ];
  return defs.map(([label,key,pfx,d,inv])=>{
    const v = cur ? cur[key] : null;
    const cv = cmp ? cmp[key] : null;
    const bv = base ? base[key] : null;
    const gCmp = pctGap(v, cv);
    const gBase = pctGap(v, bv);
    // 逆向指标：数值上升是坏事，取反后用于排序和着色
    const signed = x => x==null ? null : (inv ? -x : x);
    return {
      label, key, pfx, d, inv,
      v, cmp:cv, base:bv,
      gapCmp:gCmp, gapBase:gBase,
      sCmp:signed(gCmp), sBase:signed(gBase),
      // 两个口径中更值得注意的那个
      severity: Math.max(Math.abs(signed(gCmp)||0), Math.abs(signed(gBase)||0)),
    };
  }).filter(x=>x.severity>=1)
    .sort((a,b)=>b.severity-a.severity);
}

/* 导出（Node 测试环境）。
   这样测试用 require() 就能拿到纯函数，不必再 eval 源码 ——
   eval 既慢又让 IDE/静态检查失效，而且一旦有语法错误只能看到
   「Unexpected token」这种没有行号的报错。 */
if(typeof module !== 'undefined' && module.exports){
  module.exports = {
    FIELD_SYNONYMS, BENCHMARKS, HEADER_OVERRIDE,
    benchOf, matchField, normHeader,
    splitLines, detectDelimiter, detectDelimiterFromRows, smartSplit, parseDelimited,
    toNum, isTimeValue, locateHeader, detectVerticalKV, parseVerticalKV, parseTable,
    clampValue, RANGE_RULES, PERCENT_KEYS, looksLikeDataValue, isKVHeaderRow,
    formatSlot, normalize,
    analyzeTimeline, analyzeProducts, analyzeSources, analyzeRefund,
    runDiagnosis, issuesToTodos,
    pctGap, chainState, trendSlope, stayCvrElasticity, buildChain,
    detectHard, pickVerdict, estimateGain, buildNextActions, decide, buildGaps,
    buildStayPlan, buildUvPlan, buildItemPlan, buildSlotPlan,
  };
}
