// 「Agent」 panel: talk directly to the Claude Code session that maintains this presentation (agent-service/ on the
// 203 server). Team members sign in once with the 203 workbench team code; every message runs as the next turn of the
// same session with the model and thinking effort picked here, and the reply and each step Claude takes stream in live.
const $ = selector => document.querySelector(selector);
const MODELS = [{id:'claude-opus-5-5',label:'Opus 5.5',hint:'细致'},{id:'claude-sonnet-5-5',label:'Sonnet 5.5',hint:'快'},{id:'claude-haiku-5-5',label:'Haiku 5.5',hint:'最快'},{id:'claude-fable-5-1',label:'Fable 5.1',hint:'最强 · 最慢'}];
const EFFORTS = [{id:'low',label:'低'},{id:'medium',label:'中'},{id:'high',label:'高'},{id:'xhigh',label:'很高'},{id:'max',label:'最高'}];
const PHASES = {starting:'正在启动',thinking:'思考中',writing:'正在回复',tool:'执行中',waiting:'处理中'};
const MAX_FILES = 6, MAX_FILE = 10 << 20;
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};
let api, auth = storage.get('203-talk:agent', null), rev = 0, seenRev = storage.get('203-talk:agent-seen', 0), messages = new Map(), status = {running:null,queue:[]}, conversation = null;
let models = MODELS, efforts = EFFORTS, context = null, files = [], loopId = 0, abort = null, ticker = null, lightTimer = null, stickToBottom = true;
const nodes = new Map(), openGroups = new Set(), blobs = new Map();

function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (className) node.className = className; return node; }
function button(text, onClick, className) { const node = element('button', text, className); node.type = 'button'; node.addEventListener('click', onClick); return node; }
const label = (list, id) => list.find(x => x.id === id)?.label || id;
const runLabel = run => run ? `${label(models, run.model)} · 强度 ${label(efforts, run.effort)}` : '';
function clock(iso) {
  const date = new Date(iso), today = new Date().toDateString() === date.toDateString();
  return date.toLocaleString('zh-CN', today ? {hour:'2-digit',minute:'2-digit',hour12:false} : {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
}
const elapsed = from => { const s = Math.max(0, Math.round((Date.now() - Date.parse(from)) / 1000)); return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`; };

async function call(route, {method = 'GET', body, signal, timeout = 20000} = {}) {
  const response = await fetch(api + route, {method, credentials:'omit', cache:'no-store', headers:{'Content-Type':'application/json', ...(auth ? {Authorization:`Bearer ${auth.token}`} : {})},
    body: body ? JSON.stringify(body) : undefined, signal: signal && AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : signal || AbortSignal.timeout(timeout)});
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && auth && route !== '/login') { signedOut('登录已失效，请重新输入团队口令。'); }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Agent 服务暂时连不上，请稍后重试。'), {status: response.status});
  return data;
}

// ---------- minimal, safe Markdown (text nodes only; links must be http/https) ----------
function inline(parent, text) {
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()（）「」]+[^\s<>()（）「」.,;:!?，。；：！？"'])/g;
  let last = 0, match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parent.append(text.slice(last, match.index));
    if (match[1]) parent.append(element('code', match[1].slice(1, -1)));
    else if (match[2]) parent.append(element('strong', match[2].slice(2, -2)));
    else { const link = element('a', match[3] || match[5]); link.href = match[4] || match[5]; link.target = '_blank'; link.rel = 'noopener noreferrer'; parent.append(link); }
    last = pattern.lastIndex;
  }
  if (last < text.length) parent.append(text.slice(last));
}
function markdown(text) {
  const root = element('div', undefined, 'agent-md'), lines = String(text).split('\n');
  let paragraph = [], list = null;
  const flush = () => { if (paragraph.length) { const p = element('p'); inline(p, paragraph.join('\n')); root.append(p); paragraph = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush(); list = null; const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      const pre = element('pre'); pre.append(element('code', code.join('\n'))); root.append(pre); continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush(); list = null; const table = element('table');
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) continue;
        const row = element('tr');
        for (const cell of lines[i].trim().slice(1, -1).split('|')) { const td = element(table.rows.length ? 'td' : 'th'); inline(td, cell.trim()); row.append(td); }
        table.append(row);
      }
      i--; const wrap = element('div', undefined, 'agent-table'); wrap.append(table); root.append(wrap); continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)/);
    if (heading) { flush(); list = null; const h = element('h4'); inline(h, heading[1]); root.append(h); continue; }
    const item = line.match(/^\s*(?:[-*•]|(\d+)[.)、])\s+(.*)/);
    if (item) {
      flush(); const ordered = !!item[1];
      if (!list || list.dataset.ordered !== String(ordered)) { list = element(ordered ? 'ol' : 'ul'); list.dataset.ordered = String(ordered); if (ordered) list.start = Number(item[1]); root.append(list); }
      const li = element('li'); inline(li, item[2]); list.append(li); continue;
    }
    if (!line.trim()) { flush(); list = null; continue; }
    if (list && /^\s{2,}\S/.test(line)) { list.lastElementChild.append('\n' + line.trim()); continue; }
    list = null; paragraph.push(line);
  }
  flush();
  return root;
}

// ---------- conversation ----------
function blocks() {
  const out = []; let group = null;
  for (const m of messages.values()) {
    if (m.role === 'tool') {
      if (!group || group.turn !== m.turn) { group = {key:'tools:' + m.id, type:'tools', turn:m.turn, items:[]}; out.push(group); }
      group.items.push(m); continue;
    }
    group = null; out.push({key:m.id, type:m.role, items:[m]});
  }
  return out;
}
function signature(block) {
  const base = block.items.map(m => m.rev).join(',');
  return block.type === 'user' ? base + ':' + (status.running?.id === block.key) + ':' + status.queue.indexOf(block.key) : block.type === 'tools' ? base + ':' + openGroups.has(block.key) : base;
}
async function thumbnail(img, messageId, index) {
  const key = `${messageId}/${index}`;
  try {
    if (!blobs.has(key)) {
      const response = await fetch(`${api}/files/${key}`, {headers:{Authorization:`Bearer ${auth.token}`}, credentials:'omit'});
      if (!response.ok) throw new Error();
      blobs.set(key, URL.createObjectURL(await response.blob()));
    }
    img.src = blobs.get(key);
  } catch { img.replaceWith(element('span', '图片', 'agent-file-chip')); }
}
function userBlock(m) {
  const box = element('article', undefined, 'agent-msg agent-user'); box.dataset.status = m.status;
  const meta = element('div', undefined, 'agent-meta');
  meta.append(element('strong', m.author), element('span', clock(m.at)));
  if (m.context) meta.append(element('span', `${m.context.version} · 第 ${m.context.slide} 页`));
  meta.append(element('span', runLabel(m.run)));
  const position = status.queue.indexOf(m.id);
  const state = {queued: position >= 0 ? `排队第 ${position + 1}` : '排队中', running:'处理中', stopped:'已停止', failed:'未完成', cancelled:'已取消', interrupted:'被中断'}[m.status];
  if (state) meta.append(element('span', state, 'agent-state'));
  box.append(meta);
  if (m.text) box.append(element('p', m.text, 'agent-user-text'));
  if (m.files?.length) {
    const list = element('div', undefined, 'agent-attachments');
    m.files.forEach((file, index) => {
      if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { const img = element('img'); img.alt = file.name; img.title = file.name; list.append(img); thumbnail(img, m.id, index); }
      else list.append(element('span', file.name, 'agent-file-chip'));
    });
    box.append(list);
  }
  const actions = element('div', undefined, 'agent-msg-actions');
  if (m.status === 'queued') actions.append(button('取消', async () => { try { await call('/cancel', {method:'POST', body:{id:m.id}}); poke(); } catch (error) { notice(error.message, true); } }));
  if (['failed', 'stopped', 'interrupted', 'cancelled'].includes(m.status)) actions.append(button('↻ 重新发送', async () => { try { await call('/retry', {method:'POST', body:{id:m.id, ...run()}}); stickToBottom = true; poke(); } catch (error) { notice(error.message, true); } }));
  if (actions.children.length) box.append(actions);
  return box;
}
function toolsBlock(block) {
  const box = element('details', undefined, 'agent-tools'); box.open = openGroups.has(block.key);
  const latest = block.items.at(-1), active = block.items.some(m => m.status === 'running'), failed = block.items.filter(m => m.status === 'error').length;
  const summary = element('summary');
  summary.append(element('span', active ? '⟳' : '⚙', active ? 'agent-spin' : 'agent-gear'), element('strong', `${block.items.length} 步`), element('span', `${latest.label} ${(latest.text || '').split('\n')[0]}`.trim(), 'agent-tools-latest'));
  if (failed) summary.append(element('span', `${failed} 步出错`, 'agent-tools-failed'));
  box.append(summary);
  box.addEventListener('toggle', () => { if (box.open) openGroups.add(block.key); else openGroups.delete(block.key); });
  const list = element('ol');
  for (const m of block.items) {
    const li = element('li', undefined, 'agent-step'); li.dataset.status = m.status;
    const head = element('div'); head.append(element('span', {running:'…', done:'✓', error:'✕', stopped:'■'}[m.status] || '·', 'agent-step-icon'), element('b', m.label), element('span', m.text || '', 'agent-step-text'));
    if (m.code || m.detail) {
      const more = element('details'); const s = element('summary'); s.append(head); more.append(s);
      if (m.code && m.code !== m.text) more.append(element('pre', m.code, 'agent-code'));
      if (m.detail) more.append(element('pre', m.detail, 'agent-output'));
      li.append(more);
    } else li.append(head);
    list.append(li);
  }
  box.append(list);
  return box;
}
function build(block) {
  const m = block.items[0];
  if (block.type === 'user') return userBlock(m);
  if (block.type === 'tools') return toolsBlock(block);
  if (block.type === 'assistant') { const box = element('article', undefined, 'agent-msg agent-reply'); if (m.status === 'streaming') box.classList.add('streaming'); box.append(markdown(m.text || '…')); return box; }
  const line = element('p', m.text, 'agent-event'); line.dataset.kind = m.kind; return line;
}
function render() {
  const log = $('#agent-log');
  const list = blocks();
  $('#agent-empty').hidden = list.length > 0;
  let previous = $('#agent-empty');
  const seen = new Set();
  for (const block of list) {
    const sig = signature(block);
    let node = nodes.get(block.key);
    if (!node || node.dataset.sig !== sig) { const fresh = build(block); fresh.dataset.sig = sig; if (node) node.replaceWith(fresh); node = fresh; nodes.set(block.key, node); }
    if (previous.nextSibling !== node) log.insertBefore(node, previous.nextSibling);
    previous = node; seen.add(block.key);
  }
  for (const [key, node] of nodes) if (!seen.has(key)) { node.remove(); nodes.delete(key); }
  if (stickToBottom) log.scrollTop = log.scrollHeight;
  renderStatus();
}
function renderStatus() {
  const bar = $('#agent-status'), running = status.running;
  bar.replaceChildren();
  bar.dataset.state = running ? 'running' : 'idle';
  const lead = element('span', undefined, 'agent-status-main');
  if (running) lead.append(element('i', undefined, 'agent-pulse'), element('strong', `${PHASES[running.phase] || '处理中'}${running.step ? '：' + running.step : ''}`), element('span', `${elapsed(running.startedAt)} · ${runLabel(running.run)}`));
  else lead.append(element('i'), element('strong', '空闲'), element('span', conversation?.session ? `会话 ${conversation.session}` : '新会话，还没开始'));
  bar.append(lead);
  if (status.queue.length) bar.append(element('span', `排队 ${status.queue.length} 条`, 'agent-status-queue'));
  $('#agent-stop').hidden = !running;
  $('#agent-new').disabled = !!running || status.queue.length > 0;
  $('#agent-dot').hidden = !(running || rev > seenRev);
  $('#agent-dot').dataset.state = running ? 'running' : 'new';
  clearInterval(ticker); ticker = running && !$('#agent-panel').hidden ? setInterval(renderStatus, 1000) : null;
}
function apply(data) {
  if (data.full) { messages = new Map(); }
  for (const m of data.messages) messages.set(m.id, m);
  rev = data.rev; status = data.status; conversation = data.conversation;
  const ids = list => list.map(x => x.id).join();
  if (data.models?.length && (ids(models) !== ids(data.models) || ids(efforts) !== ids(data.efforts))) { models = data.models; efforts = data.efforts; fillPickers(data.defaults); }
  if (!$('#agent-panel').hidden) { seenRev = rev; storage.set('203-talk:agent-seen', seenRev); render(); }
  else renderStatus();
}
function notice(text, error = false) { const node = $('#agent-notice'); node.textContent = text; node.classList.toggle('error', error); node.hidden = !text; }

// Long-polls while the panel is open; a light check every 20 s keeps the button's dot current while it is closed.
async function follow() {
  const id = ++loopId; let failures = 0;
  abort?.abort(); abort = new AbortController();
  while (id === loopId && auth && !$('#agent-panel').hidden) {
    try { apply(await call(`/state?rev=${rev}&wait=20`, {signal:abort.signal, timeout:35000})); failures = 0; notice(''); }
    catch (error) {
      if (id !== loopId || !auth) return;
      failures++;
      if (failures > 1) notice(navigator.onLine ? 'Agent 服务暂时连不上，正在重试…' : '网络已断开，联网后自动恢复', true);
      await new Promise(r => setTimeout(r, Math.min(15000, 1500 * failures)));
    }
  }
}
const poke = () => { if (!$('#agent-panel').hidden) follow(); };
function lightCheck() {
  clearInterval(lightTimer);
  lightTimer = setInterval(async () => { if (auth && $('#agent-panel').hidden && !document.hidden) { try { apply(await call(`/state?rev=${rev}`)); } catch {} } }, 20000);
}

// ---------- composer ----------
function fillPickers(defaults) {
  const saved = storage.get('203-talk:agent-run', {}), pick = (list, value, fallback) => list.some(x => x.id === value) ? value : fallback;
  const model = pick(models, saved.model, defaults?.model || 'claude-opus-5-5'), effort = pick(efforts, saved.effort, defaults?.effort || 'xhigh');
  $('#agent-model').replaceChildren(...models.map(m => { const o = element('option', `${m.label} · ${m.hint}`); o.value = m.id; return o; }));
  $('#agent-effort').replaceChildren(...efforts.map(e => { const o = element('option', `强度 ${e.label}`); o.value = e.id; return o; }));
  $('#agent-model').value = model; $('#agent-effort').value = effort;
}
const run = () => ({model:$('#agent-model').value, effort:$('#agent-effort').value});
function renderFiles() {
  const list = $('#agent-files'); list.replaceChildren();
  files.forEach((file, index) => { const chip = element('span', `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`, 'agent-file-chip'); chip.append(button('×', () => { files.splice(index, 1); renderFiles(); })); list.append(chip); });
  list.hidden = !files.length;
}
function addFiles(list) {
  for (const file of list) {
    if (files.length >= MAX_FILES) { notice(`一次最多 ${MAX_FILES} 个附件`, true); break; }
    if (file.size > MAX_FILE) { notice(`${file.name} 超过 10 MB`, true); continue; }
    files.push(file);
  }
  renderFiles();
}
const base64 = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(file); });
// The message box grows with what is typed (up to 40% of the screen), then scrolls.
function autosize() { const input = $('#agent-input'); input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight + 2, innerHeight * 0.4) + 'px'; }
function updateContext() {
  $('#agent-context-label').textContent = context ? `${context.version} · 第 ${context.slide} 页` : '';
}
async function send(event) {
  event?.preventDefault();
  const text = $('#agent-input').value.trim();
  if (!text && !files.length) return;
  const sendButton = $('#agent-send'); sendButton.disabled = true; sendButton.textContent = '发送中…';
  try {
    const body = {text, ...run(), context: $('#agent-context').checked ? context : null, files: await Promise.all(files.map(async f => ({name:f.name, type:f.type, data:await base64(f)})))};
    const data = await call('/messages', {method:'POST', body, timeout:120000});
    $('#agent-input').value = ''; autosize(); storage.remove('203-talk:agent-draft'); files = []; renderFiles(); notice('');
    status = data.status; stickToBottom = true; renderStatus(); poke();
  } catch (error) { notice(error.message, true); }
  finally { sendButton.disabled = false; sendButton.textContent = '发送'; }
}
async function stop() {
  if (!confirm('停止 Agent 正在做的这一轮？已经改动的文件会保留，之后可以回复「继续」。')) return;
  try { await call('/stop', {method:'POST'}); poke(); } catch (error) { notice(error.message, true); }
}

// ---------- sign-in and panel ----------
function showView() {
  $('#agent-login').hidden = !!auth; $('#agent-chat').hidden = !auth;
  $('#agent-new').hidden = $('#agent-signout').hidden = !auth;
  $('#agent-who').textContent = auth ? `${auth.name} · 已连接` : '';
}
function signedOut(text) {
  auth = null; storage.remove('203-talk:agent'); messages = new Map(); rev = 0; loopId++; abort?.abort();
  for (const node of nodes.values()) node.remove(); nodes.clear();
  status = {running:null, queue:[]}; renderStatus(); showView();
  if (text) { $('#agent-login-message').textContent = text; $('#agent-login-message').classList.add('error'); }
  document.dispatchEvent(new CustomEvent('agent:auth', {detail:{signedIn:false}}));
}
function openPanel(open = true) {
  $('#agent-panel').hidden = !open;
  $('#agent-button').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('agent-open', open);
  if (open) {
    if (!$('#review-panel').hidden) $('#close-review').click();
    document.body.classList.remove('clean');
    showView();
    // No automatic focus on touch screens: it would pop the keyboard up every time the panel opens.
    const focus = selector => { if (matchMedia('(pointer:fine)').matches) setTimeout(() => $(selector).focus({preventScroll:true}), 0); };
    if (auth) { stickToBottom = true; render(); follow(); autosize(); focus('#agent-input'); }
    else focus($('#agent-name').value ? '#agent-code' : '#agent-name');
  } else { loopId++; abort?.abort(); renderStatus(); }
}

export function initAgent() {
  document.addEventListener('slidechange', event => {
    const url = new URL(location.href); url.searchParams.delete('thread'); url.searchParams.set('v', event.detail.version);
    context = {...event.detail, url:url.href}; updateContext();
  });
  document.addEventListener('agent:compose', event => {
    openPanel(true);
    const input = $('#agent-input'); input.value = (input.value.trim() ? input.value.trim() + '\n\n' : '') + event.detail.text;
    storage.set('203-talk:agent-draft', input.value); autosize(); input.focus();
  });
  $('#agent-button').addEventListener('click', () => openPanel($('#agent-panel').hidden));
  $('#close-agent').addEventListener('click', () => openPanel(false));
  $('#review-button').addEventListener('click', () => { if (!$('#agent-panel').hidden) openPanel(false); });
  $('#agent-name').value = storage.get('203-talk:agent-name', '') || storage.get('203-talk:author', '');
  $('#agent-login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter || $('#agent-login-form button'), message = $('#agent-login-message');
    submit.disabled = true; message.textContent = '正在连接…'; message.classList.remove('error');
    try {
      const data = await call('/login', {method:'POST', body:{name:$('#agent-name').value, code:$('#agent-code').value}});
      auth = {token:data.token, name:data.name}; storage.set('203-talk:agent', auth); storage.set('203-talk:agent-name', data.name);
      $('#agent-code').value = ''; message.textContent = ''; rev = 0;
      document.dispatchEvent(new CustomEvent('agent:auth', {detail:{signedIn:true}}));
      openPanel(true);
    } catch (error) { message.textContent = error.message; message.classList.add('error'); }
    finally { submit.disabled = false; }
  });
  $('#agent-signout').addEventListener('click', async () => {
    if (!confirm('退出 Agent 登录？对话会保留在服务器上。')) return;
    try { await call('/logout', {method:'POST'}); } catch {}
    signedOut('');
  });
  $('#agent-new').addEventListener('click', async () => {
    if (!confirm('开启新会话？Agent 将不再记得之前聊过的内容（之前的对话会存档在服务器上）。')) return;
    try { await call('/new-session', {method:'POST'}); openGroups.clear(); poke(); } catch (error) { notice(error.message, true); }
  });
  $('#agent-stop').addEventListener('click', stop);
  $('#agent-form').addEventListener('submit', send);
  const input = $('#agent-input');
  input.value = storage.get('203-talk:agent-draft', '');
  input.addEventListener('input', () => { storage.set('203-talk:agent-draft', input.value); autosize(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); }
  });
  input.addEventListener('paste', event => {
    const pasted = [...(event.clipboardData?.files || [])];
    if (pasted.length) { event.preventDefault(); addFiles(pasted.map((f, i) => f.name && f.name !== 'image.png' ? f : new File([f], `截图-${new Date().toLocaleTimeString('zh-CN', {hour12:false}).replace(/:/g, '')}${i ? '-' + (i + 1) : ''}.png`, {type:f.type}))); }
  });
  $('#agent-attach').addEventListener('click', () => $('#agent-file').click());
  $('#agent-file').addEventListener('change', event => { addFiles([...event.target.files]); event.target.value = ''; });
  const panel = $('#agent-panel');
  panel.addEventListener('dragover', event => { if (auth && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); panel.classList.add('dragging'); } });
  panel.addEventListener('dragleave', event => { if (!panel.contains(event.relatedTarget)) panel.classList.remove('dragging'); });
  panel.addEventListener('drop', event => { panel.classList.remove('dragging'); if (auth && event.dataTransfer?.files.length) { event.preventDefault(); addFiles([...event.dataTransfer.files]); } });
  $('#agent-model').addEventListener('change', () => storage.set('203-talk:agent-run', run()));
  $('#agent-effort').addEventListener('change', () => storage.set('203-talk:agent-run', run()));
  $('#agent-log').addEventListener('scroll', () => { const log = $('#agent-log'); stickToBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poke(); });
  window.addEventListener('online', poke);
  fillPickers(); renderFiles(); showView();
  fetch('collaboration-config.json', {cache:'no-store'}).then(r => r.json()).then(config => {
    api = config.agentApi;
    if (!api) { $('#agent-button').hidden = true; return; }
    lightCheck();
    if (auth) call(`/state?rev=0`).then(apply).catch(() => {});
  }).catch(() => { $('#agent-button').hidden = true; });
}
