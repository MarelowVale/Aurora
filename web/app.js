import { KIND, kindIcon, UI, ui, SPRITE } from './icons.js';

/* 自检用：把运行期错误留下来，方便通过 /api/dev/js 读回 */
window.__errors = [];
window.addEventListener('error', (e) => {
  window.__errors.push(String(e.message) + ' @ ' + String(e.filename || '').split('/').pop() + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  window.__errors.push('promise: ' + String((e.reason && e.reason.message) || e.reason));
});

/* 调试用：允许从宿主侧 /api/dev/js 里直接跳转目录 */
window.__nav = (p) => navigate(p, { push: true });

/* =========================================================================
   Aurora · 前端
   ========================================================================= */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const TOKEN = new URLSearchParams(location.search).get('t') || '';
const withToken = (p) => p + (p.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(TOKEN);

async function api(path, body) {
  const opt = { method: 'GET' };
  if (body !== undefined) {
    opt.method = 'POST';
    opt.headers = { 'Content-Type': 'application/json' };
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(withToken(path), opt);
  if (!r.ok && r.status !== 204) throw new Error('HTTP ' + r.status);
  if (r.status === 204) return null;
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('json')) return r.text();
  return r.json();
}

/* ---------------------------- 格式化 ---------------------------- */
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function humanSize(n, digits) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1, v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return v.toFixed(digits ?? (v >= 100 ? 0 : v >= 10 ? 1 : 2)) + ' ' + u[i];
}
function fmtDate(ms, withTime = true) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  const date = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
  return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}
function relTime(ms) {
  if (!ms) return '—';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' 天前';
  return fmtDate(ms, false);
}
const KIND_LABEL = {
  folder: '文件夹', image: '图像', video: '视频', audio: '音频', pdf: 'PDF 文稿',
  doc: 'Word 文档', sheet: '电子表格', slide: '演示文稿', archive: '压缩包',
  code: '源代码', app: '应用程序', text: '文本', font: '字体', file: '文件',
};
function kindLabel(e) {
  if (!e) return '';
  if (e.d) return '文件夹';
  if (e.k && KIND_LABEL[e.k]) {
    const ext = (e.e || '').replace('.', '').toUpperCase();
    return ext && e.k === 'file' ? ext + ' 文件' : KIND_LABEL[e.k];
  }
  return (e.e || '').replace('.', '').toUpperCase() || '文件';
}
const isTextLike = (e) => e && !e.d && (e.k === 'text' || e.k === 'code' || e.k === 'doc' || ['md', 'txt', 'log', 'json', 'csv', 'xml', 'yml', 'yaml'].includes((e.e || '').replace('.', '').toLowerCase()));
const isThumbnailable = (e) => e && !e.d && (e.k === 'image' || e.k === 'video' || e.k === 'pdf' || e.k === 'slide' || e.k === 'doc' || e.k === 'sheet');

/* ---------------------------- 路径 ---------------------------- */
const norm = (p) => (p || '').replace(/\//g, '\\').replace(/\\+$/, (m) => m.length > 1 ? (m.length === 3 ? m : '') : '') || p;
function parentOf(p) {
  if (!p) return null;
  let q = p.replace(/[\\/]+$/, '');
  if (/^[A-Za-z]:$/.test(q)) return null;
  const i = Math.max(q.lastIndexOf('\\'), q.lastIndexOf('/'));
  if (i < 0) return null;
  const head = q.slice(0, i);
  if (/^[A-Za-z]:$/.test(head)) return head + '\\';
  return head || '\\';
}
const nameOf = (p) => {
  const q = p.replace(/[\\/]+$/, '');
  const i = Math.max(q.lastIndexOf('\\'), q.lastIndexOf('/'));
  return i < 0 ? q : q.slice(i + 1);
};
const samePath = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
function shortPath(p) {
  if (!p) return '';
  const q = p.replace(/[\\/]+$/, '');
  const parts = q.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return q;
  if (/^[A-Za-z]:$/.test(parts[0])) parts[0] += '\\';
  return parts.length <= 2 ? parts.join('\\') : '…\\' + parts.slice(-2).join('\\');
}

/* ---------------------------- 状态 ---------------------------- */
const S = {
  boot: null,
  settings: {},
  path: '',
  parent: null,
  entries: [],
  count: 0,
  total: 0,
  free: 0,
  truncated: false,
  driveLabel: '',
  sort: 'name',
  desc: false,
  hidden: false,
  view: localStorage.getItem('aurora.view') || 'grid',
  iconSize: Number(localStorage.getItem('aurora.iconSize') || 92),
  sel: new Set(),
  cursor: 0,
  anchor: 0,
  history: [],
  hi: -1,
  tabs: [],
  tabIndex: 0,
  filter: 'all',
  query: '',
  aiQuery: '',
  mode: 'browse',      // browse | search | recents
  loading: false,
  inspector: localStorage.getItem('aurora.inspector') !== '0',
  renaming: null,
  clipboard: null,
  dragPaths: [],
  index: null,
  pendingRender: 0,
  aiBusy: false,
};

function applySettings(st) {
  if (!st) return;
  S.settings = st;
  if (st.sortField) S.sort = st.sortField;
  if (typeof st.sortDesc === 'boolean') S.desc = st.sortDesc;
  if (typeof st.showHidden === 'boolean') S.hidden = st.showHidden;
  if (st.iconSize) S.iconSize = st.iconSize;
  if (st.accent) document.documentElement.style.setProperty('--accent', st.accent);
}

/* ---------------------------- 启动 ---------------------------- */
async function boot() {
  document.body.insertAdjacentHTML('afterbegin', SPRITE);

  // 顶部图标
  $('#btn-new').innerHTML = ui('folderPlus');
  $('#btn-refresh').innerHTML = ui('refresh');
  $('#btn-ai').innerHTML = ui('sparkles');
  $('#btn-settings').innerHTML = ui('gear');
  $('#nav-back').innerHTML = ui('chevronLeft');
  $('#nav-fwd').innerHTML = ui('chevronRight');
  $('#nav-up').innerHTML = ui('chevronUp');
  $('#view-grid').innerHTML = ui('grid');
  $('#view-list').innerHTML = ui('list');
  $('#btn-inspector').innerHTML = ui('columns');
  $('#btn-more').innerHTML = ui('more');
  $('#search-icon').innerHTML = ui('search');
  $('#search-clear').innerHTML = ui('x');

  const b = await api('/api/bootstrap').catch((e) => { console.error(e); return null; });
  if (!b) { toast('无法连接到 Aurora 服务', 'err'); return; }
  S.boot = b;
  S.index = b.index;
  applySettings(b.settings);

  if (b.hasWallpaper) {
    const img = new Image();
    img.onload = () => { $('#backdrop').style.backgroundImage = `url("${withToken('/api/wallpaper')}")`; };
    img.src = withToken('/api/wallpaper');
  }

  buildSidebarShell();
  wireChrome();
  wireKeyboard();
  wireDragDrop();

  const start = sessionStorage.getItem('aurora.path') || b.settings.roots?.[0] || 'D:\\';
  S.tabs = [{ id: tabSeq++, path: start, history: [start], hi: 0, mode: 'browse', query: '' }];
  S.tabIndex = 0;
  await navigate(start, { push: true });
  renderTabs();
  pollIndex();
  setInterval(pollIndex, 4000);
}

/* ---------------------------- 导航 ---------------------------- */
async function navigate(path, opts = {}) {
  if (!path) return;
  S.mode = 'browse';
  S.query = '';
  S.aiQuery = '';
  $('#search').value = '';
  const data = await loadList(path);
  if (!data) return;
  if (opts.push !== false) {
    S.history = S.history.slice(0, S.hi + 1);
    S.history.push(path);
    S.hi = S.history.length - 1;
  }
  sessionStorage.setItem('aurora.path', path);
  S.sel.clear();
  S.cursor = 0;
  S.anchor = 0;
  renderAll();
  snapTab();
  renderTabs();
}

async function loadList(path) {
  S.loading = true;
  try {
    const d = await api(`/api/list?path=${encodeURIComponent(path)}&sort=${S.sort}&desc=${S.desc}&hidden=${S.hidden}`);
    S.path = d.path;
    S.parent = d.parent;
    S.entries = d.entries || [];
    S.count = d.count ?? S.entries.length;
    S.total = d.total ?? 0;
    S.free = d.free ?? 0;
    S.truncated = !!d.truncated;
    S.name = d.name;
    S.loading = false;
    return d;
  } catch (e) {
    S.loading = false;
    toast('无法打开此位置：' + (e.message || e), 'err');
    return null;
  }
}

async function refresh() {
  if (S.mode === 'search') { return doSearch($('#search').value, true); }
  if (S.mode === 'recents') { return loadRecents(true); }
  const keep = new Set(S.sel);
  await loadList(S.path);
  S.sel = new Set([...keep].filter((p) => S.entries.some((e) => samePath(e.p, p))));
  renderAll();
}

async function goBack() { if (S.hi > 0) { S.hi--; await navigate(S.history[S.hi], { push: false }); } }
async function goFwd() { if (S.hi < S.history.length - 1) { S.hi++; await navigate(S.history[S.hi], { push: false }); } }
async function goUp() {
  if (S.mode !== 'browse') { return navigate(S.path || S.settings.roots?.[0] || 'D:\\'); }
  if (S.parent) return navigate(S.parent);
}

/* ---------------------------- 标签页 ---------------------------- */
let tabSeq = 1;
function snapTab() {
  const t = S.tabs[S.tabIndex];
  if (!t) return;
  t.path = S.path; t.history = S.history.slice(); t.hi = S.hi;
  t.mode = S.mode; t.query = S.query; t.scroll = $('#content').scrollTop;
}
function renderTabs() {
  const strip = $('#tabs-strip');
  if (!strip) return;
  strip.innerHTML = '';
  strip.classList.toggle('single', S.tabs.length < 2);
  S.tabs.forEach((t, i) => {
    const tab = el('div', 'tab' + (i === S.tabIndex ? ' on' : ''));
    tab.dataset.i = i;
    const label = t.mode === 'search' ? '搜索 · ' + (t.query || '') : t.mode === 'recents' ? '最近使用' : (nameOf(t.path || '') || t.path || '新标签页');
    tab.innerHTML = `${ui(t.mode === 'search' ? 'search' : t.mode === 'recents' ? 'clock' : 'folder')}<span>${esc(label)}</span>`;
    tab.title = t.path || label;
    if (S.tabs.length > 1) {
      const x = el('button', 'tab-x'); x.innerHTML = ui('x'); x.title = '关闭标签页 (Ctrl+W)';
      x.addEventListener('click', (ev) => { ev.stopPropagation(); closeTab(i); });
      tab.appendChild(x);
    }
    tab.addEventListener('mousedown', (ev) => {
      if (ev.button === 1) { ev.preventDefault(); closeTab(i); return; }
      if (ev.button !== 0) return;
      selectTab(i);
    });
    strip.appendChild(tab);
  });
  $('#tab-new').style.display = '';
}
async function selectTab(i) {
  if (i === S.tabIndex || !S.tabs[i]) return;
  snapTab();
  S.tabIndex = i;
  await restoreTab();
}
async function restoreTab() {
  const t = S.tabs[S.tabIndex];
  if (!t) return;
  S.history = (t.history || []).slice();
  S.hi = t.hi ?? 0;
  $('#search').value = t.mode === 'search' ? (t.query || '') : '';
  if (t.mode === 'search' && t.query) await doSearch(t.query, true);
  else if (t.mode === 'recents') await loadRecents(true);
  else await navigate(t.path, { push: false });
  renderTabs();
}
async function newTab(path) {
  snapTab();
  const p = path || S.path || S.settings.roots?.[0] || 'D:\\';
  S.tabs.push({ id: tabSeq++, path: p, history: [p], hi: 0, mode: 'browse', query: '' });
  S.tabIndex = S.tabs.length - 1;
  await restoreTab();
  $('#content').scrollTop = 0;
}
async function closeTab(i) {
  if (S.tabs.length <= 1) { return; }
  const wasActive = i === S.tabIndex;
  S.tabs.splice(i, 1);
  if (wasActive) {
    S.tabIndex = Math.max(0, Math.min(i, S.tabs.length - 1));
    await restoreTab();
  } else {
    if (i < S.tabIndex) S.tabIndex--;
    renderTabs();
  }
  if (S.tabs.length === 1) renderTabs();
}

async function loadRecents(noPush) {
  S.mode = 'recents';
  S.query = '';
  const list = await api('/api/recents?limit=200').catch(() => []);
  S.entries = list || [];
  S.count = S.entries.length;
  S.sel.clear(); S.cursor = 0; S.anchor = 0;
  renderAll();
  snapTab();
  renderTabs();
}

/* ---------------------------- 排序 / 过滤 ---------------------------- */
function sortedEntries() {
  const arr = S.entries.slice();
  const dir = S.desc ? -1 : 1;
  const f = S.sort;
  arr.sort((a, b) => {
    if (a.d !== b.d) return a.d ? -1 : 1;
    if (f === 'size') return ((a.s || 0) - (b.s || 0)) * dir;
    if (f === 'mtime') return ((a.m || 0) - (b.m || 0)) * dir;
    if (f === 'ctime') return ((a.c || 0) - (b.c || 0)) * dir;
    if (f === 'kind') { const r = collator.compare(kindLabel(a), kindLabel(b)); if (r) return r * dir; }
    return collator.compare(a.n || '', b.n || '') * dir;
  });
  return arr;
}

const FILTERS = {
  all: () => true,
  folder: (e) => e.d,
  image: (e) => e.k === 'image',
  video: (e) => e.k === 'video',
  audio: (e) => e.k === 'audio',
  doc: (e) => ['doc', 'sheet', 'slide', 'pdf', 'text', 'code'].includes(e.k),
  archive: (e) => e.k === 'archive',
  code: (e) => e.k === 'code',
  other: (e) => !e.d && ['doc', 'sheet', 'slide', 'pdf', 'text', 'code', 'image', 'video', 'audio', 'archive'].includes(e.k) === false,
};
function visibleEntries() {
  const pred = FILTERS[S.filter] || FILTERS.all;
  return sortedEntries().filter(pred);
}

/* ---------------------------- 选择 ---------------------------- */
function selectedEntries() { return S.entries.filter((e) => S.sel.has(e.p)); }
function setSelection(paths, cursorIndex) {
  S.sel = new Set(paths);
  if (cursorIndex != null) S.cursor = cursorIndex;
  updateSelectionUI();
  renderInspector();
  renderStatus();
}
function clearSelection() { S.sel.clear(); updateSelectionUI(); renderInspector(); renderStatus(); }

function updateSelectionUI() {
  const nodes = $$('#content [data-path]');
  for (const n of nodes) {
    const on = S.sel.has(n.dataset.path);
    n.classList.toggle('sel', on);
    if (n.dataset.path) n.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  const v = visibleEntries();
  if (v[S.cursor]) scrollIntoView(v[S.cursor].p);
}

function scrollIntoView(path) {
  const n = $(`#content [data-path="${cssEsc(path)}"]`);
  if (n) n.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

function clickEntry(e, ev) {
  const v = visibleEntries();
  const i = v.findIndex((x) => samePath(x.p, e.p));
  if (i < 0) return;
  if (ev.shiftKey && S.anchor != null) {
    const [a, b] = [Math.min(S.anchor, i), Math.max(S.anchor, i)];
    setSelection(v.slice(a, b + 1).map((x) => x.p), i);
  } else if (ev.ctrlKey || ev.metaKey) {
    if (S.sel.has(e.p)) S.sel.delete(e.p); else S.sel.add(e.p);
    S.anchor = i; S.cursor = i;
    updateSelectionUI(); renderInspector(); renderStatus();
  } else {
    S.anchor = i; S.cursor = i;
    setSelection([e.p], i);
  }
}

/* ---------------------------- 渲染 ---------------------------- */
function renderAll() {
  document.documentElement.style.setProperty('--icon-size', S.iconSize + 'px');
  document.body.classList.toggle('view-grid', S.view === 'grid');
  document.body.classList.toggle('view-list', S.view === 'list');
  $('#view-grid').classList.toggle('on', S.view === 'grid');
  $('#view-list').classList.toggle('on', S.view === 'list');
  $('#btn-inspector').classList.toggle('on', S.inspector);
  $('#inspector').classList.toggle('hidden', !S.inspector);
  $('#nav-back').classList.toggle('disabled', S.hi <= 0);
  $('#nav-fwd').classList.toggle('disabled', S.hi >= S.history.length - 1);
  $('#nav-up').classList.toggle('disabled', S.mode !== 'browse' ? false : !S.parent);
  $('#ai-chip').classList.toggle('hidden', !(S.boot?.ai?.enabled));
  renderSidebar();
  renderCrumbs();
  renderFilters();
  renderContent();
  renderInspector();
  renderStatus();
  renderTitle();
}

function renderTitle() {
  let t = 'Aurora';
  if (S.mode === 'search') t = `搜索 · ${S.query}`;
  else if (S.mode === 'recents') t = '最近使用';
  else if (S.name) t = S.name;
  $('#win-title').textContent = t;
  document.title = t + ' — Aurora';
}

function spinnerCard() {
  const w = el('div', 'empty');
  w.innerHTML = `<div class="spinner"></div><div class="s">正在读取…</div>`;
  return w;
}

/* ---------- 侧栏 ---------- */
function buildSidebarShell() {
  // 结构由 renderSidebar 生成
}

function sideItem({ icon, label, sub, active, badge, dot, nav, titleAttr }) {
  const it = el('div', 'side-item' + (active ? ' active' : ''));
  it.dataset.nav = nav;
  if (titleAttr) it.title = titleAttr;
  it.innerHTML = `<span class="si">${icon || ''}</span><span class="sn">${esc(label)}${sub ? `<span class="sub2">${esc(sub)}</span>` : ''}</span>${badge != null ? `<span class="badge">${esc(String(badge))}</span>` : ''}${dot ? `<span class="dot" style="background:${dot}"></span>` : ''}`;
  return it;
}

function renderSidebar() {
  const host = $('#sidebar-scroll');
  host.innerHTML = '';
  const b = S.boot || {};
  const cur = S.mode === 'browse' ? S.path : null;

  // 常用
  const specials = b.specials || [];
  if (specials.length) {
    host.appendChild(sideSection('常用', specials.map((s) => sideItem({
      icon: KIND[s.icon] || KIND.folder,
      label: s.name,
      active: samePath(cur, s.path),
      nav: 'path:' + s.path,
      titleAttr: s.path,
    }))));
  }

  // 位置
  const drives = b.drives || [];
  host.appendChild(sideSection('位置', drives.map((d) => sideItem({
    icon: KIND.drive,
    label: (d.label && d.label !== d.path) ? d.label : d.path,
    sub: d.ready ? `${humanSize(d.total - d.free, 0)} 可用` : '未就绪',
    active: samePath(cur, d.path),
    nav: 'path:' + d.path,
    titleAttr: `${d.path}  ${humanSize(d.total)}`,
  }))));

  // 收藏
  const favs = (S.settings.favorites || []);
  host.appendChild(sideSection('收藏', favs.length
    ? favs.map((f) => sideItem({
      icon: KIND.star,
      label: f.name || nameOf(f.path),
      active: samePath(cur, f.path),
      nav: 'path:' + f.path,
      titleAttr: f.path,
    }))
    : [el('div', 'side-empty', '右键文件夹可加入收藏')]));

  // 标签
  const tags = S.settings.tags || [];
  if (tags.length) {
    host.appendChild(sideSection('标签', tags.map((t) => sideItem({
      icon: ui('tag'),
      label: t.name,
      dot: t.color,
      nav: 'tag:' + t.id,
    }))));
  }

  // 智能
  host.appendChild(sideSection('智能', [
    sideItem({ icon: ui('clock'), label: '最近使用', active: S.mode === 'recents', nav: 'recents' }),
  ]));

  // 存储概览
  if (S.total) {
    const used = Math.max(0, S.total - S.free);
    const pct = S.total ? Math.min(100, (used / S.total) * 100) : 0;
    const w = el('div', 'side-storage');
    w.innerHTML = `<div class="ss-row"><span>${esc(S.driveLabel || '磁盘')}</span><span>${humanSize(S.free, 0)} 可用</span></div>
      <div class="ss-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="ss-sub">共 ${humanSize(S.total, 0)}</div>`;
    host.appendChild(w);
  }
}

function sideSection(title, items) {
  const s = el('div', 'side-section');
  s.appendChild(el('div', 'side-title', esc(title)));
  for (const it of items) if (it) s.appendChild(it);
  return s;
}

/* ---------- 面包屑 ---------- */
function renderCrumbs() {
  const host = $('#crumbs');
  host.innerHTML = '';
  if (S.mode === 'search' || S.mode === 'recents') {
    const c = el('div', 'crumb last');
    c.innerHTML = `${ui(S.mode === 'search' ? 'search' : 'clock')}<span>${esc(S.mode === 'search' ? '搜索结果' : '最近使用')}</span>`;
    if (S.mode === 'search' && S.query) c.appendChild(el('span', 'cq', esc(S.query)));
    host.appendChild(c);
    return;
  }
  const p = S.path || '';
  const segs = [];
  let acc = '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    acc = i === 0 ? parts[0] + '\\' : (acc.endsWith('\\') ? acc : acc + '\\') + parts[i];
    segs.push({ label: parts[i], path: acc });
  }
  if (p.startsWith('\\\\')) segs.unshift({ label: '网络', path: '\\\\' });

  const item = (i) => ({ seg: segs[i], first: i === 0, last: i === segs.length - 1 });
  paintCrumbs(host, segs.map((_, i) => item(i)));

  // 放不下就把中间层级折叠成 “…”（首段与末 3 段永远保留）
  if (host.scrollWidth > host.clientWidth + 1 && segs.length > 4) {
    const cutFrom = Math.max(2, segs.length - 3);
    const collapsed = [item(0)];
    const hidden = segs.slice(1, cutFrom);
    if (hidden.length) collapsed.push({ gap: hidden });
    for (let i = cutFrom; i < segs.length; i++) collapsed.push(item(i));
    host.innerHTML = '';
    paintCrumbs(host, collapsed);
  }

  // 空白处点击进入路径编辑
  const spacer = el('div', 'crumb-blank');
  spacer.title = '点击编辑路径 (Ctrl+L)';
  host.appendChild(spacer);
}

/* 面包屑绘制：item 为 { seg, first, last } 或 { gap: [seg...] } */
function paintCrumbs(host, items) {
  items.forEach((it, i) => {
    if (i > 0) host.appendChild(el('span', 'crumb-sep', ui('chevronRight')));
    if (it.gap) {
      const g = el('div', 'crumb gap');
      g.textContent = '…';
      g.title = it.gap.map((s) => s.label).join(' \\ ');
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const r = g.getBoundingClientRect();
        openMenu(r.left, r.bottom + 6, it.gap.map((s) => ({
          label: s.label,
          icon: ui('folder'),
          action: () => navigate(s.path, { push: true }),
        })));
      });
      host.appendChild(g);
      return;
    }
    const c = el('div', 'crumb' + (it.last ? ' last' : ''));
    c.dataset.path = it.seg.path;
    const label = it.first && /^[A-Za-z]:$/.test(it.seg.label) ? it.seg.label + '：' : it.seg.label;
    c.innerHTML = it.first
      ? `<span class="drive-ic">${KIND.drive}</span><span>${esc(label)}</span>`
      : `<span>${esc(label)}</span>`;
    host.appendChild(c);
  });
}

/* ---------- 过滤条 ---------- */
function renderFilters() {
  const host = $('#filters');
  if (S.mode !== 'browse' || !S.entries.length) { host.style.display = 'none'; return; }
  host.style.display = '';
  const counts = {};
  for (const e of S.entries) {
    for (const [k, fn] of Object.entries(FILTERS)) if (k !== 'all' && fn(e)) counts[k] = (counts[k] || 0) + 1;
  }
  const defs = [['all', '全部'], ['folder', '文件夹'], ['image', '图片'], ['video', '视频'], ['audio', '音频'], ['doc', '文档'], ['archive', '压缩包'], ['code', '代码'], ['other', '其他']];
  const frag = document.createDocumentFragment();
  for (const [k, label] of defs) {
    const n = k === 'all' ? S.entries.length : (counts[k] || 0);
    if (k !== 'all' && !n) continue;
    const c = el('button', 'chip' + (S.filter === k ? ' on' : ''));
    c.dataset.filter = k;
    c.innerHTML = `${esc(label)}<span class="n">${n}</span>`;
    frag.appendChild(c);
  }
  if (S.filter !== 'all' && !(counts[S.filter])) S.filter = 'all';
  if (S.truncated) {
    const w = el('span', 'chip warn');
    w.textContent = `仅显示前 ${S.count} 项`;
    frag.appendChild(w);
  }
  host.innerHTML = '';
  host.appendChild(frag);
}

/* ---------- 内容区 ---------- */
let renderToken = 0;

function renderContent() {
  const token = ++renderToken;
  const host = S.view === 'grid' ? $('#grid') : $('#list');
  $('#grid').style.display = S.view === 'grid' ? '' : 'none';
  $('#list').style.display = S.view === 'list' ? '' : 'none';
  host.innerHTML = '';

  if (S.loading) { host.appendChild(spinnerCard()); return; }

  const v = visibleEntries();
  if (!v.length) {
    const emp = el('div', 'empty');
    emp.innerHTML = S.filter !== 'all'
      ? `<div class="et">${ui('filter')}</div><div class="t">没有符合“${esc(S.filter)}”的项目</div><div class="s">试试切换筛选条件</div>`
      : S.mode === 'search'
        ? `<div class="et">${ui('search')}</div><div class="t">没有找到“${esc(S.query)}”</div><div class="s">试试更短的关键词，或用 AI 搜索</div>`
        : `<div class="et">${ui('folder')}</div><div class="t">此文件夹为空</div><div class="s">拖入文件，或按 Ctrl+Shift+N 新建文件夹</div>`;
    host.appendChild(emp);
    return;
  }

  if (S.view === 'list') {
    const head = el('div', 'lhead');
    head.innerHTML = ['name:名称', 'mtime:修改日期', 'kind:类型', 'size:大小'].map((x, i) => {
      const [f, label] = x.split(':');
      const on = S.sort === f;
      return `<div class="col-${f === 'mtime' ? 'mtime' : f === 'kind' ? 'kind' : f === 'size' ? 'size' : 'name'} sortable${on ? ' on' : ''}" data-sort="${f}">${label}${on ? `<span class="arrow">${S.desc ? ui('chevronDown') : ui('chevronUp')}</span>` : ''}</div>`;
    }).join('');
    host.appendChild(head);
  }

  const batch = 240;
  let i = 0;
  const add = () => {
    if (token !== renderToken) return;
    const end = Math.min(v.length, i + batch);
    const frag = document.createDocumentFragment();
    for (; i < end; i++) frag.appendChild(S.view === 'grid' ? gridCell(v[i]) : listRow(v[i]));
    host.appendChild(frag);
    if (i < v.length) requestAnimationFrame(add);
  };
  add();
}

function thumbUrl(e) {
  const px = Math.min(512, Math.max(64, Math.round(S.iconSize * (window.devicePixelRatio || 1))));
  return withToken(`/api/thumb?path=${encodeURIComponent(e.p)}&size=${px}&v=${e.m || 0}`);
}

function gridCell(e) {
  const c = el('div', 'cell' + (S.sel.has(e.p) ? ' sel' : ''));
  c.dataset.path = e.p;
  c.draggable = true;
  const thumb = el('div', 'thumb');
  if (isThumbnailable(e)) {
    const img = new Image();
    img.loading = 'lazy';
    img.className = 'ti';
    img.src = thumbUrl(e);
    img.alt = '';
    img.onerror = () => { img.remove(); thumb.innerHTML = kindIcon(e); };
    thumb.appendChild(img);
  } else {
    thumb.innerHTML = kindIcon(e);
  }
  if (e.h) c.classList.add('hidden-file');
  const name = el('div', 'name', esc(e.n));
  if (S.mode === 'search' && S.query) name.innerHTML = highlight(e.n, S.query);
  c.append(thumb, name);
  if (S.mode === 'search' || S.mode === 'recents') {
    const dir = parentOf(e.p);
    const sub = el('div', 'sub2', esc(shortPath(dir)));
    sub.title = dir;
    c.appendChild(sub);
  }
  const tagIds = (S.boot?.fileTags || {})[e.p];
  if (tagIds && tagIds.length) {
    const def = (S.settings.tags || []).find((t) => t.id === tagIds[0]);
    const dot = el('span', 'tagdot');
    dot.style.background = def?.color || 'var(--accent)';
    c.appendChild(dot);
  }
  return c;
}

function listRow(e) {
  const r = el('div', 'row' + (S.sel.has(e.p) ? ' sel' : ''));
  r.dataset.path = e.p;
  r.draggable = true;
  const ic = isThumbnailable(e)
    ? `<img class="ti" loading="lazy" src="${thumbUrl(e)}" alt="">`
    : kindIcon(e);
  r.innerHTML = `<span class="ic">${ic}</span>` +
    `<span class="nm">${S.mode === 'search' && S.query ? highlight(e.n, S.query) : esc(e.n)}</span>` +
    `<span class="dim c-mtime">${fmtDate(e.m)}</span>` +
    `<span class="dim c-kind">${esc(kindLabel(e))}</span>` +
    `<span class="dim c-size">${e.d ? '—' : humanSize(e.s)}</span>`;
  const img = r.querySelector('img.ti');
  if (img) img.onerror = () => { const p = img.parentElement; p.innerHTML = kindIcon(e); };
  if (e.h) r.classList.add('hidden-file');
  return r;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function highlight(text, q) {
  const t = esc(text);
  const terms = q.split(/\s+/).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return t;
  return t.replace(new RegExp('(' + terms.join('|') + ')', 'gi'), '<mark>$1</mark>');
}

/* ---------- 信息面板 ---------- */
function renderInspector() {
  const host = $('#inspector-scroll');
  if (!S.inspector) { host.innerHTML = ''; return; }
  const sel = selectedEntries();
  host.innerHTML = '';

  if (sel.length === 0) {
    host.appendChild(inspFolderInfo());
    return;
  }
  if (sel.length > 1) {
    const total = sel.reduce((a, e) => a + (e.s || 0), 0);
    const dirs = sel.filter((e) => e.d).length;
    const box = el('div');
    box.innerHTML = `<div class="insp-preview multi">${ui('copy')}</div>
      <div class="insp-name">已选择 ${sel.length} 个项目</div>
      <div class="insp-grid">
        <div class="insp-row"><span class="k">总计</span><span class="v">${humanSize(total)}</span></div>
        <div class="insp-row"><span class="k">文件夹</span><span class="v">${dirs} 个</span></div>
        <div class="insp-row"><span class="k">文件</span><span class="v">${sel.length - dirs} 个</span></div>
      </div>`;
    host.appendChild(box);
    host.appendChild(inspActions(sel));
    return;
  }

  const e = sel[0];
  const box = el('div');
  const prev = el('div', 'insp-preview');
  if (e.d) prev.innerHTML = kindIcon(e);
  else if (e.k === 'image') {
    const img = new Image();
    img.src = withToken('/api/raw?path=' + encodeURIComponent(e.p));
    img.alt = e.n;
    img.onerror = () => { prev.innerHTML = kindIcon(e); };
    prev.appendChild(img);
  } else if (isTextLike(e)) {
    prev.innerHTML = `<div class="text-preview shimmer">读取中…</div>`;
  } else {
    prev.innerHTML = kindIcon(e);
  }

  box.appendChild(prev);
  const nm = el('div', 'insp-name', esc(e.n));
  nm.title = e.n;
  nm.addEventListener('dblclick', () => startRename(e.p));
  box.appendChild(nm);

  const rows = [
    ['类型', kindLabel(e)],
    e.d ? ['大小', '—'] : ['大小', humanSize(e.s) + (e.s != null ? `（${e.s.toLocaleString()} 字节）` : '')],
    ['修改时间', fmtDate(e.m)],
    ['创建时间', fmtDate(e.c)],
    ['位置', e.p.slice(0, Math.max(0, e.p.length - e.n.length)).replace(/[\\/]+$/, '') || e.p],
  ];
  if (e.r) rows.push(['属性', '只读']);
  const grid = el('div', 'insp-grid');
  for (const [k, v] of rows) {
    const r = el('div', 'insp-row');
    r.innerHTML = `<span class="k">${esc(k)}</span><span class="v${k === '位置' ? ' wrap' : ''}">${esc(v)}</span>`;
    if (k === '位置') r.querySelector('.v').dataset.path = e.p.slice(0, Math.max(0, e.p.length - e.n.length)).replace(/[\\/]+$/, '');
    grid.appendChild(r);
  }
  box.appendChild(grid);

  // 标签
  const tags = (S.settings.tags || []);
  if (tags.length) {
    box.appendChild(el('div', 'insp-section-title', '标签'));
    const tagged = new Set(((S.boot?.fileTags || {})[e.p]) || []);
    const tl = el('div', 'tag-list');
    for (const t of tags) {
      const on = tagged.has(t.id);
      const chip = el('span', 'tag' + (on ? ' on' : ''), `<i class="tdot" style="background:${t.color}"></i>${esc(t.name)}`);
      chip.addEventListener('click', async () => {
        const next = new Set(tagged);
        on ? next.delete(t.id) : next.add(t.id);
        await api('/api/tags', { path: e.p, tags: [...next] });
        const ft = (S.boot.fileTags || (S.boot.fileTags = {}));
        ft[e.p] = [...next];
        renderInspector(); renderContent(); renderStatus();
      });
      tl.appendChild(chip);
    }
    const add = el('span', 'tag-add', '+ 新建标签');
    add.addEventListener('click', () => promptTag(e.p));
    tl.appendChild(add);
    box.appendChild(tl);
  } else {
    const add = el('div', 'tag-add', '+ 添加标签');
    add.addEventListener('click', () => promptTag(e.p));
    box.appendChild(add);
  }

  host.appendChild(box);
  host.appendChild(inspActions([e]));

  // 异步尺寸 / 文本预览
  if (e.k === 'image' && prev) {
    const im = prev.querySelector('img');
    if (im) im.addEventListener('load', () => {
      const row = el('div', 'insp-row');
      row.innerHTML = `<span class="k">尺寸</span><span class="v">${im.naturalWidth} × ${im.naturalHeight}</span>`;
      grid.insertBefore(row, grid.children[2] || null);
    });
  }
  if (!e.d && (e.k === 'image' || e.k === 'video')) {
    api('/api/preview?path=' + encodeURIComponent(e.p)).then((p) => {
      if (!p || p.kind !== 'image') return;
      const row = el('div', 'insp-row');
      row.innerHTML = `<span class="k">尺寸</span><span class="v">${p.width} × ${p.height}</span>`;
      grid.appendChild(row);
    }).catch(() => {});
  }
  if (isTextLike(e) && prev) {
    api('/api/preview?path=' + encodeURIComponent(e.p)).then((p) => {
      const tp = prev.querySelector('.text-preview');
      if (!tp) return;
      if (p && p.kind === 'text' && p.text) {
        tp.classList.remove('shimmer');
        tp.textContent = p.text.slice(0, 1600);
      } else { tp.remove(); prev.innerHTML = kindIcon(e); }
    }).catch(() => { const tp = prev.querySelector('.text-preview'); if (tp) tp.remove(); });
  }
}

function inspFolderInfo() {
  const box = el('div');
  const b = S.boot || {};
  const name = S.mode === 'browse' ? (S.name || nameOf(S.path)) : (S.mode === 'search' ? '搜索结果' : '最近使用');
  box.innerHTML = `<div class="insp-preview folder">${KIND.folder}</div>
    <div class="insp-name">${esc(name)}</div>
    <div class="insp-grid">
      ${S.mode === 'browse' ? `<div class="insp-row"><span class="k">项目</span><span class="v">${S.entries.length} 个${S.truncated ? '（已截断）' : ''}</span></div>
      <div class="insp-row"><span class="k">磁盘可用</span><span class="v">${S.total ? humanSize(S.free) : '—'}</span></div>` : ''}
      <div class="insp-row"><span class="k">索引</span><span class="v">${S.index && S.index.total ? S.index.total.toLocaleString() + ' 个文件' : '未建立'}</span></div>
    </div>`;
  if (S.index && !S.index.total) {
    const b2 = el('button', 'btn ghost', '建立索引');
    b2.style.margin = '10px 12px';
    b2.addEventListener('click', async () => { await api('/api/index/rescan', {}); toast('已开始后台建立索引'); pollIndex(); });
    box.appendChild(b2);
  }
  return box;
}

function inspActions(sel) {
  const one = sel.length === 1 ? sel[0] : null;
  const acts = [];
  if (one) {
    acts.push(['open', ui('open'), one.d ? '打开文件夹' : '打开', () => openEntry(one)]);
    if (one.d) acts.push(['ask', ui('sparkles'), 'AI 整理此文件夹', () => aiOrganize(one.p)]);
    acts.push(['rename', ui('rename'), '重命名', () => startRename(one.p)]);
    acts.push(['copy', ui('copy'), '复制副本', () => op('duplicate', { paths: sel.map((x) => x.p) }).then(refresh)]);
    if (!one.d) acts.push(['askfile', ui('zap'), '用 AI 总结', () => aiAsk([one.p], '简要总结这个文件的内容要点。')]);
    acts.push(['tag', ui('tag'), '编辑标签', () => promptTag(one.p)]);
  }
  acts.push(['trash', ui('trash'), '移到回收站', () => trashPaths(sel.map((x) => x.p))]);
  const wrap = el('div', 'insp-actions');
  for (const [id, icon, label, fn] of acts) {
    const b = el('button', 'iact' + (id === 'trash' ? ' danger' : ''));
    b.dataset.act = id;
    b.innerHTML = `${icon}<span>${label}</span>`;
    b.addEventListener('click', fn);
    wrap.appendChild(b);
  }
  return wrap;
}

/* ---------- 状态栏 ---------- */
function renderStatus() {
  const v = visibleEntries();
  const n = S.sel.size;
  let txt;
  if (S.loading) txt = '正在读取…';
  else if (S.mode === 'search') txt = `找到 ${S.entries.length} 个结果${n ? `，已选 ${n} 个` : ''}`;
  else if (S.mode === 'recents') txt = `${S.entries.length} 个最近项目${n ? `，已选 ${n} 个` : ''}`;
  else txt = `${S.count} 个项目${S.filter !== 'all' ? `（筛出 ${v.length}）` : ''}${n ? `，已选 ${n} 个` : ''}`;
  $('#st-count').textContent = txt;
  $('#st-space').textContent = S.total ? `${humanSize(S.free, 1)} 可用 / ${humanSize(S.total, 0)}` : '';
  const p = $('#st-index');
  p.className = 'index-pill';
  if (S.index) {
    const m = { idle: '索引就绪', scanning: '正在索引', done: '索引就绪', error: '索引异常', none: '未建立索引' };
    let label = m[S.index.state] || S.index.state || '';
    if (S.index.state === 'scanning') {
      label = `正在索引 ${S.index.scanned ? S.index.scanned.toLocaleString() : 0}`;
      p.classList.add('scanning');
    }
    if (S.index.state === 'error') p.classList.add('error');
    if (S.index.total && (S.index.state === 'idle' || S.index.state === 'done')) {
      label = `已索引 ${S.index.total.toLocaleString()}`;
    }
    p.querySelector('span').textContent = label;
  }
}

async function pollIndex() {
  try {
    const st = await api('/api/index/status');
    const changed = !S.index || st.state !== S.index.state || st.scanned !== S.index.scanned || st.total !== S.index.total;
    S.index = st;
    if (changed) renderStatus();
    if (changed && st.state === 'idle' && st.total) {
      // 索引完成后若正在搜索，刷新结果
      if (S.mode === 'search' && S.query) doSearch(S.query, true);
    }
  } catch { /* 忽略 */ }
}

/* ---------------------------- 事件接线 ---------------------------- */
function wireChrome() {
  const win = (a) => api('/api/window/' + a, {}).catch(() => {});
  $('#tl-close').addEventListener('click', () => win('close'));
  $('#tl-min').addEventListener('click', () => win('min'));
  $('#tl-max').addEventListener('click', () => win('max'));
  $('#drag-region').addEventListener('dblclick', () => win('max'));
  $('#drag-region').addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.detail === 2) return;
    win('drag');
  });
  $('#win-title').addEventListener('dblclick', () => win('max'));

  // 边缘拖拽改大小：WebView2 铺满整块客户区，系统收不到边缘的命中测试，
  // 所以由页面判断鼠标是否贴边，再让宿主进入改变大小的循环。
  const EDGE = 6;
  const CURSORS = {
    top: 'ns-resize', bottom: 'ns-resize', left: 'ew-resize', right: 'ew-resize',
    topleft: 'nwse-resize', topright: 'nesw-resize', bottomleft: 'nesw-resize', bottomright: 'nwse-resize',
  };
  const edgeAt = (e) => {
    const x = e.clientX, y = e.clientY;
    const l = x <= EDGE, r = x >= innerWidth - EDGE;
    const t = y <= EDGE, b = y >= innerHeight - EDGE;
    return (t ? 'top' : '') + (b ? 'bottom' : '') + (l ? 'left' : '') + (r ? 'right' : '');
  };
  document.addEventListener('mousemove', (e) => {
    const edge = edgeAt(e);
    const want = CURSORS[edge] || '';
    if (document.documentElement.style.cursor !== want) {
      document.documentElement.style.cursor = want;
    }
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const edge = edgeAt(e);
    if (!edge) return;
    e.preventDefault();
    e.stopPropagation();
    api('/api/window/resize', { edge }).catch(() => {});
  }, true);
  $('#tab-new').innerHTML = ui('plus');
  $('#tab-new').addEventListener('click', () => newTab());

  $('#btn-new').addEventListener('click', newFolder);
  $('#btn-refresh').addEventListener('click', refresh);
  $('#btn-palette').addEventListener('click', () => openPalette(''));
  $('#btn-ai').addEventListener('click', () => openAiPanel());
  $('#btn-settings').addEventListener('click', () => openSettings());
  $('#nav-back').addEventListener('click', goBack);
  $('#nav-fwd').addEventListener('click', goFwd);
  $('#nav-up').addEventListener('click', goUp);
  $('#view-grid').addEventListener('click', () => setView('grid'));
  $('#view-list').addEventListener('click', () => setView('list'));
  $('#btn-inspector').addEventListener('click', () => {
    S.inspector = !S.inspector;
    localStorage.setItem('aurora.inspector', S.inspector ? '1' : '0');
    renderAll();
  });
  $('#btn-more').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMainMenu(r.left - 190, r.bottom + 6);
  });

  // 搜索
  const input = $('#search');
  let timer = 0;
  input.addEventListener('input', () => {
    $('#search-clear').style.display = input.value ? '' : 'none';
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) {
      if (S.mode === 'search') navigate(S.path || S.settings.roots?.[0] || 'D:\\', { push: false });
      return;
    }
    timer = setTimeout(() => { if (q.length >= 2) doSearch(q); }, 260);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (!q) return;
      if (e.ctrlKey || e.metaKey) aiSearch(q); else doSearch(q);
    } else if (e.key === 'Escape') {
      input.blur();
      if (S.mode === 'search') { input.value = ''; $('#search-clear').style.display = 'none'; navigate(S.path, { push: false }); }
    }
  });
  $('#search-clear').addEventListener('click', () => {
    input.value = '';
    $('#search-clear').style.display = 'none';
    if (S.mode === 'search') navigate(S.path, { push: false });
    input.focus();
  });
  $('#search-icon').addEventListener('click', () => input.focus());
  $('#ai-chip').addEventListener('click', () => {
    const q = input.value.trim();
    if (q) aiSearch(q); else { input.focus(); toast('先用一句话描述你要找的东西，例如“上个月的设计稿”'); }
  });

  // 过滤
  $('#filters').addEventListener('click', (e) => {
    const c = e.target.closest('.chip[data-filter]');
    if (!c) return;
    S.filter = c.dataset.filter;
    S.cursor = 0;
    renderFilters(); renderContent(); renderStatus();
  });

  // 面包屑
  $('#crumbs').addEventListener('click', (e) => {
    const blank = e.target.closest('.crumb-blank');
    if (blank) { editPath(); return; }
    const c = e.target.closest('.crumb[data-path]');
    if (c) navigate(c.dataset.path, { push: true });
  });
  $('#crumbs').addEventListener('contextmenu', (e) => {
    const c = e.target.closest('.crumb[data-path]');
    if (!c) return;
    e.preventDefault();
    openPathMenu(c.dataset.path, e.clientX, e.clientY);
  });

  // 侧栏
  $('#sidebar').addEventListener('click', (e) => {
    const it = e.target.closest('.side-item');
    if (!it || !it.dataset.nav) return;
    const nav = it.dataset.nav;
    if (nav === 'recents') return loadRecents();
    if (nav.startsWith('path:')) return navigate(nav.slice(5), { push: true });
    if (nav.startsWith('tag:')) return filterByTag(nav.slice(4));
  });
  $('#sidebar').addEventListener('contextmenu', (e) => {
    const it = e.target.closest('.side-item');
    if (!it) return;
    const nav = it.dataset.nav || '';
    if (!nav.startsWith('path:')) return;
    e.preventDefault();
    openPathMenu(nav.slice(5), e.clientX, e.clientY);
  });

  // 内容区
  const content = $('#content');
  content.addEventListener('click', (e) => {
    const node = e.target.closest('[data-path]');
    if (!node) { clearSelection(); return; }
    const ent = S.entries.find((x) => samePath(x.p, node.dataset.path));
    if (ent) clickEntry(ent, e);
    if (e.detail === 2) return;
    if (S.renaming && !samePath(S.renaming, ent?.p)) cancelRename();
  });
  content.addEventListener('dblclick', (e) => {
    const node = e.target.closest('[data-path]');
    if (!node) return;
    if (S.renaming) return;
    const ent = S.entries.find((x) => samePath(x.p, node.dataset.path));
    if (ent) openEntry(ent);
  });
  content.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const node = e.target.closest('[data-path]');
    if (node) {
      const ent = S.entries.find((x) => samePath(x.p, node.dataset.path));
      if (ent && !S.sel.has(ent.p)) { const v = visibleEntries(); const i = v.findIndex((x) => samePath(x.p, ent.p)); setSelection([ent.p], i); }
      if (ent) openEntryMenu(ent, e.clientX, e.clientY);
    } else {
      openBlankMenu(e.clientX, e.clientY);
    }
  });
  content.addEventListener('scroll', () => { closeMenu(); }, { passive: true });

  // 列表头排序
  $('#list').addEventListener('click', (e) => {
    const h = e.target.closest('.sortable[data-sort]');
    if (!h) return;
    const f = h.dataset.sort;
    if (S.sort === f) S.desc = !S.desc; else { S.sort = f; S.desc = false; }
    api('/api/settings', { sortField: S.sort, sortDesc: S.desc }).catch(() => {});
    renderContent(); renderStatus();
  });

  // 双击空白处返回上级
  content.addEventListener('dblclick', (e) => {
    if (!e.target.closest('[data-path]')) goUp();
  });

  // 状态下标点击
  $('#st-index').addEventListener('click', () => openIndexSheet());
}

function setView(v) {
  S.view = v;
  localStorage.setItem('aurora.view', v);
  S.cursor = Math.min(S.cursor, Math.max(0, visibleEntries().length - 1));
  renderAll();
}

function gridCols() {
  const cells = $$('#grid .cell');
  if (!cells.length) return 1;
  const top = cells[0].offsetTop;
  let n = 0;
  for (const c of cells) { if (c.offsetTop === top) n++; else break; }
  return Math.max(1, n);
}

function moveCursor(delta, absolute) {
  const v = visibleEntries();
  if (!v.length) return;
  let i = absolute != null ? absolute : S.cursor + delta;
  i = Math.max(0, Math.min(v.length - 1, i));
  S.cursor = i; S.anchor = i;
  setSelection([v[i].p], i);
  scrollIntoView(v[i].p);
}

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLElement &&
      (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);

    if (e.key === 'Escape') {
      if ($('#palette')) return closePalette();
      if ($('#quicklook.show')) return closeQuickLook();
      if ($('#menu-root .menu')) return closeMenu();
      if ($('#overlay').classList.contains('show')) return closeSheet();
      if (S.renaming) return cancelRename();
      if (S.sel.size) { clearSelection(); return; }
      if (S.mode === 'search') { $('#search').value = ''; navigate(S.path, { push: false }); return; }
      return;
    }
    if (typing) return;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(''); }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); return $('#search').focus(); }
    if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); return openAiPanel(); }
    if (mod && e.key === ',') { e.preventDefault(); return openSettings(); }
    if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); return editPath(); }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); return setSelection(visibleEntries().map((x) => x.p), S.cursor); }
    if (mod && e.key.toLowerCase() === 'c') { return copySel('copy'); }
    if (mod && e.key.toLowerCase() === 'x') { return copySel('cut'); }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); return paste(); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); return newFolder(); }
    if (mod && e.key === '1') { e.preventDefault(); return setView('grid'); }
    if (mod && e.key === '2') { e.preventDefault(); return setView('list'); }
    if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); return refresh(); }
    if (mod && e.key.toLowerCase() === 't') { e.preventDefault(); return newTab(); }
    if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); return closeTab(S.tabIndex); }
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      if (S.tabs.length > 1) selectTab((S.tabIndex + (e.shiftKey ? S.tabs.length - 1 : 1)) % S.tabs.length);
      return;
    }
    if (e.key === 'F5') { e.preventDefault(); return refresh(); }
    if (e.key === 'F2') { e.preventDefault(); const s = selectedEntries(); if (s.length === 1) startRename(s[0].p); return; }
    if (e.key === 'Delete') { e.preventDefault(); const s = selectedEntries(); if (s.length) e.shiftKey ? deletePaths(s.map((x) => x.p)) : trashPaths(s.map((x) => x.p)); return; }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); return goBack(); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); return goFwd(); }
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); return goUp(); }
    if (e.key === 'Backspace') { e.preventDefault(); return goUp(); }
    if (e.key === ' ') { e.preventDefault(); const s = selectedEntries(); if (s.length === 1) toggleQuickLook(s[0]); return; }
    if (e.key === 'Enter') { const s = selectedEntries(); if (s.length) { e.preventDefault(); openEntry(s[0]); } return; }
    if (e.key === 'Home') { e.preventDefault(); return moveCursor(0, 0); }
    if (e.key === 'End') { e.preventDefault(); return moveCursor(0, visibleEntries().length - 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); return moveCursor(S.view === 'grid' ? gridCols() : 1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); return moveCursor(S.view === 'grid' ? -gridCols() : -1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); return moveCursor(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); return moveCursor(-1); }
  });
}

/* ---------------------------- 拖放 ---------------------------- */
function wireDragDrop() {
  const content = $('#content');
  content.addEventListener('dragstart', (e) => {
    const node = e.target.closest('[data-path]');
    if (!node) return;
    const p = node.dataset.path;
    S.dragPaths = S.sel.has(p) ? [...S.sel] : [p];
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', S.dragPaths.join('\n'));
    document.body.classList.add('dragging');
  });
  content.addEventListener('dragend', () => {
    document.body.classList.remove('dragging');
    S.dragPaths = [];
    $$('.drop-target').forEach((n) => n.classList.remove('drop-target'));
  });
  const over = (e) => {
    const node = e.target.closest('[data-path]');
    if (!node) return;
    const ent = S.entries.find((x) => samePath(x.p, node.dataset.path));
    if (!ent || !ent.d) return;
    if (S.dragPaths.some((p) => samePath(p, ent.p) || ent.p.toLowerCase().startsWith(p.toLowerCase() + '\\'))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
    $$('.drop-target').forEach((n) => n !== node && n.classList.remove('drop-target'));
    node.classList.add('drop-target');
  };
  content.addEventListener('dragover', over);
  content.addEventListener('dragleave', (e) => {
    const node = e.target.closest('[data-path]');
    if (node) node.classList.remove('drop-target');
  });
  content.addEventListener('drop', async (e) => {
    const node = e.target.closest('[data-path]');
    $$('.drop-target').forEach((n) => n.classList.remove('drop-target'));
    if (!node || !S.dragPaths.length) return;
    e.preventDefault();
    const target = node.dataset.path;
    const move = !e.ctrlKey;
    const paths = S.dragPaths.slice();
    S.dragPaths = [];
    const r = await op(move ? 'move' : 'copy', { paths, target });
    if (r && r.ok) { toast(move ? `已移动 ${r.count ?? paths.length} 项` : `已复制 ${r.count ?? paths.length} 项`, 'ok'); refresh(); }
  });

  // 拖到侧栏 / 面包屑
  const dropZone = (root) => {
    root.addEventListener('dragover', (e) => {
      const node = e.target.closest('[data-nav^="path:"],.crumb[data-path]');
      if (!node || !S.dragPaths.length) return;
      e.preventDefault();
      node.classList.add('drop-target');
    });
    root.addEventListener('dragleave', (e) => {
      const node = e.target.closest('[data-nav^="path:"],.crumb[data-path]');
      if (node) node.classList.remove('drop-target');
    });
    root.addEventListener('drop', async (e) => {
      const node = e.target.closest('[data-nav^="path:"],.crumb[data-path]');
      $$('.drop-target').forEach((n) => n.classList.remove('drop-target'));
      if (!node || !S.dragPaths.length) return;
      e.preventDefault();
      const target = node.dataset.path || (node.dataset.nav || '').slice(5);
      if (!target) return;
      const paths = S.dragPaths.slice(); S.dragPaths = [];
      const r = await op(e.ctrlKey ? 'copy' : 'move', { paths, target });
      if (r && r.ok) { toast(`已${e.ctrlKey ? '复制' : '移动'} ${r.count ?? paths.length} 项`, 'ok'); refresh(); }
    });
  };
  dropZone($('#sidebar'));
  dropZone($('#crumbs'));

  // 阻止浏览器默认的整页拖放
  window.addEventListener('dragover', (e) => { if (!e.target.closest('#content,#sidebar,#crumbs')) e.preventDefault(); });
  window.addEventListener('drop', (e) => e.preventDefault());
}

/* ---------------------------- 菜单 ---------------------------- */
function closeMenu() { $('#menu-root').innerHTML = ''; }

function openMenu(x, y, items) {
  closeMenu();
  const m = el('div', 'menu');
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { m.appendChild(el('div', 'menu-sep')); continue; }
    if (it.header) { m.appendChild(el('div', 'menu-label', esc(it.header))); continue; }
    const row = el('div', 'menu-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : ''));
    row.innerHTML = `<span class="mi">${it.icon || ''}</span><span class="ml">${esc(it.label)}</span>${it.shortcut ? `<span class="sc">${esc(it.shortcut)}</span>` : ''}`;
    if (!it.disabled) {
      row.addEventListener('click', () => { closeMenu(); it.action && it.action(); });
    }
    m.appendChild(row);
  }
  $('#menu-root').appendChild(m);
  const r = m.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - r.width - 10);
  const py = Math.min(y, window.innerHeight - r.height - 10);
  m.style.left = Math.max(8, px) + 'px';
  m.style.top = Math.max(8, py) + 'px';
  setTimeout(() => {
    document.addEventListener('mousedown', onDocDownMenu, true);
    document.addEventListener('contextmenu', onDocDownMenu, true);
  }, 0);
}

function onDocDownMenu(e) {
  if (e.target.closest('.menu')) return;
  closeMenu();
  document.removeEventListener('mousedown', onDocDownMenu, true);
  document.removeEventListener('contextmenu', onDocDownMenu, true);
}

function openEntryMenu(ent, x, y) {
  const sel = selectedEntries();
  const one = sel.length === 1 ? sel[0] : null;
  const paths = sel.map((s) => s.p);
  const isZip = one && !one.d && /\.(zip|7z|rar|tar|gz)$/i.test(one.n);
  const favd = (S.settings.favorites || []).some((f) => samePath(f.path, ent.p));
  openMenu(x, y, [
    { label: one ? (one.d ? '打开文件夹' : '打开') : `打开 ${sel.length} 个项目`, icon: ui('open'), shortcut: 'Enter', action: () => openEntry(ent) },
    one && one.d ? { label: '在新标签页打开', icon: ui('columns'), shortcut: 'Ctrl T', action: () => newTab(one.p) } : null,
    one && !one.d ? { label: '打开方式…', icon: ui('external'), action: () => op('openwith', { path: one.p }) } : null,
    { label: '在资源管理器中显示', icon: ui('external'), action: () => op('reveal', { path: ent.p }) },
    { label: '复制路径', icon: ui('copy'), action: () => copyText(paths.join('\n')) },
    { sep: true },
    { label: '复制', icon: ui('copy'), shortcut: 'Ctrl C', action: () => copySel('copy') },
    { label: '剪切', icon: ui('scissors'), shortcut: 'Ctrl X', action: () => copySel('cut') },
    { label: '粘贴', icon: ui('paste'), shortcut: 'Ctrl V', disabled: !S.clipboard || !one?.d, action: () => paste(one?.d ? one.p : null) },
    { label: '创建副本', icon: ui('copy'), action: () => op('duplicate', { paths }).then(refresh) },
    { sep: true },
    { label: '重命名', icon: ui('rename'), shortcut: 'F2', disabled: sel.length !== 1, action: () => startRename(ent.p) },
    { label: '移到回收站', icon: ui('trash'), shortcut: 'Del', danger: true, action: () => trashPaths(paths) },
    { label: '永久删除', icon: ui('trash'), shortcut: 'Shift Del', danger: true, action: () => deletePaths(paths) },
    { sep: true },
    { label: '压缩为 ZIP', icon: ui('zip'), action: () => zipSel(paths) },
    isZip ? { label: '解压到此处', icon: ui('zip'), action: () => extractZip(one.p) } : null,
    { sep: true },
    { label: favd ? '取消收藏' : '添加到收藏', icon: ui('star'), action: () => toggleFav(ent.p) },
    { label: '编辑标签…', icon: ui('tag'), action: () => promptTag(ent.p) },
    { label: '显示属性', icon: ui('info'), action: () => showProps(ent.p) },
    { sep: true },
    one && !one.d ? { label: 'AI · 总结这个文件', icon: ui('sparkles'), action: () => aiAsk([one.p], '用中文简要总结这个文件的内容要点，控制在 200 字以内。') } : null,
    { label: 'AI · 智能重命名…', icon: ui('sparkles'), disabled: (S.boot?.ai?.providers || []).length === 0, action: () => aiRename(paths) },
    one && one.d ? { label: 'AI · 整理这个文件夹…', icon: ui('sparkles'), disabled: (S.boot?.ai?.providers || []).length === 0, action: () => aiOrganize(one.p) } : null,
  ].filter(Boolean));
}

function openBlankMenu(x, y) {
  openMenu(x, y, [
    { label: '新建文件夹', icon: ui('folderPlus'), shortcut: 'Ctrl Shift N', action: newFolder },
    { label: '新建文本文件', icon: ui('file'), action: () => newFile() },
    { label: '粘贴', icon: ui('paste'), shortcut: 'Ctrl V', disabled: !S.clipboard, action: () => paste() },
    { sep: true },
    { label: '选择全部', icon: ui('check'), shortcut: 'Ctrl A', action: () => setSelection(visibleEntries().map((e) => e.p), S.cursor) },
    { label: S.hidden ? '隐藏系统/隐藏文件' : '显示隐藏文件', icon: ui('eye'), action: toggleHidden },
    { label: '排序方式…', icon: ui('sortAsc'), action: () => openSortMenu(x, y) },
    { sep: true },
    { label: 'AI · 整理这个文件夹…', icon: ui('sparkles'), disabled: !S.path || (S.boot?.ai?.providers || []).length === 0, action: () => aiOrganize(S.path) },
    { label: '刷新', icon: ui('refresh'), shortcut: 'F5', action: refresh },
    { sep: true },
    { label: '在此处打开终端', icon: ui('terminal'), action: () => op('terminal', { path: S.path }) },
  ]);
}

function openPathMenu(path, x, y) {
  const favd = (S.settings.favorites || []).some((f) => samePath(f.path, path));
  openMenu(x, y, [
    { label: '打开', icon: ui('open'), action: () => navigate(path, { push: true }) },
    { label: '在新标签页打开', icon: ui('columns'), action: () => newTab(path) },
    { sep: true },
    { label: '粘贴到此文件夹', icon: ui('paste'), disabled: !S.clipboard, action: () => paste(path) },
    { label: '复制路径', icon: ui('copy'), action: () => copyText(path) },
    { label: favd ? '取消收藏' : '添加到收藏', icon: ui('star'), action: () => toggleFav(path) },
    { sep: true },
    { label: '在资源管理器中打开', icon: ui('external'), action: () => op('open', { path }) },
    { label: '属性', icon: ui('info'), action: () => showProps(path) },
  ]);
}

function openSortMenu(x, y) {
  const items = [['name', '名称'], ['mtime', '修改日期'], ['ctime', '创建日期'], ['size', '大小'], ['kind', '类型']];
  openMenu(x, y, items.map(([f, label]) => ({
    label: (S.sort === f ? '✓ ' : '') + label + (S.sort === f ? (S.desc ? ' ↓' : ' ↑') : ''),
    action: () => {
      if (S.sort === f) S.desc = !S.desc; else { S.sort = f; S.desc = false; }
      api('/api/settings', { sortField: S.sort, sortDesc: S.desc }).catch(() => {});
      renderContent(); renderStatus();
    },
  })));
}

function openMainMenu(x, y) {
  openMenu(x, y, [
    { label: '设置…', icon: ui('gear'), shortcut: 'Ctrl ,', action: openSettings },
    { label: 'AI 助手…', icon: ui('sparkles'), shortcut: 'Ctrl J', action: () => openAiPanel() },
    { label: '命令面板', icon: ui('zap'), shortcut: 'Ctrl K', action: () => openPalette('') },
    { sep: true },
    { label: S.hidden ? '隐藏隐藏文件' : '显示隐藏文件', icon: ui('eye'), action: toggleHidden },
    { label: '视图：网格', icon: ui('grid'), shortcut: 'Ctrl 1', action: () => setView('grid') },
    { label: '视图：列表', icon: ui('list'), shortcut: 'Ctrl 2', action: () => setView('list') },
    { label: '重新索引 D 盘', icon: ui('refresh'), action: () => openIndexSheet() },
    { sep: true },
    { label: '快捷键一览', icon: ui('help'), action: showShortcuts },
  ]);
}

async function toggleHidden() {
  S.hidden = !S.hidden;
  await api('/api/settings', { showHidden: S.hidden }).catch(() => {});
  await refresh();
}

/* ---------------------------- 提示 ---------------------------- */
function toast(msg, kind, ms) {
  const t = el('div', 'toast' + (kind ? ' ' + kind : ''), esc(msg));
  $('#toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 220);
  }, ms || (kind === 'err' ? 5000 : 2600));
}

/* ---------------------------- 弹层 ---------------------------- */
function sheet(title, bodyHTML, footHTML, opts = {}) {
  const ov = $('#overlay');
  ov.innerHTML = '';
  const box = el('div', 'sheet' + (opts.wide ? ' wide' : ''));
  box.innerHTML = `<div class="sheet-head"><div class="sheet-title">${esc(title)}</div><button class="gbtn sheet-x">${ui('x')}</button></div><div class="sheet-body">${bodyHTML || ''}</div>`;
  if (footHTML) box.insertAdjacentHTML('beforeend', `<div class="sheet-foot">${footHTML}</div>`);
  ov.appendChild(box);
  ov.classList.add('show');
  const close = () => closeSheet();
  ov.onmousedown = (e) => { if (e.target === ov) close(); };
  box.querySelector('.sheet-x').onclick = close;
  return box;
}
function closeSheet() {
  const ov = $('#overlay');
  ov.classList.remove('show');
  ov.innerHTML = '';
}

/* ---------------------------- 文件操作 ---------------------------- */
async function op(name, body) {
  try {
    const r = await api('/api/op', Object.assign({ op: name }, body));
    if (r && r.ok === false) toast(r.error || '操作失败', 'err');
    return r;
  } catch (e) {
    toast('操作失败：' + (e.message || e), 'err');
    return { ok: false, error: String(e) };
  }
}

function openEntry(ent) {
  if (!ent) return;
  if (ent.d) return navigate(ent.p, { push: true });
  return op('open', { path: ent.p });
}

async function newFolder() {
  if (S.mode !== 'browse') return toast('请先进入一个文件夹', 'err');
  const r = await op('mkdir', { target: S.path, name: '新建文件夹' });
  if (!r || !r.ok) return;
  await refresh();
  if (r.path) { selectByPath(r.path); startRename(r.path); }
}

async function newFile() {
  if (S.mode !== 'browse') return toast('请先进入一个文件夹', 'err');
  const r = await op('newfile', { target: S.path, name: '未命名.txt' });
  if (!r || !r.ok) return;
  await refresh();
  if (r.path) { selectByPath(r.path); startRename(r.path); }
}

function selectByPath(p) {
  const v = visibleEntries();
  const i = v.findIndex((x) => samePath(x.p, p));
  if (i >= 0) setSelection([v[i].p], i);
}

/* ---------- 重命名 ---------- */
function startRename(path) {
  cancelRename();
  const node = $(`#content [data-path="${cssEsc(path)}"]`);
  if (!node) return;
  S.renaming = path;
  const target = node.classList.contains('row') ? node.querySelector('.nm') : node.querySelector('.name');
  if (!target) return;
  const old = nameOf(path);
  const input = el('input', 'rename-input');
  input.value = old;
  input.spellcheck = false;
  target.textContent = '';
  target.appendChild(input);
  const dot = old.lastIndexOf('.');
  input.focus();
  if (!node.classList.contains('row') && dot > 0) input.setSelectionRange(0, dot);
  else input.select();

  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const val = input.value.trim();
    if (!commit || !val || val === old) { S.renaming = null; await renderAfterRename(); return; }
    const r = await op('rename', { path, name: val });
    S.renaming = null;
    if (r && r.ok) {
      toast('已重命名为 ' + val, 'ok');
      await refresh();
      if (r.path) selectByPath(r.path);
    } else {
      await renderAfterRename();
    }
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
}

async function renderAfterRename() {
  await refresh();
}

function cancelRename() {
  if (!S.renaming) return;
  const input = $('.rename-input');
  S.renaming = null;
  if (input) input.blur();
  renderContent();
}

/* ---------- 删除 ---------- */
async function trashPaths(paths) {
  if (!paths || !paths.length) return;
  const r = await op('trash', { paths });
  if (r && r.ok) { toast(`已将 ${r.count ?? paths.length} 项移到回收站`); refresh(); }
}
async function deletePaths(paths) {
  if (!paths || !paths.length) return;
  const names = paths.slice(0, 4).map((p) => '· ' + nameOf(p)).join('<br>');
  sheet('永久删除？', `<p class="hint">以下 ${paths.length} 个项目将被永久删除，无法恢复：</p><div class="del-list">${names}${paths.length > 4 ? '<br>…' : ''}</div>`,
    `<button class="btn ghost" data-a="no">取消</button><button class="btn danger" data-a="yes">永久删除</button>`);
  $('#overlay .sheet-foot').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    closeSheet();
    if (a !== 'yes') return;
    const r = await op('delete', { paths });
    if (r && r.ok) { toast(`已永久删除 ${r.count ?? paths.length} 项`, 'ok'); refresh(); }
  });
}

/* ---------- 剪贴板 ---------- */
function copySel(mode) {
  const sel = selectedEntries();
  if (!sel.length) return;
  S.clipboard = { mode, paths: sel.map((e) => e.p) };
  toast(mode === 'copy' ? `已复制 ${sel.length} 项` : `已剪切 ${sel.length} 项`);
}
async function paste(targetDir) {
  if (!S.clipboard) return;
  const target = targetDir || S.path;
  if (S.mode !== 'browse' && !targetDir) return toast('请先进入目标文件夹', 'err');
  const { mode, paths } = S.clipboard;
  const r = await op(mode === 'cut' ? 'move' : 'copy', { paths, target });
  if (r && r.ok) {
    toast((mode === 'cut' ? '已移动 ' : '已复制 ') + (r.count ?? paths.length) + ' 项', 'ok');
    if (mode === 'cut') S.clipboard = null;
    refresh();
  }
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('已复制到剪贴板'); }
  catch { toast('复制失败', 'err'); }
}

/* ---------- 压缩 ---------- */
async function zipSel(paths) {
  const base = nameOf(paths[0]) .replace(/\.[^.]*$/, '') || '归档';
  const name = paths.length > 1 ? `${nameOf(S.path) || 'archive'}.zip` : base + '.zip';
  const r = await op('zip', { paths, target: S.path, name });
  if (r && r.ok) { toast('已压缩为 ' + name, 'ok'); refresh(); }
}
async function extractZip(path) {
  const r = await op('extract', { path, target: S.path });
  if (r && r.ok) { toast('已解压', 'ok'); refresh(); }
}

/* ---------- 收藏 / 标签 / 属性 ---------- */
async function toggleFav(path) {
  const r = await api('/api/fav', { path }).catch(() => null);
  if (!r || !r.ok) return;
  S.settings.favorites = r.favorites || [];
  if (S.boot) S.boot.settings.favorites = S.settings.favorites;
  renderSidebar();
  toast('已更新收藏');
}

async function promptTag(path) {
  const tags = S.settings.tags || [];
  const cur = new Set(((S.boot?.fileTags || {})[path]) || []);
  const body = `<div class="tag-pick">${tags.map((t) => `<label class="tag-l" data-id="${t.id}"><input type="checkbox" ${cur.has(t.id) ? 'checked' : ''}><i class="tdot" style="background:${t.color}"></i>${esc(t.name)}</label>`).join('')}</div>
    <div class="row2" style="margin-top:14px"><input class="input" id="newtag" placeholder="新标签名称"><button class="btn" id="addtag">新建</button></div>`;
  sheet('编辑标签', body, `<button class="btn ghost" data-a="cancel">取消</button><button class="btn primary" data-a="ok">保存</button>`);
  const box = $('#overlay .sheet');
  box.querySelector('#addtag').onclick = async () => {
    const name = box.querySelector('#newtag').value.trim();
    if (!name) return;
    const r = await api('/api/tagdef', { name, color: pickColor() }).catch(() => null);
    if (r && r.ok) {
      S.settings.tags = r.tags;
      if (S.boot) { S.boot.settings.tags = r.tags; }
      closeSheet(); promptTag(path); renderSidebar();
    }
  };
  box.querySelector('.sheet-foot').onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'cancel') return closeSheet();
    const ids = $$('.tag-l', box).filter((l) => l.querySelector('input').checked).map((l) => l.dataset.id);
    const r = await api('/api/tags', { path, tags: ids }).catch(() => null);
    if (r && r.ok) {
      S.boot.fileTags = S.boot.fileTags || {};
      if (ids.length) S.boot.fileTags[path] = ids;
      else delete S.boot.fileTags[path];
      closeSheet(); renderInspector(); renderContent(); toast('标签已更新');
    }
  };
}
function pickColor() {
  const c = ['#0A84FF', '#FF375F', '#30D158', '#FF9F0A', '#BF5AF2', '#64D2FF', '#FFD60A', '#FF6482'];
  return c[Math.floor(Math.random() * c.length)];
}

async function showProps(path) {
  const ent = S.entries.find((e) => samePath(e.p, path));
  sheet('属性', `<div class="props"><div class="p-name">${esc(nameOf(path))}</div>
    <div class="p-path">${esc(path)}</div>
    <div class="insp-grid" id="props-grid">
      <div class="insp-row"><span class="k">类型</span><span class="v">${ent ? esc(kindLabel(ent)) : '—'}</span></div>
      <div class="insp-row"><span class="k">大小</span><span class="v" id="pg-size">${ent && !ent.d ? humanSize(ent.s) : '计算中…'}</span></div>
      <div class="insp-row"><span class="k">修改时间</span><span class="v">${fmtDate(ent?.m)}</span></div>
      <div class="insp-row"><span class="k">创建时间</span><span class="v">${fmtDate(ent?.c)}</span></div>
    </div></div>`, `<button class="btn ghost" data-a="close">关闭</button>`);
  $('#overlay .sheet-foot').onclick = (e) => { if (e.target.closest('[data-a]')) closeSheet(); };
  const r = await api('/api/stat?path=' + encodeURIComponent(path)).catch(() => null);
  const g = $('#props-grid');
  if (!g) return;
  if (r && r.ok) {
    if (r.isDir) {
      g.insertAdjacentHTML('beforeend', `<div class="insp-row"><span class="k">包含</span><span class="v">${r.files} 个文件，${r.dirs} 个文件夹</span></div>`);
      $('#pg-size').textContent = humanSize(r.size);
    }
  } else if (r && r.error) {
    $('#pg-size').textContent = '—';
  }
}

/* ---------------------------- 搜索 ---------------------------- */
async function doSearch(q, silent) {
  q = (q || '').trim();
  if (!q) return;
  S.mode = 'search';
  S.query = q;
  S.filter = 'all';
  S.loading = true;
  renderContent(); renderStatus(); renderCrumbs(); renderTitle();
  const res = await api('/api/search?q=' + encodeURIComponent(q) + '&limit=400').catch(() => []);
  S.entries = res || [];
  S.count = S.entries.length;
  S.loading = false;
  S.sel.clear(); S.cursor = 0; S.anchor = 0;
  if (!silent) $('#search').value = q;
  $('#search-clear').style.display = q ? '' : 'none';
  renderAll();
  snapTab();
  renderTabs();
}

async function aiSearch(q) {
  if (!(S.boot?.ai?.providers || []).length) return toast('请先在设置中配置 AI 供应商', 'err');
  toast('AI 正在理解你的需求…');
  const r = await api('/api/ai/run', { feature: 'search', q }).catch((e) => ({ ok: false, error: String(e) }));
  if (!r || !r.ok) return toast('AI 搜索失败：' + (r?.error || '未知错误'), 'err');
  const spec = r.json || {};
  const kw = (spec.keywords || []).slice(0, 8);
  if (!kw.length) return doSearch(q);
  S.mode = 'search';
  S.query = q;
  S.aiQuery = kw.join(' ');
  S.loading = true;
  S.entries = [];
  renderContent(); renderStatus(); renderCrumbs(); renderTitle();

  const seen = new Set();
  const out = [];
  for (const k of kw) {
    const list = await api('/api/search?q=' + encodeURIComponent(k) + '&limit=250').catch(() => []);
    for (const e of list || []) {
      if (seen.has(e.p.toLowerCase())) continue;
      seen.add(e.p.toLowerCase());
      out.push(e);
    }
  }
  // 结构化过滤
  const exts = (spec.exts || []).map((x) => String(x).replace(/^\./, '').toLowerCase());
  const after = spec.afterDays ? Date.now() - spec.afterDays * 86400000 : 0;
  let filtered = out;
  if (exts.length) filtered = filtered.filter((e) => exts.includes((e.e || '').replace('.', '').toLowerCase()));
  if (after) filtered = filtered.filter((e) => (e.m || 0) >= after);
  S.entries = filtered.length ? filtered : out;
  S.count = S.entries.length;
  S.loading = false;
  S.sel.clear(); S.cursor = 0;
  renderAll();
  if (spec.note) toast('AI：' + spec.note, null, 4000);
}

function filterByTag(id) {
  const inDir = S.entries.filter((e) => (((S.boot?.fileTags || {})[e.p]) || []).includes(id));
  if (!inDir.length) return toast('当前文件夹没有这个标签的文件');
  S.mode = 'search';
  S.query = '#' + ((S.settings.tags || []).find((t) => t.id === id)?.name || id);
  S.entries = inDir;
  S.count = inDir.length;
  renderAll();
}

/* ---------------------------- 路径编辑 ---------------------------- */
function editPath() {
  const host = $('#crumbs');
  const cur = S.path || S.settings.roots?.[0] || 'D:\\';
  host.innerHTML = `<input class="crumb-input" id="crumb-input" spellcheck="false">`;
  const input = $('#crumb-input');
  input.value = cur;
  input.focus(); input.select();
  let done = false;
  const go = async (commit) => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (!commit || !v) { renderCrumbs(); return; }
    await navigate(v, { push: true });
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); go(true); }
    if (e.key === 'Escape') { e.preventDefault(); go(false); }
  });
  input.addEventListener('blur', () => go(true));
}

/* ---------------------------- 索引面板 ---------------------------- */
function openIndexSheet() {
  const st = S.index || {};
  sheet('索引状态', `<div class="insp-grid">
      <div class="insp-row"><span class="k">状态</span><span class="v">${{ idle: '就绪', scanning: '正在索引', error: '异常', none: '未建立' }[st.state] || st.state || '—'}</span></div>
      <div class="insp-row"><span class="k">已收录</span><span class="v">${(st.total || 0).toLocaleString()} 个文件</span></div>
      <div class="insp-row"><span class="k">本次扫描</span><span class="v">${(st.scanned || 0).toLocaleString()}</span></div>
      <div class="insp-row"><span class="k">上次完成</span><span class="v">${st.finishedAt ? fmtDate(Date.parse(st.finishedAt)) : '—'}</span></div>
      ${st.message ? `<div class="insp-row"><span class="k">消息</span><span class="v wrap">${esc(st.message)}</span></div>` : ''}
    </div><p class="hint" style="margin:14px 2px 0">索引只是加速搜索的缓存，删除后可随时重建，不会影响任何文件。</p>`,
    `<button class="btn ghost" data-a="close">关闭</button><button class="btn primary" data-a="rescan">重新索引</button>`);
  $('#overlay .sheet-foot').onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') closeSheet();
    if (a === 'rescan') {
      closeSheet();
      await api('/api/index/rescan', {}).catch(() => {});
      toast('已开始重新索引');
      pollIndex();
    }
  };
}

function showShortcuts() {
  const rows = [
    ['Ctrl K', '命令面板'], ['Ctrl F', '搜索'], ['Ctrl J', 'AI 助手'], ['Ctrl L', '编辑路径'],
    ['Ctrl C / X / V', '复制 / 剪切 / 粘贴'], ['Ctrl Shift N', '新建文件夹'], ['F2', '重命名'],
    ['Del', '移到回收站'], ['Shift Del', '永久删除'], ['Space', '快速预览'], ['Enter', '打开'],
    ['Ctrl 1 / 2', '网格 / 列表'], ['Alt ← →', '后退 / 前进'], ['Backspace', '上一级'],
    ['Ctrl A', '全选'], ['Ctrl ,', '设置'], ['方向键', '移动选择'],
  ];
  sheet('快捷键', `<div class="kb">${rows.map(([k, v]) => `<div class="kb-row"><span class="kb-k">${k}</span><span class="kb-v">${v}</span></div>`).join('')}</div>`,
    `<button class="btn ghost" data-a="close">关闭</button>`);
  $('#overlay .sheet-foot').onclick = () => closeSheet();
}

/* ---------------------------- 命令面板 ---------------------------- */
let palState = null;

function commands() {
  const list = [
    { id: 'newfolder', label: '新建文件夹', sub: 'Ctrl+Shift+N', icon: 'folderPlus', run: newFolder },
    { id: 'newfile', label: '新建文本文件', sub: '', icon: 'file', run: newFile },
    { id: 'refresh', label: '刷新当前文件夹', sub: 'F5', icon: 'refresh', run: refresh },
    { id: 'grid', label: '切换到网格视图', sub: 'Ctrl+1', icon: 'grid', run: () => setView('grid') },
    { id: 'list', label: '切换到列表视图', sub: 'Ctrl+2', icon: 'list', run: () => setView('list') },
    { id: 'hidden', label: (S.hidden ? '隐藏' : '显示') + '隐藏文件', sub: '', icon: 'eye', run: toggleHidden },
    { id: 'recents', label: '查看最近使用', sub: '', icon: 'clock', run: loadRecents },
    { id: 'root', label: '回到 D 盘根目录', sub: 'D:\\', icon: 'drive', run: () => navigate('D:\\', { push: true }) },
    { id: 'inspector', label: '显示/隐藏信息面板', sub: '', icon: 'columns', run: () => { S.inspector = !S.inspector; renderAll(); } },
    { id: 'ai', label: '打开 AI 助手', sub: 'Ctrl+J', icon: 'sparkles', run: openAiPanel },
    { id: 'settings', label: '打开设置', sub: 'Ctrl+,', icon: 'gear', run: openSettings },
    { id: 'index', label: '索引状态 / 重建索引', sub: '', icon: 'cpu', run: openIndexSheet },
    { id: 'shortcuts', label: '查看快捷键', sub: '', icon: 'help', run: showShortcuts },
  ];
  return list;
}

function openPalette(initial) {
  closePalette();
  const p = el('div');
  p.id = 'palette';
  p.innerHTML = `<div class="pal-box"><input id="palette-input" placeholder="输入命令、路径，或搜索文件…" spellcheck="false"><div id="palette-list"></div><div class="pal-foot"><span>↑↓ 选择</span><span>↵ 执行</span><span>esc 关闭</span></div></div>`;
  document.body.appendChild(p);
  const input = p.querySelector('#palette-input');
  input.value = initial || '';
  input.focus();
  palState = { items: [], idx: 0 };
  p.addEventListener('mousedown', (e) => { if (e.target === p) closePalette(); });
  input.addEventListener('input', () => palFilter(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); movePal(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); movePal(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runPal(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  palFilter(input.value);
}

function closePalette() { const p = $('#palette'); if (p) p.remove(); palState = null; }

function palFilter(q) {
  if (!palState) return;
  q = (q || '').trim();
  const low = q.toLowerCase();
  const items = [];
  if (q && /^[a-zA-Z]:[\\/]/.test(q)) {
    items.push({ label: '打开 ' + q, sub: '路径', icon: 'folder', run: () => navigate(q, { push: true }) });
  }
  if (q) {
    items.push({ label: `搜索 “${q}”`, sub: '本地索引', icon: 'search', run: () => { $('#search').value = q; doSearch(q); } });
    if ((S.boot?.ai?.providers || []).length) {
      items.push({ label: `用 AI 搜索 “${q}”`, sub: '自然语言', icon: 'sparkles', run: () => aiSearch(q) });
    }
  }
  for (const c of commands()) {
    if (q && !(c.label.toLowerCase().includes(low) || c.id.includes(low))) continue;
    items.push({ label: c.label, sub: c.sub, icon: c.icon, run: c.run });
  }
  palState.items = items;
  palState.idx = 0;
  const host = $('#palette-list');
  host.innerHTML = '';
  if (!items.length) { host.innerHTML = '<div class="pal-empty">没有匹配的命令</div>'; return; }
  items.forEach((it, i) => {
    const row = el('div', 'pal-item' + (i === 0 ? ' active' : ''));
    row.innerHTML = `<span class="pi">${ui(it.icon)}</span><span class="pl">${esc(it.label)}</span><span class="sub">${esc(it.sub || '')}</span>`;
    row.dataset.i = i;
    row.addEventListener('mouseenter', () => { palState.idx = i; paintPal(); });
    row.addEventListener('click', () => { runPal(); });
    host.appendChild(row);
  });
  paintPal();
}

function paintPal() {
  if (!palState) return;
  $$('#palette-list .pal-item').forEach((n, i) => {
    n.classList.toggle('active', i === palState.idx);
  });
  const on = $('#palette-list .pal-item.active');
  if (on) on.scrollIntoView({ block: 'nearest' });
}
function movePal(d) {
  if (!palState || !palState.items.length) return;
  palState.idx = (palState.idx + d + palState.items.length) % palState.items.length;
  paintPal();
}
function runPal() {
  if (!palState) return;
  const it = palState.items[palState.idx];
  closePalette();
  if (it && it.run) setTimeout(it.run, 10);
}

/* ---------------------------- 快速预览 ---------------------------- */
let qlPath = null;

async function toggleQuickLook(ent) {
  if (qlPath && samePath(qlPath, ent.p)) return closeQuickLook();
  qlPath = ent.p;
  const q = $('#quicklook');
  q.querySelector('.ql-inner').innerHTML = `<div class="spinner"></div>`;
  q.classList.add('show');
  q.querySelector('.ql-inner').onclick = (e) => { if (e.target.closest('.ql-inner')) closeQuickLook(); };

  const p = await api('/api/preview?path=' + encodeURIComponent(ent.p)).catch(() => null);
  if (!qlPath) return;
  const inner = q.querySelector('.ql-inner');
  let html = '';
  if (ent.k === 'image') {
    html = `<img class="ql-img" src="${withToken('/api/raw?path=' + encodeURIComponent(ent.p))}" alt=""><div class="ql-name">${esc(ent.n)}</div>`;
  } else if (p && p.kind === 'image') {
    html = `<img class="ql-img" src="${withToken('/api/raw?path=' + encodeURIComponent(ent.p))}" alt=""><div class="ql-name">${esc(ent.n)}</div>`;
  } else if (p && p.kind === 'text' && p.text) {
    html = `<div class="ql-head">${esc(ent.n)}<span class="ql-meta">${p.lines || 0} 行 · ${humanSize(ent.s)}</span></div><pre class="ql-text">${esc(p.text.slice(0, 12000))}</pre>`;
  } else {
    html = `<div class="ql-icon">${kindIcon(ent)}</div><div class="ql-name">${esc(ent.n)}</div><div class="ql-meta">${kindLabel(ent)} · ${ent.d ? '文件夹' : humanSize(ent.s)}</div>`;
  }
  inner.innerHTML = html;
}

function closeQuickLook() {
  qlPath = null;
  const q = $('#quicklook');
  q.classList.remove('show');
  q.querySelector('.ql-inner').innerHTML = '';
}

/* ---------------------------- AI ---------------------------- */
const PROVIDER_PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', protocol: 'openai', model: 'deepseek-chat' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai', model: 'gpt-4o' },
  { name: 'Anthropic', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic', model: 'claude-sonnet-4-5' },
  { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai', model: 'gemini-2.0-flash' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai', model: 'anthropic/claude-3.5-sonnet' },
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai', model: 'Qwen/Qwen2.5-72B-Instruct' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai', model: 'qwen-plus' },
  { name: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1', protocol: 'openai', model: 'llama3.2' },
];

function aiReady() {
  return (S.boot?.ai?.providers || []).some((p) => p.hasKey || /localhost|127\.0\.0\.1/.test(p.baseUrl || ''));
}

async function aiRun(feature, extra, onProgress) {
  if (!aiReady()) {
    toast('请先在设置 → AI 中配置供应商与 API Key', 'err');
    openSettings('ai');
    return null;
  }
  try {
    const r = await api('/api/ai/run', Object.assign({ feature }, extra || {}));
    return r;
  } catch (e) {
    toast('AI 调用失败：' + (e.message || e), 'err');
    return null;
  }
}

function openAiPanel(initial) {
  const b = S.boot?.ai || {};
  const provs = b.providers || [];
  const active = provs.find((p) => p.id === b.activeProviderId) || provs[0];
  const sel = selectedEntries();
  const empty = !provs.length;
  const body = `
    <div class="ai-top">
      <span class="ai-badge">${ui('sparkles')}${active ? esc(active.name) + ' · ' + esc(active.model || '') : '未配置'}</span>
      <span class="hint">${sel.length ? `针对已选 ${sel.length} 项` : '针对当前文件夹'}</span>
    </div>
    ${empty ? '<div class="ai-empty">还没有配置模型。填一个你自己的 API Key 之后，搜索、总结、重命名、整理这些能力就会亮起来。</div>' : ''}
    <textarea class="input ai-ta" id="ai-q" rows="3" placeholder="用一句话描述你要做的事。例如：把选中的照片按月份归类，或总结这份文档"></textarea>
    <div class="ai-quick">
      <button class="btn" data-ai="ask"${empty ? ' disabled' : ''}>${ui('zap')} 询问 / 总结</button>
      <button class="btn" data-ai="rename"${empty ? ' disabled' : ''}>${ui('rename')} 智能重命名</button>
      <button class="btn" data-ai="organize"${empty ? ' disabled' : ''}>${ui('folderPlus')} 整理此文件夹</button>
      <button class="btn" data-ai="plan"${empty ? ' disabled' : ''}>${ui('terminal')} 自然语言命令</button>
      <button class="btn" data-ai="search"${empty ? ' disabled' : ''}>${ui('search')} 帮我找文件</button>
    </div>
    <div id="ai-out" class="ai-answer" style="display:none"></div>`;
  sheet('AI 助手', body, empty
    ? `<button class="btn ghost" data-a="close">关闭</button><button class="btn primary" data-a="settings">去配置模型</button>`
    : `<button class="btn ghost" data-a="close">关闭</button><button class="btn ghost" data-a="settings">AI 设置</button>`,
    { wide: true });
  const box = $('#overlay .sheet');
  const out = box.querySelector('#ai-out');
  const q = box.querySelector('#ai-q');
  if (initial) q.value = initial;

  const show = (html) => { out.style.display = ''; out.innerHTML = html; };
  const busy = (t) => { out.style.display = ''; out.innerHTML = `<div class="ai-loading"><span class="spinner"></span>${esc(t)}</div>`; };

  box.querySelector('.ai-quick').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ai]');
    if (!btn) return;
    const kind = btn.dataset.ai;
    const text = q.value.trim();
    if (kind === 'ask') return doAsk(text || '简要总结这些内容的要点。', sel);
    if (kind === 'rename') return openRenameSheet(sel.length ? sel : visibleEntries().slice(0, 60));
    if (kind === 'organize') return openOrganizeSheet(S.path);
    if (kind === 'plan') return openPlanSheet(text);
    if (kind === 'search') return openSearchSheet(text);
  });

  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doAsk(q.value.trim() || '简要总结这些内容的要点。', sel);
    }
  });

  async function doAsk(question, items) {
    if (!question) return;
    busy('AI 正在思考…');
    const paths = items.filter((x) => !x.d).map((x) => x.p);
    const r = await aiRun('ask', { question, paths });
    if (!r) return show(`<div class="ai-err">调用失败</div>`);
    if (!r.ok) return show(`<div class="ai-err">${esc(r.error || 'AI 返回错误')}</div>`);
    show(`<div class="ai-text">${fmtAiText(r.text)}</div>${aiMeta(r)}`);
  }

  box.querySelector('.sheet-foot').onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') closeSheet();
    if (a === 'settings') { closeSheet(); openSettings('ai'); }
  };
}

function aiMeta(r) {
  const t = (r.promptTokens || 0) + (r.completionTokens || 0);
  return `<div class="meta">${esc(r.model || '')}${t ? ` · ${t} tokens` : ''}${r.error ? ` · ${esc(r.error)}` : ''}</div>`;
}

function fmtAiText(t) {
  return esc(t || '').replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

async function aiAsk(paths, question) {
  const sel = selectedEntries();
  const use = paths && paths.length ? paths.map((p) => ({ p, d: false, n: nameOf(p) })) : sel;
  openAiPanel();
  const q = $('#ai-q');
  if (q) q.value = question;
  const out = $('#ai-out');
  out.style.display = '';
  out.innerHTML = `<div class="ai-loading"><span class="spinner"></span>AI 正在阅读…</div>`;
  const r = await aiRun('ask', { question, paths: paths || [] });
  if (!r) return;
  out.innerHTML = r.ok ? `<div class="ai-text">${fmtAiText(r.text)}</div>${aiMeta(r)}` : `<div class="ai-err">${esc(r.error || '失败')}</div>`;
}

/* 智能重命名 */
function openRenameSheet(items) {
  const sel = items && items.length ? items : selectedEntries();
  if (!sel.length) return toast('请先选择要重命名的项目', 'err');
  const files = sel.filter((e) => !e.d);
  if (!files.length) return toast('文件夹不支持批量重命名', 'err');
  sheet('AI 智能重命名', `<p class="hint">描述你想要的命名规则，AI 会给出预览，确认后才会真正改名。</p>
    <input class="input" id="rn-rule" placeholder="例如：改成“日期-项目-序号”的格式；或：把相机照片改成拍摄时间">
    <div class="row2" style="margin-top:10px"><span class="hint">将处理 ${files.length} 个文件</span></div>
    <div id="rn-out" class="ai-answer" style="display:none"></div>`,
    `<button class="btn ghost" data-a="cancel">取消</button><button class="btn primary" data-a="go">生成方案</button>`, { wide: true });
  const box = $('#overlay .sheet');
  box.querySelector('.sheet-foot').onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') return closeSheet();
    if (a !== 'go') return;
    const rule = box.querySelector('#rn-rule').value.trim() || '让文件名更清晰、统一，去掉冗余的编号和乱码';
    const out = box.querySelector('#rn-out');
    out.style.display = '';
    out.innerHTML = `<div class="ai-loading"><span class="spinner"></span>AI 正在生成命名方案…</div>`;
    const payload = files.slice(0, 120).map((f) => ({ p: f.p }));
    const r = await aiRun('rename', { rule, items: payload });
    if (!r || !r.ok) { out.innerHTML = `<div class="ai-err">${esc(r?.error || '失败')}</div>`; return; }
    const plan = (r.json || []).filter((x) => x && x.p && x.n);
    if (!plan.length) { out.innerHTML = `<div class="ai-err">AI 没有给出有效的命名方案</div>`; return; }
    out.innerHTML = `<div class="rn-count">方案 ${plan.length} 项</div><table class="rn-table"><thead><tr><th>原名称</th><th>新名称</th><th>理由</th></tr></thead><tbody>
      ${plan.map((x) => `<tr><td class="old">${esc(nameOf(x.p))}</td><td class="new">${esc(x.n)}</td><td class="why">${esc(x.why || '')}</td></tr>`).join('')}
      </tbody></table>${aiMeta(r)}`;
    const foot = box.querySelector('.sheet-foot');
    foot.innerHTML = `<button class="btn ghost" data-a="cancel">取消</button><button class="btn primary" data-a="apply">应用 ${plan.length} 项</button>`;
    foot.onclick = async (e2) => {
      const a2 = e2.target.closest('[data-a]')?.dataset.a;
      if (a2 === 'cancel') return closeSheet();
      if (a2 !== 'apply') return;
      closeSheet();
      let ok = 0, fail = 0;
      for (const x of plan) {
        const rr = await op('rename', { path: x.p, name: x.n }).catch(() => null);
        if (rr && rr.ok) ok++; else fail++;
      }
      toast(`已重命名 ${ok} 项${fail ? `，${fail} 项失败` : ''}`, fail ? 'err' : 'ok');
      refresh();
    };
  };
}

/* 整理文件夹 */
function openOrganizeSheet(dir) {
  if (!dir) return;
  sheet('AI 智能整理', `<p class="hint">AI 会分析当前文件夹的内容，提出分类方案；确认后才会移动文件。</p>
    <div class="insp-row"><span class="k">目标</span><span class="v wrap">${esc(dir)}</span></div>
    <div class="insp-row"><span class="k">项目</span><span class="v">${S.entries.length} 个</span></div>
    <div id="og-out" class="ai-answer" style="display:none"></div>`,
    `<button class="btn ghost" data-a="cancel">取消</button><button class="btn primary" data-a="go">生成整理方案</button>`, { wide: true });
  const box = $('#overlay .sheet');
  box.querySelector('.sheet-foot').onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') return closeSheet();
    if (a !== 'go') return;
    const out = box.querySelector('#og-out');
    out.style.display = '';
    out.innerHTML = `<div class="ai-loading"><span class="spinner"></span>AI 正在分析目录结构…</div>`;
    const listing = S.entries.slice(0, 220).map((x) => ({ n: x.n, d: !!x.d, s: x.s }));
    const r = await aiRun('organize', { dir, listing });
    if (!r || !r.ok) { out.innerHTML = `<div class="ai-err">${esc(r?.error || '失败')}</div>`; return; }
    const spec = r.json || {};
    const groups = (spec.groups || []).filter((g) => g && g.folder);
    if (!groups.length) { out.innerHTML = `<div class="ai-text">${fmtAiText(spec.reply || '这个文件夹已经足够整齐了。')}</div>`; return; }
    out.innerHTML = `<div class="ai-text">${fmtAiText(spec.reply || '')}</div>
      <div class="og-groups">${groups.map((g, i) => `<div class="og-g"><div class="og-h">${ui('folder')}${esc(g.folder)}<span class="dim">${(g.files || []).length} 个</span></div>
        <div class="og-s">${esc(g.reason || '')}</div>
        <div class="og-files">${(g.files || []).slice(0, 12).map((f) => `<span>${esc(nameOf(String(f)))}</span>`).join('')}${(g.files || []).length > 12 ? '<span>…</span>' : ''}</div></div>`).join('')}</div>${aiMeta(r)}`;
    const foot = box.querySelector('.sheet-foot');
    foot.innerHTML = `<button class="btn ghost" data-a="cancel">取消</button><button class="btn primary" data-a="apply">创建文件夹并移动</button>`;
    foot.onclick = async (e2) => {
      const a2 = e2.target.closest('[data-a]')?.dataset.a;
      if (a2 === 'cancel') return closeSheet();
      if (a2 !== 'apply') return;
      closeSheet();
      let moved = 0;
      for (const g of groups) {
        const sub = dir.replace(/[\\/]+$/, '') + '\\' + g.folder;
        const mk = await op('mkdir', { target: dir, name: g.folder });
        const folder = mk && mk.path ? mk.path : sub;
        const paths = (g.files || []).map((f) => String(f)).filter((f) => f.includes('\\')).slice(0, 200);
        if (paths.length) {
          const rr = await op('move', { paths, target: folder });
          if (rr && rr.ok) moved += rr.count || paths.length;
        }
      }
      toast(`已整理 ${moved} 个文件`, 'ok');
      refresh();
    };
  };
}

/* 自然语言命令 */
function openPlanSheet(cmd) {
  if (!cmd) return toast('先描述你想做的事，例如“把上周的截图都移到 归档 文件夹”', 'err');
  sheet('AI 命令', `<p class="hint">AI 会把你的话翻译成一组文件操作，执行前会先给你预览。</p>
    <input class="input" id="pl-cmd" value="${esc(cmd)}">
    <div class="insp-row" style="margin-top:10px"><span class="k">当前目录</span><span class="v wrap">${esc(S.path)}</span></div>
    <div id="pl-out" class="ai-answer" style="display:none"></div>`,
    `<button class="btn ghost" data-a="cancel">取消</button><button class="btn primary" data-a="go">生成计划</button>`, { wide: true });
  const box = $('#overlay .sheet');
  box.querySelector('.sheet-foot').onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') return closeSheet();
    if (a !== 'go') return;
    const text = box.querySelector('#pl-cmd').value.trim();
    const out = box.querySelector('#pl-out');
    out.style.display = '';
    out.innerHTML = `<div class="ai-loading"><span class="spinner"></span>正在生成操作计划…</div>`;
    const listing = visibleEntries().slice(0, 160).map((x) => ({ n: x.n, d: !!x.d, p: x.p }));
    const r = await aiRun('plan', { cmd: text, cwd: S.path, listing });
    if (!r || !r.ok) { out.innerHTML = `<div class="ai-err">${esc(r?.error || '失败')}</div>`; return; }
    const spec = r.json || {};
    const ops = (spec.ops || []).filter((o) => o && o.op);
    out.innerHTML = `<div class="ai-text">${fmtAiText(spec.reply || '')}</div>
      ${ops.length ? `<ol class="plan-ops">${ops.map((o) => `<li><b>${esc(o.op)}</b> ${esc(nameOf(String(o.from || '')) || o.from || '')}${o.to ? ' → ' + esc(o.to) : ''}<span class="why">${esc(o.why || '')}</span></li>`).join('')}</ol>` : '<div class="ai-err">没有可执行的操作</div>'}
      ${aiMeta(r)}`;
    if (!ops.length) return;
    const foot = box.querySelector('.sheet-foot');
    foot.innerHTML = `<button class="btn ghost" data-a="cancel">取消</button><button class="btn primary" data-a="apply">执行这 ${ops.length} 步</button>`;
    foot.onclick = async (e2) => {
      const a2 = e2.target.closest('[data-a]')?.dataset.a;
      if (a2 === 'cancel') return closeSheet();
      if (a2 !== 'apply') return;
      if (ops.some((o) => o.op === 'trash')) {
        const yes = await confirmSheet('计划中包含删除操作', '删除的项目会进入回收站，可以从回收站恢复。', '继续执行');
        if (!yes) return;
      }
      closeSheet();
      let ok = 0;
      for (const o of ops) {
        const body = o.op === 'move' || o.op === 'copy'
          ? { paths: [o.from], target: o.to }
          : o.op === 'rename' ? { path: o.from, name: nameOf(String(o.to || '')) || o.to }
            : o.op === 'trash' ? { paths: [o.from] }
              : o.op === 'mkdir' ? { target: parentOf(String(o.to || o.from)) || S.path, name: nameOf(String(o.to || o.from)) }
                : null;
        if (!body) continue;
        const rr = await op(o.op, body).catch(() => null);
        if (rr && rr.ok) ok++;
      }
      toast(`已执行 ${ok} / ${ops.length} 步`, ok === ops.length ? 'ok' : 'err');
      refresh();
    };
  };
}

/* AI 找文件 */
function openSearchSheet(initial) {
  sheet('AI 找文件', `<p class="hint">用一句话描述，AI 会拆成关键词和条件，再在本地索引里检索。</p>
    <input class="input" id="as-q" value="${esc(initial || '')}" placeholder="例如：上个月做的 PPT，名字里有季度汇报">
    <div id="as-out" class="ai-answer" style="display:none"></div>`,
    `<button class="btn ghost" data-a="cancel">取消</button><button class="btn primary" data-a="go">搜索</button>`);
  const box = $('#overlay .sheet');
  box.querySelector('#as-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); box.querySelector('[data-a="go"]').click(); }
    e.stopPropagation();
  });
  box.querySelector('.sheet-foot').onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') return closeSheet();
    if (a !== 'go') return;
    const q = box.querySelector('#as-q').value.trim();
    if (!q) return;
    closeSheet();
    aiSearch(q);
  };
}

function confirmSheet(title, text, okLabel = '确定') {
  return new Promise((resolve) => {
    sheet(title, `<p class="hint">${esc(text)}</p>`, `<button class="btn ghost" data-a="no">取消</button><button class="btn danger" data-a="yes">${esc(okLabel)}</button>`);
    let done = false;
    $('#overlay .sheet-foot').onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a || done) return;
      done = true; closeSheet(); resolve(a === 'yes');
    };
  });
}

/* ---------------------------- 设置 ---------------------------- */
async function refreshBootstrap() {
  const b = await api('/api/bootstrap').catch(() => null);
  if (b) { S.boot = b; S.settings = b.settings; S.index = b.index; }
}

function openSettings(tab = 'general') {
  if (typeof tab !== 'string') tab = 'general';
  const wide = tab === 'ai';
  const box = sheet('设置', `<div class="tabs">
      <button class="tab" data-tab="general">通用</button>
      <button class="tab" data-tab="ai">AI 与模型</button>
      <button class="tab" data-tab="about">关于</button>
    </div><div id="set-body"></div>`, '', { wide });
  const body = box.querySelector('#set-body');
  const paint = (t) => {
    $$('.tab', box).forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
    if (t === 'general') paintGeneral(body);
    else if (t === 'ai') paintAi(body);
    else paintAbout(body);
  };
  box.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) paint(t.dataset.tab);
  });
  paint(tab);
}

function paintGeneral(host) {
  const st = S.settings;
  host.innerHTML = `
    <div class="set-row"><div class="set-l"><div class="set-t">图标大小</div><div class="set-d">网格视图中的图标尺寸</div></div>
      <div class="set-c"><input type="range" id="set-icon" min="56" max="150" step="2" value="${S.iconSize}"><span id="set-icon-v">${S.iconSize}</span></div></div>
    <div class="set-row"><div class="set-l"><div class="set-t">显示隐藏文件</div><div class="set-d">包含系统文件与以点开头的文件</div></div>
      <div class="set-c"><button class="switch ${S.hidden ? 'on' : ''}" id="set-hidden"></button></div></div>
    <div class="set-row"><div class="set-l"><div class="set-t">默认排序</div><div class="set-d">新打开的文件夹使用此排序</div></div>
      <div class="set-c"><select class="input" id="set-sort">
        ${[['name', '名称'], ['mtime', '修改日期'], ['ctime', '创建日期'], ['size', '大小'], ['kind', '类型']].map(([v, l]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select><button class="switch ${S.desc ? 'on' : ''}" id="set-desc" title="降序"></button></div></div>
    <div class="set-row"><div class="set-l"><div class="set-t">起始位置</div><div class="set-d">${esc((st.roots || []).join('、') || 'D:\\')}</div></div>
      <div class="set-c"><button class="btn" id="set-root">设为当前文件夹</button></div></div>
    <div class="set-row"><div class="set-l"><div class="set-t">强调色</div><div class="set-d">按钮与选中状态的颜色</div></div>
      <div class="set-c">${['#0A84FF', '#BF5AF2', '#FF375F', '#30D158', '#FF9F0A', '#64D2FF'].map((c) => `<button class="swatch" data-c="${c}" style="background:${c}"></button>`).join('')}</div></div>
    <div class="set-row"><div class="set-l"><div class="set-t">索引</div><div class="set-d">${S.index ? `${(S.index.total || 0).toLocaleString()} 个文件已收录` : '—'}</div></div>
      <div class="set-c"><button class="btn" id="set-reindex">重新索引</button></div></div>
    <div class="set-row"><div class="set-l"><div class="set-t">快捷键</div><div class="set-d">查看全部键盘操作</div></div>
      <div class="set-c"><button class="btn ghost" id="set-keys">查看</button></div></div>`;

  const icon = host.querySelector('#set-icon');
  icon.addEventListener('input', () => {
    S.iconSize = Number(icon.value);
    host.querySelector('#set-icon-v').textContent = icon.value;
    document.documentElement.style.setProperty('--icon-size', S.iconSize + 'px');
    localStorage.setItem('aurora.iconSize', S.iconSize);
    api('/api/settings', { iconSize: S.iconSize }).catch(() => {});
  });
  host.querySelector('#set-hidden').onclick = async (e) => {
    S.hidden = !S.hidden;
    e.currentTarget.classList.toggle('on', S.hidden);
    await api('/api/settings', { showHidden: S.hidden }).catch(() => {});
    refresh();
  };
  host.querySelector('#set-sort').onchange = async (e) => {
    S.sort = e.target.value;
    await api('/api/settings', { sortField: S.sort, sortDesc: S.desc }).catch(() => {});
    if (S.mode === 'browse') { renderContent(); renderStatus(); }
  };
  host.querySelector('#set-desc').onclick = async (e) => {
    S.desc = !S.desc;
    e.currentTarget.classList.toggle('on', S.desc);
    await api('/api/settings', { sortField: S.sort, sortDesc: S.desc }).catch(() => {});
    if (S.mode === 'browse') { renderContent(); renderStatus(); }
  };
  host.querySelector('#set-root').onclick = async () => {
    if (!S.path) return;
    await api('/api/settings', { roots: [S.path] }).catch(() => {});
    await refreshBootstrap();
    toast('起始位置已更新');
  };
  host.querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', async () => {
    const c = b.dataset.c;
    document.documentElement.style.setProperty('--accent', c);
    S.settings.accent = c;
    await api('/api/settings', { accent: c }).catch(() => {});
  }));
  host.querySelector('#set-reindex').onclick = async () => {
    closeSheet();
    await api('/api/index/rescan', {}).catch(() => {});
    toast('已开始重新索引');
    pollIndex();
  };
  host.querySelector('#set-keys').onclick = () => { closeSheet(); showShortcuts(); };
}

function paintAi(host) {
  const ai = S.boot.ai || {};
  const provs = ai.providers || [];
  host.innerHTML = `
    <div class="set-row"><div class="set-l"><div class="set-t">启用 AI 功能</div><div class="set-d">关闭后界面上的 AI 入口会隐藏，不会发出任何请求</div></div>
      <div class="set-c"><button class="switch ${ai.enabled ? 'on' : ''}" id="ai-on"></button></div></div>
    <div class="set-row"><div class="set-l"><div class="set-t">允许发送文件内容</div><div class="set-d">开启后“总结/询问”会把文件正文发给模型；默认只发送文件名与元数据</div></div>
      <div class="set-c"><button class="switch ${ai.allowContent ? 'on' : ''}" id="ai-content"></button></div></div>
    <div class="set-sub">供应商</div>
    <div id="prov-list">${provs.length ? provs.map(provCard).join('') : '<div class="set-empty">还没有配置供应商。在下面选一个预设快速开始。</div>'}</div>
    <div class="set-sub">添加供应商</div>
    <div class="presets">${PROVIDER_PRESETS.map((p, i) => `<button class="preset" data-i="${i}">${esc(p.name)}</button>`).join('')}</div>
    <div class="prov-form" id="prov-form">
      <div class="row2"><input class="input" id="pv-name" placeholder="名称（如 DeepSeek）"><select class="input" id="pv-proto"><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic</option></select></div>
      <input class="input" id="pv-base" placeholder="Base URL，例如 https://api.deepseek.com">
      <div class="row2"><input class="input" id="pv-model" placeholder="模型，例如 deepseek-chat"><input class="input" id="pv-summary" placeholder="摘要/重命名用模型（可留空）"></div>
      <div class="row2"><input class="input" id="pv-key" type="password" placeholder="API Key（加密保存在本机）"><label class="check"><input type="checkbox" id="pv-vision"> 支持图片理解</label></div>
      <div class="row2"><button class="btn primary" id="pv-save">保存供应商</button><button class="btn ghost" id="pv-test">测试连接</button><span class="hint" id="pv-msg"></span></div>
    </div>`;
  host.querySelector('#ai-on').onclick = async (e) => {
    ai.enabled = !ai.enabled;
    e.currentTarget.classList.toggle('on', ai.enabled);
    await api('/api/settings', { ai: { enabled: ai.enabled } }).catch(() => {});
    $('#ai-chip').classList.toggle('hidden', !ai.enabled);
  };
  host.querySelector('#ai-content').onclick = async (e) => {
    ai.allowContent = !ai.allowContent;
    e.currentTarget.classList.toggle('on', ai.allowContent);
    await api('/api/settings', { ai: { allowContent: ai.allowContent } }).catch(() => {});
  };

  const form = host.querySelector('#prov-form');
  const msg = host.querySelector('#pv-msg');
  let editingId = null;
  host.querySelectorAll('.preset').forEach((b) => b.addEventListener('click', () => {
    const p = PROVIDER_PRESETS[Number(b.dataset.i)];
    host.querySelector('#pv-name').value = p.name;
    host.querySelector('#pv-base').value = p.baseUrl;
    host.querySelector('#pv-proto').value = p.protocol;
    host.querySelector('#pv-model').value = p.model;
    host.querySelector('#pv-key').focus();
  }));

  host.querySelector('#prov-list').addEventListener('click', async (e) => {
    const card = e.target.closest('.prov-card');
    if (!card) return;
    const id = card.dataset.id;
    const p = provs.find((x) => x.id === id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'del') {
      const yes = await confirmSheet('删除供应商', '删除后对应的 API Key 也会从本机移除。', '删除');
      if (!yes) return;
      await api('/api/ai/provider/delete', { id }).catch(() => {});
      await refreshBootstrap();
      paintAi(host);
      return;
    }
    if (act === 'test') {
      const m = card.querySelector('.pc-status');
      m.textContent = '测试中…';
      const r = await api('/api/ai/test', { id }).catch((err) => ({ ok: false, error: String(err) }));
      m.textContent = r && r.ok ? '连接正常' : ('失败：' + (r?.error || '未知'));
      m.className = 'pc-status ' + (r && r.ok ? 'ok' : 'err');
      return;
    }
    if (act === 'edit' || e.target.closest('.pc-main')) {
      editingId = id;
      host.querySelector('#pv-name').value = p.name || '';
      host.querySelector('#pv-base').value = p.baseUrl || '';
      host.querySelector('#pv-proto').value = p.protocol || 'openai';
      host.querySelector('#pv-model').value = p.model || '';
      host.querySelector('#pv-summary').value = p.summaryModel || '';
      host.querySelector('#pv-vision').checked = !!p.vision;
      host.querySelector('#pv-key').value = '';
      host.querySelector('#pv-key').placeholder = p.hasKey ? `已保存（${p.mask}），留空则不修改` : 'API Key（加密保存在本机）';
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  host.querySelector('#pv-save').onclick = async () => {
    const body = {
      name: host.querySelector('#pv-name').value.trim(),
      baseUrl: host.querySelector('#pv-base').value.trim(),
      protocol: host.querySelector('#pv-proto').value,
      model: host.querySelector('#pv-model').value.trim(),
      summaryModel: host.querySelector('#pv-summary').value.trim(),
      vision: host.querySelector('#pv-vision').checked,
    };
    const key = host.querySelector('#pv-key').value.trim();
    if (key) body.key = key;
    if (!body.name || !body.baseUrl || !body.model) { msg.textContent = '名称、地址、模型都要填'; return; }
    if (editingId) body.id = editingId;
    const r = await api('/api/ai/provider', body).catch((err) => ({ ok: false, error: String(err) }));
    if (!r || !r.ok) { msg.textContent = '保存失败：' + (r?.error || '未知'); return; }
    editingId = r.id || editingId;
    msg.textContent = '已保存';
    await refreshBootstrap();
    paintAi(host);
    const f = host.querySelector('#prov-form');
    if (f) f.scrollIntoView({ block: 'nearest' });
  };

  host.querySelector('#pv-test').onclick = async () => {
    msg.textContent = '测试中…';
    const id = editingId;
    const r = await api('/api/ai/test', id ? { id } : {}).catch((err) => ({ ok: false, error: String(err) }));
    msg.textContent = r && r.ok ? '连接正常：' + (r.text || '').slice(0, 40) : ('失败：' + (r?.error || '未知'));
  };
}

function provCard(p) {
  return `<div class="prov-card" data-id="${p.id}">
    <div class="pc-main">
      <div class="pc-name">${esc(p.name)}<span class="pc-model">${esc(p.model || '')}</span></div>
      <div class="pc-sub">${esc(p.baseUrl || '')} · ${p.hasKey ? 'Key ' + esc(p.mask || '') : '未设置 Key'}</div>
      <div class="pc-status"></div>
    </div>
    <div class="pc-acts">
      <button class="btn ghost" data-act="test">测试</button>
      <button class="btn ghost" data-act="edit">编辑</button>
      <button class="btn ghost danger" data-act="del">删除</button>
    </div>
  </div>`;
}

function paintAbout(host) {
  host.innerHTML = `
    <div class="about">
      <img class="about-icon" src="app-icon.png" alt="Aurora" />
      <div class="about-name">Aurora</div>
      <div class="about-ver">版本 ${esc(S.boot?.version || '1.0.0')} · 为 D 盘打造的文件工作台</div>
      <div class="about-rows">
        <div class="insp-row"><span class="k">安装位置</span><span class="v wrap">${esc(S.boot?.installPath || '便携运行')}</span></div>
        <div class="insp-row"><span class="k">数据目录</span><span class="v wrap">%LOCALAPPDATA%\\Aurora</span></div>
        <div class="insp-row"><span class="k">索引文件</span><span class="v wrap">index.db（可安全删除，会自动重建）</span></div>
        <div class="insp-row"><span class="k">密钥存储</span><span class="v wrap">secrets.bin（Windows DPAPI 加密，仅当前用户可解）</span></div>
        <div class="insp-row"><span class="k">渲染内核</span><span class="v">WebView2 · .NET 10 WPF</span></div>
      </div>
      <p class="hint" style="margin-top:16px">Aurora 不接管系统外壳、不注入其它进程，所有能力都在自己的窗口内完成。删除整个程序目录不会影响 D 盘上的任何文件。</p>
    </div>`;
}

/* ---------------------------- 启动 ---------------------------- */
boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div style="color:#eee;font:14px/1.6 system-ui;padding:40px">
    <h2>Aurora 界面加载失败</h2><pre style="white-space:pre-wrap;color:#f88">${esc(String(e && e.stack || e))}</pre></div>`;
});







