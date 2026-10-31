// 生成 web/icons.js
// 图标来源（均为宽松许可证，可随程序分发）：
//   · Lucide          ISC   —— 界面细线图标（工具栏、菜单、状态栏）
//   · vscode-icons    MIT   —— 文件类型彩色图标（文档 / 媒体 / 代码语言）
// 运行： node tools/gen-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lucide = require('./icons-src/node_modules/@iconify-json/lucide/icons.json');
const vscode = require('./icons-src/node_modules/@iconify-json/vscode-icons/icons.json');

const missing = [];

function pick(collection, name) {
  const icon = collection.icons[name];
  if (icon) return icon;
  const alias = collection.aliases?.[name];
  if (alias) {
    if (alias.parent) return collection.icons[alias.parent] || null;
    if (alias.parents) {
      for (const p of alias.parents) if (collection.icons[p]) return collection.icons[p];
    }
  }
  missing.push(name);
  return null;
}

/* ---------------- 界面图标（Lucide） ---------------- */
const UI_MAP = {
  chevronLeft: 'chevron-left',
  chevronRight: 'chevron-right',
  chevronDown: 'chevron-down',
  chevronUp: 'chevron-up',
  search: 'search',
  x: 'x',
  plus: 'plus',
  grid: 'layout-grid',
  list: 'list',
  columns: 'panel-right',
  sidebar: 'panel-left',
  gear: 'settings',
  more: 'ellipsis',
  sparkles: 'sparkles',
  spark2: 'sparkle',
  folderPlus: 'folder-plus',
  folder: 'folder',
  file: 'file',
  trash: 'trash-2',
  copy: 'copy',
  scissors: 'scissors',
  paste: 'clipboard-paste',
  rename: 'pencil-line',
  info: 'info',
  open: 'square-arrow-out-up-right',
  refresh: 'refresh-cw',
  tag: 'tag',
  star: 'star',
  clock: 'clock',
  drive: 'hard-drive',
  download: 'download',
  upload: 'upload',
  eye: 'eye',
  zap: 'zap',
  filter: 'filter',
  check: 'check',
  key: 'key-round',
  cpu: 'cpu',
  help: 'circle-help',
  external: 'external-link',
  zip: 'file-archive',
  sortAsc: 'arrow-up-down',
  terminal: 'square-terminal',
  palette: 'palette',
  link: 'link',
  folderOpen: 'folder-open',
  save: 'save',
  history: 'history',
  layers: 'layers',
  image: 'image',
  video: 'clapperboard',
  music: 'music',
  code: 'code-xml',
  text: 'file-text',
  sheet: 'table',
  slide: 'presentation',
  pdf: 'file-text',
  archive: 'package',
  app: 'app-window',
  font: 'type',
  home: 'house',
  arrowLeft: 'arrow-left',
  arrowRight: 'arrow-right',
  maximize: 'maximize-2',
  minimize: 'minimize-2',
};

const svgFile = (inner, w, h) =>
  `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
const line = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const uiEntries = [];
for (const [key, name] of Object.entries(UI_MAP)) {
  const icon = pick(lucide, name);
  if (!icon) continue;
  uiEntries.push(`  ${key}: line(\`${icon.body}\`),`);
}

/* ---------------- 文件类型图标（vscode-icons） ---------------- */
const KIND_MAP = {
  image: 'file-type-image',
  video: 'file-type-video',
  audio: 'file-type-audio',
  pdf: 'file-type-pdf2',
  doc: 'file-type-word',
  sheet: 'file-type-excel',
  slide: 'file-type-powerpoint',
  archive: 'file-type-zip',
  code: 'file-type-source',
  app: 'file-type-binary',
  text: 'file-type-text',
  font: 'file-type-font',
  file: 'default-file',
};

const kindEntries = [];
const kindMsgs = [];
for (const [key, name] of Object.entries(KIND_MAP)) {
  const icon = pick(vscode, name);
  if (!icon) continue;
  kindMsgs.push(`  ${key}: svg32(\`${icon.body}\`),`);
}

/* 语言 / 扩展名专属图标 */
const EXT_MAP = {
  eps: 'file-type-eps', ai: 'file-type-ai',
  js: 'file-type-js', mjs: 'file-type-js', cjs: 'file-type-js',
  ts: 'file-type-typescript', mts: 'file-type-typescript', cts: 'file-type-typescript',
  jsx: 'file-type-reactjs', tsx: 'file-type-reacttsx',
  py: 'file-type-python', ipynb: 'file-type-jupyter',
  java: 'file-type-java', jar: 'file-type-java',
  cs: 'file-type-csharp', csproj: 'file-type-csproj', sln: 'file-type-sln',
  c: 'file-type-c', h: 'file-type-c',
  cpp: 'file-type-cpp', cc: 'file-type-cpp', cxx: 'file-type-cpp', hpp: 'file-type-cpp',
  go: 'file-type-go', rs: 'file-type-rust', php: 'file-type-php', rb: 'file-type-ruby',
  sh: 'file-type-shell', bash: 'file-type-shell', zsh: 'file-type-shell',
  ps1: 'file-type-powershell', psm1: 'file-type-powershell',
  bat: 'file-type-shell', cmd: 'file-type-shell',
  html: 'file-type-html', htm: 'file-type-html',
  css: 'file-type-css', scss: 'file-type-scss', sass: 'file-type-sass', less: 'file-type-less',
  json: 'file-type-json', jsonc: 'file-type-json',
  yml: 'file-type-yaml', yaml: 'file-type-yaml',
  xml: 'file-type-xml', xaml: 'file-type-xaml',
  md: 'file-type-markdown', markdown: 'file-type-markdown',
  sql: 'file-type-sql', db: 'file-type-sqlite', sqlite: 'file-type-sqlite',
  csv: 'file-type-csv',
  vue: 'file-type-vue', svelte: 'file-type-svelte',
  lua: 'file-type-lua', kt: 'file-type-kotlin', swift: 'file-type-swift',
  dart: 'file-type-dartlang', r: 'file-type-r',
  toml: 'file-type-toml', ini: 'file-type-ini', cfg: 'file-type-ini',
  gradle: 'file-type-gradle',
  lock: 'file-type-lock', log: 'file-type-log',
  txt: 'file-type-text',
};

const extEntries = [];
for (const [ext, name] of Object.entries(EXT_MAP)) {
  const icon = pick(vscode, name);
  if (!icon) continue;
  const key = /^[a-z]+$/.test(ext) ? ext : `'${ext}'`;
  extEntries.push(`  ${key}: svg32(\`${icon.body}\`),`);
}

/* ---------------- 自绘图标（macOS 风格渐变，保留） ---------------- */
const CUSTOM = {
  folder: `<path d="M2.4 6.9c0-1.5 1.2-2.7 2.7-2.7h4.2c.6 0 1.2.2 1.6.6l1.3 1.1c.4.4 1 .6 1.6.6h4.2c1.5 0 2.7 1.2 2.7 2.7v2.2H2.4V6.9Z" fill="#5c8ef2"/>
    <path d="M2.4 9.3h19.2v7.8c0 1.6-1.3 2.9-2.9 2.9H5.3a2.9 2.9 0 0 1-2.9-2.9V9.3Z" fill="url(#g_folder)"/>
    <path d="M2.9 9.8h18.2" stroke="rgba(255,255,255,.42)" stroke-width=".9" stroke-linecap="round"/>
    <path d="M5.6 12.4h4.6" stroke="rgba(255,255,255,.3)" stroke-width="1" stroke-linecap="round"/>`,
  drive: `<rect x="2.6" y="6" width="18.8" height="12" rx="3.4" fill="url(#g_drive)"/>
    <circle cx="17.6" cy="12" r="1.5" fill="rgba(255,255,255,.95)"/>
    <rect x="5.4" y="9.2" width="8.6" height="1.6" rx=".8" fill="rgba(255,255,255,.5)"/>`,
  star: `<path d="m12 3.4 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.5l5.8-.8L12 3.4Z" fill="url(#g_star)"/>`,
  desktop: `<rect x="2.4" y="4.2" width="19.2" height="12.6" rx="2.4" fill="url(#g_drive)"/>
    <rect x="4.6" y="6.4" width="14.8" height="8.2" rx="1.2" fill="rgba(255,255,255,.9)"/>
    <path d="M8 20h8" stroke="#8ab6ff" stroke-width="1.8" stroke-linecap="round"/>`,
  downloads: `<circle cx="12" cy="12" r="9.4" fill="url(#g_folder)"/>
    <path d="M12 6.8v7.2m0 0 3-3m-3 3-3-3M8.2 17.2h7.6" stroke="#fff" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>`,
  documents: `<rect x="4.4" y="2.8" width="15.2" height="18.4" rx="2.6" fill="url(#g_doc)"/>
    <path d="M8.2 8h7.6M8.2 11.4h7.6M8.2 14.8h4.8" stroke="rgba(255,255,255,.92)" stroke-width="1.4" stroke-linecap="round"/>`,
  pictures: `<rect x="2.6" y="4.4" width="18.8" height="15.2" rx="3" fill="url(#g_image)"/>
    <circle cx="8.2" cy="9.4" r="1.6" fill="rgba(255,255,255,.92)"/>
    <path d="M4.8 17.2 9 12.6l2.5 2.9 2.4-2.2 3.6 3.9H4.8Z" fill="rgba(255,255,255,.88)"/>`,
  music: `<circle cx="12" cy="12" r="9.4" fill="url(#g_audio)"/>
    <path d="M14.6 7.8v6.4a2.3 2.3 0 1 1-1.4-2.1V9.5l-3.2.7v4.4a2.3 2.3 0 1 1-1.4-2.1V9.3l6-1.5Z" fill="rgba(255,255,255,.95)"/>`,
  videos: `<rect x="2.6" y="5" width="18.8" height="14" rx="3" fill="url(#g_video)"/>
    <path d="M10.4 9.4 15 12l-4.6 2.6V9.4Z" fill="rgba(255,255,255,.95)"/>`,
  home: `<path d="M3.6 11.2 12 4l8.4 7.2v8.2a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6v-8.2Z" fill="url(#g_folder)"/>
    <path d="M9.8 21v-5.4h4.4V21" fill="rgba(255,255,255,.55)"/>`,
};

const customEntries = Object.entries(CUSTOM).map(
  ([k, v]) => `  ${k}: wrap(\`${v}\`),`,
);

const out = `/* Aurora 图标库 —— 由 tools/gen-icons.mjs 生成，请勿手工编辑
 *
 * 界面细线图标：Lucide (ISC)  · https://lucide.dev
 * 文件类型图标：vscode-icons (MIT) · https://github.com/vscode-icons/vscode-icons
 * 文件夹 / 磁盘 / 常用位置：自绘渐变图标（macOS 风格）
 */

const GRADS = {
  folder: ['#8ab6ff', '#3d7bfd'],
  image: ['#ffd479', '#ff9f0a'],
  video: ['#b39bff', '#7c3aed'],
  audio: ['#f98fc0', '#db2777'],
  pdf: ['#ff8b8b', '#e03131'],
  doc: ['#8ac6ff', '#2f6fed'],
  sheet: ['#7ce8bb', '#059669'],
  slide: ['#fdc08a', '#ea580c'],
  archive: ['#cbd5e1', '#78859a'],
  code: ['#93e8a8', '#16a34a'],
  app: ['#c9b8ff', '#6d28d9'],
  text: ['#d5d9e0', '#6b7280'],
  font: ['#fdb3bd', '#a31832'],
  file: ['#d8d8dd', '#75757f'],
  drive: ['#a8c7ff', '#4b6fbd'],
  star: ['#ffe08a', '#f5a524'],
};

function gradDefs() {
  return Object.entries(GRADS).map(([k, [a, b]]) =>
    \`<linearGradient id="g_\${k}" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="\${a}"/><stop offset="1" stop-color="\${b}"/>
     </linearGradient>\`).join('');
}

const wrap = (inner) => \`<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">\${inner}</svg>\`;
const line = (inner) => \`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">\${inner}</svg>\`;
const svg32 = (inner) => \`<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><g transform="translate(-1.1 -1.1) scale(1.07)">\${inner}</g></svg>\`;

/** 文件类型 → 图标（自绘 + vscode-icons） */
export const KIND = {
${customEntries.join('\n')}
${kindMsgs.join('\n')}
};

/** 扩展名 → 语言专属图标 */
const EXT = {
${extEntries.join('\n')}
};

/** 取图标：目录优先，其次按扩展名，最后按大类 */
export function kindIcon(entry) {
  if (!entry) return KIND.file;
  if (entry.d) return KIND.folder;
  const ext = String(entry.e || '').toLowerCase().replace(/^\\./, '');
  const byExt = EXT[ext];
  if (byExt) return byExt;
  return KIND[entry.k] || KIND.file;
}

/** 界面细线图标 */
export const UI = {
${uiEntries.join('\n')}
};

export const SPRITE = \`<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>\${gradDefs()}</defs></svg>\`;

export function ui(name) { return UI[name] || UI.file; }
`;

writeFileSync(new URL('../web/icons.js', import.meta.url), out, 'utf8');
console.log('icons.js 生成完成');
console.log('  UI 图标:', Object.keys(UI_MAP).length - new Set(missing.filter((m) => m in Object.values(UI_MAP).reduce((a, v) => ((a[v] = 1), a), {}))).size, '个');
console.log('  KIND:', kindMsgs.length, '个，EXT:', extEntries.length, '个，自绘:', customEntries.length, '个');
if (missing.length) console.log('  缺失（已跳过）:', [...new Set(missing)].join(', '));
console.log('  输出大小:', (out.length / 1024).toFixed(1), 'KB');
