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

// 是哪一套皮肤：把 body 上那两个行内图片变量取出来，算 data URI 的内容哈希，查对照表。
// 对照表由 build-image-hashes.mjs 从 skins/ 下的包生成。
let hashTable = {};
try {
	const { readFileSync } = await import("node:fs");
	const { dirname, join } = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	hashTable = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "image-hashes.json"), "utf8"));
} catch {
	console.log('  （没有 image-hashes.json，先跑 node dev/perf/build-image-hashes.mjs）');
}
const hashOf = (customProperty) => evaluate(`(async () => {
  const raw = getComputedStyle(document.body).getPropertyValue(${JSON.stringify(customProperty)}).trim();
  const url = raw.replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '');
  if (url === '') return null;
  const buffer = await (await fetch(url)).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
})()`);
for (const [label, prop] of [["画布图", "--dsh-mini-skin-canvas-file"], ["角色图", "--dsh-mini-skin-character-art"]]) {
	const hash = await hashOf(prop);
	console.log(`  ${label}哈希`.padEnd(14), hash ?? "(无)", hash !== null && hashTable[hash] !== undefined ? `→ ${hashTable[hash]}` : "");
}

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

// 渲染是否在被节流：往页面里塞一个元素，看 1.2 秒内有没有发生重算/布局。
const readMetrics = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const beforeRender = await readMetrics();
await evaluate(`(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:-9999px;width:10px;height:10px;'; d.textContent = 'render-probe'; document.body.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.remove())); })()`);
await new Promise((r) => setTimeout(r, 1200));
const afterRender = await readMetrics();
const moved = (n) => (afterRender[n] ?? 0) - (beforeRender[n] ?? 0);
console.log('\n渲染自检（1.2s 内）: RecalcStyleCount Δ' + moved('RecalcStyleCount') + ', LayoutCount Δ' + moved('LayoutCount') + ', TaskDuration Δ' + (moved('TaskDuration') * 1000).toFixed(1) + 'ms');
console.log(moved('RecalcStyleCount') === 0 && moved('LayoutCount') === 0
	? '  → 页面被节流了：请把这个 Chrome 窗口点到前台并保持可见，否则测出来全是假数据'
	: '  → 渲染正常，可以测量');

// 皮肤库路由（节点半边是否在这个 profile 里活着）
const route = await evaluate(`fetch('/api/dsh/mini-skins', { credentials: 'same-origin' }).then((r) => r.status).catch((e) => 'err:' + e.message)`);
console.log('\n皮肤库路由 /api/dsh/mini-skins ->', route);
if (route === 200) {
  const packs = await evaluate(`fetch('/api/dsh/mini-skins', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.skins.map((s) => s.file + (s.ok ? '' : '!')))`);
  console.log('库里的包:', JSON.stringify(packs));
}

ws.close();
