/* ============================================================
   复盘台 · 场次仓库 v3
   ------------------------------------------------------------
   解决的问题：导入的每场数据必须留存，多场之间要能对比。

   设计原则：
   - 纯逻辑，无 DOM 依赖 → 浏览器和 Node 都能跑、都能测
   - 存储介质可插拔 → 浏览器用 localStorage，Node 用内存对象
   - 每场存「原始文本 + 归一化结果 + 诊断结论 + 快照指标」
     存原始文本是为了能重新解析（引擎升级后旧数据不用重录）

   核心概念：
   - Session（场次）：一次直播 → 一条记录。是网站的一等公民。
   - 快照指标（snapshot）：从 M.session 抽出的扁平指标，供对比/趋势直接读
   ============================================================ */

/* ---------- 常量 ---------- */
const STORE_KEY = 'fupantai.sessions.v3';
const STORE_VER = 3;

/* 从归一化结果里抽取对比用的扁平指标 */
function snapshotOf(M, DIAG){
  const s = M.session || {};
  const D = DIAG || {};
  return {
    gmv:        s.gmv != null ? s.gmv : 0,
    views:      s.views != null ? s.views : 0,
    uv:         s.uvValue != null ? s.uvValue : (s.views ? +(s.gmv||0)/s.views : 0),
    stay:       s.avgStay != null ? s.avgStay : 0,
    entry:      s.entryRate != null ? s.entryRate : 0,
    cvr:        s.cvr != null ? s.cvr : 0,
    refund:     s.refundRate != null ? s.refundRate : 0,
    paid:       s.paidRate != null ? s.paidRate : 0,
    avgOnline:  s.avgOnline != null ? s.avgOnline : 0,
    peakOnline: s.peakOnline != null ? s.peakOnline : 0,
    newFans:    s.newFans != null ? s.newFans : 0,
    score:      D.score != null ? D.score : null,
    issueCount: D.issues ? D.issues.length : 0,
  };
}

/* 生成稳定指纹：用于识别「这场是不是已经存过了」 */
function fingerprint(M){
  const s = M.session || {};
  const raw = [
    M.meta && M.meta.category,
    s.gmv, s.views, s.avgStay, s.entryRate, s.cvr, s.refundRate,
    (M.timeline||[]).length,
    (M.products||[]).length,
  ].join('|');
  let h = 5381;
  for(let i=0;i<raw.length;i++) h = ((h<<5)+h+raw.charCodeAt(i))>>>0;
  return 'fp_' + h.toString(36);
}

/* ---------- 场次记录构造 ---------- */
function makeSession(input){
  // input: {M, DIAG, raw, category, hostName, date, note}
  const M = input.M;
  const DIAG = input.DIAG;
  return {
    id: 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7),
    ts: Date.now(),
    date: input.date || todayStr(),
    hostName: input.hostName || '未命名主播',
    category: (M.meta && M.meta.category) || input.category || '通用',
    note: input.note || '',
    duration: (M.timeline && M.timeline.length) ? M.timeline.length : 0,
    fp: fingerprint(M),
    snapshot: snapshotOf(M, DIAG),
    // 单调递增序号：解决同一毫秒内连续导入时 ts 相同、排序退化的问 题
    seq: input.seq != null ? input.seq : 0,
    // 存原文，引擎升级后可重解析
    raw: input.raw || '',
    // 存诊断的问题清单（瘦身，只留对比需要的字段）
    issues: (DIAG.issues||[]).map(it=>({
      key: it.short || it.title || '',
      title: it.title || '',
      sev: it.sev || 'mid',
      category: it.category || '',
    })),
    // 存归一化结果的精简版（时段 + 商品 + 来源），供重绘图表
    timeline: (M.timeline||[]).map(t=>({label:t.label, online:t.online, gmv:t.gmv, item:t.item})),
    products: (M.products||[]).map(p=>({name:p.name, ctr:p.ctr, cvr:p.cvr, amt:p.amt})),
    sources:  (M.sources||[]).map(x=>({name:x.name, views:x.views, entry:x.entryRate})),
    unknownFields: M.unknownFields || [],
    flags: M.flags || {},
  };
}

function todayStr(){
  const d = new Date();
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

/* ---------- 仓库：对接可插拔后端 ---------- */
/*
  后端接口约定（duck typing）：
    backend.load()      -> string | null   读出序列化内容
    backend.save(str)   -> boolean         写入，并「回读校验」确认真的落盘
    backend.clear()     -> void            清空
    backend.available() -> boolean         探测后端当前是否可用
    backend.kind()      -> string          后端类型标识（展示给用户看）
    backend.lastError() -> string | null   最近一次失败原因

  为什么要「回读校验」：
  浏览器的 localStorage 在几种情况下会静默失败——隐私模式、站点数据被禁、
  存储配额写满。过去的实现是 try/catch 一把梭，失败只返回 false，
  调用方不看返回值就把失败吞掉了，用户看到界面一切正常、第二天数据却没了。
  所以这里写入后必须读回来比对，并把失败原因留住，让界面能明确报错。
*/
function createMemoryBackend(){
  let mem = null;
  return {
    load: ()=>mem,
    save: (v)=>{ mem = v; return true; },
    clear: ()=>{ mem = null; },
    available: ()=>true,
    kind: ()=>'memory',
    lastError: ()=>null,
  };
}
function createLocalBackend(key){
  const k = key || STORE_KEY;
  let lastErr = null;

  // 探测：能不能真的读写。用于区分「不支持」和「暂时满」
  function probe(){
    try{
      const p = k + '.probe';
      localStorage.setItem(p, '1');
      const ok = localStorage.getItem(p) === '1';
      localStorage.removeItem(p);
      return ok;
    }catch(e){ lastErr = (e && e.name) + ': ' + (e && e.message); return false; }
  }

  return {
    load(){
      try{ return localStorage.getItem(k); }
      catch(e){ lastErr = (e&&e.name)+': '+(e&&e.message); return null; }
    },
    save(v){
      try{
        localStorage.setItem(k, v);
        // 回读校验：写进去不等于存住了
        const back = localStorage.getItem(k);
        if(back === null){
          lastErr = '写入后读回为空，浏览器拒绝了本次存储';
          return false;
        }
        if(back !== v){
          lastErr = '写入内容与读回内容不一致（可能被截断或配额不足）';
          return false;
        }
        lastErr = null;
        return true;
      }catch(e){
        const quota = /quota|exceed|full/i.test((e&&e.name||'') + (e&&e.message||''));
        lastErr = quota
          ? '本机存储空间已满，请导出备份后清理旧场次'
          : ((e&&e.name||'存储错误') + ': ' + (e&&e.message||''));
        return false;
      }
    },
    clear(){ try{ localStorage.removeItem(k); }catch(e){} },
    available(){ return probe(); },
    kind(){ return 'localStorage'; },
    lastError(){ return lastErr; },
  };
}

function createStore(backend){
  const be = backend || createMemoryBackend();
  let sessions = [];
  let loaded = false;
  // 最近一次持久化结果，供界面显示「已存本机 / 保存失败」
  let lastSave = { ok:null, at:null, error:null };

  function ensure(){
    if(loaded) return;
    loaded = true;
    try{
      const raw = be.load();
      if(raw){
        const data = JSON.parse(raw);
        if(data && Array.isArray(data.sessions)) sessions = data.sessions;
        // 版本迁移预留位
      }
    }catch(e){ sessions = []; }
  }
  function serialize(){
    return JSON.stringify({ver:STORE_VER, updated:Date.now(), sessions});
  }
  function persist(){
    let ok = false, err = null;
    try{
      ok = be.save(serialize()) === true;
      if(!ok) err = (be.lastError && be.lastError()) || '后端未能确认写入';
    }catch(e){ ok = false; err = e.message; }
    lastSave = { ok, at:Date.now(), error: err };
    return ok;
  }

  return {
    /* 读取全部场次（最新在前） */
    /* 排序键：seq 优先（单调递增、同毫秒也稳定），无 seq 的老数据回退到 ts */
    all(){
      ensure();
      return sessions.slice().sort((a,b)=>
        (b.seq||0)-(a.seq||0) || b.ts-a.ts);
    },
    /* 从旧到新（用于趋势图） */
    ordered(){
      ensure();
      return sessions.slice().sort((a,b)=>
        (a.seq||0)-(b.seq||0) || a.ts-b.ts);
    },
    count(){ ensure(); return sessions.length; },
    get(id){ ensure(); return sessions.find(s=>s.id===id) || null; },

    /* 新增。返回 {record, dup, saved}
       saved=false 表示「记录在内存里，但没写进本机存储」——界面必须提示用户导出备份 */
    add(input){
      ensure();
      // 分配单调递增 seq：永远大于现有最大值
      const maxSeq = sessions.reduce((m,s)=>Math.max(m, s.seq||0), 0);
      const rec = makeSession(Object.assign({}, input, {seq: maxSeq+1}));
      // 指纹去重：同一天 + 同指纹 → 视为重复导入
      const dup = sessions.find(s=>s.fp===rec.fp && s.date===rec.date);
      if(dup) return {record:dup, dup:true, saved: lastSave.ok !== false};
      sessions.push(rec);
      const saved = persist();
      return {record:rec, dup:false, saved};
    },
    /* 更新某场（改日期/主播/备注） */
    update(id, patch){
      ensure();
      const s = sessions.find(x=>x.id===id);
      if(!s) return false;
      ['date','hostName','note','category'].forEach(k=>{
        if(patch[k] != null) s[k] = patch[k];
      });
      persist();
      return true;
    },
    remove(id){
      ensure();
      const i = sessions.findIndex(s=>s.id===id);
      if(i<0) return false;
      sessions.splice(i,1); persist(); return true;
    },
    clearAll(){ ensure(); sessions = []; be.clear(); lastSave={ok:true,at:Date.now(),error:null}; return true; },

    /* ---- 数据可靠性：让「有没有存住」这件事可见 ---- */
    /* 最近一次保存的状态，界面顶部用它显示「已存本机 N 场」或报错 */
    saveState(){
      ensure();
      return {
        ok: lastSave.ok,
        at: lastSave.at,
        error: lastSave.error,
        count: sessions.length,
        backend: be.kind ? be.kind() : 'memory',
      };
    },
    /* 立刻重试写入一次（用户点「重试保存」时调用） */
    flush(){ ensure(); const ok = persist(); return {ok, error:lastSave.error}; },
    /* 存储健康度：占用多少、上限多少、后端是否可用 */
    health(){
      ensure();
      const bytes = serialize().length;
      const cap = 5 * 1024 * 1024;              // localStorage 通行上限约 5MB
      const available = be.available ? be.available() : true;
      const ok = persist();                      // 主动写一次做真实校验
      const pct = Math.min(100, +(bytes/cap*100).toFixed(2));
      return {
        ok, available,
        backend: be.kind ? be.kind() : 'memory',
        count: sessions.length,
        bytes, cap, pct,
        error: lastSave.error,
        level: (!ok || !available) ? 'bad' : (pct > 70 ? 'warn' : 'ok'),
      };
    },
    /* 积累进度：用它回答「我坚持录了几天、攒了多少场」 */
    progress(){
      ensure();
      const ordered = sessions.slice().sort((a,b)=>(a.seq||0)-(b.seq||0) || a.ts-b.ts);
      if(!ordered.length) return {n:0, days:0, first:null, last:null};
      const first = ordered[0], last = ordered[ordered.length-1];
      const d0 = Date.parse(first.date), d1 = Date.parse(last.date);
      const days = (isFinite(d0) && isFinite(d1))
        ? Math.max(1, Math.round((d1-d0)/86400000) + 1) : ordered.length;
      return {n:ordered.length, days, first:first.date, last:last.date};
    },

    /* ---- 派生：基准线 ---- */
    /* 排除指定场次后的历史均值（用于「本场 vs 历史」） */
    baseline(excludeId, keys){
      ensure();
      const pool = excludeId ? sessions.filter(s=>s.id!==excludeId) : sessions;
      if(!pool.length) return null;
      const out = {};
      (keys||['gmv','uv','stay','entry','cvr','refund','paid','score']).forEach(k=>{
        const vals = pool.map(s=>s.snapshot[k]).filter(v=>v!=null && !isNaN(v));
        out[k] = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
      });
      out.__n = pool.length;
      return out;
    },
    /* 上一场（顺序上紧邻的更早一场） */
    previous(id){
      ensure();
      const cur = sessions.find(s=>s.id===id);
      if(!cur) return null;
      const older = sessions.filter(s=>
        (s.seq||0) < (cur.seq||0) || ((s.seq||0)===(cur.seq||0) && s.ts < cur.ts)
      ).sort((a,b)=>(b.seq||0)-(a.seq||0) || b.ts-a.ts);
      return older[0] || null;
    },
    /* 按主播聚合（用于主播对比页） */
    byHost(){
      ensure();
      const map = {};
      sessions.forEach(s=>{
        const k = s.hostName || '未命名主播';
        if(!map[k]) map[k] = {name:k, sessions:0, gmv:0, views:0, stays:[], cvrs:[], refunds:[], scores:[], entries:[]};
        const g = map[k];
        g.sessions++;
        g.gmv += s.snapshot.gmv||0;
        g.views += s.snapshot.views||0;
        if(s.snapshot.stay)   g.stays.push(s.snapshot.stay);
        if(s.snapshot.cvr)    g.cvrs.push(s.snapshot.cvr);
        if(s.snapshot.refund!=null) g.refunds.push(s.snapshot.refund);
        if(s.snapshot.score!=null)  g.scores.push(s.snapshot.score);
        if(s.snapshot.entry)  g.entries.push(s.snapshot.entry);
      });
      const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
      return Object.values(map).map(g=>({
        name:g.name,
        sessions:g.sessions,
        gmv:g.gmv,
        uv: g.views ? +(g.gmv/g.views).toFixed(2) : 0,
        stay: +avg(g.stays).toFixed(1),
        cvr: +avg(g.cvrs).toFixed(1),
        refund: +avg(g.refunds).toFixed(1),
        entry: +avg(g.entries).toFixed(1),
        score: Math.round(avg(g.scores)),
      })).sort((a,b)=>b.score-a.score);
    },

    /* ---- 派生：跨场问题追踪 ---- */
    /* 统计每个问题在多少场里出现过，判断是「反复出现」还是「偶发」 */
    issueTrends(minHits){
      ensure();
      const map = {};
      const orderedSessions = sessions.slice().sort((a,b)=>
        (a.seq||0)-(b.seq||0) || a.ts-b.ts);
      orderedSessions.forEach(s=>{
        const seen = new Set();
        s.issues.forEach(it=>{
          const k = it.key || it.title;
          if(!k || seen.has(k)) return;
          seen.add(k);
          if(!map[k]) map[k] = {key:k, title:it.title||k, category:it.category||'', hits:0, total:orderedSessions.length, lastSev:it.sev, firstDate:s.date, lastDate:s.date, streak:0, dates:[]};
          const g = map[k];
          g.hits++;
          g.dates.push(s.date);
          g.lastDate = s.date;
          g.lastSev = it.sev;
        });
      });
      // 计算「连续出现」的连击数（从最新一场往前数，连续命中多少次）
      const n = orderedSessions.length;
      Object.values(map).forEach(g=>{
        let streak = 0;
        for(let i=n-1;i>=0;i--){
          const ks = new Set(orderedSessions[i].issues.map(x=>x.key||x.title));
          if(ks.has(g.key)) streak++; else break;
        }
        g.streak = streak;
        g.rate = n ? +(g.hits/n*100).toFixed(0) : 0;
        // 判定：连续 ≥3 场 = 结构性问题；间歇 = 波动问题；仅 1 场 = 新出现
        g.level = g.streak>=3 ? 'chronic' : (g.hits>=3 ? 'recurring' : (g.hits>=2 ? 'occasional' : 'new'));
        g.label = g.streak>=3 ? '结构性问题（连续 '+g.streak+' 场）'
                : g.hits>=3   ? '反复出现（'+g.hits+'/'+n+' 场）'
                : g.hits>=2   ? '间歇出现（'+g.hits+'/'+n+' 场）'
                              : '首次出现';
      });
      return Object.values(map)
        .filter(g=>g.hits >= (minHits||1))
        .sort((a,b)=> b.streak-a.streak || b.hits-a.hits);
    },

    /* 全场次指标序列（趋势图用），从旧到新 */
    series(keys){
      ensure();
      const ordered = sessions.slice().sort((a,b)=>
        (a.seq||0)-(b.seq||0) || a.ts-b.ts);
      const ks = keys || ['gmv','uv','stay','entry','cvr','refund','score'];
      return {
        labels: ordered.map(s=>s.date),
        ids: ordered.map(s=>s.id),
        data: ks.reduce((acc,k)=>{ acc[k] = ordered.map(s=>s.snapshot[k]); return acc; }, {}),
      };
    },

    /* 导出 / 导入（换设备、备份） */
    exportJSON(){
      ensure();
      return JSON.stringify({ver:STORE_VER, exported:new Date().toISOString(), sessions}, null, 2);
    },
    importJSON(str){
      ensure();
      try{
        const data = JSON.parse(str);
        const incoming = Array.isArray(data) ? data : (data.sessions||[]);
        let added = 0;
        incoming.forEach(rec=>{
          if(!rec || !rec.snapshot) return;
          const dup = sessions.find(s=>s.fp===rec.fp && s.date===rec.date);
          if(dup) return;
          sessions.push(rec); added++;
        });
        persist();
        return {ok:true, added, total:sessions.length};
      }catch(e){ return {ok:false, err:e.message}; }
    },

    /* 内核数据（测试用） */
    _raw(){ ensure(); return sessions; },
  };
}

/* 导出（Node 测试环境） */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { createStore, createMemoryBackend, createLocalBackend, snapshotOf, fingerprint, makeSession, STORE_KEY };
}
