/* 线上发布验证：每次同步到线上之后跑这一套
   用法：node test-online.js [url]
   退出码：0 = 全部通过，1 = 有失败

   做两件事：
   A. 拉取线上 index.html / engine.js / store.js，与本地逐字符对比
      （字符数对不上不等于有问题，中文 3 字节折 1 字符；必须是逐字符相等）
   B. 无头 Chrome 直接加载线上 URL，dump-dom 后检查容器与脚本执行痕迹
      —— 这一步才能证明「线上不是白屏、线上 JS 真的跑起来了」

   写在文件里的坑（别重踩）：
   1. 不要加 --virtual-time-budget，它与页面里的 rAF 冲突会让进程挂死
   2. 无头模式下 alert/confirm/prompt 会永久阻塞渲染进程 → 必须设硬超时
   3. <title> 是「复盘台 · 直播运营作战系统」（应用列表里的名字叫「直播数据复盘台」，
      两者不是一回事，别拿应用名去断言 DOM）
*/
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = __dirname + '/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = (process.argv[2] || 'https://live-review-desk.app.workbuddy.host/').replace(/\/?$/, '/');
const FILES = ['index.html', 'engine.js', 'store.js'];

let fails = 0;
function T(name, cond, extra) {
  if (!cond) fails++;
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra !== undefined ? '  →  ' + String(extra).slice(0, 200) : ''));
}

function get(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    mod.get(url, res => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', d => s += d);
      res.on('end', () => resolve({ status: res.statusCode, body: s }));
    }).on('error', () => resolve({ status: 0, body: '' }));
  });
}

function runChrome(timeoutMs) {
  return new Promise((resolve) => {
    const profile = path.join(os.tmpdir(), '_vonline_' + Date.now());
    const args = [
      '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--disable-extensions', '--window-size=1440,900',
      '--user-data-dir=' + profile,
      '--dump-dom', URL,
    ];
    const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const killer = setTimeout(() => { if (!done) { try { p.kill('SIGKILL'); } catch (e) {} } }, timeoutMs);
    p.on('close', () => { if (done) return; done = true; clearTimeout(killer); resolve({ out, err, profile }); });
    p.on('error', e => { if (done) return; done = true; clearTimeout(killer); resolve({ out, err: String(e), profile }); });
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
  });
}

(async () => {
  console.log('目标：' + URL);
  console.log('== A. 线上文件 vs 本地文件 ==');

  const bodies = {};
  for (const f of FILES) {
    const r = await get(URL + f);
    bodies[f] = r.body;
    T(f + ' HTTP 200', r.status === 200, 'status=' + r.status);
    const local = fs.readFileSync(DIR + f, 'utf8');
    T(f + ' 与本地逐字符一致', r.body === local,
      r.body === local ? local.length + ' 字符' : ('线上 ' + r.body.length + ' / 本地 ' + local.length + '（差 ' + (r.body.length - local.length) + '）'));
  }

  console.log('== B. 无头 Chrome 加载线上页面 ==');
  const t0 = Date.now();
  const { out, profile } = await runChrome(90000);
  console.log('   耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's，DOM ' + Buffer.byteLength(out, 'utf8') + ' 字节');

  T('浏览器有输出（未挂死）', out.length > 2000, out.length + ' 字节');
  T('页面标题正确', /复盘台/.test(out));
  ['scroll', 'tbBack', 'tbTitle', 'libCnt', 'navCnt', 'tabs', 'topbar', 'viewMenu', 'cv'].forEach(id => {
    T('容器 #' + id + ' 存在', out.includes('id="' + id + '"'));
  });
  const tb = out.match(/id="tbTitle"[^>]*>([\s\S]{0,60}?)</);
  T('顶栏标题已被线上脚本写入', !!tb && tb[1].trim().length > 0, tb ? tb[1].trim() : 'n/a');
  const nav = out.match(/id="navCnt"[^>]*>([\s\S]{0,40}?)</);
  T('导航计数区已被线上脚本写入', !!nav, nav ? nav[1].trim() : 'n/a');

  console.log('== C. 关键修复是否真的在线上产物里 ==');
  const page = bodies['index.html'] || '';
  [['两阶段删除确认', 'delPending'],
   ['顶栏返回键', 'tbBack'],
   ['窄屏菜单', 'only-narrow'],
   ['960px 断点', 'max-width:960px']].forEach(([n, k]) => T('线上含 ' + n, page.includes(k)));

  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  console.log('='.repeat(60));
  console.log('线上验证：通过 ' + (fails === 0 ? '全部' : '') + '，失败 ' + fails);
  process.exit(fails === 0 ? 0 : 1);
})();
