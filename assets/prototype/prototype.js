/* Structure prototype: in-memory examples only. No API, model or production storage. */
const ips = [
  {id:'orange',name:'橘子头',accounts:[{platform:'小红书',name:'橘子头'},{platform:'公众号',name:'橘子头'}]},
  {id:'zheme',name:'这么说',accounts:[{platform:'小红书',name:'这么说'}]}
];
const articles = [
  {id:'collect',ip:'orange',title:'收藏了很多，为什么还是用不上？',state:'writing',type:'个人感悟',body:'我最近在想一件事：收藏了那么多内容，为什么真正用到的时候，还是想不起来？\n\n也许我需要的不是再多收集一点，而是找到一个机会，把已经知道的东西用一次。\n\n这篇文章还没有写完。我想先弄清楚，自己究竟是在积累知识，还是在用收藏缓解焦虑。',revision:1,approved:false,imageApproved:false,messages:[],pending:null},
  {id:'practice',ip:'orange',title:'第一次整理自己的知识库',state:'planned',type:'教程 / 实战记',body:'',revision:1,approved:false,imageApproved:false,messages:[],pending:null},
  {id:'expression',ip:'zheme',title:'有些话，我想慢慢说清楚',state:'ready',type:'个人感悟',body:'有些想法，说出来的时候还没有形状。\n\n我想慢一点，把自己真正想说的话找出来，再把它写下来。',revision:1,approved:true,imageApproved:false,messages:[],pending:null}
];
const topics=[{ip:'orange',title:'为什么收藏之后很少再打开？'},{ip:'orange',title:'一次真正用上笔记的经历'},{ip:'zheme',title:'那些没有急着说出口的话'}];
const labels={planned:'准备写',writing:'正在写',ready:'待分发'};
let currentFilter='all',currentStage='body',toastTimer;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ipBy=id=>ips.find(i=>i.id===id);
const row=a=>`<a class="article-row" href="#article/${esc(a.id)}"><div class="article-name"><strong>${esc(a.title)}</strong><small>${esc(ipBy(a.ip).name)} · ${esc(a.type)}</small></div><span class="tag ${a.state==='ready'?'attention':''}">${labels[a.state]}</span></a>`;
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4200);}
function route(){
  const [view,id]=(location.hash.slice(1)||'home').split('/');
  const a=articles.find(a=>a.id===id),ip=ipBy(view==='article'?a?.ip:id);
  $('#nav').innerHTML=`<a class="nav-link ${view==='home'?'active':''}" href="#home">总览</a><div class="nav-label">我的 IP</div>${ips.map(i=>`<a class="nav-link ${ip?.id===i.id?'active':''}" href="#ip/${i.id}">${esc(i.name)}</a>`).join('')}`;
  $('#crumb').innerHTML=view==='home'?'全部 IP':`<a href="#home">总览</a> / ${ip?`<a href="#ip/${ip.id}">${esc(ip.name)}</a>`:''}${view==='article'?' / 文章':''}`;
  $('#main').classList.toggle('article-view',view==='article');
  if(view==='article'&&a)renderArticle(a);
  else if(view==='ip'&&ip)renderIp(ip);
  else renderHome();
}
function renderHome(){
  $('#main').innerHTML=`<div class="heading"><div><h1>总览</h1><p class="sub">${ips.length} 个 IP，${ips.reduce((n,i)=>n+i.accounts.length,0)} 个平台账号，${articles.length} 篇文章尚未完成分发</p></div><button class="primary" data-start="">开始写文章</button></div>
  <section class="section"><div class="section-head"><h2>IP 与平台账号</h2></div><div class="table-wrap"><table class="accounts-table"><thead><tr><th>IP</th><th>平台 / 账号</th><th class="num">粉丝</th><th class="num">阅读</th><th class="num">待分发文章</th></tr></thead><tbody>${ips.flatMap(i=>i.accounts.map((acc,k)=>`<tr><td>${k===0?`<a class="ip-name row-link" href="#ip/${i.id}">${esc(i.name)}</a>`:''}</td><td>${esc(acc.platform)}<div class="minor">${esc(acc.name)}</div></td><td class="num dim">—</td><td class="num dim">—</td><td class="num">${articles.filter(a=>a.ip===i.id&&a.state==='ready').length}</td></tr>`)).join('')}</tbody></table></div></section>
  <div class="home-bottom"><section class="section"><div class="section-head"><h2>还没完成的文章 · ${articles.length} 篇</h2></div>${articles.map(row).join('')}</section><section class="section"><div class="section-head"><h2>选题储备 · ${topics.length} 条</h2></div>${topics.map(t=>`<div class="topic-row"><a href="#ip/${t.ip}">${esc(t.title)}</a><span>${esc(ipBy(t.ip).name)}</span></div>`).join('')}</section></div>`;
  bindStart();
}
function renderIp(ip){
  const own=articles.filter(a=>a.ip===ip.id),shown=own.filter(a=>currentFilter==='all'||a.state===currentFilter);
  $('#main').innerHTML=`<div class="heading"><div><h1>${esc(ip.name)}</h1><p class="sub">${ip.accounts.map(a=>esc(a.platform)).join(' · ')} · ${own.length} 篇文章</p></div><button class="primary" data-start="${ip.id}">开始写文章</button></div>
  <div class="ip-context"><span>赛道：<b>待填写</b></span><span>面向谁：<b>待填写</b></span><span>语言风格：<b>边写边形成</b></span></div>
  <section class="section"><div class="section-head"><h2>文章</h2></div><div class="filters" aria-label="文章筛选">${[['all','全部'],['planned','准备写'],['writing','正在写'],['ready','待分发']].map(([v,n])=>`<button data-filter="${v}" class="${currentFilter===v?'active':''}" aria-pressed="${currentFilter===v}">${n} ${own.filter(a=>v==='all'||a.state===v).length}</button>`).join('')}</div>${shown.length?shown.map(row).join(''):'<p class="empty">这里暂时没有文章。</p>'}</section>
  <section class="section"><div class="section-head"><h2>选题储备 · ${topics.filter(t=>t.ip===ip.id).length} 条</h2></div>${topics.filter(t=>t.ip===ip.id).map(t=>`<div class="topic-row"><a href="#" data-topic="${esc(t.title)}">${esc(t.title)}</a><span>开始聊这篇</span></div>`).join('')}</section>`;
  bindStart();
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;renderIp(ip);});
  document.querySelectorAll('[data-topic]').forEach(b=>b.onclick=e=>{e.preventDefault();openStart(ip.id,b.dataset.topic);});
}
function renderArticle(a){
  const ip=ipBy(a.ip);
  $('#main').innerHTML=`<div class="heading article-head"><div><h1>写文章</h1><p class="sub">${esc(ip.name)} · ${esc(a.type)} · ${a.approved?'正文已确认':'正文待确认'}</p></div><button class="text" id="backIp">返回 IP</button></div>
  <nav class="stage-nav" aria-label="文章工作区">${[['body','正文与讨论'],['images','配图'],['publish','排版与分发']].map(([v,n])=>`<button class="${currentStage===v?'active':''}" data-stage="${v}" aria-pressed="${currentStage===v}">${n}</button>`).join('')}</nav>
  <div id="stagePanel"></div><div class="mobile-tabs" aria-label="文章与聊天切换"><button class="active" data-pane="document">文章</button><button data-pane="chat">聊天</button></div>
  <div class="writing-grid"><section class="document" aria-label="当前母稿"><div class="doc-toolbar"><span>当前母稿</span><span id="saveStatus" role="status">页面演示 · 刷新后重置</span></div><input class="editor-title" id="articleTitle" aria-label="文章标题" value="${esc(a.title)}"><textarea class="body-editor" id="articleBody" aria-label="文章正文" placeholder="从右侧聊起，确认后的文章会在这里。你也可以直接写。">${esc(a.body)}</textarea><div class="document-footer"><p id="approvalNote">${a.approved?'这版正文已经确认，可以开始配图。':'看完正文，觉得意思和表达都对了，再进入配图。'}</p><button id="approveBody">${a.approved?'查看配图':'正文确认，开始配图'}</button></div></section>
  <aside class="chat" aria-label="围绕文章的对话"><div class="chat-header"><h2>一起把这篇写清楚</h2><span class="minor">演示对话</span></div><div class="messages" id="messages"></div><form class="composer" id="chatForm"><textarea id="chatInput" aria-label="告诉写作搭档你的想法" placeholder="继续说你的想法，或者告诉我哪一段不对。" required></textarea><div class="composer-foot"><span>建议确认后才写入母稿</span><button class="primary" type="submit">发送</button></div></form></aside></div>`;
  $('#backIp').onclick=()=>location.hash=`ip/${ip.id}`;
  document.querySelectorAll('[data-stage]').forEach(b=>b.onclick=()=>{currentStage=b.dataset.stage;renderArticle(a);});
  document.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>{document.querySelector('.writing-grid').classList.toggle('show-chat',b.dataset.pane==='chat');document.querySelectorAll('[data-pane]').forEach(x=>x.classList.toggle('active',x===b));});
  const edit=()=>{
    a.title=$('#articleTitle').value;a.body=$('#articleBody').value;a.revision++;a.approved=false;a.imageApproved=false;a.state='writing';
    $('#saveStatus').textContent='已保留在当前页面 · AI 建议需基于这版';$('#approvalNote').textContent='正文有改动，需要重新确认；已有图片会保留。';$('#approveBody').textContent='正文确认，开始配图';
    if(a.pending)renderMessages(a);
    $('.article-head .sub').textContent=`${ip.name} · ${a.type} · 正文待确认`;
    if(currentStage!=='body')renderStage(a);
  };
  $('#articleTitle').oninput=edit;$('#articleBody').oninput=edit;
  $('#approveBody').onclick=()=>{if(!a.body.trim()){toast('先写出正文，再确认。');return;}a.approved=true;a.state='ready';currentStage='images';renderArticle(a);};
  $('#chatForm').onsubmit=e=>{e.preventDefault();const text=$('#chatInput').value.trim();if(!text)return;a.messages.push({role:'user',text});a.messages.push({role:'assistant',text:`收到。当前母稿是你刚刚编辑的这一版。\n\n这是结构演示：正式接入后，我会围绕你的意思继续追问或拟稿。这里先用一段固定建议，让你体验“先看建议，再采用”。`});a.pending={revision:a.revision,text:a.body?`${a.body}\n\n比起再存一条，也许可以先问自己：这次，我准备用它做什么？`:'有些想法，一开始只是零散的几句话。\n\n我想把它们慢慢说清楚，再写成一篇属于自己的文章。'};$('#chatInput').value='';renderMessages(a);};
  renderMessages(a);renderStage(a);
}
function renderMessages(a){
  const intro=a.body?'我想先听你说：这篇文章里，哪一个意思是你最想留下来的？你可以继续聊，也可以直接改左边的文章。':'先不用想文章结构。你想说什么，或者遇到了什么事？';
  $('#messages').innerHTML=`<div class="message"><div class="who">写作搭档</div><p>${esc(intro)}</p></div>${a.messages.map(m=>`<div class="message ${m.role==='user'?'user':''}"><div class="who">${m.role==='user'?'你':'写作搭档'}</div><p>${esc(m.text)}</p></div>`).join('')}${a.pending?`<div class="suggestion"><strong>拟写内容 · ${a.pending.revision===a.revision?'待你确认':'正文已改，这份建议已过期'}</strong><p>${esc(a.pending.text)}</p><button id="accept" ${a.pending.revision!==a.revision?'disabled':''}>采用到母稿</button> <button class="text" id="dismiss">暂不采用</button></div>`:''}`;
  if(a.pending){$('#dismiss').onclick=()=>{a.pending=null;renderMessages(a);};$('#accept').onclick=()=>{if(a.pending.revision!==a.revision)return;a.body=a.pending.text;a.pending=null;a.revision++;a.approved=false;a.imageApproved=false;a.state='writing';renderArticle(a);toast('已采用到演示母稿。');};}
  $('#messages').scrollTop=$('#messages').scrollHeight;
}
function renderStage(a){
  const panel=$('#stagePanel');
  if(currentStage==='body'){panel.innerHTML='';return;}
  if(currentStage==='images'){
    panel.innerHTML=`<section class="stage-detail"><h2>这篇文章的配图</h2><p>${a.approved?'正文已确认。先讨论需要什么图，再确认图片。':'正文还未确认。可以查看这里，确认正文后再开始配图。'}</p><label for="imageInput">导入一张图片，体验配图位置</label><input id="imageInput" type="file" accept="image/*" ${!a.approved?'disabled':''}>${a.imageUrl?`<img src="${esc(a.imageUrl)}" alt="当前文章的演示配图">`:''}<p>${a.imageApproved?'配图已确认。':'图片仅用于当前页面预览。'}</p><button id="approveImage" ${!a.approved||!a.imageUrl?'disabled':''}>图片确认，去排版</button></section>`;
    $('#imageInput').onchange=e=>{const file=e.target.files[0];if(!file)return;if(!file.type.startsWith('image/')){toast('请选择图片文件。');return;}if(a.imageUrl)URL.revokeObjectURL(a.imageUrl);a.imageUrl=URL.createObjectURL(file);a.imageApproved=false;renderStage(a);};
    $('#approveImage').onclick=()=>{a.imageApproved=true;currentStage='publish';renderArticle(a);};
  }else{
    panel.innerHTML=`<section class="stage-detail"><h2>同一篇母稿，分发到不同账号</h2><p>${a.imageApproved?'图片已确认。下面是各平台的分发位置。':'可以先查看分发位置，正文和配图确认后再准备发布。'}</p><div class="platforms">${ipBy(a.ip).accounts.map((acc,k)=>`<div class="platform-row"><div><strong>${esc(acc.platform)} · ${esc(acc.name)}</strong><p>复用当前母稿 · 尚未发布</p></div><button data-platform="${k}" ${!a.imageApproved?'disabled':''}>查看排版</button></div>`).join('')}</div><p class="minor">此处只展示结构，不进行真实排版或发布。</p><div id="platformPreview"></div></section>`;
    document.querySelectorAll('[data-platform]').forEach(b=>b.onclick=()=>{$('#platformPreview').innerHTML=`<h3>${esc(ipBy(a.ip).accounts[Number(b.dataset.platform)].platform)}预览位置</h3><p>这里将放平台排版、必要适配建议和发布结果。母稿仍保留在下方。</p>`;});
  }
}
function bindStart(){document.querySelectorAll('[data-start]').forEach(b=>b.onclick=()=>openStart(b.dataset.start));}
function openStart(ip='',idea=''){$('#startIp').innerHTML=ips.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('');if(ip)$('#startIp').value=ip;$('#idea').value=idea;$('#start').showModal();$('#idea').focus();}
$('#closeStart').onclick=()=>$('#start').close();
$('#startForm').onsubmit=e=>{e.preventDefault();const idea=$('#idea').value.trim();if(!idea)return;const a={id:`new-${articles.length}`,ip:$('#startIp').value,title:'还没起标题的文章',state:'writing',type:'尚未确定类型',body:'',revision:1,approved:false,imageApproved:false,pending:null,messages:[{role:'user',text:idea},{role:'assistant',text:'这是结构演示。正式写作前，我会先和你明确这个 IP 的赛道和读者，再围绕你刚才的想法聊下去。'}]};articles.unshift(a);$('#start').close();currentStage='body';location.hash=`article/${a.id}`;};
window.addEventListener('hashchange',()=>{currentStage='body';route();});route();
