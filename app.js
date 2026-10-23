const $ = (selector) => document.querySelector(selector);
let deck;
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
}

function go(index) {
  page = Math.min(deck.slides.length - 1, Math.max(0, index));
  history.replaceState(null, '', `#/${page + 1}`);
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
  const response = await fetch('slides.json');
  if (!response.ok) throw new Error('Unable to load slide manifest');
  deck = await response.json();
  document.documentElement.style.setProperty('--ratio', deck.width / deck.height);
  $('#source-download').href = deck.source;
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
  render();
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
    if (isDialogOpen() || event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    // Native keyboard activation of focused controls takes priority.
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
  $('#stage').addEventListener('touchstart', (event) => { touchX = event.touches.length === 1 ? [event.touches[0].clientX, event.touches[0].clientY] : null; }, { passive: true });
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

init().catch((error) => { console.error(error); $('#error').hidden = false; });
