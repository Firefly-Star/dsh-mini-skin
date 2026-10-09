// 探一下探针页面：加载状态、迷你皮肤是否生效、关键元素是否在
const CDP = process.env.DSH_PROBE_CDP || 'http://127.0.0.1:9335';

const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (page === undefined) { console.log('没有 page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, fail) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', fail, { once: true }); });
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
});
const send = (method, params = {}) => new Promise((ok, fail) => { const i = ++id; pending.set(i, { resolve: ok, reject: fail }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails !== undefined) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await send('Runtime.enable');

console.log('url         ', await evaluate('location.href.slice(0, 60)'));
console.log('readyState  ', await evaluate('document.readyState'));
console.log('title       ', await evaluate('document.title'));

const bodyAttrs = await evaluate(`[...document.body.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).join(' ')`);
console.log('body 属性    ', bodyAttrs || '(无)');

const probe = {
  'mini-skin (data-dsh-mini-skin)': "document.body.hasAttribute('data-dsh-mini-skin')",
  '样式表已注入': "document.getElementById('dsh-mini-skin-styles') !== null",
  '官方主题探针': "!document.body.hasAttribute('data-dsh-mini-skin')",
  'maid-atelier 属性': "document.body.hasAttribute('data-dsh-maid-atelier')",
  'orca-link 属性': "document.body.hasAttribute('data-dsh-orca-link')",
};
for (const [name, expr] of Object.entries(probe)) console.log(`  ${name.padEnd(28)} ${await evaluate(expr)}`);

const els = {
  '输入框 [data-composer-input]': "[data-composer-input]",
  '输入卡 [data-composer-card]': "[data-composer-card]",
  '侧栏收放按钮': "[aria-label='打开侧边栏'], [aria-label='收起侧边栏'], [aria-label='Open sidebar'], [aria-label='Collapse sidebar']",
  '右栏展开 [data-sidebar-right-expand]': "[data-sidebar-right-expand]",
  '工作区树 role=treeitem': "[data-slot='sidebar.workspaces'] [role='treeitem']",
  '对话滚动区': "[data-conversation-scroll], [data-slot='conversation.content'], main",
};
for (const [name, sel] of Object.entries(els)) {
  const n = await evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  console.log(`  ${name.padEnd(38)} ${n}`);
}

const metrics = await send('Performance.enable').then(() => send('Performance.getMetrics'));
const names = metrics.metrics.map((m) => m.name);
console.log('\n指标总数', names.length);
console.log('有 Duration 字段:', names.filter((n) => n.endsWith('Duration')).join(', ') || '(无)');
console.log('有 Count 字段:   ', names.filter((n) => n.endsWith('Count')).join(', ') || '(无)');

// 皮肤库路由（节点半边是否在这个 profile 里活着）
const route = await evaluate(`fetch('/api/dsh/mini-skins', { credentials: 'same-origin' }).then((r) => r.status).catch((e) => 'err:' + e.message)`);
console.log('\n皮肤库路由 /api/dsh/mini-skins ->', route);
if (route === 200) {
  const packs = await evaluate(`fetch('/api/dsh/mini-skins', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.skins.map((s) => s.file + (s.ok ? '' : '!')))`);
  console.log('库里的包:', JSON.stringify(packs));
}

ws.close();
