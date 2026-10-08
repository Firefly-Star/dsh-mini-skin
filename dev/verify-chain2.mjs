// Probe verification v2: real mouse events (this host ignores synthetic .click()
// for its settings dialog), plus the panel / theme switch / export checks.
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';

const CDP = process.env.DSH_PROBE_CDP || 'http://127.0.0.1:9335';
const APP = process.env.DSH_PROBE_APP;
const DL = 'C:/Users/Summer/Documents/deepseek-harness/default-workspace/_probe-downloads';
if (!APP) { console.log('DSH_PROBE_APP is required'); process.exit(2); }
try { rmSync(DL, { recursive: true, force: true }); } catch { /* fine */ }
mkdirSync(DL, { recursive: true });

const targets = await (await fetch(`${CDP}/json/list`)).json();
let page = targets.find((t) => t.type === 'page');
if (page === undefined) page = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let nextId = 0;
const pending = new Map();
const issues = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== undefined && pending.has(msg.id)) {
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error !== undefined) entry.reject(new Error(msg.error.message)); else entry.resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    issues.push(`${msg.params.type}: ${(msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')}`.slice(0, 200));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    issues.push(`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`.slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression, awaitPromise = false) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
const report = [];
const step = (name, value) => { report.push({ name, ...value }); console.log(`- ${name}: ${JSON.stringify(value)}`); };

/** Real mouse click at an element's centre (the host needs trusted events). */
const clickAt = async (expression, label) => {
  const box = await evaluate(`(() => { const el = ${expression}; if (el === null || el === undefined) return null; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return { zero: true, tag: el.tagName }; return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 24) }; })()`);
  if (box === null) { console.log(`   [${label}] element not found`); return false; }
  if (box.zero === true) { console.log(`   [${label}] zero-size ${box.tag}`); return false; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
  console.log(`   [${label}] clicked ${box.tag} "${box.text}" at ${Math.round(box.x)},${Math.round(box.y)}`);
  return true;
};
/** Find a clickable ancestor of a leaf whose text matches. */
const byText = (text) => `(() => { const leaf = [...document.querySelectorAll('button,a,div,span,li')].find((el) => el.textContent.trim() === ${JSON.stringify(text)}); return leaf === null ? null : (leaf.closest('button,a,[role=button],li') || leaf); })()`;

await send('Page.enable');
await send('Runtime.enable');
try { await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }); } catch { /* export check will skip */ }
await send('Page.navigate', { url: APP });
for (let i = 0; i < 60; i += 1) {
  const ready = await evaluate('document.readyState === "complete" && !!document.querySelector("[data-slot=\'sidebar\']")').catch(() => false);
  if (ready === true) break;
  await sleep(500);
}
await sleep(2000);

// ---- 1. opacity default is now sane -----------------------------------------
try {
  const state = await evaluate(`(() => {
    const inlineBase = document.body.style.getPropertyValue('--dsw-alias-bg-base');
    const stored = JSON.parse(localStorage.getItem('dsh-mini-skin:settings:v1') || 'null');
    return { inlineBase, storedVersion: stored === null ? null : stored.version, dark: stored === null ? null : stored.dark.canvasOpacity, light: stored === null ? null : stored.light.canvasOpacity };
  })()`);
  const alpha = Number((state.inlineBase.match(/([0-9.]+)\)$/) || [])[1]);
  step('opacityDefault', { ...state, alpha, looksLikeDefault52: Math.abs(alpha - 0.48) < 0.01 });
} catch (error) { step('opacityDefault', { failed: String(error) }); }

// ---- 2. open settings, reach the custom-skin section ------------------------
try {
  await clickAt(`document.querySelector("[data-slot='sidebar.settings']")?.closest('button')`, 'sidebar settings');
  await sleep(1500);
  let opened = await evaluate(`!!document.querySelector("[role='dialog']")`);
  if (opened !== true) { await clickAt(byText('设置'), 'settings by text'); await sleep(1500); opened = await evaluate(`!!document.querySelector("[role='dialog']")`); }
  const navTexts = await evaluate(`(() => { const d = document.querySelector("[role='dialog']"); return d === null ? [] : [...d.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim() !== '').map((e) => e.textContent.trim()).slice(0, 40); })()`);
  step('settingsDialog', { opened, texts: navTexts });
  if (opened === true) {
    await clickAt(byText('自定义皮肤'), 'custom skin nav');
    await sleep(1500);
    const controls = await evaluate(`(() => { const d = document.querySelector("[role='dialog']"); const q = (s) => d.querySelectorAll(s).length; return { selects: q('select'), ranges: q("input[type='range']"), numbers: q("input[type='number']"), buttons: q('button'), rows: [...d.querySelectorAll('div')].filter((e) => e.children.length === 0 && /主内容 · 背景图|侧栏 · 背景图|正在编辑|皮肤包|导出|导入|UI 风格/.test(e.textContent)).map((e) => e.textContent.trim()).slice(0, 14) }; })()`);
    step('customSkinPanel', controls);
  }
} catch (error) { step('settingsDialog', { failed: String(error) }); }

// ---- 3. theme switch swaps the preset --------------------------------------
try {
  const before = await evaluate(`({ live: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light', canvas: document.body.getAttribute('data-mini-canvas') })`);
  const labels = await evaluate(`(() => { const d = document.querySelector("[role='dialog']") || document.body; return [...d.querySelectorAll('[aria-pressed]')].map((el) => ({ label: (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().slice(0, 16), pressed: el.getAttribute('aria-pressed') })); })()`);
  const want = before.live === 'dark' ? '浅色' : '深色';
  const clicked = await clickAt(`(() => { const d = document.querySelector("[role='dialog']") || document.body; const want = ${JSON.stringify(want)}; return [...d.querySelectorAll('[aria-pressed]')].find((el) => ((el.getAttribute('aria-label') || el.title || '') + el.textContent).includes(want)) || null; })()`, 'theme cube');
  await sleep(2000);
  const after = await evaluate(`(() => { const stored = JSON.parse(localStorage.getItem('dsh-mini-skin:settings:v1') || 'null'); const live = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'; return { live, canvas: document.body.getAttribute('data-mini-canvas'), presetForLive: stored === null ? null : stored[live].canvasImage, sidebar: document.body.getAttribute('data-mini-sidebar-art'), alpha: document.body.style.getPropertyValue('--dsw-alias-bg-base') }; })()`);
  step('themeSwitch', { before, ariaPressed: labels, clicked, after, modeChanged: before.live !== after.live, presetFollowed: after.presetForLive === null ? 'no stored settings yet' : after.canvas === after.presetForLive });
} catch (error) { step('themeSwitch', { failed: String(error) }); }

// ---- 4. export --------------------------------------------------------------
try {
  const clicked = await clickAt(`(() => { const d = document.querySelector("[role='dialog']") || document.body; return [...d.querySelectorAll('button')].find((b) => (b.textContent || '').includes('导出皮肤包')) || null; })()`, 'export button');
  let file = null;
  for (let i = 0; i < 20; i += 1) { await sleep(500); const files = readdirSync(DL).filter((n) => n.endsWith('.json')); if (files.length > 0) { file = files[0]; break; } }
  if (file === null) step('export', { clicked, downloaded: false });
  else {
    const raw = readFileSync(`${DL}/${file}`, 'utf8');
    const parsed = JSON.parse(raw);
    step('export', { clicked, downloaded: true, file, format: parsed.format, version: parsed.version, name: parsed.name, modes: Object.keys(parsed.modes || {}), imageSlots: Object.keys(parsed.images || {}), kb: Math.round(raw.length / 1024) });
  }
} catch (error) { step('export', { failed: String(error) }); }

await send('Page.captureScreenshot', {}).then(async (r) => {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('C:/Users/Summer/Documents/deepseek-harness/default-workspace/_perf-probe/verify-panel.png', Buffer.from(r.data, 'base64'));
  console.log('   screenshot -> _perf-probe/verify-panel.png');
}).catch(() => {});

console.log('');
console.log('console errors/warnings:', issues.length === 0 ? 'none' : JSON.stringify(issues.slice(0, 10), null, 1));
ws.close();
