const $ = selector => document.querySelector(selector);
const statusNames = {open:'待处理',planned:'已计划',done:'已完成',resolved:'已解决'};
let api, context, items = [], replies = [], point = null, replyTo = null, offset = 0, requestSerial = 0;
let localKey, ownIds, pendingId = crypto.randomUUID();
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch { return false; } },
};
const identity = c => `${c.version}:${c.slide}`;
const draftKey = c => `203-talk:draft:${identity(c)}`;
function message(text, error = false) { $('#feedback-message').textContent = text; $('#feedback-message').classList.toggle('error',error); }
function openPanel(open = true) {
  $('#review-panel').hidden = !open;
  $('#review-button').setAttribute('aria-expanded',String(open));
  document.body.classList.toggle('review-open',open);
  if (open) document.body.classList.remove('clean');
}
function cancelAnnotation() { document.body.classList.remove('annotating'); $('#annotation-hint').hidden = true; }
function saveDraft() {
  if (context) storage.set(draftKey(context),{content:$('#feedback-content').value,author:$('#feedback-author').value,kind:$('#feedback-kind').value,point,replyTo});
}
function loadDraft() {
  const draft = storage.get(draftKey(context),{});
  $('#feedback-content').value = draft.content || '';
  $('#feedback-author').value = draft.author || storage.get('203-talk:author','');
  $('#feedback-kind').value = draft.kind || 'comment';
  point = draft.point || null;
  replyTo = draft.replyTo || null;
  pendingId = crypto.randomUUID();
  updateComposer();
}
function updateComposer() {
  $('#compose-title').textContent = replyTo ? '回复讨论' : '发送反馈';
  $('#cancel-reply').hidden = !replyTo;
  $('#annotate').hidden = !!replyTo;
  $('#feedback-kind').disabled = !!replyTo;
  const draft = $('#annotation-draft');
  draft.replaceChildren();
  if (point && !replyTo) {
    draft.append(document.createTextNode(`已标注：横向 ${Math.round(point.x*100)}%，纵向 ${Math.round(point.y*100)}% `));
    const remove = document.createElement('button'); remove.type='button'; remove.textContent='移除';
    remove.addEventListener('click',() => {point=null;saveDraft();updateComposer();renderMarkers();});draft.append(remove);
  }
  renderMarkers();
}
function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent=text; if (className) node.className=className;return node;
}
function threadLink(item) {
  const url = new URL(location.href);url.searchParams.set('v',item.version);url.searchParams.set('thread',item.parent_id || item.id);url.hash=`/${item.slide}`;return url.href;
}
function isSelected(item) {return new URL(location.href).searchParams.get('thread') === item.id;}
function displayItems() {
  return items.filter(item => ($('#feedback-kind-filter').value === 'all' || item.kind === $('#feedback-kind-filter').value) && ($('#feedback-status-filter').value === 'all' || item.status === $('#feedback-status-filter').value));
}
function renderMarkers() {
  const layer=$('#markers');layer.replaceChildren();
  displayItems().filter(item=>item.x !== null && item.y !== null).forEach((item,index)=>{
    const marker=element('button',String(index+1),'annotation-marker');marker.style.left=`${item.x*100}%`;marker.style.top=`${item.y*100}%`;
    marker.setAttribute('aria-label',`标注 ${index+1}：${item.content.slice(0,50)}`);marker.title=item.content.slice(0,80);
    marker.addEventListener('click',event=>{event.stopPropagation();cancelAnnotation();openPanel();$(`#feedback-${item.id}`)?.scrollIntoView({block:'nearest',behavior:'smooth'});$(`#feedback-${item.id}`)?.focus();});layer.append(marker);
  });
  if (point && !replyTo) { const marker=element('span','＋','annotation-marker draft-marker');marker.style.left=`${point.x*100}%`;marker.style.top=`${point.y*100}%`;layer.append(marker); }
}
async function request(method, body) {
  const response=await fetch(api,{method,headers:{'Content-Type':'application/json','X-Edit-Key':localKey},body:JSON.stringify(body),credentials:'omit'});
  const data=await response.json();if(!response.ok) throw new Error(data.error || '服务暂时不可用，请稍后重试。');return data;
}
function renderList() {
  const list=$('#feedback-list');list.replaceChildren();
  const filtered=displayItems();
  if (!filtered.length) list.append(element('p',items.length ? '当前筛选下没有反馈。' : '这页还没有反馈。可以发表评论，或标注一个希望修改的位置。','empty-state'));
  for (const item of filtered) {
    const article=element('article',undefined,'feedback-item');article.id=`feedback-${item.id}`;article.tabIndex=-1;
    if (isSelected(item)) article.classList.add('selected');
    const meta=element('div',undefined,'feedback-meta');meta.append(element('span',item.kind==='request'?'需求':'评论'),element('span',statusNames[item.status] || item.status));
    article.append(meta,element('p',item.content,'feedback-content'),element('p',`${item.author} · ${new Date(item.created_at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`,'feedback-author'));
    const actions=element('div',undefined,'feedback-actions');
    const reply=element('button','回复');reply.addEventListener('click',()=>{replyTo=item.id;point=null;$('#feedback-kind').value=item.kind;updateComposer();saveDraft();$('#feedback-content').focus();});
    const share=element('a','链接');share.href=threadLink(item);share.title='版本、页码和讨论专属链接';
    actions.append(reply,share);
    if (ownIds.includes(item.id)) {
      const select=element('select');select.setAttribute('aria-label','更新此反馈状态');
      for (const [value,label] of Object.entries(statusNames)) { const option=element('option',label);option.value=value;select.append(option); }select.value=item.status;
      select.addEventListener('change',async()=>{select.disabled=true;try {await request('PATCH',{id:item.id,status:select.value});await refresh();}catch(error){select.value=item.status;message(error.message,true);}finally{select.disabled=false;}});
      actions.append(select);
      const withdraw=element('button','撤回');withdraw.addEventListener('click',async()=>{
        withdraw.disabled=true;
        try {await request('DELETE',{id:item.id});await refresh();}catch(error){message(error.message,true);}finally{withdraw.disabled=false;}
      });actions.append(withdraw);
    }
    article.append(actions);
    for (const child of replies.filter(reply=>reply.parent_id===item.id)) {
      const box=element('div',undefined,'feedback-reply');box.append(element('p',child.content),element('small',child.author));
      if(ownIds.includes(child.id)) {const remove=element('button','撤回回复');remove.addEventListener('click',async()=>{try{await request('DELETE',{id:child.id});await refresh();}catch(error){message(error.message,true);}});box.append(remove);}
      article.append(box);
    }
    list.append(article);
  }
  renderMarkers();
}
async function refresh(more=false) {
  if (!context) return;
  const serial=++requestSerial;
  const current={...context};
  const nextOffset=more ? offset+30 : 0;
  const url=new URL(api);url.searchParams.set('version',current.version);url.searchParams.set('slide',current.slide);url.searchParams.set('offset',nextOffset);
  const target=new URL(location.href).searchParams.get('thread');if(target)url.searchParams.set('thread',target);
  message('正在加载共享反馈…');$('#more-feedback').disabled=true;
  try {
    const response=await fetch(url,{credentials:'omit',cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error || '评论加载失败。');
    if (serial!==requestSerial || identity(current)!==identity(context))return;
    items=more?[...items,...data.items]:data.items;replies=more?[...replies,...data.replies]:data.replies;offset=nextOffset;
    $('#more-feedback').hidden=!data.hasMore;renderList();message(`${items.length} 条反馈 · 共享保存`);
    if(target) {openPanel();$(`#feedback-${target}`)?.scrollIntoView({block:'nearest'});}
  } catch(error) {if(serial===requestSerial){message(error.message || '无法连接协作服务，请稍后刷新。',true);$('#feedback-list').replaceChildren();$('#more-feedback').hidden=true;}}
  finally{if(serial===requestSerial)$('#more-feedback').disabled=false;}
}
export async function initCollaboration() {
  const response=await fetch('collaboration-config.json');if(!response.ok)throw new Error('Unable to load collaboration configuration');api=(await response.json()).api;
  localKey=storage.get('203-talk:edit-key',null);
  if (!localKey) {localKey=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');storage.set('203-talk:edit-key',localKey);}
  ownIds=storage.get('203-talk:own-ids',[]);
  document.addEventListener('slidechange',event=>{
    const next=event.detail;if(context && identity(context)===identity(next))return;
    saveDraft();cancelAnnotation();context=next;items=[];replies=[];offset=0;
    $('#review-context').textContent=`${context.version} / 第 ${context.slide} 页`;
    loadDraft();renderList();refresh();
  });
  $('#review-button').addEventListener('click',()=>openPanel($('#review-panel').hidden));
  $('#close-review').addEventListener('click',()=>openPanel(false));
  $('#refresh-feedback').addEventListener('click',()=>{const url=new URL(location.href);url.searchParams.delete('thread');history.replaceState(null,'',url);refresh();});
  $('#more-feedback').addEventListener('click',()=>refresh(true));
  $('#feedback-kind-filter').addEventListener('change',renderList);$('#feedback-status-filter').addEventListener('change',renderList);
  $('#feedback-form').addEventListener('input',saveDraft);
  $('#cancel-reply').addEventListener('click',()=>{replyTo=null;updateComposer();saveDraft();});
  $('#annotate').addEventListener('click',()=>{openPanel(false);document.body.classList.add('annotating');$('#annotation-hint').hidden=false;});
  $('#cancel-annotation').addEventListener('click',()=>{cancelAnnotation();openPanel();});
  $('#canvas').addEventListener('click',event=>{
    if(!document.body.classList.contains('annotating') || event.target.closest('button'))return;
    const bounds=$('#canvas').getBoundingClientRect();point={x:Math.min(1,Math.max(0,(event.clientX-bounds.left)/bounds.width)),y:Math.min(1,Math.max(0,(event.clientY-bounds.top)/bounds.height))};
    cancelAnnotation();openPanel();updateComposer();saveDraft();$('#feedback-content').focus();
  });
  $('#feedback-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!context)return;
    const content=$('#feedback-content').value.trim();if(!content)return;
    if(!storage.set('203-talk:edit-key',localKey)){message('浏览器禁止本地存储，无法保存匿名管理凭证。请允许此网站存储后再提交。',true);return;}
    const submitted={...context};const originalReply=replyTo;
    const data={id:pendingId,version:context.version,slide:context.slide,kind:$('#feedback-kind').value,content,author:$('#feedback-author').value,point:replyTo?null:point,parentId:replyTo};
    $('#send-feedback').disabled=true;$('#send-feedback').textContent='发送中…';
    try {
      const result=await request('POST',data);ownIds=[...new Set([...ownIds,result.id])];storage.set('203-talk:own-ids',ownIds);storage.set('203-talk:author',data.author);storage.set(draftKey(submitted),{});
      if(identity(context)===identity(submitted)){$('#feedback-content').value='';point=null;replyTo=null;pendingId=crypto.randomUUID();updateComposer();await refresh();message(originalReply?'回复已发送并共享保存。':'反馈已发送并共享保存。');}
    } catch(error){message(error.message,true);}
    finally{$('#send-feedback').disabled=false;$('#send-feedback').textContent='发送';}
  });
}
