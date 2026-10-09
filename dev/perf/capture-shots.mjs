// 自动截取皮肤多状态截图 + 设置面板截图。
//
// 前提：那个 Chrome 窗口在前台可见。浏览器在后台时 Chrome 会节流渲染，
// 截出来会是空白或旧帧（脚本会先做一次采样自检）。
//
// 用法：node dev/perf/capture-shots.mjs [输出目录]
//
// 切换都是程序化的，但走的是受控组件的真实事件路径：
//   皮肤      -> 面板第 0 个 select（正在使用）
//   主题+状态 -> 面板第 1 个 select（正在编辑）；它内部调用宿主的 theme.setTheme()，
//                所以界面主题与预览状态一起切过去，四态可以在一个会话里截全。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? join(HERE, "..", "..", "..", "docs", "zhihu-screenshots"));
mkdirSync(OUT, { recursive: true });
/** 默认 JPEG：皮肤截图是照片性内容，PNG 一张约 2.5MB，JPEG 约 250KB。设 --png 可换回。 */
const SHOT_FORMAT = process.argv.includes("--png") ? "png" : "jpeg";
const SHOT_QUALITY = 88;

const CDP = process.env.DSH_PROBE_CDP ?? "http://127.0.0.1:9335";
const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
if (page === undefined) { console.error("没有 page target"); process.exit(1); }
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

await send("Runtime.enable");
await send("Page.enable");
await send("Performance.enable");

// ---- 前置：窗口必须在渲染，否则截出来是旧帧
const readMetrics = async () => Object.fromEntries((await send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
const m0 = await readMetrics();
await evaluate(`(() => { const d = document.createElement('div'); d.style.cssText='position:fixed;left:-9999px;width:9px;height:9px'; d.textContent='probe'; document.body.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.remove())); })()`);
await sleep(1000);
const m1 = await readMetrics();
if ((m1.RecalcStyleCount ?? 0) - (m0.RecalcStyleCount ?? 0) === 0) {
	console.error("页面被节流（1 秒内没有样式重算）。请把 Chrome 窗口点到前台并保持可见，再重跑。");
	process.exit(4);
}
console.log(`输出目录：${OUT}\n`);

const setSelect = (index, value) => evaluate(`(() => {
  const sel = [...document.querySelectorAll("[role='dialog'] select")][${index}];
  if (sel === undefined) return "找不到面板 select";
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), "value");
  descriptor.set.call(sel, ${JSON.stringify(value)});
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return sel.value;
})()`);

async function openPanel() {
	if (await evaluate(`document.querySelector("[role='dialog']") !== null`)) return;
	const entry = await evaluate(`(() => {
    const hit = [...document.querySelectorAll("button, [role='button']")].find((el) => (el.getAttribute("aria-label") || el.textContent || "").trim() === "设置");
    if (hit === undefined) return null;
    hit.scrollIntoView({ block: "center" });
    const r = hit.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
	if (entry === null) throw new Error("找不到设置入口");
	await click(entry.x, entry.y);
	await sleep(1400);
	const section = await evaluate(`(() => {
    const dialog = document.querySelector("[role='dialog']");
    if (dialog === null) return null;
    const hit = [...dialog.querySelectorAll("*")].find((el) => el.children.length === 0 && (el.textContent || "").trim() === "自定义皮肤");
    if (hit === undefined) return null;
    const target = hit.closest("button, [role='button'], [role='tab']") || hit;
    target.scrollIntoView({ block: "center" });
    const r = target.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
	if (section !== null) { await click(section.x, section.y); await sleep(1200); }
}

async function closePanel() {
	const hit = await evaluate(`(() => {
    const dialog = document.querySelector("[role='dialog']");
    if (dialog === null) return null;
    const btn = [...dialog.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "关闭");
    if (btn === undefined) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
	if (hit !== null) { await click(hit.x, hit.y); await sleep(1000); } else { await pressEscape(); await sleep(1000); }
}

/** 皮肤/主题状态自检：把行内图片变量的内容哈希与包里的图对照。 */
const HASHES = JSON.parse(readFileSync(join(HERE, "image-hashes.json"), "utf8"));
async function describeSkin() {
	const state = await evaluate(`(async () => {
    const get = (p) => { const raw = getComputedStyle(document.body).getPropertyValue(p).trim(); return raw.replace(/^url\\(["']?/, "").replace(/["']?\\)$/, ""); };
    const out = { dark: document.body.hasAttribute("data-ds-dark-theme"), mini: document.body.hasAttribute("data-dsh-mini-skin") };
    for (const [key, prop] of [["canvas", "--dsh-mini-skin-canvas-file"], ["character", "--dsh-mini-skin-character-art"]]) {
      const url = get(prop);
      if (url === "") { out[key] = null; continue; }
      const buffer = await (await fetch(url)).arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      out[key] = [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return out;
  })()`);
	const name = state.mini ? (HASHES[state.canvas] ?? HASHES[state.character] ?? "mini-skin(未知包)") : "官方主题";
	return { name, dark: state.dark };
}

async function shoot(name, clip) {
	// 默认出 JPEG：皮肤截图是照片性内容，PNG 一张 2.5MB（2561×1398），JPEG 只要约 250KB。
	const params = { format: SHOT_FORMAT, captureBeyondViewport: false };
	if (SHOT_FORMAT === "jpeg") params.quality = SHOT_QUALITY;
	if (clip !== undefined) params.clip = { ...clip, scale: 1 };
	const result = await send("Page.captureScreenshot", params);
	const buffer = Buffer.from(result.data, "base64");
	writeFileSync(join(OUT, `${name}.${SHOT_FORMAT === "jpeg" ? "jpg" : "png"}`), buffer);
	console.log(`  ${name}.${SHOT_FORMAT === "jpeg" ? "jpg" : "png"}  ${Math.round(buffer.length / 1024)} KB`);
}

/** 退出所有弹层（右侧工作台、下拉等不入镜）。 */
async function tidy() {
	await pressEscape();
	await sleep(500);
}

// ================================================================ 截图流程
await openPanel();

// --- 皮肤 1：官方主题（对照用）
{
	await setSelect(0, "official");
	await sleep(1400);
	await setSelect(1, "dark:idle");
	await sleep(1600);
	await closePanel();
	console.log("官方主题 · 深色", JSON.stringify(await describeSkin()));
	await tidy();
	await shoot("01-official-dark");
	await openPanel();
	await setSelect(1, "light:idle");
	await sleep(1600);
	await closePanel();
	console.log("官方主题 · 浅色", JSON.stringify(await describeSkin()));
	await tidy();
	await shoot("02-official-light");
}

// --- 皮肤 2：虎鲸链路（深/浅）
{
	await openPanel();
	await setSelect(0, "pack:虎鲸链路.json");
	await sleep(1800);
	await setSelect(1, "dark:idle");
	await sleep(1600);
	await closePanel();
	console.log("虎鲸链路 · 深色", JSON.stringify(await describeSkin()));
	await tidy();
	await shoot("03-orca-dark");
	await openPanel();
	await setSelect(1, "light:idle");
	await sleep(1600);
	await closePanel();
	console.log("虎鲸链路 · 浅色", JSON.stringify(await describeSkin()));
	await tidy();
	await shoot("04-orca-light");
}

// --- 皮肤 3：深海女仆（深/浅 × 空闲/工作）
{
	await openPanel();
	await setSelect(0, "pack:深海女仆.json");
	await sleep(1800);
	for (const [state, file] of [["dark:idle", "05-maid-dark-idle"], ["dark:work", "06-maid-dark-work"], ["light:idle", "07-maid-light-idle"], ["light:work", "08-maid-light-work"]]) {
		await setSelect(1, state);
		await sleep(1700);
		await closePanel();
		console.log(`深海女仆 · ${state}`, JSON.stringify(await describeSkin()));
		await tidy();
		await shoot(file);
		await openPanel();
	}
}

// --- 设置面板：完整分区 + 勾选态对比
{
	await openPanel();
	const clip = await evaluate(`(() => {
    const dialog = document.querySelector("[role='dialog']");
    if (dialog === null) return null;
    const r = dialog.getBoundingClientRect();
    return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.round(r.width), height: Math.round(Math.min(r.height, window.innerHeight - r.y)) };
  })()`);
	// 面板很长：先滚到顶部截"应用已有皮肤 + 正在编辑"，再滚到主内容/侧栏截下半
	await evaluate(`(() => { const d = document.querySelector("[role='dialog']"); const region = d?.querySelector("[role='dialog'] *"); const scroller = [...d.querySelectorAll("div")].find((el) => el.scrollHeight > el.clientHeight + 30); if (scroller) scroller.scrollTop = 0; })()`);
	await sleep(600);
	await shoot("09-settings-top", clip);
	await evaluate(`(() => { const d = document.querySelector("[role='dialog']"); const scroller = [...d.querySelectorAll("div")].find((el) => el.scrollHeight > el.clientHeight + 30); if (scroller) scroller.scrollTop = scroller.scrollHeight; })()`);
	await sleep(600);
	await shoot("10-settings-bottom", clip);

	// 取消"主内容 · 有背景图"勾选，截"整行隐藏"的对比。
	// 宿主的开关是自定义 Switch：`button[role='switch'][aria-label='主内容有背景图']`，
	// 而且这个面板只对真实鼠标事件有反应，所以用坐标点击、不用 element.click()。
	const toggleBox = await evaluate(`(() => {
    const el = document.querySelector("[role='dialog'] button[role='switch'][aria-label='主内容有背景图']");
    if (el === null) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, checked: el.getAttribute("aria-checked") };
  })()`);
	if (toggleBox === null) {
		console.log("  ⚠ 找不到「主内容 有背景图」开关，第 11 张跳过");
	} else {
		console.log(`  开关当前 aria-checked=${toggleBox.checked}，点击取消勾选`);
		await click(toggleBox.x, toggleBox.y);
		await sleep(1200);
		const after = await evaluate(`document.querySelector("[role='dialog'] button[role='switch'][aria-label='主内容有背景图']")?.getAttribute("aria-checked")`);
		console.log(`  点击后 aria-checked=${after}`);
		await shoot("11-settings-unchecked", clip);
		// 恢复勾选（否则会把用户的配置改掉）
		const back = await evaluate(`(() => { const el = document.querySelector("[role='dialog'] button[role='switch'][aria-label='主内容有背景图']"); if (el === null) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
		if (back !== null) {
			await click(back.x, back.y);
			await sleep(1000);
			const restored = await evaluate(`document.querySelector("[role='dialog'] button[role='switch'][aria-label='主内容有背景图']")?.getAttribute("aria-checked")`);
			console.log(`  已恢复：aria-checked=${restored}`);
		}
	}
}

await closePanel();
await tidy();
ws.close();
console.log("\n完成。");
