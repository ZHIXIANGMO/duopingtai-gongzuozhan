const DRAFT_ID = new URLSearchParams(location.search).get('id') || '';
let VIEW = null, HISTORY = [], BUSY = false, PREVIEW = false, LOCK_EDIT = false;
const recoveryKey = 'editing:' + DRAFT_ID;
const pendingPrefix = 'pending-chat:' + DRAFT_ID + ':';
const section = (text, name) => {
  const names = ['素材','正文','这版改了什么','人工意见','配图','排版','复盘','必须写进去的细节'];
  let current = '', lines = [];
  for(const line of (text || '').split('\n')){
    if(line.startsWith('## ') && names.includes(line.slice(3).trim())) current = line.slice(3).trim();
    else if(current === name) lines.push(line);
  }
  return lines.join('\n').trim();
};
function dirty(){ return VIEW && ($('#bodyEditor').value !== VIEW['正文'] || $('#materialEditor').value !== section(VIEW.item['正文'],'素材')); }
function status(text){ $('#status').textContent = text; }
function backup(){
  if(!VIEW) return;
  try{sessionStorage.setItem(recoveryKey, JSON.stringify({body:$('#bodyEditor').value, materials:$('#materialEditor').value, revision:VIEW.revision}));}catch(e){}
}
function updateStatus(){ status(dirty() ? '有未保存修改' : VIEW['已确认'] ? '正文已确认' : '已保存'); }
function setView(view){
  VIEW = view; $('#bodyEditor').value = view['正文']; $('#materialEditor').value = section(view.item['正文'],'素材');
  $('#bodyPreview').innerHTML = renderMd(view['正文']);
  $('#assets').innerHTML = view['文件'].map(f=>`<a href="${esc(f['地址'])}" target="_blank" rel="noopener">${esc(f['名字'])}</a>`).join('');
  $('#confirmBody').textContent = view['已确认'] ? '正文已确认' : '正文满意，确认';
  backup(); updateStatus(); renderMessages();
}
function setBusy(on){
  BUSY=on;
  for(const id of ['save','saveMaterials','confirmBody','generate','send','reloadDraft','retryChat']) $('#'+id).disabled=on;
  $('#assetInput').disabled=on;
  renderMessages();
}
async function saveAll(){
  $('#bodyEditor').readOnly = $('#materialEditor').readOnly = true;
  try{
    const body=$('#bodyEditor').value, materials=$('#materialEditor').value;
    if(body !== VIEW['正文']){
      const result=await postJSON('/api/draft',{id:DRAFT_ID, revision:VIEW.revision, 内容:body});
      VIEW=result; $('#bodyEditor').value=result['正文'];
    }
    if(materials !== section(VIEW.item['正文'],'素材')) VIEW=await postJSON('/api/draft',{id:DRAFT_ID,revision:VIEW.revision,小节:'素材',内容:materials});
    setView(VIEW);
  }finally{ $('#bodyEditor').readOnly = $('#materialEditor').readOnly = LOCK_EDIT; }
}
async function action(fn, lockEdit=true){
  if(BUSY || !VIEW) return;
  setBusy(true);
  LOCK_EDIT=lockEdit; $('#bodyEditor').readOnly=$('#materialEditor').readOnly=lockEdit;
  try{await fn();}catch(e){backup();status(e.message);}finally{LOCK_EDIT=false;$('#bodyEditor').readOnly=$('#materialEditor').readOnly=false;setBusy(false);}
}
function messageHTML(m, index, readonly=false){
  return `<div class="writer-message"><strong>${m.role==='user'?'你':'AI'}</strong><div class="doc">${renderMd(m.content)}</div>${readonly?'':(m['写入']||[]).map((w,j)=>{
    const stale=!w.revision || w.revision!==VIEW.revision || dirty();
    return `<div class="suggestion"><p>${w.kind==='稿件'?'拟写正文':'选题修改建议'} · ${stale?'已失效，请基于最新内容重新讨论':'待你确认'}</p><div class="doc">${w.kind==='稿件'?renderMd(w['正文']):`<pre>${esc(JSON.stringify(w['字段'],null,2))}</pre>`}</div><button class="btn" data-apply="${index}:${j}" ${stale||BUSY?'disabled':''}>采用这份建议</button></div>`;
  }).join('')}</div>`;
}
function renderMessages(){
  if(!VIEW) return;
  const host=$('#messages'), bottom=host.scrollHeight-host.scrollTop-host.clientHeight<80;
  host.innerHTML=HISTORY.length?HISTORY.map((m,i)=>messageHTML(m,i)).join(''):'<p>从一个想法、一段经历，或一句还没想清楚的话开始。</p>';
  host.querySelectorAll('[data-apply]').forEach(b=>b.onclick=()=>action(async()=>{
    const [i,j]=b.dataset.apply.split(':').map(Number), w=HISTORY[i]['写入'][j];
    if(dirty()) throw new Error('请先保存修改，再重新讨论');
    setView(await postJSON('/api/apply_suggestion',{id:DRAFT_ID,revision:w.revision,建议:w}));
  }));
  if(bottom) host.scrollTop=host.scrollHeight;
}
function pending(){
  const out=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(k.startsWith(pendingPrefix)){try{out.push([k,JSON.parse(localStorage.getItem(k))]);}catch(e){}}
  }
  return out.sort((a,b)=>(a[1].time||'').localeCompare(b[1].time||''));
}
async function flushChat(){
  try{
    for(const [key,m] of pending()){
      await postJSON('/api/chatlog',{kind:'稿件',id:DRAFT_ID,mode:'append',消息:m});
      localStorage.removeItem(key);
    }
    $('#chatStatus').textContent=''; $('#retryChat').hidden=true;
  }catch(e){$('#retryChat').hidden=false;$('#chatStatus').textContent='对话尚未保存到文件，已暂存在本浏览器。请重试保存。';throw e;}
}
async function persistMessage(m){
  m.message_id=crypto.randomUUID(); m.time=new Date().toISOString();
  HISTORY.push(m);
  try{localStorage.setItem(pendingPrefix+m.message_id,JSON.stringify(m));}
  catch(e){$('#chatStatus').textContent='浏览器缓存不可用，请保留当前对话';throw e;}
  renderMessages(); await flushChat();
}
async function ask(generate=false){
  await action(async()=>{
    await saveAll(); await flushChat();
    const input=$('#messageInput'), text=input.value.trim();
    if(!generate && !text) return;
    if(text){await persistMessage({role:'user',content:text});input.value='';}
    $('#chatStatus').textContent='正在思考…';
    let completed=null;
    await chatStream('稿件',DRAFT_ID,HISTORY.map(m=>({role:m.role,content:m.content})),{
      onDelta(full){$('#chatStatus').textContent=full.slice(-240);},
      onDone(writes,full,meta){completed={writes,full,meta};}
    },{generate,instructions:text});
    if(!completed) throw new Error('没有收到完整回答');
    let {writes,full,meta}=completed;
    if(generate) writes=[{kind:'稿件',id:DRAFT_ID,正文:full,字段:{},revision:meta.revision,target_revision:meta.revision}];
    await persistMessage({role:'assistant',content:generate?'拟稿已完成，请先阅读再采用。':full,写入:writes});
    $('#messages').scrollTop=$('#messages').scrollHeight;
  },false);
}
$('#save').onclick=$('#saveMaterials').onclick=()=>action(saveAll);
$('#retryChat').onclick=()=>action(flushChat);
$('#confirmBody').onclick=()=>action(async()=>{await saveAll();setView(await postJSON('/api/confirm_body',{id:DRAFT_ID,revision:VIEW.revision}));});
$('#reloadDraft').onclick=()=>action(async()=>{
  if(dirty()&&!confirm('当前修改未保存。确定放弃这些修改并读取磁盘上的版本？')) return;
  setView(await getJSON('/api/draft?id='+encodeURIComponent(DRAFT_ID)));
});
$('#preview').onclick=()=>{PREVIEW=!PREVIEW;$('#bodyPreview').innerHTML=renderMd($('#bodyEditor').value);$('#bodyPreview').hidden=!PREVIEW;$('#bodyEditor').hidden=PREVIEW;$('#preview').textContent=PREVIEW?'继续编辑':'预览';};
for(const id of ['bodyEditor','materialEditor']) $('#'+id).addEventListener('input',()=>{backup();updateStatus();renderMessages();});
$('#chatForm').onsubmit=e=>{e.preventDefault();ask();};
$('#generate').onclick=()=>ask(true);
$('#assetInput').onchange=()=>action(async()=>{
  const file=$('#assetInput').files[0]; if(!file) return;
  if(file.size>20*1024*1024) throw new Error('附件不能超过 20MB');
  await saveAll();
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
  await postJSON('/api/asset',{稿件:DRAFT_ID,名字:file.name,数据:data});
  setView(await getJSON('/api/draft?id='+encodeURIComponent(DRAFT_ID)));$('#assetInput').value='';
});
document.querySelectorAll('[data-pane]').forEach(b=>{if(b.tagName==='BUTTON')b.onclick=()=>{document.querySelector('.writer-grid').dataset.pane=b.dataset.pane;document.querySelectorAll('.writer-mobile button').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));};});
window.addEventListener('beforeunload',e=>{if(dirty()||BUSY||pending().length){e.preventDefault();e.returnValue='';}});
(async()=>{
  try{
    const state=await boot('work'); if(!state) throw new Error('无法读取工作台');
    const recovered=sessionStorage.getItem(recoveryKey);
    setView(await getJSON('/api/draft?id='+encodeURIComponent(DRAFT_ID)));
    // 文章以自身绑定的 IP 为准，与浏览器当前筛选无关。
    const scoped=await getJSON('/api/state?ident='+encodeURIComponent(VIEW.IP.id));renderSide(scoped,'work');
    const topic=scoped['选题'].find(t=>t.id===VIEW.item['选题']);
    $('#title').textContent=(topic?.['标题候选']||'未命名文章').split('|')[0];
    $('#ipLink').textContent=VIEW.IP['名称']+' · 编辑人设';$('#ipLink').href='persona.html?id='+encodeURIComponent(VIEW.IP.id);
    if(recovered){const r=JSON.parse(recovered);if(r.body!==VIEW['正文']||r.materials!==section(VIEW.item['正文'],'素材')){
      $('#bodyEditor').value=r.body;$('#materialEditor').value=r.materials;
      if(r.revision!==VIEW.revision) VIEW.revision=r.revision;
      status('已恢复本页未保存文字；如磁盘版本已变，请保留文字后重新载入');
    }}
    const legacyKey='chat:稿件:'+DRAFT_ID, legacy=localStorage.getItem(legacyKey);
    if(legacy){await postJSON('/api/chatlog',{kind:'稿件',id:DRAFT_ID,mode:'migrate',消息:JSON.parse(legacy)}); /* 保留旧缓存以便人工恢复 */}
    try{await flushChat();}catch(e){}
    const chat=await getJSON('/api/chatlog?id='+encodeURIComponent(DRAFT_ID));
    HISTORY=chat['对话'];for(const [,m] of pending()) if(!HISTORY.some(x=>x.message_id===m.message_id)) HISTORY.push(m);
    $('#archives').hidden=!chat['归档'].length;
    for(const a of chat['归档']){const b=document.createElement('button');b.className='btn';b.textContent=a['时间'];b.onclick=async()=>{try{const old=await getJSON('/api/chatlog?id='+encodeURIComponent(DRAFT_ID)+'&file='+encodeURIComponent(a['文件']));$('#archiveContent').innerHTML=old['对话'].map((m,i)=>messageHTML(m,i,true)).join('');}catch(e){status(e.message);}};$('#archiveList').append(b);}
    renderMessages();
  }catch(e){status(e.message);}
})();
