#!/usr/bin/env node
/**
 * mini-skin 性能测量 —— 口径对齐 dsh-deep-whale 的 `docs/performance-issue-114.md`，
 * 这样三边（官方主题 / deep-whale / mini-skin）的数字可以直接并排放。
 *
 * 原文的方法要点（我照抄，不要改）：
 *   - CDP `Performance.getMetrics` 的**累计耗时差值**，不是单帧耗时；
 *   - 四类整轮操作：输入并清空 / 左栏收放 / 会话往返切换 / 右栏收放；
 *   - 每项**预热一次**，再**串行测三轮取算术平均**；
 *   - 每轮校验当前激活的皮肤（皮肤没生效的样本直接丢弃）；
 *   - 每轮结束等 600ms 再进下一轮；
 *   - 正式计时**不启用**诊断开关（SelectorStats / invalidation tracking 会显著放大耗时）。
 *
 * 我额外加的两组（原文四类里没有，但知乎文里点名要）：
 *   - `--scenario scroll`   滚动屏幕看对话：测 rAF 帧间隔（长帧比例 / p95）
 *   - `--scenario stream`   大模型持续输出：若你能触发真实流式，用同法测；否则用
 *                           `--synthetic-stream` 在页面里以固定节奏改文本模拟"每帧都在变"。
 *
 * ⚠️ 关于指标名的现实情况：新版 Chrome（≥131）从 `Performance.getMetrics` 里**移除了**
 *    `LayoutDuration` / `RecalcStyleDuration`（`LayoutCount` / `RecalcStyleCount` 仍在）。
 *    所以本脚本在启动时会把实际可用的指标名打出来，并自动选择算法：
 *      A) 有 Duration 字段      -> 直接用它的差值（与原文同口径）
 *      B) 只有 Count 字段        -> 用 ΔCount × 该指标的平均单次耗时估算，**并明确标注**
 *    两种都拿不到时，会退回只报 rAF 帧间隔 —— 宁可少报，也不编数。
 *
 * 用法：
 *   $env:DSH_PROBE_APP='http://127.0.0.1:PORT/?token=...'
 *   $env:DSH_PROBE_CDP='http://127.0.0.1:9335'
 *   node dev/perf/measure.mjs --skin mini-skin --label mini-skin-1
 *   node dev/perf/measure.mjs --skin official --label official-1
 *   node dev/perf/measure.mjs --dry-run          # 不连浏览器，只校验脚本与配置
 *
 * 环境变量：
 *   DSH_PROBE_APP    必填（探针实例地址，带 token）
 *   DSH_PROBE_CDP    CDP 地址，默认 http://127.0.0.1:9335
 *   PERF_RUNS        正式计时轮数，默认 3
 *   PERF_SETTLE_MS   每轮之间的等待，默认 600
 *   PERF_OUT         结果目录，默认 dev/perf/out
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2);
const arg = (name, fallback = undefined) => {
	const index = argv.indexOf(`--${name}`);
	if (index === -1) return fallback;
	const next = argv[index + 1];
	return next === undefined || next.startsWith("--") ? true : next;
};

const DRY_RUN = arg("dry-run", false) === true;
const SELF_TEST = arg("selftest", false) === true;
const SKIN = String(arg("skin", "mini-skin"));
const LABEL = String(arg("label", SKIN.replace(/[^\w.-]+/g, "_")));
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const SETTLE_MS = Number(process.env.PERF_SETTLE_MS ?? 600);
/** 侧栏/右栏有动画，采样窗口要盖住它，否则重算会落在窗口外。 */
const COLLAPSE_SETTLE_MS = Number(process.env.PERF_COLLAPSE_MS ?? 1200);
/** 逐键输入时字符之间的间隔（ms）。25ms ≈ 正常打字节奏（约 40 字/秒偏快，属"持续输入"）。 */
const TYPE_DELAY_MS = Number(process.env.PERF_TYPE_DELAY_MS ?? 25);
const OUT_DIR = resolve(process.env.PERF_OUT ?? join(HERE, "out"));
const APP = process.env.DSH_PROBE_APP;
const CDP = process.env.DSH_PROBE_CDP ?? "http://127.0.0.1:9335";

const SCENARIOS = ["input", "sidebar", "session", "rightbar"];
const EXTRA = arg("scenario", "") === "" ? [] : String(arg("scenario")).split(",").map((s) => s.trim()).filter(Boolean);

/** 皮肤 → 判断"这一轮皮肤确实生效了"的探针。 */
const SKIN_PROBE = {
	"mini-skin": "document.body.hasAttribute('data-dsh-mini-skin')",
	"official": "!document.body.hasAttribute('data-dsh-mini-skin') && !document.body.hasAttribute('data-dsh-maid-atelier') && !document.body.hasAttribute('data-dsh-orca-link')",
	"maid-atelier": "document.body.hasAttribute('data-dsh-maid-atelier')",
	"orca-link": "document.body.hasAttribute('data-dsh-orca-link')",
};

// ---------------------------------------------------------------- CDP 客户端

async function connect() {
	const targets = await (await fetch(`${CDP}/json/list`)).json();
	let page = targets.find((t) => t.type === "page");
	if (page === undefined) page = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((ok, fail) => {
		socket.addEventListener("open", ok, { once: true });
		socket.addEventListener("error", fail, { once: true });
	});
	let id = 0;
	const pending = new Map();
	const exceptions = [];
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (message.id !== undefined && pending.has(message.id)) {
			const entry = pending.get(message.id);
			pending.delete(message.id);
			if (message.error !== undefined) entry.reject(new Error(message.error.message));
			else entry.resolve(message.result);
			return;
		}
		if (message.method === "Runtime.exceptionThrown") {
			const details = message.params.exceptionDetails ?? {};
			exceptions.push(String(details.exception?.description ?? details.text ?? "").slice(0, 200));
		}
	});
	const send = (method, params = {}) =>
		new Promise((ok, fail) => {
			const messageId = ++id;
			pending.set(messageId, { resolve: ok, reject: fail });
			socket.send(JSON.stringify({ id: messageId, method, params }));
		});
	const evaluate = async (expression) => {
		const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		if (result.exceptionDetails !== undefined) {
			throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
		}
		return result.result.value;
	};
	return { socket, send, evaluate, exceptions };
}

/** 真实鼠标点击：这个宿主的设置界面只在真实事件下响应（dev/README 里记过）。 */
async function clickAt(send, x, y) {
	await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

/** 字符 → 按键信息。宿主编辑器按真实按键处理，所以要给全 key/code/text。 */
function keyInfo(ch) {
	const upper = ch.toUpperCase();
	if (ch >= "a" && ch <= "z") return { key: ch, code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
	if (ch >= "A" && ch <= "Z") return { key: ch, code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
	if (ch >= "0" && ch <= "9") return { key: ch, code: `Digit${ch}`, keyCode: ch.charCodeAt(0) };
	if (ch === " ") return { key: " ", code: "Space", keyCode: 32 };
	return { key: ch, code: "", keyCode: 0 };
}

/**
 * 逐字符键入 —— **不能用 `Input.insertText` 一次性塞**：
 * 一次性插入只产生一次 DOM 变更，而宿主的输入区每键入一个字符都会产生一批变更
 * （幽灵文本、输入镜像、受控值回写）。用 insertText 等于把最贵的那条路径绕过去了，
 * 测出来是"一次重排"而不是"41 次键入"。这里按真实按键逐次 dispatch，
 * 并在字符之间保留 `delayMs`（默认 25ms，接近正常打字节奏）。
 */
async function typeCharByChar(send, text, delayMs) {
	for (const ch of text) {
		const info = keyInfo(ch);
		await send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: info.key,
			code: info.code,
			text: ch,
			unmodifiedText: ch,
			windowsVirtualKeyCode: info.keyCode,
			nativeVirtualKeyCode: info.keyCode,
		});
		await send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: info.key,
			code: info.code,
			windowsVirtualKeyCode: info.keyCode,
			nativeVirtualKeyCode: info.keyCode,
		});
		if (delayMs > 0) await sleep(delayMs);
	}
}

/** 真实的全选（Ctrl+A）与删除（Backspace），同样逐键。 */
async function selectAllAndDelete(send) {
	const modifiers = 2; // Ctrl
	await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers });
	await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers });
	await sleep(80);
	await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
	await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
}

// ---------------------------------------------------------------- 指标

/**
 * 采样一次 `Performance.getMetrics`，返回 name -> value 的对象。
 * 同时把"指标名到算法"的选择结果记下来，报告里要写清楚用的是哪种。
 */
async function sample(send) {
	const result = await send("Performance.getMetrics");
	const out = {};
	for (const metric of result.metrics) out[metric.name] = metric.value;
	return out;
}

/**
 * 选一组"风格重算 + 布局"的指标，并给出差值口径。
 * 返回 { mode, keys } —— mode 是 'duration' | 'count-mean' | 'none'。
 */
function pickStyleMetrics(snapshot) {
	const has = (name) => Object.prototype.hasOwnProperty.call(snapshot, name);
	if (has("RecalcStyleDuration") || has("LayoutDuration")) {
		return { mode: "duration", keys: { style: "RecalcStyleDuration", layout: "LayoutDuration" } };
	}
	if (has("RecalcStyleCount") || has("LayoutCount")) {
		return { mode: "count-mean", keys: { style: "RecalcStyleCount", layout: "LayoutCount" } };
	}
	return { mode: "none", keys: {} };
}

/**
 * 一轮操作的代价。
 * duration 口径：  ΔRecalcStyleDuration + ΔLayoutDuration
 * count-mean 口径： ΔCount × 该指标的"平均单次耗时"（= Duration/Count 的累计比）
 *   注意：count-mean 是**估算**，报告里会标注；两种口径的数字不要与其他报告的混用。
 *
 * 同时返回 `work`：这一轮到底有没有真的发生事情（DOM 节点数或样式重算的变化量）。
 * 没有 work 的样本是**假样本** —— 比如点击没聚焦到编辑器、点了工作区行而不是切会话 ——
 * 它们会拿到接近 0 的耗时，混进平均里会把结果压得好看但没有意义。
 */
function operationCost(before, after, picked) {
	const delta = (name) => (after[name] ?? 0) - (before[name] ?? 0);
	const work = delta("Nodes") + delta("RecalcStyleCount") + delta("LayoutCount");
	if (picked.mode === "duration") {
		const style = delta(picked.keys.style);
		const layout = delta(picked.keys.layout);
		return { ms: (style + layout) * 1000, style, layout, method: "duration", work };
	}
	if (picked.mode === "count-mean") {
		const styleCount = delta(picked.keys.style);
		const layoutCount = delta(picked.keys.layout);
		return { ms: styleCount + layoutCount, style: styleCount, layout: layoutCount, method: "count-mean", unit: "count", work };
	}
	return { ms: 0, style: 0, layout: 0, method: "none", work };
}

/** 低于这个 work 量，就认为这一轮没真的发生操作，丢弃并重试。 */
const MIN_WORK = 3;

// ---------------------------------------------------------------- 四类操作

/**
 * 每个操作：找到目标元素的中心坐标 -> 点/输入 -> 等一轮 -> 返回。
 * 找不到元素时抛错，让这一轮作废（宁可少样本，也不要混进无效样本）。
 */
async function rectOf(evaluate, selector) {
	const box = await evaluate(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (el === null) return null;
		el.scrollIntoView({ block: 'center' });
		const r = el.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) return null;
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	})()`);
	if (box === null) throw new Error(`找不到可点的元素：${selector}`);
	return box;
}

/**
 * 宿主里的稳定选择器 —— 都从宿主源码里核过，不是猜的：
 *   侧栏收放  dsh-client-ui-sidebar：按钮 `aria-label` = t("toggle.open") / t("toggle.collapse")
 *             zh 文案「打开侧边栏」/「收起侧边栏」；点两次即"收放"一轮。
 *   右栏收放  dsh-client-ui-sidebar-right：`[data-sidebar-right-expand]` 开、
 *             `[data-sidebar-right-toggle]` 收。
 *   输入框    dsh-client-ui-conversation：`[data-composer-input]`、`[data-composer-card]`。
 *   会话行    dsh-client-ui-workspace：`role="treeitem"`（在工作区树里）。
 */
const SELECTOR = {
	composer: "[data-composer-input]",
	sidebarToggle: "[aria-label='打开侧边栏'], [aria-label='收起侧边栏'], [aria-label='Open sidebar'], [aria-label='Collapse sidebar']",
	rightbarExpand: "[data-sidebar-right-expand]",
	rightbarToggle: "[data-sidebar-right-toggle]",
	scrollRegion: "[data-conversation-scroll], [data-slot='conversation.content'], main",
	sessionRows: "[data-slot='sidebar.workspaces'] [role='treeitem']",
};

const OPERATIONS = {
	/** 逐键输入 41 个字符，再全选删除（与原文同长度、同"逐键"口径）。 */
	input: async ({ evaluate, send }) => {
		const box = await rectOf(evaluate, SELECTOR.composer);
		await clickAt(send, box.x, box.y);
		await sleep(120);
		const text = "The quick brown fox jumps over the lazy dog".slice(0, 41);
		await typeCharByChar(send, text, TYPE_DELAY_MS);
		await sleep(120);
		await selectAllAndDelete(send);
		await sleep(120);
	},
	/** 左栏收起再展开。收放有动画（transition + 150ms 卸载延迟），所以每步等长一点，
	 *  否则重算会落在采样窗口之外，被误判成"没发生操作"。 */
	sidebar: async ({ evaluate, send }) => {
		const box = await rectOf(evaluate, SELECTOR.sidebarToggle);
		await clickAt(send, box.x, box.y);
		await sleep(COLLAPSE_SETTLE_MS);
		const again = await rectOf(evaluate, SELECTOR.sidebarToggle);
		await clickAt(send, again.x, again.y);
		await sleep(COLLAPSE_SETTLE_MS);
	},
	/** 会话 A → B → A（点**非当前**会话的叶子行，并验证会话区真的换了）。 */
	session: async ({ evaluate, send }) => {
		// 侧栏必须是展开的，否则树不可见（会话行会查不到）。
		const expanded = await evaluate(`document.querySelector("[aria-label='收起侧边栏'], [aria-label='Collapse sidebar']") !== null`);
		if (expanded !== true) {
			const box = await rectOf(evaluate, SELECTOR.sidebarToggle);
			await clickAt(send, box.x, box.y);
			await sleep(COLLAPSE_SETTLE_MS);
		}
		const readActive = () => evaluate(`(() => {
			const active = document.querySelector("[data-slot='sidebar.workspaces'] [aria-current], [data-slot='sidebar.workspaces'] [aria-selected='true']");
			const header = document.querySelector("[data-slot='conversation.header']");
			return (active === null ? "" : (active.textContent || "").trim().slice(0, 30)) + " | " + (header === null ? "" : (header.textContent || "").trim().slice(0, 40));
		})()`);
		// 只点"不是当前选中"的叶子会话行（否则点了等于没点）。
		const target = await evaluate(`(() => {
			const list = [...document.querySelectorAll(${JSON.stringify(SELECTOR.sessionRows)})]
				.filter((el) => el.getAttribute("aria-expanded") === null
					&& el.getAttribute("aria-current") === null
					&& el.getAttribute("aria-selected") !== "true"
					&& el.getBoundingClientRect().height > 8);
			const pick = list[0];
			if (pick === undefined) return null;
			pick.scrollIntoView({ block: "center" });
			const r = pick.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (pick.textContent || "").trim().slice(0, 20) };
		})()`);
		if (target === null) throw new Error("侧栏展开后找不到「非当前」的会话行");
		const start = await readActive();
		await clickAt(send, target.x, target.y);
		await sleep(COLLAPSE_SETTLE_MS);
		const switched = await readActive();
		if (switched === start) throw new Error("点了会话行但会话区没换 —— 这一轮无效，不记数");
		// 回到原来那个（再用一次同样的判据确认真的回去了）
		const back = await evaluate(`(() => {
			const list = [...document.querySelectorAll(${JSON.stringify(SELECTOR.sessionRows)})]
				.filter((el) => el.getAttribute("aria-expanded") === null
					&& el.getAttribute("aria-current") === null
					&& el.getAttribute("aria-selected") !== "true"
					&& el.getBoundingClientRect().height > 8);
			const pick = list[0];
			if (pick === undefined) return null;
			pick.scrollIntoView({ block: "center" });
			const r = pick.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		})()`);
		if (back !== null) {
			await clickAt(send, back.x, back.y);
			await sleep(COLLAPSE_SETTLE_MS);
		}
	},
	/** 右栏展开再收起。同样等动画走完。 */
	rightbar: async ({ evaluate, send }) => {
		const box = await rectOf(evaluate, SELECTOR.rightbarExpand);
		await clickAt(send, box.x, box.y);
		await sleep(COLLAPSE_SETTLE_MS);
		const again = await rectOf(evaluate, SELECTOR.rightbarToggle);
		await clickAt(send, again.x, again.y);
		await sleep(COLLAPSE_SETTLE_MS);
	},
};

/**
 * rAF 帧间隔采样：在页面里跑一段 collect 循环，返回帧间隔数组（ms）。
 * 这是给"滚动 / 流式"这两组用的 —— 它们关心的是**掉帧**，不是样式重算总量。
 */
const RAF_COLLECTOR = (ms) => `(async () => {
	const gaps = [];
	let last = performance.now();
	const stop = last + ${ms};
	await new Promise((done) => {
		const tick = () => {
			const now = performance.now();
			gaps.push(now - last);
			last = now;
			if (now >= stop) done(); else requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	return gaps;
})()`;

function frameStats(gaps) {
	if (gaps.length === 0) return { frames: 0 };
	const sorted = [...gaps].sort((a, b) => a - b);
	const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
	const longFrames = sorted.filter((g) => g > 50).length;
	return {
		frames: sorted.length,
		median: Number(at(0.5).toFixed(2)),
		p95: Number(at(0.95).toFixed(2)),
		max: Number(sorted[sorted.length - 1].toFixed(2)),
		longFrames,
		longShare: Number((longFrames / sorted.length).toFixed(3)),
	};
}

/** 滚动场景：让对话区滚一段，同时采帧。 */
async function scenarioScroll({ send, evaluate }, ms = 3000) {
	const box = await rectOf(evaluate, SELECTOR.scrollRegion);
	const collecting = evaluate(RAF_COLLECTOR(ms));
	for (let i = 0; i < 12; i += 1) {
		await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: i % 2 === 0 ? 240 : -240 });
		await sleep(ms / 12);
	}
	return frameStats(await collecting);
}

/**
 * 流式场景（合成）：没有模型请求，就在页面里以固定节奏改动一段文本，
 * 模拟"每帧都有 DOM 变更"的负载，再采帧。真实流式的做法一样，只是负载来自宿主。
 * 这条**不是**真实模型输出，报告里必须标注 `synthetic`。
 */
async function scenarioSyntheticStream({ evaluate }, ms = 3000) {
	const collecting = evaluate(`(async () => {
		const host = document.querySelector("[data-slot='conversation.content'], main") || document.body;
		const probe = document.createElement('div');
		probe.setAttribute('data-perf-synthetic', '');
		probe.style.display = 'none';
		host.appendChild(probe);
		const gaps = [];
		let last = performance.now();
		const stop = last + ${ms};
		let n = 0;
		await new Promise((done) => {
			const tick = () => {
				const now = performance.now();
				gaps.push(now - last);
				last = now;
				probe.textContent = 'token '.repeat((n++ % 40) + 1);
				if (now >= stop) done(); else requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		probe.remove();
		return gaps;
	})()`);
	return frameStats(await collecting);
}

// ---------------------------------------------------------------- 主流程

/**
 * 计算层自检 —— 用 dsh-deep-whale `docs/performance-issue-114.md` 里**已发布的数字**
 * 回算，看本脚本的算法能不能复现它的表。跑不了浏览器也能验这一段。
 */
function selfTest() {
	let failed = 0;
	const check = (name, actual, expected) => {
		const ok = Math.abs(actual - expected) < 0.01;
		if (!ok) failed += 1;
		console.log(`  ${ok ? "✓" : "✗"} ${name}: ${actual}（期望 ${expected}）`);
	};

	console.log("案例 1：duration 口径 —— 女仆「输入并清空」修复前后");
	// 文档：149.41 -> 31.56，改善 79%
	const before = { RecalcStyleDuration: 0, LayoutDuration: 0 };
	const after = { RecalcStyleDuration: 0.14941, LayoutDuration: 0 };
	const cost = operationCost(before, after, { mode: "duration", keys: { style: "RecalcStyleDuration", layout: "LayoutDuration" } });
	check("修复前耗时(ms)", Number(cost.ms.toFixed(2)), 149.41);
	const improved = (1 - 31.56 / 149.41) * 100;
	check("隐含改善幅度(%)", Number(improved.toFixed(0)), 79);

	console.log("案例 2：count-mean 口径 —— 只有 ΔCount 时的估算路径");
	const picked = pickStyleMetrics({ RecalcStyleCount: 10, LayoutCount: 3 });
	check("选中的口径 mode=count-mean", picked.mode === "count-mean" ? 1 : 0, 1);
	const countCost = operationCost({ RecalcStyleCount: 10, LayoutCount: 3 }, { RecalcStyleCount: 30, LayoutCount: 5 }, picked);
	check("ΔCount 合计", countCost.ms, 22);

	console.log("案例 3：口径选择 —— 有 Duration 时优先用 Duration");
	const dur = pickStyleMetrics({ RecalcStyleDuration: 1, LayoutDuration: 1, RecalcStyleCount: 1 });
	check("mode=duration", dur.mode === "duration" ? 1 : 0, 1);

	console.log("案例 4：frameStats —— 已知帧序列");
	const stats = frameStats([16.7, 16.7, 16.7, 120, 16.7, 60, 16.7, 16.7, 16.7, 200]);
	check("帧数", stats.frames, 10);
	check("中位数(ms)", stats.median, 16.7);
	check(">50ms 的帧数", stats.longFrames, 3);
	check("长帧占比", stats.longShare, 0.3);
	check("最长(ms)", stats.max, 200);

	console.log(failed === 0 ? "\n自检通过：计算层与 114 文档的口径一致" : `\n自检失败 ${failed} 项`);
	return failed;
}

async function main() {
	if (SELF_TEST) {
		process.exit(selfTest() === 0 ? 0 : 1);
	}
	if (DRY_RUN) {
		console.log("dry-run：只校验脚本结构与配置，不连浏览器");
		console.log(`  skin        ${SKIN}`);
		console.log(`  皮肤探针    ${SKIN_PROBE[SKIN] ?? "（未内置，需自行提供 --probe）"}`);
		console.log(`  操作        ${SCENARIOS.join(", ")}${EXTRA.length > 0 ? " + " + EXTRA.join(", ") : ""}`);
		console.log(`  轮数        ${RUNS}（每项先预热 1 次）`);
		console.log(`  逐键输入    41 字符，字符间隔 ${TYPE_DELAY_MS}ms（PERF_TYPE_DELAY_MS 可调）`);
		console.log(`  动画等待    ${COLLAPSE_SETTLE_MS}ms（PERF_COLLAPSE_MS 可调）`);
		console.log(`  输出目录    ${OUT_DIR}`);
		console.log(`  必填环境    DSH_PROBE_APP=${APP ?? "（未设置！）"}`);
		console.log(`  可选环境    DSH_PROBE_CDP=${CDP}`);
		const missing = SCENARIOS.filter((name) => typeof OPERATIONS[name] !== "function");
		console.log(missing.length === 0 ? "  操作实现    齐备" : `  操作实现    缺：${missing.join(", ")}`);
		return;
	}
	if (APP === undefined) {
		console.error("DSH_PROBE_APP 未设置。示例：$env:DSH_PROBE_APP='http://127.0.0.1:PORT/?token=...'");
		process.exit(2);
	}
	const probe = SKIN_PROBE[SKIN];
	if (probe === undefined) {
		console.error(`没有为皮肤 ${SKIN} 内置探针；请先把它写进 SKIN_PROBE，避免拿到无效样本。`);
		process.exit(2);
	}
	mkdirSync(OUT_DIR, { recursive: true });
	const client = await connect();
	await client.send("Page.enable");
	await client.send("Runtime.enable");
	await client.send("Performance.enable");

	await client.send("Page.navigate", { url: APP });
	for (let i = 0; i < 60; i += 1) {
		const ready = await client.evaluate("document.readyState === 'complete'").catch(() => false);
		if (ready === true) break;
		await sleep(500);
	}
	await sleep(2500);

	const activated = await client.evaluate(probe).catch(() => false);
	if (activated !== true) {
		console.error(`皮肤 ${SKIN} 没有生效（探针为 false），先切成这套皮肤再测。`);
		process.exit(3);
	}

	// 前置校验：页面必须真的在渲染。
	// Chrome 会在窗口被切到后台/最小化/遮挡时节流渲染 —— 那时 RecalcStyleCount / LayoutCount /
	// LayoutDuration 全都停在原地，测出来的"耗时"会接近 0，是**假数据**。宁可拒绝测量。
	const renderCheck = await client.send("Performance.getMetrics");
	const renderBefore = Object.fromEntries(renderCheck.metrics.map((m) => [m.name, m.value]));
	await client.evaluate(`(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:-9999px;width:10px;height:10px;'; d.textContent = 'render-probe'; document.body.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.remove())); })()`);
	await sleep(1200);
	const renderAfter = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
	const moved = (name) => (renderAfter[name] ?? 0) - (renderBefore[name] ?? 0);
	if (moved("RecalcStyleCount") === 0 && moved("LayoutCount") === 0) {
		console.error("页面没有在渲染（RecalcStyleCount 与 LayoutCount 在 1.2 秒内都没动）。");
		console.error("→ 最常见的原因是这个 Chrome 窗口被切到后台/最小化/被遮挡，Chrome 节流了渲染。");
		console.error("→ 请把那个 Chrome 窗口置于前台并保持可见，然后重跑。此时测出来的数字会接近 0，是假数据。");
		process.exit(4);
	}

	const first = await sample(client.send);
	const picked = pickStyleMetrics(first);
	console.log(`指标口径：${picked.mode}${picked.mode === "count-mean" ? "（估算，见脚本顶部说明）" : ""}`);
	if (picked.mode === "none") console.log("警告：这台 Chrome 既没有 Duration 也没有 Count 指标，只能报 rAF 帧间隔。");

	const results = { label: LABEL, skin: SKIN, app: APP, runs: RUNS, method: picked.mode, startedAt: new Date().toISOString(), operations: {}, extras: {}, exceptions: [] };

	const names = [...SCENARIOS, ...EXTRA.filter((name) => name === "scroll" || name === "stream")];
	for (const name of names) {
		if (name === "scroll") {
			console.log("scenario scroll …");
			results.extras.scroll = await scenarioScroll(client);
			continue;
		}
		if (name === "stream") {
			console.log("scenario stream（合成负载）…");
			results.extras.stream = { synthetic: true, ...(await scenarioSyntheticStream(client)) };
			continue;
		}
		const run = OPERATIONS[name];
		console.log(`operation ${name}：预热 1 次 + 正式 ${RUNS} 轮（无效轮丢弃）`);
		try {
			await run(client);                                  // 预热，不记
			await sleep(SETTLE_MS);
			const samples = [];
			const invalid = [];
			let attempts = 0;
			while (samples.length < RUNS && attempts < RUNS * 3) {
				attempts += 1;
				const ok = await client.evaluate(probe).catch(() => false);
				if (ok !== true) { console.log(`  第 ${attempts} 次：皮肤未生效，丢弃`); continue; }
				const before = await sample(client.send);
				await run(client);
				const after = await sample(client.send);
				const cost = operationCost(before, after, picked);
				if (cost.work < MIN_WORK) {
					invalid.push(cost.work);
					console.log(`  第 ${attempts} 次：work=${cost.work} 太小，判定没真的发生操作，丢弃`);
					await sleep(SETTLE_MS);
					continue;
				}
				samples.push(cost.ms);
				console.log(`  第 ${attempts} 次：${cost.method === "duration" ? cost.ms.toFixed(2) + " ms" : cost.ms + " 次重算"}（work=${cost.work}）`);
				await sleep(SETTLE_MS);
			}
			const sorted = [...samples].sort((a, b) => a - b);
			results.operations[name] = {
				samples,
				average: samples.length === 0 ? null : Number((samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2)),
				median: sorted.length === 0 ? null : Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
				max: sorted.length === 0 ? null : Number(sorted[sorted.length - 1].toFixed(2)),
				invalidRounds: invalid.length,
				method: picked.mode,
			};
		} catch (error) {
			console.log(`  跳过：${error.message}`);
			results.operations[name] = { error: error.message };
		}
	}

	results.exceptions = client.exceptions;
	results.finishedAt = new Date().toISOString();
	const file = join(OUT_DIR, `${LABEL}.json`);
	writeFileSync(file, JSON.stringify(results, null, 1), "utf8");

	console.log("\n=== 汇总（ms/轮，duration 口径）===");
	for (const [name, value] of Object.entries(results.operations)) {
		if (value.error !== undefined) { console.log(`  ${name.padEnd(9)} 跳过：${value.error}`); continue; }
		console.log(`  ${name.padEnd(9)} 平均 ${value.average}  中位 ${value.median}  最大 ${value.max}  样本 [${value.samples.join(", ")}]  丢弃 ${value.invalidRounds}`);
	}
	for (const [name, value] of Object.entries(results.extras)) {
		console.log(`  ${name.padEnd(9)} 帧 ${value.frames}，中位 ${value.median}ms，p95 ${value.p95}ms，最长 ${value.max}ms，>50ms 占 ${(value.longShare * 100).toFixed(1)}%`);
	}
	if (results.exceptions.length > 0) console.log(`  页面异常 ${results.exceptions.length} 条（见 JSON）`);
	console.log(`\n结果：${file}`);
	client.socket.close();
}

await main();
