#!/usr/bin/env node
/**
 * caret-check.mjs — 光标（|）这一层的回归验证，不需要浏览器。
 *
 * 为什么要它：光标那套逻辑的坑全在"算不出位置时怎么办"——
 * 一旦原生光标被隐藏、自绘细条又没画出来，用户就**没有光标**了。
 * 所以这里验的是不变量：只有细条真的画到位置上了，body 才会有 data-mini-caret；
 * 拖选、失焦、在别的可编辑区输入时，都退回收到的原生光标。
 *
 * 做法与 dropdown-check.mjs 相同：从 lib/client.js 里抠出**真实的**常量、
 * clamp、buildSettings 与光标运行时，外面套一层最小 DOM 假件执行 —— 跑的是真代码。
 *
 * 局限：假 DOM 没有真实布局，验证的是"给定矩形怎么算、什么时候隐藏"，
 * 不是像素级观感（粗细/发光好不好看要人眼看）。
 *
 * 跑：node dev/caret-check.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

let failures = 0;
const out = (line) => process.stdout.write(line + "\n");
const check = (name, ok, detail = "") => {
	if (ok) out(`  ok   ${name}`);
	else {
		failures += 1;
		out(`  FAIL ${name}${detail === "" ? "" : ` — ${detail}`}`);
	}
};

/** 按标记切一段源码；标记没了就直接报错，别静默跳过一个模块。 */
const slice = (startMark, endMark, label) => {
	const from = source.indexOf(startMark);
	if (from < 0) throw new Error(`找不到起点标记（${label}）：${startMark}`);
	const to = source.indexOf(endMark, from + startMark.length);
	if (to < 0) throw new Error(`找不到终点标记（${label}）：${endMark}`);
	return source.slice(from, to);
};

const CARET_CONSTANTS = slice(
	"// ---- 光标（|）样式：常量 ----",
	"// 深/浅各一套预设；本地图片按",
	"光标常量",
);
const CLAMP = slice("const clamp = (value, min, max) =>", "\t\tconst isMode = () =>", "clamp");
const CARET_RUNTIME = slice(
	"// ===================== 光标（|）：自绘层 =====================",
	"// ===================== 本地图片：系统文件选择器 + IndexedDB =====================",
	"光标运行时",
);
const SETTINGS_SOURCE = slice("const ART_KEYS = [", '/** 画布底色分量；alpha 由"背景图不透明度"给出。 */', "设置模型");

// ---------------------------------------------------------------------------
// 最小 DOM 假件
// ---------------------------------------------------------------------------
const makeStyle = () => {
	const values = new Map();
	return {
		values,
		setProperty: (name, value) => values.set(name, String(value)),
		removeProperty: (name) => values.delete(name),
		getPropertyValue: (name) => (values.has(name) ? values.get(name) : ""),
	};
};

const makeDom = () => {
	const byId = new Map();
	const listeners = [];
	const attributes = new Map();

	const makeElement = (tag) => {
		const element = {
			tagName: String(tag).toUpperCase(),
			id: "",
			style: makeStyle(),
			display: "none",
			children: [],
			parentElement: null,
			appendChild(child) {
				this.children.push(child);
				child.parentElement = this;
				if (child.id !== "") byId.set(child.id, child);
				return child;
			},
			remove() {
				const parent = this.parentElement;
				if (parent !== null) parent.children = parent.children.filter((child) => child !== this);
				if (this.id !== "") byId.delete(this.id);
			},
			setAttribute(name, value) {
				if (name === "id") this.id = String(value);
				this.attributes = this.attributes === undefined ? new Map() : this.attributes;
				this.attributes.set(name, String(value));
				if (this.attributes.has("data-mini-caret-blink")) this.blink = this.attributes.get("data-mini-caret-blink");
			},
			getAttribute(name) {
				if (name === "id") return this.id === "" ? null : this.id;
				if (this.attributes === undefined) return null;
				return this.attributes.has(name) ? this.attributes.get(name) : null;
			},
			hasAttribute(name) {
				if (name === "id") return this.id !== "";
				return this.attributes !== undefined && this.attributes.has(name);
			},
			removeAttribute(name) {
				if (this.attributes !== undefined) this.attributes.delete(name);
			},
			closest: () => null,
		};
		// `style.display` 与假件的 display 字段同步：断言直接读 style.display 更贴近真实代码。
		Object.defineProperty(element.style, "display", {
			get: () => element.display,
			set: (value) => {
				element.display = String(value);
			},
		});
		element.attributes = new Map();
		return element;
	};

	const body = makeElement("body");
	const document = {
		body,
		documentElement: makeElement("html"),
		hasFocus: () => true,
		getElementById: (id) => (byId.has(id) ? byId.get(id) : null),
		createElement: (tag) => {
			// 字体内容盒度量：模拟 Chrome 在 14px 下的字体度量（ascent 15 + descent 4 = 19px），
			// 与实测的文字光标矩形高度一致。
			if (String(tag).toLowerCase() === "canvas") {
				return { font: "", getContext: () => ({ font: "", measureText: () => ({ fontBoundingBoxAscent: 15, fontBoundingBoxDescent: 4 }) }) };
			}
			return makeElement(tag);
		},
		querySelector: () => null,
		addEventListener: (type, handler) => listeners.push({ type, handler }),
		removeEventListener: (type, handler) => {
			const at = listeners.findIndex((entry) => entry.type === type && entry.handler === handler);
			if (at >= 0) listeners.splice(at, 1);
		},
	};

	const frames = [];
	const window = {
		innerHeight: 900,
		innerWidth: 1400,
		requestAnimationFrame: (fn) => {
			frames.push(fn);
			return frames.length;
		},
		cancelAnimationFrame: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		getComputedStyle: () => ({ lineHeight: "24px", fontSize: "14px" }),
		getSelection: () => null,
	};

	return { document, window, body, byId, listeners, frames, makeElement };
};

const buildHarness = () => {
	const dom = makeDom();
	const code =
		CARET_CONSTANTS +
		"\n" +
		CLAMP +
		"\n" +
		CARET_RUNTIME +
		"\n" +
		"return { CARET_ID, CARET_COLOR_VAR, CARET_GLOW_VAR, CARET_ACCENT, CARET_WIDTH_MAX, CARET_GLOW_MAX, HEX_COLOR, CARET_PRESETS, applyCaret, placeCaret, hideCaret, mountCaret, unmountCaret, caretStyle: () => caretStyle };\n";
	const factory = new Function("document", "window", code);
	return { dom, api: factory(dom.document, dom.window) };
};

const buildSettingsHarness = () => {
	const dom = makeDom();
	const code =
		CARET_CONSTANTS +
		"\n" +
		CLAMP +
		"\n" +
		SETTINGS_SOURCE +
		"\nreturn { buildSettings, SHARED_DEFAULTS, defaultSettings, fingerprint, PRESET_KEYS, CARET_KEYS };\n";
	return new Function("document", "window", code)(dom.document, dom.window);
};

const normalize = (value) => String(value).replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// 1. 常量与设置模型
// ---------------------------------------------------------------------------
out("\n1. 设置模型（每套预设各一份 / 夹紧 / 颜色校验 / 旧版迁移）");
{
	const { buildSettings, defaultSettings, SHARED_DEFAULTS, fingerprint, PRESET_KEYS, CARET_KEYS } = buildSettingsHarness();

	const defaults = buildSettings({});
	const dark = defaults["dark:idle"];
	check("默认：跟随强调色", dark.caretFollowAccent === true, String(dark.caretFollowAccent));
	check("默认：原生粗细 1px", dark.caretWidth === 1, String(dark.caretWidth));
	check("默认：无发光", dark.caretGlow === 0, String(dark.caretGlow));
	check("默认：闪烁开", dark.caretBlink === true, String(dark.caretBlink));
	check("默认：颜色是一个 #rrggbb", /^#[0-9a-f]{6}$/i.test(dark.caretColor), dark.caretColor);
	check("defaultSettings() 与 buildSettings({}) 一致", JSON.stringify(defaultSettings()) === JSON.stringify(defaults));
	check("四套预设各自都有 5 个光标键", PRESET_KEYS.every((preset) => CARET_KEYS.every((name) => defaults[preset][name] !== undefined)));
	check("光标不再是 shared 字段（改由预设保存）", !CARET_KEYS.some((name) => Object.hasOwn(SHARED_DEFAULTS, name)));

	// 每套预设可以不一样：这正是"深色粗、浅色细"能不能成立的关键。
	const split = buildSettings({ "dark:idle": { caretWidth: 5 }, "light:idle": { caretWidth: 2 }, "dark:work": { caretWidth: 4 } });
	check("四套预设可以互不相同", split["dark:idle"].caretWidth === 5 && split["light:idle"].caretWidth === 2 && split["dark:work"].caretWidth === 4, [split["dark:idle"].caretWidth, split["light:idle"].caretWidth, split["dark:work"].caretWidth].join("/"));
	check("没写的那套保持默认", split["light:work"].caretWidth === 1, String(split["light:work"].caretWidth));

	const clampedLow = buildSettings({ "dark:idle": { caretWidth: 0, caretGlow: -5 } });
	check("粗细 0 夹到 1", clampedLow["dark:idle"].caretWidth === 1, String(clampedLow["dark:idle"].caretWidth));
	check("发光 -5 夹到 0", clampedLow["dark:idle"].caretGlow === 0, String(clampedLow["dark:idle"].caretGlow));

	const clampedHigh = buildSettings({ "dark:idle": { caretWidth: 99, caretGlow: 99 } });
	check("粗细 99 夹到上限 8", clampedHigh["dark:idle"].caretWidth === 8, String(clampedHigh["dark:idle"].caretWidth));
	check("发光 99 夹到上限 16", clampedHigh["dark:idle"].caretGlow === 16, String(clampedHigh["dark:idle"].caretGlow));

	const dirty = buildSettings({ "light:work": { caretWidth: "3.7", caretGlow: "6.2" } });
	check("字符串数值会被取整", dirty["light:work"].caretWidth === 4 && dirty["light:work"].caretGlow === 6, `${dirty["light:work"].caretWidth}/${dirty["light:work"].caretGlow}`);

	const badColor = buildSettings({ "dark:idle": { caretFollowAccent: false, caretColor: "rgba(1,2,3,.5)" } });
	check("非 #rrggbb 的颜色退回默认", badColor["dark:idle"].caretColor === dark.caretColor, badColor["dark:idle"].caretColor);

	const goodColor = buildSettings({ "dark:work": { caretFollowAccent: false, caretColor: "#FFEB3B" } });
	check("合法的 #rrggbb 原样保留", goodColor["dark:work"].caretColor === "#FFEB3B", goodColor["dark:work"].caretColor);

	const kept = buildSettings({ "dark:idle": { caretFollowAccent: false, caretWidth: 5 } });
	check("取消跟随强调色后保持 false", kept["dark:idle"].caretFollowAccent === false && kept["dark:idle"].caretWidth === 5);

	// 0.4.0 的旧设置把光标写在顶层（shared）：升级时要铺进四套预设，不能丢。
	const migrated = buildSettings({ caretWidth: 4, caretColor: "#ffffff", caretFollowAccent: false, caretGlow: 9, caretBlink: false });
	check("旧版全局光标铺进四套预设", PRESET_KEYS.every((preset) => migrated[preset].caretWidth === 4 && migrated[preset].caretColor === "#ffffff" && migrated[preset].caretGlow === 9 && migrated[preset].caretBlink === false));
	check("预设自己写的值优先于旧全局值", buildSettings({ caretWidth: 4, "dark:idle": { caretWidth: 6 } })["dark:idle"].caretWidth === 6);

	// 关键回归：包里的 shared 带光标、modes 带素材时，不能被误判成"扁平老格式"而丢掉四套预设。
	const packLike = buildSettings({
		caretWidth: 3,
		"dark:idle": { canvasImage: "custom", canvasOpacity: 11 },
		"light:idle": { canvasImage: "custom", canvasOpacity: 22 },
	});
	check("带光标的皮肤包不会被误判成扁平格式", packLike["dark:idle"].canvasOpacity === 11 && packLike["light:idle"].canvasOpacity === 22, `${packLike["dark:idle"].canvasOpacity}/${packLike["light:idle"].canvasOpacity}`);
	check("这类包的光标也照旧铺开", packLike["light:work"].caretWidth === 3, String(packLike["light:work"].caretWidth));

	// 指纹必须包含光标：否则"只改了光标"不算改过，下次刷新会被皮肤包盖回去。
	const base = buildSettings({});
	const tweaked = buildSettings({ "dark:idle": { caretWidth: 6 } });
	check("只改光标也会改变指纹", fingerprint(base) !== fingerprint(tweaked), `${fingerprint(base)} vs ${fingerprint(tweaked)}`);
}

// ---------------------------------------------------------------------------
// 2. 自绘：位置与尺寸
// ---------------------------------------------------------------------------
out("\n2. 自绘光标：定位与尺寸");
const cardRect = { left: 100, top: 200, height: 24, width: 0, right: 100, bottom: 224 };

const setupCaret = ({ collapsed = true, insideComposer = true, rect = cardRect, clientRects, editorFrame = { left: 0, top: 0, width: 0, height: 0 }, style, focused = true } = {}) => {
	const { dom, api } = buildHarness();
	const editor = dom.makeElement("div");
	editor.setAttribute("contenteditable", "true");
	editor.setAttribute("data-composer-input", "");
	editor.closest = (selector) => (insideComposer && selector === "[data-composer-input]" ? editor : null);
	editor.getBoundingClientRect = () => editorFrame;
	const text = { nodeType: 3, parentElement: insideComposer ? editor : dom.makeElement("div") };
	dom.document.hasFocus = () => focused;
	dom.document.body.appendChild(editor);
	if (style !== undefined) dom.window.getComputedStyle = () => style;
	dom.window.getSelection = () => ({
		rangeCount: 1,
		isCollapsed: collapsed,
		getRangeAt: () => ({
			startContainer: text,
			getBoundingClientRect: () => rect,
			...(clientRects === undefined ? {} : { getClientRects: () => clientRects }),
		}),
	});
	return { dom, api };
};

{
	const { dom, api } = setupCaret();
	api.applyCaret({ caretFollowAccent: false, caretColor: "#ffd166", caretWidth: 3, caretGlow: 8, caretBlink: false });
	check("粗细 3 → 进入自绘模式", api.caretStyle() !== null);
	api.placeCaret();
	const element = dom.document.getElementById(api.CARET_ID);
	check("细条被创建并显示", element !== null && element.style.display === "block", element === null ? "没创建" : element.style.display);
	check("宽度 = 设置值", normalize(element.style.width) === "3px", element.style.width);
	check("高度取选区矩形", normalize(element.style.height) === "24.00px", element.style.height);
	check("以原生 1px 位置为轴居中", normalize(element.style.left) === "99.00px", element.style.left);
	check("顶边对齐选中行", normalize(element.style.top) === "200.00px", element.style.top);
	check("细条画出来后才隐藏原生光标", dom.document.body.hasAttribute("data-mini-caret"));
	check("不闪烁：属性为 off", element.getAttribute("data-mini-caret-blink") === "off", String(element.getAttribute("data-mini-caret-blink")));
}

{
	const { dom, api } = setupCaret({ collapsed: false });
	api.applyCaret({ caretWidth: 3 });
	api.placeCaret();
	const element = dom.document.getElementById(api.CARET_ID);
	check("拖选（非折叠）时不画、原生光标回来", !dom.document.body.hasAttribute("data-mini-caret") && (element === null || element.style.display === "none"));
}

{
	const { dom, api } = setupCaret({ insideComposer: false });
	api.applyCaret({ caretWidth: 3 });
	api.placeCaret();
	check("会话输入框之外的可编辑区不接管", !dom.document.body.hasAttribute("data-mini-caret"));
}

{
	const { dom, api } = setupCaret({ focused: false });
	api.applyCaret({ caretWidth: 3 });
	api.placeCaret();
	check("失焦时不画", !dom.document.body.hasAttribute("data-mini-caret"));
}

{
	const { dom, api } = setupCaret({ rect: { left: 100, top: 200, height: 0, width: 0, right: 100, bottom: 200 } });
	api.applyCaret({ caretWidth: 3 });
	api.placeCaret();
	const element = dom.document.getElementById(api.CARET_ID);
	check("零高矩形用字体内容盒兜底", normalize(element.style.height) === "19.00px", normalize(element.style.height));
}

{
	const { dom, api } = setupCaret({ rect: { left: 100, top: -40, height: 24, width: 0, right: 100, bottom: -16 } });
	api.applyCaret({ caretWidth: 3 });
	api.placeCaret();
	check("滚出视口时不画", !dom.document.body.hasAttribute("data-mini-caret"));
}

// 空输入框：Chrome 对"只有一个 <br> 的空段落"常给全零矩形。
// 这个 case 曾经把细条画到视口左上角、而原生光标已透明 = "框里没有光标"。
{
	const { dom, api } = setupCaret({
		rect: { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 },
		editorFrame: { left: 300, top: 500, width: 800, height: 40, right: 1100, bottom: 540 },
		style: { lineHeight: "24px", fontSize: "14px", fontFamily: "sans-serif", fontStyle: "normal", fontWeight: "400", paddingLeft: "14px", paddingTop: "4px", borderLeftWidth: "0px", borderTopWidth: "1px" },
	});
	api.applyCaret({ caretWidth: 3 });
	api.placeCaret();
	const element = dom.document.getElementById(api.CARET_ID);
	// 300 + paddingLeft 14 = 314，再按 3px 粗细居中（-1）= 313。
	check("空框：全零矩形退回编辑框内容原点", normalize(element.style.left) === "313.00px", element.style.left);
	// 500 + paddingTop 4 + border 1 + (24 行高 - 19 内容盒)/2 = 507.5
	check("空框：垂直按行盒居中", normalize(element.style.top) === "507.50px", element.style.top);
	check("空框：仍然有光标（不是没有光标）", element.style.display === "block" && dom.document.body.hasAttribute("data-mini-caret"));
	check("空框：高度 = 字体内容盒 19px（不是行高 24px）", normalize(element.style.height) === "19.00px", element.style.height);
}

// 光标落在 <p> 里（Lexical 的实际结构）：垂直位置要跟着那个行块走。
{
	const { dom, api } = setupCaret({
		rect: { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 },
		editorFrame: { left: 300, top: 500, width: 800, height: 40, right: 1100, bottom: 540 },
		style: { lineHeight: "24px", fontSize: "14px", fontFamily: "sans-serif", paddingLeft: "14px", paddingTop: "4px" },
	});
	// 把"文字节点"挪进一个 <p>：编辑器 > p > 文本。
	const paragraph = dom.makeElement("p");
	paragraph.getBoundingClientRect = () => ({ left: 314, top: 554, width: 800, height: 24, right: 1114, bottom: 578 });
	const editor = dom.document.body.children[0];
	editor.appendChild(paragraph);
	editor.children = editor.children.filter((child) => child !== paragraph);
	editor.appendChild(paragraph);
	const text = { nodeType: 3, parentElement: paragraph };
	dom.window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, getRangeAt: () => ({ startContainer: text, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) }) });
	api.applyCaret({ caretWidth: 3 });
	api.placeCaret();
	const element = dom.document.getElementById(api.CARET_ID);
	// 554 + (24 - 19)/2 = 556.5
	check("空框在 <p> 里：跟着行块居中", normalize(element.style.top) === "556.50px", element.style.top);
	check("空框在 <p> 里：高度仍是内容盒", normalize(element.style.height) === "19.00px", element.style.height);
}

{
	const { dom, api } = setupCaret({ rect: { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }, editorFrame: { left: 300, top: -200, width: 800, height: 40, right: 1100, bottom: -160 } });
	api.applyCaret({ caretWidth: 3 });
	api.placeCaret();
	check("空框但编辑框在视口外：退回收到的原生光标", !dom.document.body.hasAttribute("data-mini-caret"));
}

{
	const { dom, api } = setupCaret({ rect: cardRect, clientRects: [{ left: 120, top: 210, width: 1, height: 18, right: 121, bottom: 228 }] });
	api.applyCaret({ caretWidth: 3 });
	api.placeCaret();
	const element = dom.document.getElementById(api.CARET_ID);
	check("有 getClientRects 时优先用它", normalize(element.style.left) === "119.00px" && normalize(element.style.top) === "210.00px", `${element.style.left}/${element.style.top}`);
}

// ---------------------------------------------------------------------------
// 3. 原生模式：只换颜色
// ---------------------------------------------------------------------------
out("\n3. 原生模式（1px、无发光）：只改颜色");
{
	const { dom, api } = setupCaret();
	api.applyCaret({ caretFollowAccent: true, caretColor: "#ffd166", caretWidth: 1, caretGlow: 0, caretBlink: true });
	api.placeCaret();
	check("1px + 无发光 → 不进自绘", api.caretStyle() === null);
	check("跟随强调色写的是 token 引用", normalize(dom.document.body.style.getPropertyValue(api.CARET_COLOR_VAR)) === "var(--dsw-alias-state-business-primary)", dom.document.body.style.getPropertyValue(api.CARET_COLOR_VAR));
	check("原生模式下不隐藏原生光标", !dom.document.body.hasAttribute("data-mini-caret"));
}

{
	const { dom, api } = setupCaret();
	api.applyCaret({ caretFollowAccent: false, caretColor: "#39ff88", caretWidth: 1, caretGlow: 0 });
	check("自选色直接写进变量", normalize(dom.document.body.style.getPropertyValue(api.CARET_COLOR_VAR)) === "#39ff88", dom.document.body.style.getPropertyValue(api.CARET_COLOR_VAR));
}

{
	const { dom, api } = setupCaret();
	api.applyCaret({ caretWidth: 1, caretGlow: 6 });
	check("发光 > 0 也会进自绘", api.caretStyle() !== null);
	check("发光写进变量", normalize(dom.document.body.style.getPropertyValue(api.CARET_GLOW_VAR)) === "6px", dom.document.body.style.getPropertyValue(api.CARET_GLOW_VAR));
}

// ---------------------------------------------------------------------------
// 4. 生命周期：监听与清理
// ---------------------------------------------------------------------------
out("\n4. 生命周期：监听绑定 / 卸载");
{
	const { dom, api } = setupCaret();
	api.mountCaret();
	const bound = dom.listeners.map((entry) => entry.type);
	check("绑定了 selectionchange", bound.includes("selectionchange"));
	check("绑定了 input / keyup / mouseup", ["input", "keyup", "mouseup"].every((type) => bound.includes(type)));
	check("绑定了 focusin / focusout / compositionend", ["focusin", "focusout", "compositionend"].every((type) => bound.includes(type)));
	const before = dom.listeners.length;
	api.unmountCaret();
	check("卸载后监听清空", dom.listeners.length === 0, `${before} → ${dom.listeners.length}`);
	check("卸载后不残留原生光标属性", !dom.document.body.hasAttribute("data-mini-caret"));
}

// ---------------------------------------------------------------------------
// 5. 样式表：规则确实生成了
// ---------------------------------------------------------------------------
// 注意：`css` 是模板字符串，源码里写的是 ${CARET_*}; 插值发生在运行时。
// 所以这里核对"模板里怎么写的"，再单独核对常量本身的值（两边合起来才等于真实样式）。
out("\n5. 注入的样式表里规则齐全");
{
	const { api } = buildHarness();
	check("常量：元素 id 固定", api.CARET_ID === "dsh-mini-skin-caret", api.CARET_ID);
	check("常量：颜色变量名", api.CARET_COLOR_VAR === "--dsh-mini-skin-caret-color", api.CARET_COLOR_VAR);
	check("常量：回退到宿主强调色 token", api.CARET_ACCENT === "var(--dsw-alias-state-business-primary)", api.CARET_ACCENT);

	const css = slice("const css = `", "`;", "样式表");
	check("原生光标颜色走变量并回退到强调色", css.includes("caret-color: var(${CARET_COLOR_VAR}, ${CARET_ACCENT});"));
	check("自绘时原生光标透明", /\[data-mini-caret\] :is\(\[contenteditable='true'\], textarea, input\) \{\s*caret-color: transparent;/.test(css));
	check("细条有 fixed 定位与高 z-index", css.includes("#${CARET_ID} {") && css.includes("position: fixed;") && css.includes("z-index: 2147483000;"));
	check("发光用 box-shadow", css.includes("box-shadow: 0 0 var(${CARET_GLOW_VAR}, 0px)"));
	check("闪烁可关", css.includes("#${CARET_ID}[data-mini-caret-blink='off']"));
	check("闪烁动画存在", css.includes("@keyframes dsh-mini-skin-caret-blink"));
	check("细条不吃鼠标事件", css.includes("pointer-events: none;"));
	check("细条不参与无障碍树 / 不选中", css.includes("position: fixed;") && source.includes('element.setAttribute("aria-hidden", "true");'));
}

// ---------------------------------------------------------------------------
// 6. 面板与出口都接上了新字段
// ---------------------------------------------------------------------------
out("\n6. 面板 / 皮肤包 / 控制台出口");
{
	check("面板有「光标」分组", source.includes('"光标"),'));
	check("面板有粗细/发光/闪烁/预设", ["光标粗细", "光标发光", "光标闪烁", "快速预设"].every((label) => source.includes(label)));
	check("取色器只接受 #rrggbb", source.includes("type: \"color\""));
	check("皮肤包 modes 直接展开预设（自动带上光标）", source.includes("Object.fromEntries(PRESET_KEYS.map"));
	check("控制台出口 __dshMiniSkinCaret", source.includes("window.__dshMiniSkinCaret"));
	// 面板里的光标控件必须落在「正在编辑」那套（patchMode / m.）上，而不是全局 settings。
	check("光标控件作用于当前预设", source.includes("patchMode({ caretWidth: value })") && source.includes("m.caretWidth"));
	check("有「同步本主题两态」与「同步全部四套」", source.includes("同步本主题两态") && source.includes("同步全部四套") && source.includes("syncCaret(\"theme\")") && source.includes("syncCaret(\"all\")"));
	// 「同步本主题」绝不能把另一套主题也覆盖掉。
	check("同主题同步只挑同 mode 的预设", source.includes('if (scope === "theme" && modeOf(key) !== theme) continue;'));
}

out("\n7. 皮肤文件（包）里的光标");
{
	const { buildSettings, PRESET_KEYS, CARET_KEYS } = buildSettingsHarness();

	// 包里的 modes 就是设置里的四套预设，字段名一一对应 —— 这正是"光标进皮肤文件"的含义。
	const pack = {
		format: "dsh-mini-skin-pack",
		version: 3,
		name: "测试皮肤",
		shared: { square: true, brandMark: "dsh", linkChip: true, uiFont: "system", sidebarFont: "inherit", packName: "测试皮肤" },
		modes: {
			"dark:idle": { canvasImage: "dark-hero", canvasOpacity: 90, caretFollowAccent: false, caretColor: "#ffeb3b", caretWidth: 4, caretGlow: 12, caretBlink: false },
			"dark:work": { canvasImage: "dark-active", canvasOpacity: 90, caretFollowAccent: false, caretColor: "#ffeb3b", caretWidth: 4, caretGlow: 12, caretBlink: false },
			"light:idle": { canvasImage: "light-hero", canvasOpacity: 65, caretFollowAccent: true, caretColor: "#086cff", caretWidth: 1, caretGlow: 0, caretBlink: true },
			"light:work": { canvasImage: "light-active", canvasOpacity: 65, caretFollowAccent: true, caretColor: "#086cff", caretWidth: 1, caretGlow: 0, caretBlink: true },
		},
		images: {},
	};
	const imported = buildSettings({ ...pack.shared, ...pack.modes, packName: pack.name });
	check("包里的光标按套读出来（深色 4px 亮黄）", imported["dark:idle"].caretWidth === 4 && imported["dark:idle"].caretColor === "#ffeb3b" && imported["dark:idle"].caretGlow === 12 && imported["dark:idle"].caretBlink === false);
	check("包里的光标按套读出来（浅色 1px 跟随强调色）", imported["light:idle"].caretWidth === 1 && imported["light:idle"].caretFollowAccent === true);
	check("同主题两态在包里可以同值，也可以不同", buildSettings({ "dark:idle": { caretWidth: 2 }, "dark:work": { caretWidth: 7 } })["dark:work"].caretWidth === 7);
	check("包的字段名就是设置里的那 5 个键", CARET_KEYS.every((name) => Object.hasOwn(pack.modes["dark:idle"], name)));

	// 官方皮肤有两份副本：仓库里的 skins/official.json 和节点半边的常量。
	// 它们必须一致（dev/README 的约定），而且 name 必须与 OFFICIAL_NAME 相同 ——
	// 曾经这里漂了（文件里是 "official"，代码里是中文名），节点半边会当成"缺这份包"而覆盖。
	const officialText = readFileSync(join(here, "..", "skins", "official.json"), "utf8");
	const official = JSON.parse(officialText);
	const nodeHalf = readFileSync(join(here, "..", "lib", "index.js"), "utf8");
	const officialName = (nodeHalf.match(/const OFFICIAL_NAME = ("[^"]*")/) || [])[1];
	check("skins/official.json 的四套预设都带光标键", PRESET_KEYS.every((key) => CARET_KEYS.every((name) => official.modes[key][name] !== undefined)));
	check("节点半边的官方包常量也带光标键", (nodeHalf.match(/caretFollowAccent: true/g) || []).length === 4);
	check("节点半边与 official.json 的 name 一致", JSON.stringify(official.name) === officialName, `${JSON.stringify(official.name)} vs ${officialName}`);
	check("official.json 的光标 = 宿主原样（跟随强调色、1px、不发光、会闪）", PRESET_KEYS.every((key) => official.modes[key].caretFollowAccent === true && official.modes[key].caretWidth === 1 && official.modes[key].caretGlow === 0 && official.modes[key].caretBlink === true));
}

out(failures === 0 ? "\n全部通过。" : `\n${failures} 项失败。`);
process.exit(failures === 0 ? 0 : 1);
