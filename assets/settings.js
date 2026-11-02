let CONFIG = null;
let DIRTY = false;
const configStatus = text => { $('#configStatus').textContent = text; };
const configId = prefix => prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
function collectConfig(){
  document.querySelectorAll('[data-model]').forEach(el => {
    const m = CONFIG['模型列表'].find(m => m.id === el.dataset.model);
    el.querySelectorAll('[data-key]').forEach(f => m[f.dataset.key] = f.value.trim());
    m['技能'] = Array.from(el.querySelectorAll('[data-skill]:checked'), x => x.dataset.skill);
    if(el.querySelector('[name="activeModel"]').checked) CONFIG['当前模型'] = m.id;
  });
  document.querySelectorAll('[data-skill-editor]').forEach(el => {
    const s = CONFIG['技能'].find(s => s.id === el.dataset.skillEditor);
    s['名称'] = el.querySelector('[data-name]').value.trim();
    s['内容'] = el.querySelector('[data-content]').value;
  });
}
function renderConfig(){
  $('#models').innerHTML = CONFIG['模型列表'].map(m => `<fieldset class="config-item" data-model="${esc(m.id)}">
    <legend>${esc(m['名称'] || '新模型')}</legend>
    <label class="config-check"><input type="radio" name="activeModel" ${m.id === CONFIG['当前模型'] ? 'checked' : ''}> 当前使用</label>
    <div class="config-grid">
      ${[['名称','名称','例如：日常写作'],['接口','接口地址','https://api.deepseek.com'],['模型名','模型 ID','deepseek-flash']].map(([k,l,p]) => `<label>${l}<input required data-key="${k}" value="${esc(m[k])}" placeholder="${p}"></label>`).join('')}
      <label>API Key<input type="password" data-key="api_key" value="${esc(m.api_key || '')}" autocomplete="new-password" placeholder="${m['已配置密钥'] ? '已保存，留空保持原密钥' : '填写 API Key'}"></label>
      <label class="config-wide">代理（选填）<input data-key="代理" value="${esc(m['代理'])}" placeholder="留空使用系统代理"></label>
    </div>
    <div class="config-skills">${CONFIG['技能'].length ? '<span>使用技能</span>' : '<span>添加技能后，可在这里启用。</span>'}
      ${CONFIG['技能'].map(s => `<label class="config-check"><input type="checkbox" data-skill="${esc(s.id)}" ${(m['技能'] || []).includes(s.id) ? 'checked' : ''}>${esc(s['名称'] || '未命名技能')}</label>`).join('')}
    </div>
    <button type="button" class="btn btn-sm" data-delete-model="${esc(m.id)}">删除模型</button>
  </fieldset>`).join('') || '<p class="settings-note">还没有模型，先添加一个。</p>';
  $('#skills').innerHTML = CONFIG['技能'].map(s => `<fieldset class="config-item" data-skill-editor="${esc(s.id)}">
    <legend>${esc(s['名称'] || '新技能')}</legend>
    <label>技能名称<input data-name required value="${esc(s['名称'])}" placeholder="例如：去除套话"></label>
    <label>写作指令<textarea data-content required rows="5" placeholder="说明什么时候使用、如何写、避免什么">${esc(s['内容'])}</textarea></label>
    <label class="skill-import">导入 Markdown<input type="file" accept=".md,.txt,text/plain,text/markdown" data-import></label>
  </fieldset>`).join('') || '<p class="settings-note">还没有技能。人设中的写作风格始终会用于生成。</p>';
  document.querySelectorAll('[data-delete-model]').forEach(button => button.addEventListener('click', () => {
    collectConfig();
    const id = button.dataset.deleteModel;
    CONFIG['模型列表'] = CONFIG['模型列表'].filter(m => m.id !== id);
    if(CONFIG['当前模型'] === id) CONFIG['当前模型'] = CONFIG['模型列表'][0]?.id || '';
    DIRTY = true;
    renderConfig();
    configStatus('模型已移除，保存设置后生效');
    $('#addModel').focus();
  }));
  document.querySelectorAll('[data-import]').forEach(input => input.addEventListener('change', async () => {
    try {
      const file = input.files[0]; if(!file) return;
      if(file.size > 200000) throw new Error('请选择小于 200 KB 的 Markdown 或文本文件');
      collectConfig();
      const s = CONFIG['技能'].find(s => s.id === input.closest('[data-skill-editor]').dataset.skillEditor);
      s['内容'] = await file.text();
      if(!s['名称']) s['名称'] = file.name.replace(/\.(md|txt)$/i, '');
      DIRTY = true; renderConfig(); configStatus('已导入，保存后生效');
    } catch(e){ configStatus(e.message); }
  }));
}
async function saveConfig(){
  collectConfig();
  // 数据库位置走自己的保存口，别跟着模型设置一起发过去
  delete CONFIG['数据库位置']; delete CONFIG['默认位置'];
  CONFIG = await postJSON('/api/settings', CONFIG);
  delete CONFIG['数据库位置']; delete CONFIG['默认位置'];
  DIRTY = false; renderConfig(); configStatus('已保存，立即生效');
}
let DB = {cur:'', def:'', next:''};

function renderDb(){
  const now = $('#dbNow');
  if(!now) return;
  if(!DB.cur){
    now.textContent = '没读到当前位置。先把工作台更新到新版，这一块才用得了。';
    return;
  }
  const where = DB.cur === DB.def ? '（默认位置）' : '（自己设过的位置）';
  now.innerHTML = '现在放在：<b>' + esc(DB.cur) + '</b>' + where +
    (DB.next ? '<br>下次启动用：<b>' + esc(DB.next) + '</b>，重启才搬过去。' : '');
}

(async () => {
  await boot('settings');
  try { CONFIG = await getJSON('/api/settings'); renderConfig(); }
  catch(e){ configStatus('读取设置失败：' + e.message); return; }
  // 位置字段单拎出来，别混进模型表单（存和发两头都剥干净，见 saveConfig）
  DB = {cur: CONFIG['数据库位置'] || '', def: CONFIG['默认位置'] || '', next: ''};
  delete CONFIG['数据库位置']; delete CONFIG['默认位置'];
  renderDb();
  $('#dbForm').addEventListener('submit', async e => {
    e.preventDefault();
    const stat = $('#dbStatus');
    const path = $('#dbPath').value.trim();
    if(!path){ stat.textContent = '先填一个文件夹路径，例如 D:\\我的写作数据'; return; }
    if(path === DB.cur && !DB.next){ stat.textContent = '和现在放的是同一个地方，不用换。'; return; }
    $('#saveDb').disabled = true;
    try{
      await postJSON('/api/settings', {'数据库位置': path, '搬迁': $('#dbMove').checked});
      DB.next = path;
      renderDb();
      stat.textContent = '已保存。关掉工作台窗口，重新双击 启动工作台.bat 就生效了。';
    }catch(err){ stat.textContent = err.message; }
    finally{ $('#saveDb').disabled = false; }
  });
  $('#configForm').addEventListener('input', () => { DIRTY = true; configStatus('有未保存的修改'); });
  $('#addModel').onclick = () => {
    collectConfig(); const id = configId('model');
    CONFIG['模型列表'].push({id, '名称':'', '接口':'https://api.deepseek.com', '模型名':'deepseek-flash', '代理':'', '技能':[]});
    if(!CONFIG['当前模型']) CONFIG['当前模型'] = id;
    DIRTY = true; renderConfig(); document.querySelector(`[data-model="${id}"] input[data-key]`).focus();
  };
  $('#addSkill').onclick = () => {
    collectConfig(); const id = configId('skill'); CONFIG['技能'].push({id, '名称':'', '内容':''});
    DIRTY = true; renderConfig(); document.querySelector(`[data-skill-editor="${id}"] input`).focus();
  };
  $('#configForm').onsubmit = async e => {
    e.preventDefault(); $('#saveConfig').disabled = true;
    try { await saveConfig(); } catch(e){ configStatus(e.message); }
    finally { $('#saveConfig').disabled = false; }
  };
  $('#testModel').onclick = async () => {
    if(DIRTY){ configStatus('请先保存设置，再测试当前模型'); return; }
    $('#testModel').disabled = true; configStatus('正在连接…');
    try { const r = await postJSON('/api/model_test', {}); configStatus(r['消息']); }
    catch(e){ configStatus(e.message); }
    finally { $('#testModel').disabled = false; }
  };
  window.addEventListener('beforeunload', e => { if(DIRTY){ e.preventDefault(); e.returnValue = ''; } });
})();
