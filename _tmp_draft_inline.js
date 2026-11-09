
let STATE = null;
let GENERATED = null;
let GENERATING = false;
let D = null;              // 当前稿件
let TOPIC = null;          // 它挂的选题
let HISTORY = [];
let SENDING = false;
let BODY_TAB = 'edit';     // 正文格：编辑 / 预览
let ARCHIVES = [];         // 归档列表：[{文件,条数,时间}]
let VIEWING = null;        // 正在回看的归档文件名；null = 当前对话
let VIEW_MSGS = null;      // 回看时载入的旧对话
let CHATLOG_DOWN = false;  // chatlog 接口连不上，降级用 localStorage 缓存

const DRAFT_ID = new URLSearchParams(location.search).get('id') || '';

/* 每个阶段的打开方式不一样 */
const OPENERS = {
  '讨论': '这条还在讨论。把你想说的倒出来，我来挑哪些能用、哪些是空的。素材够了我就写正文。',
  '正文': '正文在这儿。想改哪段直接说，左边 md 也能自己改。改完我把稿子推去配图。',
  '配图': '到配图了。先说配哪种：公众号横图、小红书竖图，还是这篇不配图。',
  '排版': '排版这儿。左边能切电脑和手机看，字号行距都能调，调好了复制走。'
};

const NEXT_LABEL = {
  '讨论': '素材够了，写正文 →',
  '正文': '正文定了，去配图 →',
  '配图': '图定了，去排版 →',
  '排版': ''
};

function curStage(){
  return (D && D['阶段']) || '讨论';
}

function redoNow(){
  return (D && D['待重做']) || [];
}

function keyOf(){ return 'chat:稿件:' + DRAFT_ID; }

/* 开场白只活在内存里，跟着当前阶段走，不落盘 */
function openerNow(){
  return { role:'assistant', content: OPENERS[curStage()] || OPENERS['讨论'], _sys:true };
}

function readLocal(){
  try{
    const raw = localStorage.getItem(keyOf());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch(e){ return []; }
}

/* 对话真源是服务端文件（数据/对话/）。localStorage 只当断网应急。
   三条路：服务端有 → 用它的；没有而本地有 → 迁上去；连不上 → 本地顶着，顶部说一声 */
async function loadHistory(){
  const local = readLocal();
  try{
    const r = await getJSON('/api/chatlog?kind=' + encodeURIComponent('稿件') + '&id=' + encodeURIComponent(DRAFT_ID));
    ARCHIVES = r['归档'] || [];
    const conv = r['对话'] || [];
    if(conv.length){
      HISTORY = conv;
    }else{
      const mine = local.filter(m => !m._sys);
      if(mine.length){
        // 服务端还没记录、本地缓存里有 → 迁过去（条数为 0 表示服务端已有，忽略即可）
        await postJSON('/api/chatlog', {kind:'稿件', id:DRAFT_ID, mode:'migrate',
          '消息': mine.map(m => ({role:m.role, content:m.content}))});
        HISTORY = mine;
      }else{
        HISTORY = [];
      }
      try{ localStorage.removeItem(keyOf()); }catch(e){}
    }
  }catch(e){
    CHATLOG_DOWN = true;
    HISTORY = local;
    ARCHIVES = [];
  }
  if(!HISTORY.length) HISTORY = [openerNow()];
}

/* 应急缓存照存：服务连不上时靠它，连上了也不碍事（读的时候服务端优先） */
function saveHistory(){
  try{ localStorage.setItem(keyOf(), JSON.stringify(HISTORY.slice(-40))); }catch(e){}
}

/* 追加一条到服务端。失败只提醒一次，不拦对话 */
async function appendChatlog(m){
  const msg = {role:m.role, content:m.content};
  if(m['写入'] && m['写入'].length) msg['写入'] = m['写入'];
  try{
    await postJSON('/api/chatlog', {kind:'稿件', id:DRAFT_ID, mode:'append', '消息':msg});
    if(CHATLOG_DOWN){ CHATLOG_DOWN = false; renderChatNote(); }
  }catch(e){
    toast('这条没存上（服务连不上）');
  }
}

/* ---------- 头部 ---------- */
function renderHead(){
  $('#dTitle').textContent = D['选题标题'] || D.id;
  const bits = [D.id, (D['版本'] || 'v1'), D['字数'] + ' 字'];
  if(TOPIC) bits.push(TOPIC.id);
  $('#dSub').innerHTML = bits.map(esc).join(' · ') +
    (D['待重做'].length ? ` · <b style="color:#D9474C">${esc(D['待重做'].join(' / '))} 待重做</b>` : '');

  $('#dStage').innerHTML = stageBar(D, {labels: true});
  bindStage($('#dStage'), D, jump);
}

/* ---------- 阶段面板 ---------- */
function sec(title, html, note){
  return `<div class="dsec">
    <div class="dsec-t">${esc(title)}${note ? `<span>${esc(note)}</span>` : ''}</div>
    ${html}
  </div>`;
}

function countWords(s){
  return String(s || '').replace(/\s/g, '').length;
}

/* 从一段正文里取某个 ## 小节 */
/* 正文里只有这几个 ## 才算小节。别的一律当内容——
   正文中间写一句「## 早上」，按老写法整篇会被切成两半。 */
const KNOWN_SECTIONS = ['素材', '正文', '这版改了什么', '人工意见', '配图', '排版',
                        '复盘', '必须写进去的细节'];

function sectionsOf(text){
  const out = {};
  let cur = null, buf = [];
  for(const line of String(text || '').split('\n')){
    const name = line.startsWith('## ') ? line.slice(3).trim() : null;
    if(name !== null && KNOWN_SECTIONS.indexOf(name) >= 0){
      if(cur !== null) out[cur] = buf.join('\n').trim();
      cur = name; buf = [];
    } else if(cur !== null){
      buf.push(line);
    }
  }
  if(cur !== null) out[cur] = buf.join('\n').trim();
  return out;
}

function sectionOf(text, name){
  return sectionsOf(text)[name] || '';
}

function sectionText(name){
  return sectionOf(D['正文'], name);
}

function bodyText(){
  return sectionOf(D['正文'], '正文');
}

function isMissing(v){
  const s = String(v || '').trim();
  // 模板占位也算空：待补 / （待补…） / 无 / -
  return !s || s === '待补' || s === '无' || s === '-' ||
    s.startsWith('（待补') || s.startsWith('(待补');
}

/* ① 选题与讨论：只看，一个字都不改。素材从这三个口子进来 */
function panelDiscuss(){
  const t = TOPIC || {};
  const tbody = t['正文'] || '';

  // 选题本身：有内容才显示，空的整块不出现
  let topicHtml = '';
  if(TOPIC){
    const info = sectionOf(tbody, '要传的信息');
    const detail = sectionOf(tbody, '必须写进去的细节');
    const conflict = [['正方', t['正方']], ['反方', t['反方']],
                      ['我站', t['我站']], ['我可能错在哪', t['我可能错在哪']]]
      .filter(([, v]) => !isMissing(v));

    topicHtml = `
      <div class="dtopic">
        <div class="dtopic-m">选题 ${esc(t.id)}${t['目标平台'] ? ' · ' + esc(t['目标平台']) : ''}</div>
        ${!isMissing(info) ? `<div class="dtopic-b">${renderMd(info)}</div>` : ''}
        ${!isMissing(detail) ? `<div class="dtopic-b"><b>写进去的细节</b>${renderMd(detail)}</div>` : ''}
        ${conflict.length ? `<div class="dconf">${conflict.map(([k, v]) =>
          `<div class="dconf-i"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
        ${(!isMissing(info) || !isMissing(detail) || conflict.length) ? '' :
          '<div class="dtopic-b" style="color:#B5B5B5">选题还是空的。素材和想法都在右边聊，够了再写。</div>'}
      </div>`;
  } else {
    topicHtml = '<div class="dbox muted">这篇稿还没挂到选题上，左边暂时空着。回选题页挂一条再来。</div>';
  }

  // 素材：AI 搜的、你粘的链接，都算这里
  const mat = D['素材'] || '';
  const matHtml = `
    <div class="dmat">${mat ? renderMd(mat) : '<span style="color:#B5B5B5">还空着。让 AI 去搜，或者把链接粘在下面。</span>'}</div>
    <div class="drow dadd">
      <input class="dinput" id="matUrl" placeholder="粘一个链接，回车加进素材">
      <button class="btn btn-sm" id="addMat">加进去</button>
    </div>`;

  // 文件：拖进来，或者点
  const files = D['文件'] || [];
  const fileHtml = `
    <div class="dfiles" id="dropZone">
      ${files.length ? files.map(f => `
        <a class="dfile-i" href="${esc(f['地址'])}" target="_blank" rel="noopener">
          ${f['是图'] ? `<img src="${esc(f['地址'])}" alt="">` : '<span class="dfile-x">' + esc((f['名字'].split('.').pop() || '').toUpperCase()) + '</span>'}
          <i>${esc(f['名字'])}</i>
        </a>`).join('') : '<div class="dfile-e">把 pdf、图、网页截图拖到这里</div>'}
      <label class="dfile-add">＋<input type="file" id="fileInput" multiple hidden></label>
    </div>`;

  return `${topicHtml}
    ${sec('素材', matHtml, mat ? '只读' : '')}
    ${sec('文件', fileHtml, files.length ? files.length + ' 个' : '')}
    <div class="dtip">这一格不改字。素材够了，右边说一句，AI 写正文去下一格。</div>`;
}

/* ② 正文：Markdown 编辑窗口 */
function panelBody(){
  const body = bodyText();
  const view = BODY_TAB === 'view';
  const tabs = `<div class="dtabs">
    <button class="dtab ${view ? '' : 'on'}" data-tab="edit">编辑</button>
    <button class="dtab ${view ? 'on' : ''}" data-tab="view">预览</button>
  </div>`;

  const area = view
    ? `<div class="dmd mdview" id="mdView">${body ? renderMd(body) : '<span style="color:#B5B5B5">还没有正文</span>'}</div>`
    : `<textarea class="dedit mdcode" id="fBody" rows="18"
        placeholder="Markdown 写。段落空一行，小标题写 ##。">${esc(body)}</textarea>
       <div class="drow"><button class="btn btn-sm" id="saveBody">保存</button></div>`;

  return `
    ${sec('正文', `${tabs}${area}`, countWords(body) + ' 字')}
    <div class="dtip">左边是 md 源码，切「预览」看渲染结果。改完记得保存，后面的配图排版会对不上。</div>`;
}

/* ③ 配图：先把位置留出来。公众号图 / 小红书图，二选一，也可以不配 */
const IMAGE_SPEC = {
  '公众号': { 说明: '一张横封面 + 文中插图。封面 2.35:1（900×383）',
              位: [{ n: '封面', r: '900×383' }, { n: '内文图 1', r: '横图' },
                   { n: '内文图 2', r: '横图' }, { n: '内文图 3', r: '横图' }] },
  '小红书': { 说明: '3:4 竖图一组，4 到 6 张。首图决定点击',
              位: [{ n: '首图', r: '3:4' }, { n: '第 2 张', r: '3:4' },
                   { n: '第 3 张', r: '3:4' }, { n: '第 4 张', r: '3:4' }] },
  '不配图': { 说明: '纯文字。小红书不适合，公众号偶尔可以', 位: [] }
};

function panelImage(){
  const cur = D['配图形式'] || '公众号';
  const spec = IMAGE_SPEC[cur] || IMAGE_SPEC['公众号'];

  const cards = ['公众号', '小红书', '不配图'].map(k => `
    <button class="dimg ${k === cur ? 'on' : ''}" data-mode="${k}">
      <b>${esc(k)}${k === '不配图' ? '' : '图'}</b>
      <span>${esc(IMAGE_SPEC[k].说明)}</span>
    </button>`).join('');

  const slots = spec.位.map((p, i) => `
    <div class="dslot ${cur === '公众号' && i === 0 ? 'wide' : ''}">
      <div class="dphase">${esc(p.r)}</div>
      <i>${esc(p.n)}</i>
    </div>`).join('');

  return `
    ${sec('配哪种图', `
      ${D['目标平台'] ? `<div class="dtip" style="margin:0 0 9px">这条选题目标平台是
        <b>${esc(D['目标平台'])}</b>。一篇稿只按一个平台的规格做，发第二个平台要另开一篇。</div>` : ''}
      <div class="dimgs">${cards}</div>`,
      '只能选一种，两种不同时做')}
    ${cur === '不配图' ? sec('图位', '<div class="dbox muted">不配图，这一篇纯文字。</div>')
      : sec('图位', `<div class="dslots ${cur === '小红书' ? 'vert' : ''}">${slots}</div>`)}
    <div class="dtip">图位先留着。接出图之后这里放真图，现在只能定数量和张幅。</div>`;
}

/* ④ 排版与发布：预览 + 三个控件 + 复制 / 推送 */
const LAYOUT_DEFAULT = { 字号: 16, 行距: 1.9, 字距: 0, 主题: '纸白', 设备: '电脑' };
const THEMES = {
  '纸白': { 底: '#FFFFFF', 字: '#1A1A1A' },
  '暖米': { 底: '#FBF7EF', 字: '#2B2620' },
  '灰面': { 底: '#F6F6F7', 字: '#1F1F1F' }
};

function layoutCfg(){
  let saved = {};
  try{ saved = JSON.parse(localStorage.getItem('layout:' + DRAFT_ID) || '{}'); }catch(e){}
  return Object.assign({}, LAYOUT_DEFAULT, saved || {});
}

function panelLayout(){
  const c = layoutCfg();
  const th = THEMES[c.主题] || THEMES['纸白'];
  const body = bodyText();

  const slider = (id, key, min, max, step, unit) => `
    <label class="dctl">
      <span>${key}</span>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${c[key]}">
      <b class="num" id="${id}v">${c[key]}${unit || ''}</b>
    </label>`;

  return `
    ${sec('预览', `
      <div class="dbar">
        <div class="dseg2">
          <button class="dtab ${c.设备 === '电脑' ? 'on' : ''}" data-dev="电脑">电脑上</button>
          <button class="dtab ${c.设备 === '手机' ? 'on' : ''}" data-dev="手机">手机上</button>
        </div>
        <div class="dthemes">${Object.keys(THEMES).map(k =>
          `<button class="dtheme ${k === c.主题 ? 'on' : ''}" data-theme="${k}">${k}</button>`).join('')}</div>
      </div>
      <div class="dstagebox ${c.设备 === '手机' ? 'phone' : ''}">
        <div class="dpaper" id="dPaper" style="--fs:${c.字号}px;--lh:${c.行距};--ls:${c.字距}px;background:${th.底};color:${th.字}">
          ${body ? renderMd(body) : '<p style="color:#B5B5B5">还没有正文</p>'}
        </div>
      </div>`,
      c.设备 + ' · ' + c.主题)}

    ${sec('排版', `
      <div class="dctls">
        ${slider('cSize', '字号', 13, 22, 1, 'px')}
        ${slider('cLine', '行距', 1.3, 2.4, 0.1, '')}
        ${slider('cSpace', '字距', -0.5, 2, 0.1, 'px')}
      </div>`, '改完立刻生效')}

    ${sec('拿出去', `
      <div class="drow">
        <button class="btn btn-primary btn-sm" id="copyRich">复制排版</button>
        <select class="dinput" id="pubTo">
          <option>公众号</option><option>小红书</option>
          <option>抖音</option><option>B站</option>
        </select>
        <button class="btn btn-sm" id="pushBtn" disabled title="平台接口还没接，先把入口留着">推送到平台</button>
      </div>
      <div class="dtip" style="margin:8px 0 0">推送是空的：四个平台都拿不到发布权限。复制能用，
        粘到公众号后台不掉格式。</div>`)}`;
}

function renderPanel(){
  const st = curStage();
  const host = $('#dPanel');
  let html = '';
  if(st === '讨论') html = panelDiscuss();
  else if(st === '正文') html = panelBody();
  else if(st === '配图') html = panelImage();
  else html = panelLayout();

  if(redoNow().indexOf(st) >= 0){
    html = `<div class="dwarn">正文改过了，这一格对不上，得重做一遍。旧的留着能看，重做才归档。</div>` + html;
  }

  const next = NEXT_LABEL[st];
  html += `<div class="dnext">
    ${next ? `<button class="btn btn-primary" id="goNext">${esc(next)}</button>` : '<span class="dtip" style="margin:0">走到头了。发了以后数据在数据页看。</span>'}
    ${redoNow().length ? `<span class="dtip" style="margin:0">${esc(redoNow().join(' / '))} 待重做</span>` : ''}
  </div>`;

  host.innerHTML = html;
  bindPanel();
}

function bindPanel(){
  /* 正文：保存 + 编辑/预览 切换 */
  const fBody = $('#fBody');
  if(fBody){
    $('#saveBody').addEventListener('click', async ev => {
      ev.target.disabled = true;
      try{
        // 走小节接口：只换「## 正文」，素材/配图/排版不动，正文里的 ## 也不会被当小节切
        await postJSON('/api/section', {kind:'稿件', id:D.id, '小节':'正文', '内容': fBody.value});
        await reload('正文存好了');
      }catch(e){ toast('没存上：' + e.message); }
      finally{ ev.target.disabled = false; }
    });
  }
  document.querySelectorAll('.dtabs .dtab').forEach(b => {
    b.addEventListener('click', () => { BODY_TAB = b.dataset.tab; renderPanel(); });
  });

  /* 讨论：粘链接 → 追加进「## 素材」 */
  const add = $('#addMat');
  if(add){
    const fire = async () => {
      const box = $('#matUrl');
      const url = box.value.trim();
      if(!url) return;
      const old = D['素材'] || '';
      const line = /^https?:\/\//.test(url) ? '- ' + url : '- ' + url;
      const next = (old ? old.replace(/\s+$/, '') + '\n' : '') + line;
      add.disabled = true;
      try{
        await postJSON('/api/section', {kind:'稿件', id:D.id, '小节':'素材', '内容': next});
        await reload('加进素材了');
      }catch(e){ toast('没存上：' + e.message); add.disabled = false; }
    };
    add.addEventListener('click', fire);
    $('#matUrl').addEventListener('keydown', e => {
      if(e.key === 'Enter'){ e.preventDefault(); fire(); }
    });
  }

  /* 讨论：拖文件进来 */
  const zone = $('#dropZone');
  const pick = $('#fileInput');
  const send = async file => {
    const b64 = await new Promise((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => no(new Error('读不出来'));
      r.readAsDataURL(file);
    });
    await postJSON('/api/asset', {稿件: D.id, 名字: file.name, 数据: b64});
  };
  if(pick){
    pick.addEventListener('change', async () => {
      const list = Array.from(pick.files || []);
      for(const f of list){
        try{ await send(f); }catch(e){ toast(f.name + ' 没传上：' + e.message); }
      }
      if(list.length) await reload('传了 ' + list.length + ' 个文件');
    });
  }
  if(zone){
    ['dragenter', 'dragover'].forEach(t => zone.addEventListener(t, e => {
      e.preventDefault(); zone.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(t => zone.addEventListener(t, e => {
      e.preventDefault(); zone.classList.remove('over');
    }));
    zone.addEventListener('drop', async e => {
      const list = Array.from((e.dataTransfer || {}).files || []);
      if(!list.length) return;
      for(const f of list){
        try{ await send(f); }catch(err){ toast(f.name + ' 没传上：' + err.message); }
      }
      await reload('传了 ' + list.length + ' 个文件');
    });
  }

  /* 配图：三种互斥，选完就落盘 */
  document.querySelectorAll('.dimg').forEach(b => {
    b.addEventListener('click', async () => {
      if(b.classList.contains('on')) return;
      try{
        await postJSON('/api/write', {kind:'稿件', id:D.id, '字段': {'配图形式': b.dataset.mode}});
        await reload('配' + b.dataset.mode + '图');
      }catch(e){ toast('没存上：' + e.message); }
    });
  });

  /* 排版控件：改就生效，顺手存本地 */
  const cfg = layoutCfg();
  const paint = () => {
    const p = $('#dPaper');
    if(!p) return;
    const th = THEMES[cfg.主题] || THEMES['纸白'];
    p.style.setProperty('--fs', cfg.字号 + 'px');
    p.style.setProperty('--lh', cfg.行距);
    p.style.setProperty('--ls', cfg.字距 + 'px');
    p.style.background = th.底;
    p.style.color = th.字;
    try{ localStorage.setItem('layout:' + DRAFT_ID, JSON.stringify(cfg)); }catch(e){}
  };
  const hook = (id, key, unit) => {
    const el = $('#' + id);
    if(!el) return;
    el.addEventListener('input', () => {
      cfg[key] = Number(el.value);
      $('#' + id + 'v').textContent = el.value + (unit || '');
      paint();
    });
  };
  hook('cSize', '字号', 'px');
  hook('cLine', '行距', '');
  hook('cSpace', '字距', 'px');

  document.querySelectorAll('[data-dev]').forEach(b => {
    b.addEventListener('click', () => {
      cfg.设备 = b.dataset.dev;
      try{ localStorage.setItem('layout:' + DRAFT_ID, JSON.stringify(cfg)); }catch(e){}
      renderPanel();
    });
  });
  document.querySelectorAll('[data-theme]').forEach(b => {
    b.addEventListener('click', () => {
      cfg.主题 = b.dataset.theme;
      document.querySelectorAll('[data-theme]').forEach(x => x.classList.toggle('on', x === b));
      paint();
      const note = document.querySelector('.dsec-t span');
      if(note) note.textContent = cfg.设备 + ' · ' + cfg.主题;
      try{ localStorage.setItem('layout:' + DRAFT_ID, JSON.stringify(cfg)); }catch(e){}
    });
  });

  /* 复制排版：带样式复制，粘到公众号后台不掉格式 */
  const copy = $('#copyRich');
  if(copy){
    copy.addEventListener('click', async () => {
      const paper = $('#dPaper');
      if(!paper) return;
      const range = document.createRange();
      range.selectNodeContents(paper);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try{ ok = document.execCommand('copy'); }catch(e){ ok = false; }
      sel.removeAllRanges();
      if(!ok){
        toast('复制失败，浏览器不让。手动选一遍再按 Ctrl+C');
        return;
      }
      // 复制出去就等于这套版式定了，记进 md，换电脑也知道这篇怎么排的
      const c = layoutCfg();
      try{
        await postJSON('/api/write', {kind:'稿件', id:D.id, '字段': {
          '排版': `${c.字号}px · 行距 ${c.行距} · 字距 ${c.字距}px · ${c.主题} · ${c.设备}看`
        }});
        await reload('复制好了，版式也记下了');
      }catch(e){ toast('复制好了，但版式没存上：' + e.message); }
    });
  }

  const go = $('#goNext');
  if(go){
    go.addEventListener('click', async () => {
      const here = stageAt(D);
      const target = STAGES[Math.min(here + 1, STAGES.length - 1)];
      go.disabled = true;
      try{
        await setStage(D.id, target, '');
        await reload('推进到 ' + STAGE_LABEL[target]);
      }catch(e){ toast(e.message); go.disabled = false; }
    });
  }
}

/* ---------- 跳阶段 ---------- */
/* ---------- 退回确认 ---------- */
/* 包一层 Promise，问完再决定走不走。原生 confirm 太丑，也说不清会丢什么 */
function askBack(stage, down){
  return new Promise(resolve => {
    const mask = $('#dmask'), box = $('#dmodal');
    const downTxt = down.length
      ? `「${down.map(s => STAGE_LABEL[s]).join('」「')}」已经做过了，退回去以后要重做一遍，旧的会归档到 .历史/作废。`
      : `后面几格还没做过什么，退回去不会丢东西。`;
    box.innerHTML = `
      <div class="dm-h">退回「${esc(STAGE_LABEL[stage])}」？</div>
      <div class="dm-b">${esc(downTxt)}</div>
      <div class="dm-n">正文不会动，只改阶段位置。</div>
      <div class="dm-f">
        <button class="btn" id="dmNo">先不退</button>
        <button class="btn btn-primary" id="dmYes">确定退回</button>
      </div>`;
    mask.classList.add('on');

    const done = ok => {
      mask.classList.remove('on');
      document.removeEventListener('keydown', key);
      setTimeout(() => { box.innerHTML = ''; }, 200);
      resolve(ok);
    };
    const key = e => { if(e.key === 'Escape') done(false); };

    $('#dmNo').addEventListener('click', () => done(false));
    $('#dmYes').addEventListener('click', () => done(true));
    mask.addEventListener('click', e => { if(e.target === mask) done(false); });
    document.addEventListener('keydown', key);
    setTimeout(() => $('#dmYes').focus(), 60);
  });
}

async function jump(stage){
  if(!D || stage === D['阶段']) return;
  const here = stageAt(D);
  const to = STAGES.indexOf(stage);

  if(to < here){
    const down = STAGES.slice(to + 1).filter(s => (D['有产物'] || []).indexOf(s) >= 0);
    if(!await askBack(stage, down)) return;
  }

  try{
    await setStage(D.id, stage, to < here ? '手动退回' : '手动推进');
    await reload('到 ' + STAGE_LABEL[stage] + ' 了');
  }catch(e){ toast(e.message); }
}

/* ---------- 对话 ---------- */
/* 写入操作条：当场聊出来的、重开页面翻出来的、归档里翻出来的，长得一样、都能点 */
function writesBarHtml(writes){
  return `<div class="writes"><div class="wt">AI 想改 <b>${writes.length}</b> 处：${
    writes.map(w => esc(w.kind + ' ' + w.id)).join('、')}</div>
    <button type="button" class="btn btn-sm btn-primary">应用</button></div>`;
}

function bindWritesBar(bar, writes){
  bar.querySelector('button').addEventListener('click', async ev => {
    ev.target.disabled = true;
    const r = await applyWrites(writes);
    ev.target.textContent = r.fail ? ('失败 ' + r.fail) : '已写入';
    toast(r.fail ? '有 ' + r.fail + ' 处没写进去' : '已写进文件');
    if(!r.fail) await reload('');
  });
}

function msgHtml(m){
  const ai = m.role !== 'user';
  const w = m['写入'];
  return `<div class="msg ${ai ? 'ai' : 'user'}">
    <div class="who">${ai ? 'AI' : '你'}</div>
    <div class="bubble">${renderMd(m.content)}</div>
    ${w && w.length ? writesBarHtml(w) : ''}
  </div>`;
}

function renderMsgs(list){
  const msgs = list || HISTORY;
  const host = $('#msgs');
  host.innerHTML = msgs.map(msgHtml).join('');
  host.querySelectorAll('.msg').forEach((el, i) => {
    const bar = el.querySelector('.writes');
    if(bar && msgs[i] && msgs[i]['写入']) bindWritesBar(bar, msgs[i]['写入']);
  });
  host.scrollTop = VIEWING ? 0 : host.scrollHeight;
}
function scrollBottom(){
  const host = $('#msgs');
  host.scrollTop = host.scrollHeight;
}

async function send(){
  if(SENDING || GENERATING || !D || VIEWING) return;
  const box = $('#input');
  const text = box.value.trim();
  if(!text) return;

  box.value = '';
  autoGrow(box);

  const userMsg = { role:'user', content: text };
  HISTORY.push(userMsg);
  saveHistory();
  appendChatlog(userMsg);

  const host = $('#msgs');
  if(!host.querySelector('.msg')) host.innerHTML = '';
  host.insertAdjacentHTML('beforeend', msgHtml({role:'user', content:text}));
  const aiWrap = document.createElement('div');
  aiWrap.className = 'msg ai';
  aiWrap.innerHTML = '<div class="who">AI</div><div class="bubble"><div class="typing"><i></i><i></i><i></i></div></div>';
  host.appendChild(aiWrap);
  scrollBottom();

  SENDING = true;
  $('#send').disabled = true;
  const bubble = aiWrap.querySelector('.bubble');
  let painted = '';

  try{
    const payload = HISTORY.filter(m => !m._sys).map(m => ({role:m.role, content:m.content}));
    await chatStream('稿件', D.id, payload, {
      onDelta(full){
        painted = full;
        bubble.innerHTML = renderMd(full);
        scrollBottom();
      },
      onDone(writes, full){
        const clean = (full || painted || '').trim();
        bubble.innerHTML = renderMd(clean) || '<span style="color:#B5B5B5">（这次没说话）</span>';
        const aiMsg = { role:'assistant', content: clean };
        if(writes && writes.length) aiMsg['写入'] = writes;
        HISTORY.push(aiMsg);
        saveHistory();
        appendChatlog(aiMsg);

        if(writes && writes.length){
          aiWrap.insertAdjacentHTML('beforeend', writesBarHtml(writes));
          bindWritesBar(aiWrap.querySelector('.writes'), writes);
        }
        scrollBottom();
      }
    });
  }catch(e){
    bubble.innerHTML = `<span style="color:#D9474C">${esc(e.message)}</span>`;
    HISTORY.push({ role:'assistant', content:'（出错了：' + e.message + '）' });
    saveHistory();
  }finally{
    SENDING = false;
    $('#send').disabled = false;
    box.focus();
  }
}

/* ---------- 新起对话 / 归档回看 ---------- */
function renderChatNote(){
  const el = $('#chatNote');
  if(CHATLOG_DOWN){
    el.hidden = false;
    el.innerHTML = '<div class="banner"><b>对话记录没连上服务，先显示本地缓存。</b> 能接着聊，服务起来后会自动接上。</div>';
  }else{
    el.hidden = true;
  }
}

function renderHistBtn(){
  const b = $('#chatHist');
  if(!b) return;
  b.hidden = !ARCHIVES.length;
  b.textContent = ARCHIVES.length ? ('历史 ' + ARCHIVES.length + ' 段') : '历史';
}

function renderArchList(){
  const host = $('#chatArch');
  host.innerHTML = ARCHIVES.length
    ? '<div class="dtbl">' + ARCHIVES.map(a => `
      <button type="button" class="drow2 ${VIEWING === a['文件'] ? 'on' : ''}" data-file="${esc(a['文件'])}" title="${esc(a['文件'])}">
        <span class="drow2-a">${esc(String(a['时间'] || a['文件'] || ''))}</span>
        <span class="drow2-n">${esc(String(a['条数'] == null ? '' : a['条数']))} 条</span>
      </button>`).join('') + '</div>'
    : '<div class="dtbl"><div class="drow2">还没归档过，聊过一段再收。</div></div>';
  host.querySelectorAll('[data-file]').forEach(btn => {
    btn.addEventListener('click', () => { viewArchive(btn.dataset.file); });
  });
}

function toggleArchList(force){
  const host = $('#chatArch');
  host.hidden = force == null ? !host.hidden : !force;
  if(!host.hidden) renderArchList();
}

/* 回看归档：旧对话只读，输入框停用，写建议的操作条照常能点（点了才落盘） */
async function viewArchive(file){
  if(!file) return;
  if(VIEWING === file){ toggleArchList(false); return; }
  if(SENDING || GENERATING){ toast('等这条说完，再翻旧对话'); return; }
  try{
    const r = await getJSON('/api/chatlog?kind=' + encodeURIComponent('稿件') + '&id=' +
      encodeURIComponent(DRAFT_ID) + '&file=' + encodeURIComponent(file));
    VIEWING = file;
    VIEW_MSGS = r['对话'] || [];
    toggleArchList(false);
    $('#newChat').hidden = true;
    $('#viewingTag').hidden = false;
    $('#backNow').hidden = false;
    const box = $('#input');
    box.disabled = true;
    box.placeholder = '在看旧对话，回到当前才能接着聊';
    $('#send').disabled = true;
    renderMsgs(VIEW_MSGS);
  }catch(e){ toast('这段旧对话打不开：' + e.message); }
}

function exitViewing(){
  VIEWING = null;
  VIEW_MSGS = null;
  $('#newChat').hidden = false;
  $('#viewingTag').hidden = true;
  $('#backNow').hidden = true;
  const box = $('#input');
  box.disabled = false;
  box.placeholder = '说你想干什么…';
  $('#send').disabled = false;
  renderMsgs();
}

/* 和 askBack 同一个弹窗，同一副骨架：原生 confirm 太丑，也说不清会动什么 */
function askNewChat(){
  return new Promise(resolve => {
    const mask = $('#dmask'), box = $('#dmodal');
    box.innerHTML = `
      <div class="dm-h">新起一段对话？</div>
      <div class="dm-b">旧对话会收进抽屉，一个字不删。新开一个？</div>
      <div class="dm-n">收起来的在「历史」里，随时翻回来看。</div>
      <div class="dm-f">
        <button class="btn" id="dmNo">先不开</button>
        <button class="btn btn-primary" id="dmYes">新起对话</button>
      </div>`;
    mask.classList.add('on');

    const done = ok => {
      mask.classList.remove('on');
      document.removeEventListener('keydown', key);
      setTimeout(() => { box.innerHTML = ''; }, 200);
      resolve(ok);
    };
    const key = e => { if(e.key === 'Escape') done(false); };

    $('#dmNo').addEventListener('click', () => done(false));
    $('#dmYes').addEventListener('click', () => done(true));
    mask.addEventListener('click', e => { if(e.target === mask) done(false); });
    document.addEventListener('keydown', key);
    setTimeout(() => $('#dmYes').focus(), 60);
  });
}

async function refreshArchives(){
  try{
    const r = await getJSON('/api/chatlog?kind=' + encodeURIComponent('稿件') + '&id=' + encodeURIComponent(DRAFT_ID));
    ARCHIVES = r['归档'] || [];
  }catch(e){ /* 列表拿不到就不显示入口，聊天不受影响 */ }
  renderHistBtn();
}

async function newChat(){
  if(!D || VIEWING || SENDING || GENERATING) return;
  if(!HISTORY.some(m => !m._sys)){ toast('这段还没聊过什么，不用新起'); return; }
  if(!await askNewChat()) return;
  try{
    await postJSON('/api/chatlog', {kind:'稿件', id:DRAFT_ID, mode:'archive'});
    HISTORY = [openerNow()];
    saveHistory();
    renderMsgs();
    await refreshArchives();
    toast('旧对话收进抽屉了');
  }catch(e){ toast('没归档上：' + e.message); }
}

/* ---------- 重新拉数据 ---------- */
async function reload(msg){
  try{
    STATE = await getJSON(withIdent('/api/state'));
    renderSide(STATE, 'work');
    D = (STATE['稿件'] || []).find(x => x.id === DRAFT_ID) || D;
    if(D){
      TOPIC = (STATE['选题'] || []).find(t => t.id === D['选题']) || null;
      renderHead();
      renderPanel();
      $('#chTitle').textContent = D['选题标题'] || D.id;
      $('#chSub').textContent = STAGE_LABEL[curStage()] + ' · ' + (D['字数'] || 0) + ' 字';
      renderBanner();
    }
    if(msg) toast(msg);
  }catch(e){ toast('刷新失败：' + e.message); }
}

function renderBanner(){
  const host = $('#aiBanner');
  const ai = (STATE && STATE['AI']) || {};
  if(ai['可用']){ host.innerHTML = ''; return; }
  host.innerHTML = `<div class="banner">
    <b>还没配模型。</b> <a href="settings.html">打开设置，填写接口和 API Key →</a>
  </div>`;
}

function initGeneration(){
  const status = $('#generationStatus'), preview = $('#generationPreview');
  $('#generateDraft').onclick = async () => {
    if(GENERATING || SENDING || !D) return;
    const editor = $('#fBody');
    if(editor && editor.value.trim() !== bodyText().trim()){
      status.textContent = '请先保存左侧正文，再生成初稿。'; return;
    }
    GENERATED = null; GENERATING = true;
    $('#generateDraft').disabled = true; $('#send').disabled = true;
    $('#adoptActions').hidden = true; preview.hidden = false; preview.innerHTML = '';
    status.textContent = '正在按人设写作…';
    try {
      await chatStream('稿件', D.id, [], {
        onDelta(full){ preview.innerHTML = renderMd(full); },
        onDone(writes, full, meta){
          if(!full.trim() || !meta.revision) throw new Error('没有收到完整初稿，请重试');
          GENERATED = {text:full.trim(), revision:meta.revision};
          preview.innerHTML = renderMd(full); $('#adoptActions').hidden = false;
          status.textContent = '初稿已生成，尚未保存。采用后替换正文，原稿会保留历史版本。';
        }
      }, {generate:true, instructions:$('#writingRequest').value});
    } catch(e){ status.textContent = e.message; }
    finally { GENERATING = false; $('#generateDraft').disabled = false; $('#send').disabled = false; }
  };
  $('#adoptDraft').onclick = async () => {
    if(!GENERATED) return;
    const editor = $('#fBody');
    if(editor && editor.value.trim() !== bodyText().trim()){
      status.textContent = '正文有未保存的修改，请先保存，再重新生成。'; return;
    }
    $('#adoptDraft').disabled = true;
    try {
      await postJSON('/api/adopt_draft', {id:D.id, '正文':GENERATED.text, revision:GENERATED.revision});
      GENERATED = null; $('#adoptActions').hidden = true; preview.hidden = true;
      await reload('初稿已保存');
      HISTORY = HISTORY.filter(m => !m._sys);
      HISTORY.push({role:'assistant', content:'初稿已采用。想改哪一段，可以直接告诉我。', _sys:true});
      saveHistory(); renderMsgs();
      status.textContent = '已采用初稿，可以继续编辑正文或在右侧讨论。';
    } catch(e){ status.textContent = e.message; }
    finally { $('#adoptDraft').disabled = false; }
  };
  $('#dismissDraft').onclick = () => { preview.hidden = true; $('#adoptActions').hidden = true; GENERATED = null; status.textContent = '预览已收起，正文未改动。'; };
}

/* ---------- 启动 ---------- */
(async function init(){
  STATE = await boot('work');
  if(!STATE){
    offlineBlock($('#dPanel'));
    return;
  }

  D = (STATE['稿件'] || []).find(x => x.id === DRAFT_ID);
  if(!D){
    $('#generationBox').hidden = true;
    $('#dTitle').textContent = '没找到这篇稿子';
    $('#dSub').textContent = DRAFT_ID ? ('id：' + DRAFT_ID) : '地址里没带 id';
    $('#dPanel').innerHTML = '<div class="blank">从工作台点一篇稿件进来，地址会带上 ?id=dr-001。</div>';
    $('#msgs').innerHTML = '';
    return;
  }

  TOPIC = (STATE['选题'] || []).find(t => t.id === D['选题']) || null;
  await loadHistory();
  renderChatNote();
  renderHistBtn();
  renderHead();
  renderPanel();
  renderMsgs();
  renderBanner();
  initGeneration();

  $('#chTitle').textContent = D['选题标题'] || D.id;
  $('#chSub').textContent = STAGE_LABEL[curStage()] + ' · ' + (D['字数'] || 0) + ' 字';

  const box = $('#input');
  box.addEventListener('input', () => autoGrow(box));
  box.addEventListener('keydown', e => {
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); }
  });
  $('#send').addEventListener('click', send);
  $('#newChat').addEventListener('click', newChat);
  $('#backNow').addEventListener('click', exitViewing);
  $('#chatHist').addEventListener('click', () => toggleArchList());

  // 从队列点某一格进来：直接落到那一步
  const want = new URLSearchParams(location.search).get('stage');
  if(want && STAGES.indexOf(want) >= 0 && want !== D['阶段']){
    history.replaceState(null, '', 'draft.html?id=' + encodeURIComponent(DRAFT_ID));
    jump(want);
  }
})();
