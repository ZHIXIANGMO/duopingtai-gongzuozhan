/* 橘子头 · 内容工作站 — 公共脚本 */

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const STEPS = ['调研','选题','草稿','配图','排版','发布','送审','数据','复盘'];

const PHASES = [
  {key:'讨论', name:'前期讨论', sub:'调研 · 选题 · 方案', color:'#FF5A5F'},
  {key:'写稿', name:'写稿修改', sub:'AI 出稿 · 你改',   color:'#141414'},
  {key:'后期', name:'后期发布', sub:'配图 · 排版 · 发布', color:'#A8B6C4'},
  {key:'复盘', name:'复盘沉淀', sub:'数据 · 复盘结论',   color:'#E2E2E2'}
];

const GATE_INFO = {
  '讨论':{label:'前期内容讨论', hint:'方案还只是初稿。想表达什么、给谁看、怎么描述、哪些细节必须写进去——这些定了我才动笔。', bg:'#FDE8EA'},
  '草稿':{label:'草稿修改', hint:'初稿在这。直接改，或者告诉我要改哪个方向，我重写。', bg:'#E8F1F8'},
  '配图':{label:'配图', hint:'几版图都出来了，挑一版；不满意就写一句想要什么感觉。', bg:'#FCF3DE'},
  '排版':{label:'排版', hint:'排好了，按平台规范过了一遍。看一眼再放行。', bg:'#E6F2EC'}
};
const GATE_SHORT = {'讨论':'定方案','草稿':'改稿','配图':'挑图','排版':'过排版'};
const GATE_ORDER = ['讨论','草稿','配图','排版'];

/* ---------- 基础工具 ---------- */
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

function fmt(n){
  n = Number(n || 0);
  if(n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万';
  return n.toLocaleString('en-US');
}

function pct(n){
  return (Number(n || 0)).toFixed(1) + '%';
}

function delta(cur, prev){
  if(!prev) return cur ? {txt:'新增', cls:'up'} : {txt:'—', cls:''};
  const d = cur - prev;
  if(!d) return {txt:'持平', cls:''};
  const r = Math.round(Math.abs(d) * 1000 / prev) / 10;
  return {txt:(d > 0 ? '+' : '−') + Math.abs(r) + '%', cls:d > 0 ? 'up' : 'down'};
}

async function getJSON(path){
  const res = await fetch(path, {cache:'no-store'});
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || '接口出错');
  return data;
}

async function postJSON(path, payload){
  const res = await fetch(path, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || '接口出错');
  return data;
}

function setSync(kind, text){
  const dot = $('#syncDot'), txt = $('#syncText');
  if(!dot || !txt) return;
  dot.className = 'dot' + (kind === 'loading' ? ' loading' : kind === 'off' ? ' off' : '');
  txt.textContent = text;
}

let toastTimer = null;
function toast(msg){
  const el = $('#toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2300);
}

/* ---------- 外壳：侧栏数字 + 连接状态 ---------- */
async function mountShell(){
  try{
    const [b, s] = await Promise.all([getJSON('/api/board'), getJSON('/api/stats')]);
    const items = b.items || [];
    const running = items.filter(i => i['阶段'] !== '复盘').length;
    const waiting = items.filter(i => (i['待你确认'] || '无') !== '无').length;

    const setN = (sel, v) => { const el = $(sel); if(el) el.textContent = v; };
    setN('[data-count="pipeline"]', running);
    setN('[data-count="wait"]', waiting);
    setN('[data-count="week"]', s['本周']['篇数']);
    setN('#meWeek', s['本周']['篇数']);
    setN('#meWait', waiting);
    setN('#meRead', fmt(s['累计']['阅读']));

    // 侧栏「待你确认」小红点只在这时出现
    const hot = $('[data-count="wait"]');
    if(hot) hot.classList.toggle('hot', waiting > 0);

    setSync('ok', '已连接 · ' + (s['服务时间'] || ''));
    return {board:b, stats:s};
  }catch(e){
    setSync('off', '未连接');
    return null;
  }
}

function offlineBlock(host, msg){
  if(!host) return;
  host.innerHTML = `<div class="blank">
    ${msg || '读不到本地数据。'}<br><br>
    先双击 <b>启动工作台.bat</b>，浏览器会自动打开这个页面；<br>
    直接双击 html 文件是读不到本地文件的。
  </div>`;
}
