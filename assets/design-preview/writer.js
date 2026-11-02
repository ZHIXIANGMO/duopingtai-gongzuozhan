// Focused writing prototype: left = editable artifact, right = conversation and actions.
function initWriter(d){
 if(d.writer)return;
 d.writer={selected:'mother',versions:[],phase:'writing',targets:[],image:null,pendingImage:false,source:{type:'skill',value:''},reviewRevision:null,
  messages:[{role:'ai',text:d.text?'这篇的内核已经有了：从收藏知识，转向真正用一次。\n\n你可以直接改左边，或者告诉我哪里不像你。等母稿满意了，再说想发到哪些平台。':'先说说你想表达什么，不用先想文章结构。我会跟着你，把这篇慢慢写出来。'}]};
}
function writerCurrent(){return draft.writer.selected==='mother'?draft:draft.writer.versions.find(v=>v.id===draft.writer.selected)||draft;}
function renderWrite(){
 initWriter(draft);
 document.querySelector('.app-frame').classList.add('writing-mode');
 $('#screen').innerHTML=`<div class="writer-layout"><section class="manuscript" aria-label="文章编辑区"><div class="manuscript-bar"><div class="document-versions" role="tablist" aria-label="文章版本" id="documentVersions"></div><span class="document-state" id="documentState" role="status">页面内演示</span></div><div class="manuscript-scroll"><article class="manuscript-paper"><div class="paper-context" id="paperContext"></div><h1><span id="writerTitle" contenteditable="true" role="textbox" aria-label="文章标题" spellcheck="false"></span></h1><div id="writerBody" contenteditable="true" role="textbox" aria-label="文章正文" aria-multiline="true" spellcheck="false"></div></article></div></section><section class="writing-assistant" aria-label="文章对话区"><header class="assistant-heading"><div><h2>${esc(ip.name)}的写作搭档</h2><span>想法、改稿、配图和分发，都在这里聊。</span></div><button id="imageSource" class="ghost">配图工具</button></header><div class="assistant-scroll"><div id="writerMessages" class="writer-messages"></div><div id="writerActions" class="writer-actions" aria-live="polite"></div></div><form id="writerComposer" class="writer-composer"><label class="visually-hidden" for="writerInput">告诉写作搭档你的想法</label><textarea id="writerInput" placeholder="继续聊，或说：这篇发小红书和公众号。" rows="3" required></textarea><div class="writer-send"><span>交互演示 · 不调用真实接口</span><button type="submit" class="primary">发送</button></div></form></section></div><div class="writer-mobile-switch"><button data-writer-pane="document" class="active">文章</button><button data-writer-pane="chat">对话与操作</button></div>`;
 renderWriterDocument();renderWriterConversation();
 $('#imageSource').onclick=writerSourceDialog;
 $('#writerComposer').onsubmit=e=>{e.preventDefault();const input=$('#writerInput').value.trim();if(!input)return;$('#writerInput').value='';writerCommand(input);};
 document.querySelectorAll('[data-writer-pane]').forEach(b=>b.onclick=()=>{document.querySelector('.writer-layout').classList.toggle('mobile-chat',b.dataset.writerPane==='chat');document.querySelectorAll('[data-writer-pane]').forEach(x=>x.classList.toggle('active',x===b));});
}
function renderWriterDocument(){
 const w=draft.writer,doc=writerCurrent();
 $('#documentVersions').innerHTML=[{id:'mother',label:'母稿'},...w.versions.map(v=>({id:v.id,label:v.platform}))].map(v=>`<button role="tab" aria-selected="${w.selected===v.id}" data-document="${v.id}" class="${w.selected===v.id?'active':''}">${esc(v.label)}</button>`).join('');
 document.querySelectorAll('[data-document]').forEach(b=>b.onclick=()=>{w.selected=b.dataset.document;renderWriterDocument();});
 $('#paperContext').textContent=w.selected==='mother'?`${ip.name} · ${draft.kind}`:`${ip.name} · ${doc.platform}版本${doc.baseRevision!==draft.revision?' · 母稿已变，需要重新生成':''}`;
 $('#writerTitle').textContent=doc.title;
 $('#writerBody').innerHTML=writerBodyHtml(doc);
 $('#writerTitle').oninput=()=>{doc.title=$('#writerTitle').innerText;writerEdited(doc);};
 $('#writerTitle').onkeydown=e=>{if(e.key==='Enter')e.preventDefault();};
 $('#writerBody').oninput=()=>{const body=$('#writerBody');doc.text=body.innerText.trim();if(!body.querySelector('img'))doc.inlineImage=null;writerEdited(doc);};
 $('#documentState').textContent=w.selected==='mother'?'当前母稿':w.phase==='distributed'?'已分发 · 待发布':w.phase==='published'?'发布完成（模拟）':'平台稿 · 待你检查';
}
function writerBodyHtml(doc){
 const paragraphs=(doc.text||'').split(/\n\s*\n/).filter(Boolean);
 let html=paragraphs.map((p,k)=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>${doc.inlineImage&&k===Math.min(1,paragraphs.length-1)?`<figure contenteditable="false"><img src="${esc(doc.inlineImage)}" alt="从收藏笔记到付诸行动的 AI 示例配图" width="1536" height="1024"></figure>`:''}`).join('');
 return html||'<p><br></p>';
}
function writerEdited(doc){
 const w=draft.writer;
 if(doc===draft){draft.revision++;draft.approved=false;draft.status='正在写';if(w.versions.length)w.phase='stale';}
 else{doc.edited=true;if(['review','confirm','distributed','published'].includes(w.phase))w.phase='review';}
 w.reviewRevision=null;
 $('#documentState').textContent='已保留在当前演示中';renderWriterActions();
}
function writerSay(text){draft.writer.messages.push({role:'ai',text});}
function renderWriterConversation(){
 const w=draft.writer;
 $('#writerMessages').innerHTML=w.messages.map(m=>`<div class="writer-message ${m.role==='user'?'from-user':''}"><span>${m.role==='user'?'你':'写作搭档'}</span><p>${esc(m.text)}</p></div>`).join('');
 renderWriterActions();
 const scroller=document.querySelector('.assistant-scroll');scroller.scrollTop=scroller.scrollHeight;
}
function writerCommand(text){
 const w=draft.writer;w.messages.push({role:'user',text});
 const targets=ip.accounts.filter(a=>text.includes(a.platform));
 if(targets.length){w.targets=[...new Set(targets.map(a=>a.platform))];w.phase='choose';writerSay(`准备投到${w.targets.join('和')}。先用同一篇母稿生成平台版本，保留你的观点与经历，再处理平台的标题、长度和表达。\n\n你看过左边的内容后，再决定分发。`);}
 else if(/配图|配.{0,4}图|插图|图片|画一/.test(text)){w.pendingImage=true;writerSay('我先准备一张图，给你看过后再插进当前文章。正式接入时，会使用你在“配图工具”里指定的技能、API 或地址。');}
 else if(/分发|发布|发出去/.test(text)&&w.versions.length){w.phase='confirm';w.reviewRevision=draft.revision;writerSay('先确认要分发的账号和版本。分发后是待发布状态，平台真正发出以后才算发布完成。');}
 else{w.phase='suggestion';w.suggestion={baseRevision:draft.revision,text:draft.text?draft.text+'\n\n也许不用再等资料齐全。今天，就找一条笔记，用它解决一件小事。':'我想先把这次的经历说清楚。\n\n有些想法，说出来的时候还零散。慢慢聊，才知道自己真正想留下来的是什么。'};writerSay('我先展示一段拟写内容。你觉得贴合自己的意思，再采用到母稿；你也可以继续补充。');}
 renderWriterConversation();
}
function renderWriterActions(){
 const w=draft.writer,host=$('#writerActions');
 if(w.pendingImage){
 host.innerHTML=`<div class="image-suggestion"><img src="writer-illustration.png" alt="AI 生成的笔记与行动主题示例插图" width="1536" height="1024"><p>AI 示例图 · ${esc(w.source.value?'已指定配图来源，原型暂不调用':'尚未连接你的配图工具')}</p><div class="button-row"><button class="primary" id="insertWriterImage">插入当前文章</button><button id="cancelWriterImage">暂不使用</button></div></div>`;
 $('#insertWriterImage').onclick=()=>{const doc=writerCurrent();doc.inlineImage='writer-illustration.png';w.pendingImage=false;writerEdited(doc);writerSay('图片已经插进左边这篇文章。你可以继续改正文，或告诉我打算发到哪个平台。');renderWriterDocument();renderWriterConversation();};
 $('#cancelWriterImage').onclick=()=>{w.pendingImage=false;renderWriterActions();};return;
 }
 if(w.phase==='suggestion'&&w.suggestion){
 const stale=w.suggestion.baseRevision!==draft.revision;
 host.innerHTML=`<div class="text-suggestion"><p>${esc(w.suggestion.text)}</p><button class="primary" id="adoptWriterText" ${stale?'disabled':''}>${stale?'母稿已修改，请重新拟写':'采用到母稿'}</button><button class="ghost" id="dismissWriterText">继续聊，先不采用</button></div>`;
 $('#adoptWriterText').onclick=()=>{if(w.suggestion.baseRevision!==draft.revision)return;draft.text=w.suggestion.text;draft.revision++;draft.approved=false;draft.status='正在写';w.selected='mother';w.phase=w.versions.length?'stale':'writing';w.suggestion=null;renderWriterDocument();writerSay('已放进母稿，我们继续改。');renderWriterConversation();};
 $('#dismissWriterText').onclick=()=>{w.phase='writing';w.suggestion=null;renderWriterActions();};return;
 }
 if(w.phase==='choose'){
 host.innerHTML=`<div class="distribution-choice"><p>这篇准备发到</p><div class="target-options">${ip.accounts.map((a,k)=>`<label><input type="checkbox" data-target="${esc(a.platform)}" ${w.targets.includes(a.platform)?'checked':''}>${esc(a.platform)}<span>${esc(a.name)}</span></label>`).join('')}</div><button class="primary" id="generateWriterVersions">生成平台内容</button></div>`;
 document.querySelectorAll('[data-target]').forEach(c=>c.onchange=()=>{w.targets=[...new Set([...document.querySelectorAll('[data-target]:checked')].map(x=>x.dataset.target))];$('#generateWriterVersions').disabled=!w.targets.length;});
 $('#generateWriterVersions').onclick=generateWriterVersions;return;
 }
 if(w.phase==='review'){
 host.innerHTML=`<div class="distribution-choice"><p>${w.versions.map(v=>esc(v.platform)).join('、')}的版本在左边。</p><span class="muted small">逐个查看和修改，母稿会保留。</span><div class="button-row"><button class="primary" id="reviewWriterVersions">内容没问题，准备分发</button><button class="ghost" id="redoWriterVersions">重新生成</button></div></div>`;
 $('#reviewWriterVersions').onclick=()=>{if(w.versions.some(v=>v.baseRevision!==draft.revision)){w.phase='stale';renderWriterActions();return;}w.phase='confirm';w.reviewRevision=draft.revision;writerSay('内容已确认。下面是这次分发的账号，分发和发布分别记录。');renderWriterConversation();};
 $('#redoWriterVersions').onclick=()=>{w.phase='choose';renderWriterActions();};return;
 }
 if(w.phase==='stale'){
 host.innerHTML=`<div class="distribution-choice"><p>母稿有变化，平台内容需要重新确认。</p><button class="primary" id="refreshWriterVersions">基于当前母稿重新生成</button></div>`;
 $('#refreshWriterVersions').onclick=generateWriterVersions;return;
 }
 if(w.phase==='confirm'){
 if(w.versions.some(v=>v.baseRevision!==draft.revision)){w.phase='stale';renderWriterActions();return;}
 host.innerHTML=`<div class="distribution-choice"><h3>确认分发</h3>${w.targets.map(p=>`<div class="delivery-row"><div><strong>${esc(p)}</strong><span>${esc(ip.accounts.find(a=>a.platform===p)?.name||ip.name)}</span></div><span>内容已确认</span></div>`).join('')}<p class="small muted">原型不连接平台。分发后，仍需在平台完成发布。</p><button class="primary" id="dispatchWriter">确认分发（演示）</button><button class="ghost" id="backWriterReview">返回检查内容</button></div>`;
 $('#dispatchWriter').onclick=()=>{if(w.reviewRevision!==draft.revision){w.phase='stale';renderWriterActions();return;}w.phase='distributed';draft.status='待发布';writerSay('已模拟分发到对应账号，当前是“待发布”。原型没有发送任何内容到平台。');renderWriterDocument();renderWriterConversation();};
 $('#backWriterReview').onclick=()=>{w.phase='review';renderWriterActions();};return;
 }
 if(w.phase==='distributed'||w.phase==='published'){
 host.innerHTML=`<div class="distribution-choice"><h3>${w.phase==='distributed'?'已分发 · 待发布':'发布完成（模拟）'}</h3>${w.targets.map(p=>`<div class="delivery-row"><strong>${esc(p)}</strong><span>${w.phase==='distributed'?'待发布':'已发布（模拟）'}</span></div>`).join('')}${w.phase==='distributed'?'<button id="simulateWriterPublish">模拟平台发布完成</button>':'<p class="small muted">这里只演示发布后的显示状态。</p>'}</div>`;
 if($('#simulateWriterPublish'))$('#simulateWriterPublish').onclick=()=>{w.phase='published';draft.status='已发布（模拟）';writerSay('现在展示的是发布完成的模拟状态。正式版本只有在平台确认发出后，才会标成已发布。');renderWriterDocument();renderWriterConversation();};return;
 }
 host.innerHTML=`<div class="conversation-shortcuts"><button id="askWriterImage">给这篇配图</button><button id="askWriterPlatforms">${ip.accounts.length?'准备发到哪些平台':'先添加平台账号'}</button></div>`;
 $('#askWriterImage').onclick=()=>writerCommand('给当前文章配一张图。');
 $('#askWriterPlatforms').onclick=()=>{if(!ip.accounts.length){location.hash=link('accounts');return;}writerCommand('这篇准备发到'+ip.accounts.map(a=>a.platform).join('和')+'。');};
}
function generateWriterVersions(){
 const w=draft.writer;if(!draft.text.trim()){writerSay('母稿还没有正文。先把想说的话写出来，再生成平台内容。');w.phase='writing';renderWriterConversation();return;}
 if(!w.targets.length){w.phase='choose';renderWriterActions();return;}
 w.versions=w.targets.map((p,k)=>({id:'version'+k,platform:p,title:draft.title,text:p==='小红书'?draft.text+'\n\n你怎么看？也想听听你的经历。':draft.text,inlineImage:draft.inlineImage||null,baseRevision:draft.revision}));
 w.selected=w.versions[0].id;w.phase='review';w.reviewRevision=null;
 writerSay('平台内容已在左边展开。点上方的版本名查看，也能直接修改。母稿仍是独立的那一份，不会被平台内容覆盖。');renderWriterDocument();renderWriterConversation();
}
function writerSourceDialog(){
 const w=draft.writer;
 modal('配图工具',`<p class="help">指定生成图片的来源。此原型只保存选择，不连接外部服务。</p><div class="field section"><label for="writerSourceType">来源类型</label><select id="writerSourceType"><option value="skill">技能</option><option value="api">API</option><option value="url">工具地址</option></select></div><div class="field"><label for="writerSourceValue">技能指令或接口地址</label><textarea id="writerSourceValue" placeholder="粘贴技能指令或地址，不要在原型中填密钥。">${esc(w.source.value)}</textarea></div><button class="primary" type="submit">使用这个来源</button>`,()=>{w.source={type:$('#writerSourceType').value,value:$('#writerSourceValue').value.trim()};closeModal();writerSay('配图来源已记录在当前演示中。正式接入后会使用这个来源；当前仍展示预先生成的 AI 示例图。');renderWriterConversation();});
 $('#writerSourceType').value=w.source.type;
}
