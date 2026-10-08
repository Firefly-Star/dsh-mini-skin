// Probe verification v4 — the decisive two:
//   (1) host-side theme switch must swap the artwork preset (the user's bug)
//   (2) export must produce a parseable pack (button scrolled into view first)
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

const CDP = process.env.DSH_PROBE_CDP || 'http://127.0.0.1:9335';
const APP = process.env.DSH_PROBE_APP;
const WS = 'C:/Users/Summer/Documents/deepseek-harness/default-workspace';
if (!APP) { console.log('DSH_PROBE_APP is required'); process.exit(2); }

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
  if (msg.method === 'Runtime.exceptionThrown') issues.push(`exception: ${(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? '').slice(0, 140)}`);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
const step = (name, value) => console.log(`- ${name}: ${JSON.stringify(value)}`);
const click = async (expression, label, scroll = true) => {
  const box = await evaluate(`(() => { const el = ${expression}; if (!el) return null; ${scroll ? 'el.scrollIntoView({block:"center"});' : ''} const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return { zero: true, tag: el.tagName }; return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 20) }; })()`);
  if (box === null || box.zero === true) { console.log(`   [${label}] not clickable ${JSON.stringify(box)}`); return false; }
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
  console.log(`   [${label}] clicked ${box.tag} "${box.text}" at ${Math.round(box.x)},${Math.round(box.y)}`);
  return true;
};

await send('Page.enable');
await send('Runtime.enable');

// seed two clearly different presets, then reload so the plugin applies them
await send('Page.navigate', { url: APP });
for (let i = 0; i < 40; i += 1) { const ready = await evaluate('document.readyState === "complete"').catch(() => false); if (ready === true) break; await sleep(400); }
const art = (canvas, sidebar, opacity) => ({ canvasImage: canvas, canvasImageUrl: '', canvasFileName: '', canvasOpacity: opacity, sidebarImage: sidebar, sidebarImageUrl: '', sidebarFileName: '', sidebarOpacity: 100, sidebarOffsetX: 0, sidebarOffsetY: 12 });
await evaluate(`localStorage.setItem('dsh-mini-skin:settings:v1', JSON.stringify({ version: 2, dark: ${JSON.stringify(art('dark-hero', 'maid-left', 52))}, light: ${JSON.stringify(art('light-active', 'none', 20))}, square: true, brandMark: 'dsh', linkChip: true, uiFont: 'system', sidebarFont: 'inherit', packName: 'probe' }))`);
await send('Page.navigate', { url: APP });
for (let i = 0; i < 60; i += 1) { const ready = await evaluate('document.readyState === "complete" && !!document.querySelector("[data-slot=\'sidebar\']")').catch(() => false); if (ready === true) break; await sleep(500); }
await sleep(2500);

const state = () => evaluate(`(() => { const live = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'; const stored = JSON.parse(localStorage.getItem('dsh-mini-skin:settings:v1')); const alpha = document.body.style.getPropertyValue('--dsw-alias-bg-base'); return { live, canvas: document.body.getAttribute('data-mini-canvas'), sidebar: document.body.getAttribute('data-mini-sidebar-art') || 'none', preset: stored[live].canvasImage, presetSidebar: stored[live].sidebarImage, alpha, offsets: document.body.style.getPropertyValue('--dsh-mini-skin-sidebar-y') }; })()`);

step('seededInitial', await state());

// (1) host-side theme switch via the Appearance row
try {
  await click(`[...document.querySelectorAll('div,span')].find((e) => e.children.length === 0 && e.textContent.trim() === '设置')`, 'settings', false);
  await sleep(1500);
  const inspected = await evaluate(`(() => {
    const leaf = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === '外观');
    if (leaf === undefined) return { found: false };
    let row = leaf;
    for (let i = 0; i < 4 && row.parentElement !== null; i += 1) row = row.parentElement;
    const cands = [...row.querySelectorAll('button,[role=button],[aria-pressed],[tabindex]')];
    return { found: true, rowText: row.textContent.trim().slice(0, 60), candidates: cands.map((el, i) => ({ i, tag: el.tagName, pressed: el.getAttribute('aria-pressed'), label: (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().slice(0, 12) })) };
  })()`);
  step('appearanceRow', inspected);
  let switched = null;
  if (inspected.found === true && inspected.candidates.length > 0) {
    for (const cand of inspected.candidates) {
      const before = (await state()).live;
      await click(`(() => { const leaf = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === '外观'); let row = leaf; for (let i = 0; i < 4 && row.parentElement !== null; i += 1) row = row.parentElement; return [...row.querySelectorAll('button,[role=button],[aria-pressed],[tabindex]')][${cand.i}] || null; })()`, `cube#${cand.i}`, false);
      await sleep(1800);
      const now = (await state()).live;
      if (now !== before) { switched = { candidate: cand, from: before, to: now }; break; }
    }
  }
  const after = await state();
  step('themeSwitch', { switched, after, presetFollowed: after.canvas === after.preset, sidebarFollowed: after.sidebar === after.presetSidebar, alphaMatchesOpacity: after.live === 'light' ? Math.abs(Number((after.alpha.match(/([0-9.]+)\)$/) || [])[1]) - 0.8) < 0.01 : Math.abs(Number((after.alpha.match(/([0-9.]+)\)$/) || [])[1]) - 0.48) < 0.01 });
} catch (error) { step('themeSwitch', { failed: String(error) }); }

// (2) export with the button scrolled into view
try {
  await click(`(() => { const all = [...document.querySelectorAll('*')]; const hit = all.find((e) => e.children.length === 0 && e.textContent.trim() === '自定义皮肤'); return hit === null ? null : (hit.closest('button') || hit); })()`, 'custom skin nav', false);
  await sleep(1200);
  const clicked = await click(`(() => { const d = document.querySelector("[role='dialog']") || document.body; return [...d.querySelectorAll('button')].find((b) => (b.textContent || '').includes('导出皮肤包')) || null; })()`, 'export');
  await sleep(3000);
  const status = await evaluate(`(() => { const d = document.querySelector("[role='dialog']") || document.body; const hit = [...d.querySelectorAll('div')].map((e) => e.textContent.trim()).filter((t) => t.startsWith('已导出') || t.startsWith('导出失败')); return hit.length === 0 ? null : hit[hit.length - 1].slice(0, 130); })()`);
  const dirs = [`${WS}/_probe-downloads`, `${WS}/_probe-chrome/Downloads`, `${WS}/_probe-chrome/Default/Downloads`, `${WS}/_probe-chrome/Profile 1/Downloads`];
  const found = [];
  for (const dir of dirs) { if (!existsSync(dir)) continue; for (const name of readdirSync(dir)) if (name.endsWith('.json')) found.push({ dir: dir.replace(`${WS}/`, ''), name, kb: Math.round(statSync(`${dir}/${name}`).size / 1024) }); }
  let parsed = null;
  if (found.length > 0) { const pack = JSON.parse(readFileSync(`${WS}/${found[0].dir}/${found[0].name}`, 'utf8')); parsed = { format: pack.format, version: pack.version, name: pack.name, modes: Object.keys(pack.modes || {}), images: Object.keys(pack.images || {}) }; }
  step('export', { clicked, status, found, parsed });
} catch (error) { step('export', { failed: String(error) }); }

console.log('');
console.log('page exceptions:', issues.length === 0 ? 'none' : JSON.stringify(issues.slice(0, 5), null, 1));
ws.close();
