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

/* ---------- 当前身份 ---------- */
const IDENT_KEY = '当前身份';

function curIdent(){
  try{ return localStorage.getItem(IDENT_KEY) || ''; }catch(e){ return ''; }
}
function setIdent(id){
  try{ localStorage.setItem(IDENT_KEY, id || ''); }catch(e){}
}
function withIdent(path){
  const id = curIdent();
  if(!id) return path;
  return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'ident=' + encodeURIComponent(id);
}

/* ---------- 侧栏 ---------- */
const IDENT_COLORS = ['#FF5A5F', '#3B82F6', '#22A06B', '#F0A020', '#8B5CF6', '#E0559B'];

function renderSide(state, active){
  const host = $('#side');
  if(!host) return;

  const S = state || {};
  const todos = (S['待办'] || []).length;
  const topics = (S['选题'] || []).length;
  const pubs = (S['投放'] || []).length;
  const roster = S['身份清单'] || [];
  const cur = S['当前身份'] || {};
  const curId = cur['id'] || '';
  const name = cur['名称'] || '未命名';
  const pos = cur['定位'] || '';
  const wk = (S['统计'] || {})['本周'] || {};
  const total = (S['统计'] || {})['累计'] || {};
  const opened = (() => { try{ return sessionStorage.getItem('meOpen') === '1'; }catch(e){ return false; } })();

  const item = (key, href, label, icon, count, hot) => `
    <a class="nav-item ${active === key ? 'on' : ''}" href="${href}">
      ${icon}<span>${label}</span>
      ${count != null ? `<span class="n ${hot ? 'hot' : ''}">${count}</span>` : ''}
    </a>`;

  const myIdx = Math.max(roster.findIndex(p => p.id === curId), 0);
  const myColor = IDENT_COLORS[myIdx % IDENT_COLORS.length];
  const myPlats = (roster.find(p => p.id === curId) || {})['平台'] || [];

  const identRow = (p, i) => {
    const on = p.id === curId;
    const color = IDENT_COLORS[i % IDENT_COLORS.length];
    const plats = (p['平台'] || []).map(a => `
      <a class="pl" href="data.html?acc=${encodeURIComponent(a.id)}" data-plat="1">
        <span class="pl-bar" style="background:${color}"></span>
        <span class="pl-plat">${esc(a['平台'])}</span>
        <span class="pl-name">${esc(a['账号名'])}</span>
        ${a['投放数'] ? `<span class="pl-n">${a['投放数']}</span>` : ''}
      </a>`).join('') || `<div class="pl-empty">还没开号</div>`;

    return `
      <div class="id ${on ? 'on' : ''}" data-id="${esc(p.id)}">
        <div class="id-top" data-act="pick">
          <span class="id-av" style="background:linear-gradient(135deg,${color}40,${color})">${esc((p['名称'] || '?').slice(0, 1))}</span>
          <span class="id-txt">
            <span class="id-name">${esc(p['名称'] || '未命名')}</span>
            <span class="id-pos">${esc(p['定位'] || '没写定位')}</span>
          </span>
          <span class="id-tag ${on ? 'now' : ''}">${on ? '当前' : (p['平台'] || []).length + ' 号'}</span>
          <svg class="id-arrow" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="id-plats">${plats}</div>
      </div>`;
  };

  host.innerHTML = `
    <div class="brand">
      <div class="mark">${esc(name.slice(0, 1) || '内')}</div>
      <div>
        <div class="name">内容矩阵</div>
        <div class="sub">${roster.length || 1} 个 IP · ${roster.reduce((n, p) => n + (p['平台'] || []).length, 0) || 0} 个号</div>
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
      <div class="me-pop ${opened ? 'on' : ''}" id="mePop">
        <div class="pop-head">
          <span>IP 形象</span>
          <span class="pop-hint">点一个，整个工作台就只看它</span>
        </div>
        <div class="id-list">
          ${roster.length ? roster.map(identRow).join('') : '<div class="pl-empty">没有读到身份文件</div>'}
        </div>
        <a class="pop-add" href="matrix.html">管理 IP 与开号 →</a>
      </div>
      <div class="me" id="meCard">
        <div class="me-top">
          <div class="me-av" style="background:linear-gradient(135deg,${myColor}55,${myColor})">${esc(name.slice(0, 1))}</div>
          <div class="me-txt">
            <div class="me-name">${esc(name)}<svg class="me-chev" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></div>
            <div class="me-role">${esc(pos || '还没写定位')}${myPlats.length ? ' · ' + myPlats.length + ' 个号' : ''}</div>
          </div>
        </div>
        <div class="me-stats">
          <div><b class="num">${wk['篇数'] || 0}</b><span>本周发布</span></div>
          <div><b class="num">${todos}</b><span>等你处理</span></div>
          <div><b class="num">${fmt(total['阅读'] || 0)}</b><span>累计阅读</span></div>
        </div>
      </div>
    </div>`;

  bindMeCard();
}

function bindMeCard(){
  const card = $('#meCard'), pop = $('#mePop');
  if(!card || !pop) return;

  const closePop = () => {
    if(pop.classList.contains('on')){
      pop.classList.remove('on');
      try{ sessionStorage.setItem('meOpen', '0'); }catch(err){}
    }
  };

  card.addEventListener('click', e => {
    e.stopPropagation();
    const on = pop.classList.toggle('on');
    try{ sessionStorage.setItem('meOpen', on ? '1' : '0'); }catch(err){}
  });

  pop.addEventListener('click', e => {
    e.stopPropagation();
    if(e.target.closest('[data-plat]')){
      // 点平台号 → 跳过去只这个号的记录，跳过去后面板不必再开着
      try{ sessionStorage.setItem('meOpen', '0'); }catch(err){}
      return;
    }

    const top = e.target.closest('[data-act="pick"]');
    if(!top) return;
    const row = top.closest('.id');
    if(!row || row.classList.contains('on')) return;  // 已经是当前身份，不重复刷新

    setIdent(row.dataset.id);
    try{ sessionStorage.setItem('meOpen', '1'); }catch(err){}
    location.reload();
  });

  card.addEventListener('keydown', e => { if(e.key === 'Escape') closePop(); });

  if(!document.body.dataset.meBound){
    document.body.dataset.meBound = '1';
    document.addEventListener('click', () => {
      const p = $('#mePop');
      if(p && p.classList.contains('on')){
        p.classList.remove('on');
        try{ sessionStorage.setItem('meOpen', '0'); }catch(err){}
      }
    });
    document.addEventListener('keydown', e => {
      if(e.key !== 'Escape') return;
      const p = $('#mePop');
      if(p && p.classList.contains('on')){
        p.classList.remove('on');
        try{ sessionStorage.setItem('meOpen', '0'); }catch(err){}
      }
    });
  }
}

async function boot(active){
  renderSide(null, active);
  try{
    const state = await getJSON(withIdent('/api/state'));
    // 服务端认定的当前身份写回来，保证下次请求一致
    const pid = (state['当前身份'] || {})['id'];
    if(pid && pid !== curIdent()) setIdent(pid);
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
    body: JSON.stringify({kind, id, messages, '身份': curIdent()})
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
