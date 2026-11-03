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

/* 本地日期 YYYY-MM-DD。
   别用 toISOString()：它按 UTC 算，东八区早上 8 点前会掉到前一天，
   日历会整列错位、今天永远不高亮。 */
function ymd(d){
  const x = d || new Date();
  const p = n => (n < 10 ? '0' : '') + n;
  return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate());
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
  // 链接：[文字](url) 和光秃秃的 url 都认
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    (m, text, url) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`);
  s = s.replace(/(^|[\s（(>])(https?:\/\/[^\s<>"）)]+)/g, (m, pre, url) => {
    const tail = url.length > 48 ? url.slice(0, 46) + '…' : url;
    return `${pre}<a href="${url}" target="_blank" rel="noopener">${tail}</a>`;
  });
  s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  const out = s.split(/\n{2,}/).map(chunk => {
    if(/^\u0000BLOCK\d+\u0000$/.test(chunk.trim())) return chunk.trim();
    if(/^<h[123]>/.test(chunk.trim())) return chunk.trim();
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

/* ---------- 行内新建 ---------- */
/* 不弹窗，直接在列表顶上长一行输入框。回车建，ESC 撤。 */
function inlineNew(host, opts){
  opts = opts || {};
  if(!host) return;
  const old = host.querySelector(':scope > .inew');
  if(old) old.remove();

  const row = document.createElement('div');
  row.className = 'inew';
  row.innerHTML = `<input placeholder="${esc(opts.placeholder || '写个名字')}">
    <button class="btn btn-sm btn-primary">建</button>
    <button class="btn btn-sm" data-x>取消</button>`;

  if(opts.where === 'end') host.appendChild(row); else host.prepend(row);

  const input = row.querySelector('input');
  input.focus();

  const submit = async () => {
    const v = input.value.trim();
    if(!v) return;
    input.disabled = true;
    try{
      await opts.onSubmit(v);
      row.remove();
    }catch(e){
      toast(e.message || '没建成');
      input.disabled = false;
      input.focus();
    }
  };

  row.querySelector('.btn-primary').addEventListener('click', submit);
  row.querySelector('[data-x]').addEventListener('click', () => row.remove());
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); submit(); }
    if(e.key === 'Escape') row.remove();
  });
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

  const item = (key, href, label, icon, count, hot) => `
    <a class="nav-item ${active === key ? 'on' : ''}" href="${href}">
      ${icon}<span>${label}</span>
      ${count != null ? `<span class="n ${hot ? 'hot' : ''}">${count}</span>` : ''}
    </a>`;

  const myIdx = Math.max(roster.findIndex(p => p.id === curId), 0);
  const myColor = IDENT_COLORS[myIdx % IDENT_COLORS.length];
  const myPlats = (roster.find(p => p.id === curId) || {})['平台'] || [];

  const deckCard = (p, i) => {
    const on = p.id === curId;
    const color = IDENT_COLORS[i % IDENT_COLORS.length];
    return `
      <div class="dc ${on ? 'on' : ''}" data-id="${esc(p.id)}" data-i="${i}">
        <span class="dc-av" style="background:linear-gradient(135deg,${color}55,${color})">${esc((p['名称'] || '?').slice(0, 1))}</span>
        <span class="dc-name">${esc(p['名称'] || '未命名')}</span>
        ${on ? '<span class="dc-dot"></span>' : `<span class="dc-n">${(p['平台'] || []).length}</span>`}
      </div>`;
  };

  host.innerHTML = `
    <div class="brand">
      <div class="mark">${esc(name.slice(0, 1) || '内')}</div>
      <div>
        <div class="name">IP 写作工作台</div>
        <div class="sub">${roster.length || 1} 个 IP · ${roster.reduce((n, p) => n + (p['平台'] || []).length, 0) || 0} 个号</div>
      </div>
    </div>
    <div class="nav">
      ${item('work', 'index.html', '今天',
        '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h10M4 17h13"/></svg>', todos, todos > 0)}
      ${item('topics', 'topics.html', '选题',
        '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></svg>', topics)}
      ${item('matrix', 'matrix.html', '矩阵',
        '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>', null)}
      ${item('data', 'data.html', '数据',
        '<svg viewBox="0 0 24 24"><path d="M5 19V9M12 19V5M19 19v-6"/></svg>', pubs)}
      ${item('persona', 'persona.html', '人设',
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>', null)}
    </div>
    <div class="side-foot">
      ${item('settings', 'settings.html', '设置', '', null)}
      <button class="btn btn-sm" id="newIp">新建 IP</button>
      <div class="deck" id="deck">
        ${roster.length ? roster.map(deckCard).join('') : '<div class="dc-empty">没读到身份文件</div>'}
        <div class="deck-info" id="deckInfo"></div>
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

  bindDeck(S);
  $('#newIp').onclick = createIp;
}

/* ---------- 卡片栈：悬停看详情，点击切身份 ---------- */
function deckInfoHTML(p, on, color){
  const plats = (p['平台'] || []).map(a => `
    <a class="di-pl" href="data.html?acc=${encodeURIComponent(a.id)}">
      <span class="di-bar" style="background:${color}"></span>
      <span class="di-plat">${esc(a['平台'])}</span>
      <span class="di-pname">${esc(a['账号名'])}</span>
      ${a['投放数'] ? `<span class="di-pn">${a['投放数']}</span>` : ''}
    </a>`).join('') || '<div class="di-empty">还没开号</div>';

  return `
    <div class="di-head">
      <span class="di-av" style="background:linear-gradient(135deg,${color}55,${color})">${esc((p['名称'] || '?').slice(0, 1))}</span>
      <div class="di-tt">
        <div class="di-name">${esc(p['名称'] || '未命名')}${on ? '<i class="di-on">当前</i>' : ''}</div>
        <div class="di-pos">${esc(p['定位'] || '还没写定位')}</div>
      </div>
    </div>
    <div class="di-sec">要发的平台</div>
    ${plats}
    <a class="di-foot di-go" href="persona.html?id=${encodeURIComponent(p.id)}">看它的人设 →</a>`;
}

let deckTimer = null;

function bindDeck(S){
  const deck = $('#deck'), info = $('#deckInfo');
  if(!deck || !info) return;

  const roster = (S && S['身份清单']) || [];
  const curId = ((S && S['当前身份']) || {}).id || '';

  const hideSoon = () => {
    clearTimeout(deckTimer);
    deckTimer = setTimeout(() => info.classList.remove('on'), 130);
  };

  deck.addEventListener('mouseenter', () => clearTimeout(deckTimer));
  deck.addEventListener('mouseleave', hideSoon);

  deck.querySelectorAll('.dc').forEach(el => {
    el.addEventListener('mouseenter', () => {
      clearTimeout(deckTimer);
      const i = Number(el.dataset.i || 0);
      const p = roster[i];
      if(!p) return;

      info.innerHTML = deckInfoHTML(p, p.id === curId, IDENT_COLORS[i % IDENT_COLORS.length]);
      info.classList.add('on');

      // 贴着这张卡片的右边浮出来，上下不出视口
      const r = el.getBoundingClientRect();
      const h = info.offsetHeight;
      const top = Math.min(Math.max(r.top - 8, 10), window.innerHeight - h - 14);
      info.style.left = Math.round(r.right + 12) + 'px';
      info.style.top = Math.round(Math.max(top, 10)) + 'px';
    });

    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if(!id) return;
      // 点已经选中的那张 → 看它的人设；点别的 → 切过去
      if(id === curId){
        location.href = 'persona.html?id=' + encodeURIComponent(id);
        return;
      }
      setIdent(id);
      try{ sessionStorage.setItem('meOpen', '1'); }catch(err){}
      location.reload();
    });
  });

  // 窄屏没有悬停：点名片把它当抽屉拉开。宽屏点名片 → 进这个 IP 的人设页
  const card = $('#meCard');
  if(card){
    card.addEventListener('click', e => {
      e.stopPropagation();
      if(window.innerWidth > 820){
        location.href = 'persona.html';
        return;
      }
      deck.classList.toggle('open');
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
async function chatStream(kind, id, messages, handlers, options={}){
  const res = await fetch(options.generate ? '/api/generate' : '/api/chat', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({kind, id, messages, '身份': curIdent(), '要求': options.instructions || ''})
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
      if(obj['修正'] !== undefined) full = obj['修正'];
      if(obj.delta){
        full += obj.delta;
        handlers.onDelta && handlers.onDelta(full);
      }
      if(obj.done){
        handlers.onDone && handlers.onDone(obj['写入'] || [], full, obj);
        return;
      }
    }
  }
  throw new Error('连接中断，生成未完成，请重试');
}

/* ---------- 输入框自适应高度 ---------- */
function autoGrow(el){
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 190) + 'px';
}

/* ---------- 四阶段 ---------- */
const STAGES = ['讨论', '正文', '配图', '排版'];
const STAGE_LABEL = {
  '讨论': '选题与讨论', '正文': '正文', '配图': '配图', '排版': '排版与发布'
};

function stageAt(d){
  const i = STAGES.indexOf((d || {})['阶段']);
  return i < 0 ? 0 : i;
}

/* V1 只展示正文状态，查看文章不会推进阶段。 */
function stageBar(d){ return `<span class="chip">${esc(d['写作状态'] || '准备写')}</span>`; }

function createIp(){
  const dialog=document.createElement('dialog');
  dialog.style.cssText='margin:auto;padding:24px;border:1px solid #ddd;border-radius:16px;width:min(440px,calc(100vw - 32px))';
  dialog.innerHTML=`<form><h2 style="font-size:20px;margin-bottom:20px">新建 IP</h2>
    <label style="display:block">名称<input name="名称" required style="display:block;width:100%;padding:12px;margin:8px 0 16px"></label>
    <label style="display:block">赛道<input name="定位" required style="display:block;width:100%;padding:12px;margin:8px 0 16px"></label>
    <label style="display:block">目标读者<input name="读者" required style="display:block;width:100%;padding:12px;margin:8px 0 16px"></label>
    <p role="status" style="margin:12px 0"></p><button class="btn btn-primary">创建</button> <button class="btn" type="button">取消</button></form>`;
  document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[type=button]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove());
  dialog.querySelector('form').onsubmit=async e=>{
    e.preventDefault(); const button=dialog.querySelector('button');button.disabled=true;
    try{const fields=Object.fromEntries(new FormData(e.target));const r=await postJSON('/api/new',{kind:'身份',...fields});setIdent(r.item.id);location.href='persona.html?id='+encodeURIComponent(r.item.id);}
    catch(err){dialog.querySelector('[role=status]').textContent=err.message;button.disabled=false;}
  };
}
