import { initCollaboration } from './collaboration.js?r=agent-20261023-1';
import { initAgent } from './agent.js?r=agent-20261023-1';
const $ = (selector) => document.querySelector(selector);
let deck;
let version;
let versions;
let versionLoad = 0;
let page = 0;
let touchX;
const dialogs = [...document.querySelectorAll('dialog')];
const isDialogOpen = () => dialogs.some((dialog) => dialog.open);

function pageFromHash() {
  const match = location.hash.match(/^#\/?(\d+)$/);
  return match ? Math.min(deck.slides.length - 1, Math.max(0, Number(match[1]) - 1)) : 0;
}

function render() {
  const slide = deck.slides[page];
  $('#slide').src = slide.image;
  $('#slide').alt = `${page + 1} / ${deck.slides.length}：${slide.title}`;
  $('#status').textContent = `第 ${page + 1} 页，共 ${deck.slides.length} 页。${slide.title}`;
  $('#counter').replaceChildren(document.createTextNode(String(page + 1).padStart(2, '0') + ' '));
  const total = document.createElement('span');
  total.textContent = `/ ${String(deck.slides.length).padStart(2, '0')}`;
  $('#counter').append(total);
  $('#previous').disabled = page === 0;
  $('#next').disabled = page === deck.slides.length - 1;
  $('#download').href = slide.pptx;
  $('#download').setAttribute('aria-label', `下载第 ${page + 1} 页 PPTX`);
  $('#text-title').textContent = `${String(page + 1).padStart(2, '0')} / ${slide.title}`;
  $('#slide-text').textContent = slide.text.join('\n');
  document.title = `${page + 1}. ${slide.title} · 203 Systems`;
  [...$('#grid').children].forEach((button, index) => {
    if (index === page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  for (const adjacent of [deck.slides[page - 1], deck.slides[page + 1]]) {
    if (adjacent) { const image = new Image(); image.src = adjacent.image; }
  }
  document.dispatchEvent(new CustomEvent('slidechange', {detail:{version, slide:page + 1, title:slide.title}}));
}

function go(index) {
  page = Math.min(deck.slides.length - 1, Math.max(0, index));
  const url = new URL(location.href);
  url.hash = `/${page + 1}`;
  url.searchParams.delete('thread');
  history.replaceState(null, '', url);
  render();
}

function showOverview() {
  $('#overview-dialog').showModal();
  $('#grid [aria-current="page"]').focus();
}

async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
  } catch (error) { console.warn('Fullscreen unavailable:', error.message); }
}

function toggleControls() {
  const clean = document.body.classList.toggle('clean');
  $('#show-controls').hidden = !clean;
}

async function init() {
  const response = await fetch('versions.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Unable to load version manifest');
  versions = await response.json();
  try { initAgent(); } catch (error) { console.error('Agent panel unavailable:', error); }
  await initCollaboration();
  const wanted = new URL(location.href).searchParams.get('v') || versions.current;
  const selected = versions.versions.find(item => item.id === wanted);
  if (!selected) throw new Error('Requested version not found');
  await loadVersion(selected.id, false);
  for (const entry of versions.versions) {
    const row = document.createElement('article');
    row.className = 'version-entry';
    const title = document.createElement('h3');
    title.textContent = entry.id + (entry.id === versions.current ? ' · 最新版' : '');
    const date = document.createElement('p');
    date.className = 'version-date';
    date.textContent = `${entry.date.slice(0,10)} · ${entry.slideCount} 页`;
    const notes = document.createElement('p');
    notes.textContent = entry.notes;
    const button = document.createElement('button');
    button.textContent = '查看此版本';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await loadVersion(entry.id); $('#versions-dialog').close(); }
      catch { $('#version-notice').textContent = '版本加载失败，请重试'; }
      finally { button.disabled = false; }
    });
    row.append(title,date,notes,button);
    $('#version-list').append(row);
  }
  $('#versions-button').addEventListener('click', () => $('#versions-dialog').showModal());
  $('#previous').addEventListener('click', () => go(page - 1));
  $('#next').addEventListener('click', () => go(page + 1));
  $('#overview').addEventListener('click', showOverview);
  $('#counter').addEventListener('click', showOverview);
  $('#transcript').addEventListener('click', () => $('#text-dialog').showModal());
  $('#fullscreen').addEventListener('click', fullscreen);
  $('#help').addEventListener('click', () => $('#help-dialog').showModal());
  $('#show-controls').addEventListener('click', toggleControls);
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  window.addEventListener('hashchange', () => { page = pageFromHash(); render(); });
  document.addEventListener('keydown', (event) => {
    if (isDialogOpen() || event.altKey || event.ctrlKey || event.metaKey || event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if ([' ', 'Enter'].includes(event.key) && event.target.closest('button,a')) return;
    const key = event.key.toLowerCase();
    const action = {
      arrowright: () => go(page + 1), pagedown: () => go(page + 1),
      ' ': () => go(page + (event.shiftKey ? -1 : 1)),
      arrowleft: () => go(page - 1), pageup: () => go(page - 1),
      home: () => go(0), end: () => go(deck.slides.length - 1),
      o: showOverview, f: fullscreen, h: toggleControls,
      t: () => $('#text-dialog').showModal(), '?': () => $('#help-dialog').showModal(),
    }[key];
    if (action) { event.preventDefault(); action(); }
  });
  $('#stage').addEventListener('touchstart', (event) => { touchX = document.body.classList.contains('annotating') ? null : event.touches.length === 1 ? [event.touches[0].clientX, event.touches[0].clientY] : null; }, { passive: true });
  $('#stage').addEventListener('touchend', (event) => {
    if (!touchX || isDialogOpen()) return;
    const dx = event.changedTouches[0].clientX - touchX[0];
    const dy = event.changedTouches[0].clientY - touchX[1];
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) go(page + (dx < 0 ? 1 : -1));
    touchX = null;
  }, { passive: true });
  $('#stage').addEventListener('touchcancel', () => { touchX = null; }, { passive: true });
  if (!document.documentElement.requestFullscreen) $('#fullscreen').hidden = true;
  $('#slide').addEventListener('error', () => { $('#error').hidden = false; });
  $('#slide').addEventListener('load', () => { $('#error').hidden = true; });
}

async function loadVersion(id, updateURL = true) {
  const generation = ++versionLoad;
  const entry = versions.versions.find(item => item.id === id);
  const response = await fetch(entry.manifest);
  if (!response.ok) throw new Error('Unable to load version');
  const next = await response.json();
  if (generation !== versionLoad) return;
  deck = next;
  version = id;
  document.documentElement.style.setProperty('--ratio', deck.width / deck.height);
  $('#source-download').href = deck.source;
  $('#version-label').textContent = version;
  $('#version-notice').textContent = version === versions.current ? '当前为最新版' : '正在查看历史版本';
  $('#grid').replaceChildren();
  for (const [index, slide] of deck.slides.entries()) {
    const button = document.createElement('button');
    const image = document.createElement('img');
    image.src = slide.image;
    image.loading = 'lazy';
    image.alt = '';
    const number = document.createElement('span');
    number.className = 'number';
    number.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = slide.title;
    button.append(image, number, title);
    button.addEventListener('click', () => { go(index); $('#overview-dialog').close(); });
    $('#grid').append(button);
  }
  page = pageFromHash();
  if (updateURL) {
    const url = new URL(location.href);
    url.searchParams.set('v',version);
    url.searchParams.delete('thread');
    url.hash = `/${page + 1}`;
    history.replaceState(null,'',url);
  }
  render();
}

init().catch((error) => { console.error(error); $('#error').textContent = '演示版本加载失败，请检查链接中的版本号或刷新重试。'; $('#error').hidden = false; });
