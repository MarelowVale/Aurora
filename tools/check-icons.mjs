// 校验 web/icons.js 是否覆盖 app.js 用到的所有图标
import { readFileSync } from 'node:fs';
const icons = await import('../web/icons.js');
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

const used = new Set();
for (const m of app.matchAll(/ui\('([A-Za-z0-9_]+)'\)/g)) used.add(m[1]);
for (const m of app.matchAll(/UI\.([A-Za-z0-9_]+)/g)) used.add(m[1]);

const miss = [...used].filter((k) => !icons.UI[k]);
console.log('UI keys:', Object.keys(icons.UI).length, '| used:', used.size,
  '| missing:', miss.length ? miss.join(', ') : 'none');

const bad = [];
for (const [k, v] of Object.entries(icons.KIND)) if (!String(v).startsWith('<svg')) bad.push('KIND.' + k);
for (const [k, v] of Object.entries(icons.UI)) if (!String(v).startsWith('<svg')) bad.push('UI.' + k);
console.log('non-svg entries:', bad.length ? bad.join(', ') : 'none');

console.log('kindIcon(folder) ok:', icons.kindIcon({ d: true }) === icons.KIND.folder);
console.log('kindIcon(ts file)  :', icons.kindIcon({ k: 'code', e: 'ts' }) !== icons.KIND.code);
console.log('kindIcon(unknown)  :', icons.kindIcon({ k: 'zzz', e: 'zzz' }) === icons.KIND.file);
console.log('SPRITE has g_folder:', icons.SPRITE.includes('g_folder'));
console.log('SKIP sprite check  :', icons.SPRITE.length, 'chars');
