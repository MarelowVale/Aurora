// 本机假模型：只为验证 Aurora 的 AI 链路（OpenAI 兼容协议）是否打通。
// 用法：node tools/fakellm.mjs 8774
// 按提示词里出现的标记，返回对应功能期望的结构化 JSON。
import http from 'node:http';

const port = Number(process.argv[2] || 8774);

// System.Text.Json 默认把中文转义成 \uXXXX，路径里的反斜杠是 \\，换行是 \n。
// 先还原 \uXXXX，再用占位符保护路径反斜杠，最后解掉其余转义。
const unescapeJson = (s) => {
  let out = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  out = out.replace(/\\\\/g, '\u0000');
  out = out.replace(/\\n/g, '\n').replace(/\\r/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
  return out.replace(/\u0000/g, '\\');
};

// 抓出形如 D:\xxx\yyy 的路径（去掉行尾的 \n 转义残留）
const grabPaths = (text) => {
  const out = [];
  const re = /[A-Za-z]:\\[^\n"|]{2,240}/g;
  let m;
  while ((m = re.exec(text))) {
    const p = m[0]
      .trim()
      .replace(/[，。,.\s]+$/, '');
    if (p.length > 3) out.push(p);
  }
  return Array.from(new Set(out));
};

const splitName = (p) => {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return { dir: p.slice(0, i), name: p.slice(i + 1) };
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed = null;
    try { parsed = JSON.parse(body || '{}'); } catch { /* 忽略 */ }
    const model = parsed?.model || 'fake-1';
    const text = unescapeJson(body);
    const paths = grabPaths(text);
    let content = '这是来自本机模拟模型的回答：链路已打通。';

    if (/当前目录：/.test(text)) {
      // 自然语言命令：{reply, ops[]}
      const cwd = (text.match(/当前目录：(.+)/) || [])[1]?.trim() || 'D:\\';
      const target = cwd.replace(/\\+$/, '') + '\\已整理';
      const ops = [{ op: 'mkdir', from: '', to: target, why: '先建好归档目录' }];
      paths.slice(0, 2).forEach((p) => {
        const { name } = splitName(p);
        ops.push({ op: 'move', from: p, to: target + '\\' + name, why: '简单归类一下' });
      });
      content = JSON.stringify({
        reply: '我打算建一个归档目录，把这两项先挪进去；删除操作我不会做，需要你确认。',
        ops,
      });
    } else if (/整理助手/.test(text)) {
      // 整理建议：{reply, groups[]}
      const groups = [
        { folder: '截图', reason: '按命名约定归到截图', files: [] },
        { folder: '其他', reason: '暂时无法归类', files: [] },
      ];
      paths.slice(0, 6).forEach((p, i) => groups[i % 2].files.push(p));
      content = JSON.stringify({ reply: '建议按用途分成两组，先看方案再决定。', groups });
    } else if (/重命名助手|重命名规则/.test(text)) {
      // 智能重命名：[{p, n, why}]
      const arr = paths.slice(0, 40).map((p) => {
        const { name } = splitName(p);
        return { p, n: '2026-10-30_' + name, why: '按规则补上统一日期前缀' };
      });
      content = JSON.stringify(arr);
    } else if (/JSON/i.test(text)) {
      content = '{"keywords":["report","doc"],"exts":[],"afterDays":0,"note":"本机模拟"}';
    }

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 },
    }));
  });
});

server.listen(port, '127.0.0.1', () => console.log('fake llm listening on ' + port));
