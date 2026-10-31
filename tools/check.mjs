import fs from 'node:fs';

const app = fs.readFileSync('D:/Aurora/web/app.js', 'utf8');
const icons = fs.readFileSync('D:/Aurora/web/icons.js', 'utf8');

const uiKeys = new Set();
for (const m of icons.matchAll(/^  ([A-Za-z0-9_]+):\s*s\(/gm)) uiKeys.add(m[1]);

const kindKeys = new Set();
const kindBlock = icons.slice(icons.indexOf('export const KIND'), icons.indexOf('export function kindIcon'));
for (const m of kindBlock.matchAll(/^  ([A-Za-z0-9_]+):/gm)) kindKeys.add(m[1]);

const used = new Set();
for (const m of app.matchAll(/\bui\('([A-Za-z0-9_]+)'\)/g)) used.add(m[1]);
for (const m of app.matchAll(/\bUI\.([A-Za-z0-9_]+)/g)) used.add(m[1]);

const missing = [...used].filter((k) => !uiKeys.has(k));
console.log('ui keys:', uiKeys.size, '| used:', used.size);
console.log('missing ui icons:', missing.length ? missing.join(', ') : 'none');

// 检查 kindIcon / KIND 键
const kindUsed = new Set();
for (const m of app.matchAll(/\bKIND\.([A-Za-z0-9_]+)/g)) kindUsed.add(m[1]);
console.log('missing kinds:', [...kindUsed].filter((k) => !kindKeys.has(k)).join(', ') || 'none');

// 简单括号平衡检查（粗检模板字符串之外的语法错误由 node --check 负责）
console.log('KIND keys:', [...kindKeys].join(','));
