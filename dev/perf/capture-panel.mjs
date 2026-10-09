// 只补截设置面板那三张（09/10/11）—— 不重跑皮肤切换，省时间也少动用户配置。
// 用法：node dev/perf/capture-panel.mjs [输出目录]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? join(HERE, "..", "..", "..", "docs", "zhihu-screenshots"));
mkdirSync(OUT, { recursive: true });
/** 与 capture-shots.mjs 一致：默认 JPEG，避免 2.5MB 一张的 PNG。设 --png 可换回。 */
const SHOT_FORMAT = process.argv.includes("--png") ? "png" : "jpeg";
const SHOT_QUALITY = 88;

const CDP = process.env.DSH_PROBE_CDP ?? "http://127.0.0.1:9335";
const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
	const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (r.exceptionDetails !== undefined) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
	return r.result.value;
};
const click = async (x, y) => {
	await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
};
const pressEscape = async () => {
	await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
	await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
};
const shoot = async (name, clip) => {
	const params = { format: SHOT_FORMAT, clip: { ...clip, scale: 1 } };
	if (SHOT_FORMAT === "jpeg") params.quality = SHOT_QUALITY;
	const result = await send("Page.captureScreenshot", params);
	const buffer = Buffer.from(result.data, "base64");
	writeFileSync(join(OUT, `${name}.${SHOT_FORMAT === "jpeg" ? "jpg" : "png"}`), buffer);
	console.log(`  ${name}.${SHOT_FORMAT === "jpeg" ? "jpg" : "png"}  ${Math.round(buffer.length / 1024)} KB`);
};

await send("Runtime.enable");
await send("Page.enable");
await send("Performance.enable");

// 渲染自检（窗口在后台时截出来是旧帧）
const read = async () => Object.fromEntries((await send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
const m0 = await read();
await evaluate(`(() => { const d = document.createElement('div'); d.style.cssText='position:fixed;left:-9999px;width:9px;height:9px'; d.textContent='p'; document.body.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.remove())); })()`);
await sleep(1000);
const m1 = await read();
if ((m1.RecalcStyleCount ?? 0) - (m0.RecalcStyleCount ?? 0) === 0) {
	console.error("页面被节流，窗口需要在前台。已中止（截出来会是旧帧）。");
	process.exit(4);
}

// 打开设置并进入「自定义皮肤」
if (await evaluate(`document.querySelector("[role='dialog']") === null`)) {
	const entry = await evaluate(`(() => { const hit = [...document.querySelectorAll("button, [role='button']")].find((el) => (el.getAttribute("aria-label") || el.textContent || "").trim() === "设置"); if (hit === null) return null; hit.scrollIntoView({ block: "center" }); const r = hit.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	if (entry === null) { console.error("找不到设置入口"); process.exit(1); }
	await click(entry.x, entry.y);
	await sleep(1400);
	const section = await evaluate(`(() => { const d = document.querySelector("[role='dialog']"); if (d === null) return null; const hit = [...d.querySelectorAll("*")].find((el) => el.children.length === 0 && (el.textContent || "").trim() === "自定义皮肤"); if (hit === undefined) return null; const t = hit.closest("button, [role='button']") || hit; t.scrollIntoView({ block: "center" }); const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	if (section !== null) { await click(section.x, section.y); await sleep(1300); }
}
console.log("面板已就位");

// 找面板里那个可滚动的容器
const scrollerExpr = `(() => {
  const d = document.querySelector("[role='dialog']");
  if (d === null) return null;
  const all = [d, ...d.querySelectorAll("div")];
  const scroller = all.find((el) => el.scrollHeight > el.clientHeight + 40);
  if (scroller === undefined) return null;
  scroller.setAttribute("data-shot-scroller", "");
  return { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
})()`;
console.log("滚 dynamic 容器:", JSON.stringify(await evaluate(scrollerExpr)));

const clip = await evaluate(`(() => {
  const d = document.querySelector("[role='dialog']");
  const r = d.getBoundingClientRect();
  return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.round(r.width), height: Math.round(Math.min(r.height, window.innerHeight - r.y)) };
})()`);
console.log("裁剪区域:", JSON.stringify(clip));

const setScroll = (top) => evaluate(`(() => { const el = document.querySelector("[data-shot-scroller]"); if (el === null) return null; el.scrollTop = ${top === "max" ? "el.scrollHeight" : top}; return el.scrollTop; })()`);

console.log("截 09-settings-top …");
await setScroll(0);
await sleep(700);
await shoot("09-settings-top", clip);

console.log("截 10-settings-bottom …");
await setScroll("max");
await sleep(700);
await shoot("10-settings-bottom", clip);

// 11：取消「主内容 · 有背景图」勾选（真实鼠标事件；开关是 button[role=switch]）
console.log("截 11-settings-unchecked …");
const box = await evaluate(`(() => {
  const el = document.querySelector("[role='dialog'] button[role='switch'][aria-label='主内容有背景图']");
  if (el === null) return null;
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, checked: el.getAttribute("aria-checked") };
})()`);
if (box === null) {
	console.log("  ⚠ 找不到开关，跳过");
} else {
	console.log(`  点击前 aria-checked=${box.checked}`);
	await click(box.x, box.y);
	await sleep(1200);
	console.log(`  点击后 aria-checked=${await evaluate(`document.querySelector("[role='dialog'] button[role='switch'][aria-label='主内容有背景图']")?.getAttribute("aria-checked")`)}`);
	await shoot("11-settings-unchecked", clip);
	const back = await evaluate(`(() => { const el = document.querySelector("[role='dialog'] button[role='switch'][aria-label='主内容有背景图']"); if (el === null) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	if (back !== null) {
		await click(back.x, back.y);
		await sleep(1000);
		console.log(`  已恢复 aria-checked=${await evaluate(`document.querySelector("[role='dialog'] button[role='switch'][aria-label='主内容有背景图']")?.getAttribute("aria-checked")`)}`);
	}
}

// 关面板、清掉临时标记
const close = await evaluate(`(() => { const d = document.querySelector("[role='dialog']"); if (d === null) return null; const b = [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "关闭"); if (b === undefined) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
if (close !== null) { await click(close.x, close.y); await sleep(900); } else { await pressEscape(); await sleep(900); }
await evaluate(`document.querySelector("[data-shot-scroller]")?.removeAttribute("data-shot-scroller")`);
ws.close();
console.log("\n完成。");
