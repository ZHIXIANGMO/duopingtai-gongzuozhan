/* 橘子头 · 内容矩阵控制台 — 公共脚本 */

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const PLATFORM_CLASS = { '小红书': 'xhs', '公众号': 'wx', '抖音': 'dy', 'B站': 'bili' };
const CONFLICT_FIELDS = ['正方', '反方', '我站', '我可能错在哪'];

/* ---------- 工具 ---------- */
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

function pct(n){ return (Number(n || 0)).toFixed(1) + '%'; }

function platTag(p){
  const cls = PLATFORM_CLASS[p] || '';
  return `<span class="tag ${cls}">${esc(p || '未标记')}</span>`;
}

function isBlank(v){
  const s = String(v == null ? '' : v).trim();
  return s === '' || s === '待补' || s === '无';
}

/* 极简 markdown：先转义再加标记，避免注入 */
function renderMd(text){
  let s = esc(text || '');
  const blocks = [];
  s = s.replace(/```([\s\S]*?)```/g, (m, code) => {
    blocks.push(code.replace(/^\w*\n/, ''));
    return `\u0000BLOCK${blocks.length - 1}\u0000`;
  });
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');

  const out = s.split(/\n{2,}/).map(chunk => {
    if(/^\u0000BLOCK\d+\u0000$/.test(chunk.trim())) return chunk.trim();
    if(/^<h[23]>/.test(chunk.trim())) return chunk.trim();
    const lines = chunk.split('\n');
    if(lines.every(l => /^\s*[-*]\s+/.test(l) || !l.trim())){
      const items = lines.filter(l => l.trim())
        .map(l => `<li>${l.replace(/^\s*[-*]\s+/, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    return `<p>${lines.join('<br>')}</p>`;
  }).join('');

  return out.replace(/\u0000BLOCK(\d+)\u0000/g,
    (m, i) => `<pre><code>${esc(blocks[Number(i)] || '')}</code></pre>`);
}

async function getJSON(path){
  const res = await fetch(path, {cache:'no-store'});
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || '接口出错');
  return data;
}

async function postJSON(path, payload){
  const res = await fetch(path, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || '接口出错');
  return data;
}

let toastTimer = null;
function toast(msg){
  const el = $('#toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
}

function setSync(kind, text){
  const dot = $('#syncDot'), txt = $('#syncText');
  if(!dot || !txt) return;
  dot.className = 'dot' + (kind === 'loading' ? ' loading' : kind === 'off' ? ' off' : '');
  txt.textContent = text;
}

/* ---------- 侧栏 ---------- */
function renderSide(state, active){
  const host = $('#side');
  if(!host) return;

  const S = state || {};
  const todos = (S['待办'] || []).length;
  const topics = (S['选题'] || []).length;
  const pubs = (S['投放'] || []).length;
  const name = (S['当前身份'] || {})['名称'] || '未命名';
  const pos = (S['当前身份'] || {})['定位'] || '';
  const wk = (S['统计'] || {})['本周'] || {};
  const total = (S['统计'] || {})['累计'] || {};

  const item = (key, href, label, icon, count, hot) => `
    <a class="nav-item ${active === key ? 'on' : ''}" href="${href}">
      ${icon}<span>${label}</span>
      ${count != null ? `<span class="n ${hot ? 'hot' : ''}">${count}</span>` : ''}
    </a>`;

  host.innerHTML = `
    <div class="brand">
      <div class="mark">橘</div>
      <div>
        <div class="name">内容矩阵</div>
        <div class="sub">一个身份，多个号</div>
      </div>
    </div>
    <div class="nav">
      ${item('work', 'index.html', '工作台',
        '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h10M4 17h13"/></svg>', todos, todos > 0)}
      ${item('topics', 'topics.html', '选题',
        '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></svg>', topics)}
      ${item('matrix', 'matrix.html', '矩阵',
        '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>', null)}
      ${item('data', 'data.html', '数据',
        '<svg viewBox="0 0 24 24"><path d="M5 19V9M12 19V5M19 19v-6"/></svg>', pubs)}
    </div>
    <div class="side-foot">
      <div class="me">
        <div class="me-top">
          <div class="me-av">${esc(name.slice(0, 1))}</div>
          <div>
            <div class="me-name">${esc(name)}</div>
            <div class="me-role">${esc(pos || '还没写定位')}</div>
          </div>
        </div>
        <div class="me-stats">
          <div><b class="num">${wk['篇数'] || 0}</b><span>本周发布</span></div>
          <div><b class="num">${todos}</b><span>等你处理</span></div>
          <div><b class="num">${fmt(total['阅读'] || 0)}</b><span>累计阅读</span></div>
        </div>
      </div>
    </div>`;
}

async function boot(active){
  renderSide(null, active);
  try{
    const state = await getJSON('/api/state');
    renderSide(state, active);
    setSync('ok', '已连接 · ' + (state['服务时间'] || ''));
    return state;
  }catch(e){
    setSync('off', '未连接');
    return null;
  }
}

function offlineBlock(host, msg){
  if(!host) return;
  host.innerHTML = `<div class="blank">
    ${msg || '读不到本地数据。'}<br><br>
    先双击 <b>启动工作台.bat</b>；<br>
    直接双击 html 文件是读不到本地文件的。
  </div>`;
}

/* ---------- 对话（SSE 流式） ---------- */
async function chatStream(kind, id, messages, handlers){
  const res = await fetch('/api/chat', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({kind, id, messages})
  });
  if(!res.ok || !res.body){
    throw new Error('对话接口没响应');
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';

  while(true){
    const {done, value} = await reader.read();
    if(done) break;
    buf += dec.decode(value, {stream:true});
    let idx;
    while((idx = buf.indexOf('\n\n')) >= 0){
      const chunk = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if(!chunk.startsWith('data:')) continue;
      let obj;
      try{ obj = JSON.parse(chunk.slice(5).trim()); }catch(e){ continue; }

      if(obj.error){ throw new Error(obj.error); }
      if(obj.delta){
        full += obj.delta;
        handlers.onDelta && handlers.onDelta(full);
      }
      if(obj.done){
        handlers.onDone && handlers.onDone(obj['写入'] || [], full);
        return;
      }
    }
  }
  handlers.onDone && handlers.onDone([], full);
}

/* ---------- 应用 AI 的修改 ---------- */
async function applyWrites(writes){
  let ok = 0, fail = 0;
  for(const w of writes){
    try{
      await postJSON('/api/write', {kind:w.kind, id:w.id, '字段': w['字段'] || {}});
      ok++;
    }catch(e){ fail++; }
  }
  return {ok, fail};
}

/* ---------- 输入框自适应高度 ---------- */
function autoGrow(el){
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 190) + 'px';
}
