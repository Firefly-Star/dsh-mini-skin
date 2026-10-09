#!/usr/bin/env node
/**
 * dropdown-check.mjs — 一次性验证：自绘下拉是不是"点当前项也回调"。
 *
 * 为什么要有这个脚本：这一步的关键不是 React，而是**点击语义**，而本机既没有
 * react / react-dom，也没有 DOM 实现。所以脚本自己写一层最小的 createElement +
 * DOM 假件，再把 lib/client.js 里那段**真实的** Select 与样式定义抠出来执行 ——
 * 跑的是真代码，只是外面套了假件。
 *
 * 验的就是用户报的那件事：当前已经是「本地文件」，再点一次「本地文件」必须**再
 * 回调一次**（原生 select 恰恰在这里不派发 change，"想再选一次选不了"）。
 * 另外顺带验：打开菜单不算选择、菜单关得掉（再点触发器 / Esc / 点外面）、
 * 点选项时焦点不被抢走、禁用项点不动、贴底边时菜单向上弹且高度受剩余空间限制。
 *
 * 局限（别当成端到端验证）：样式与真实布局、原生文件选择器都不在这里验。
 * 踩过的坑都写在对应位置：vm 的 realm 边界、createContext 的时序、maxHeight 必须带单位。
 *
 * 跑：node dev/dropdown-check.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

// 从生成物里抠出 Select 与它用到的样式定义（以 lib/client.js 为准，不另抄一份）。
const START = "\t\t// ===================== 下拉：面板自绘，不用 <select> =====================";
const END = "\n\t\tconst Slider = (value, onChange) =>";
const from = source.indexOf(START);
const to = source.indexOf(END, from);
if (from < 0 || to < 0) throw new Error("在 lib/client.js 里找不到 Select 源码块（标记变了？）");
const selectSource = source.slice(from, to);

// ---------------------------------------------------------------------------
// 结果收集
// ---------------------------------------------------------------------------
const out = (line) => process.stdout.write(line + "\n");
let failures = 0;
const check = (name, ok, detail = "") => {
	if (ok) out(`  ok   ${name}`);
	else {
		failures += 1;
		out(`  FAIL ${name}${detail === "" ? "" : ` — ${detail}`}`);
	}
};

// ---------------------------------------------------------------------------
// 最小 DOM 假件
// ---------------------------------------------------------------------------
let elementId = 0;
// 没有真布局：所有元素共用一组坐标，改它就能模拟"这个下拉在视口的哪个位置"。
const RECT = { top: 40, bottom: 70, left: 0, right: 200, width: 200, height: 30 };
const makeElement = (type, props, children, attach) => {
	const element = {
		type,
		props,
		children,
		id: (elementId += 1),
		parent: null,
		getBoundingClientRect: () => RECT,
		contains: (target) => {
			let cursor = target;
			while (cursor !== null && cursor !== undefined) {
				if (cursor === element) return true;
				cursor = typeof cursor === "object" ? cursor.parent : null;
			}
			return false;
		},
	};
	for (const child of children) if (child !== null && typeof child === "object" && child.parent === null) attach(element, child);
	return element;
};
const attachTo = (parent, child) => {
	let root = parent;
	while (root.parent !== null) root = root.parent;
	child.parent = root;
	return child;
};

// document 上的监听器，按 (type, handler) 记账，好验"关掉时有没有撤干净"。
const documentListeners = new Map(); // type -> Set<handler>
const document = {
	addEventListener(type, handler) {
		if (!documentListeners.has(type)) documentListeners.set(type, new Set());
		documentListeners.get(type).add(handler);
	},
	removeEventListener(type, handler) {
		if (documentListeners.has(type)) documentListeners.get(type).delete(handler);
	},
};
const documentListenerCount = () => [...documentListeners.values()].reduce((n, set) => n + set.size, 0);
const fireDocument = (type, extra = {}) => {
	const event = { type, target: null, currentTarget: document, key: "", relatedTarget: null, preventDefault() {}, stopPropagation() {}, ...extra };
	[...(documentListeners.get(type) || [])].forEach((handler) => handler(event));
};

// 极其精简的 hooks：数组按顺序存槽位；setState 只标脏，由 flush 重渲染。
const React = {
	__current: null,
	useState(initial) {
		const current = React.__current;
		if (current === null) throw new Error("useState 出现在渲染之外");
		if (current.hookIndex >= current.hooks.length) current.hooks.push({ kind: "state", value: typeof initial === "function" ? initial() : initial });
		const hook = current.hooks[current.hookIndex];
		current.hookIndex += 1;
		return [hook.value, (next) => {
			const value = typeof next === "function" ? next(hook.value) : next;
			if (value === hook.value) return;
			hook.value = value;
			current.dirty = true;
		}];
	},
	useEffect(effect, deps) {
		const current = React.__current;
		if (current.hookIndex >= current.hooks.length) current.hooks.push({ kind: "effect", deps: null, cleanup: null });
		const hook = current.hooks[current.hookIndex];
		current.hookIndex += 1;
		current.pendingEffects.push({ hook, effect, deps: deps === undefined ? null : deps });
	},
	useRef(initial) {
		const current = React.__current;
		if (current.hookIndex >= current.hooks.length) current.hooks.push({ kind: "ref", value: { current: initial } });
		const hook = current.hooks[current.hookIndex];
		current.hookIndex += 1;
		return hook.value;
	},
	createElement(type, props, ...children) {
		const flat = [];
		const push = (child) => {
			if (child === null || child === undefined || typeof child === "boolean") return;
			if (Array.isArray(child)) child.forEach(push);
			else if (typeof child === "object") flat.push(child);
			else flat.push({ type: "text", props: {}, children: [String(child)], parent: null });
		};
		children.forEach(push);
		if (typeof type === "function") return type({ ...(props || {}), children: flat });
		const element = makeElement(type, props || {}, flat, attachTo);
		// React 的 ref：真代码靠它拿到外层 div 去量位置、判"点在不在里面"。
		const ref = props === undefined || props === null ? null : props.ref;
		if (ref !== null && typeof ref === "object") ref.current = element;
		return element;
	},
	Fragment: Symbol("Fragment"),
};

/**
 * 最小的 react-dom：渲染根组件，setState 后重跑。
 * 副作用按依赖数组决定要不要重跑（真代码传的是 [open]，这一点必须照做，
 * 否则"打开时挂、关掉时撤"这段生命周期就验不出来）。
 */
function mountRoot(component) {
	const current = { hooks: [], hookIndex: 0, pendingEffects: [], dirty: false, tree: null };
	const sameDeps = (a, b) => a !== null && b !== null && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
	const renderPass = () => {
		current.hookIndex = 0;
		current.pendingEffects = [];
		React.__current = current;
		let tree;
		try {
			tree = component();
		} finally {
			React.__current = null;
		}
		// React 的 commit 顺序：先撤旧副作用，再挂新的。
		for (const { hook, effect, deps } of current.pendingEffects) {
			if (hook.deps !== null && sameDeps(hook.deps, deps)) continue;
			if (typeof hook.cleanup === "function") hook.cleanup();
			hook.deps = deps;
			const cleanup = effect();
			hook.cleanup = typeof cleanup === "function" ? cleanup : null;
		}
		current.tree = tree;
	};
	const flush = () => {
		do {
			current.dirty = false;
			renderPass();
		} while (current.dirty);
	};
	flush();
	return { get tree() { return current.tree; }, flush };
}

// 事件派发：从目标沿 parent 冒泡找 onXxx（就是 React 的冒泡语义，少了合成层）。
const HANDLER_OF = { mousedown: "onMouseDown", click: "onClick", blur: "onBlur", focus: "onFocus", keydown: "onKeyDown", change: "onChange" };
function fire(target, type, extra = {}) {
	const prop = HANDLER_OF[type];
	let prevented = false;
	let cursor = target;
	while (cursor !== null) {
		const handler = cursor.props[prop];
		if (typeof handler === "function") {
			handler({
				type,
				target,
				currentTarget: cursor,
				key: extra.key === undefined ? "" : extra.key,
				relatedTarget: extra.relatedTarget === undefined ? null : extra.relatedTarget,
				preventDefault: () => { prevented = true; },
				stopPropagation: () => {},
			});
			return { prevented, handled: true };
		}
		cursor = cursor.parent;
	}
	return { prevented, handled: false };
}
/** 逼真的鼠标点击：mousedown（可能被 preventDefault 吃掉）→ click。 */
const userClick = (element) => {
	const down = fire(element, "mousedown");
	fire(element, "click");
	return down;
};

const find = (root, predicate) => {
	const hits = [];
	const walk = (node) => {
		if (node === null || node === undefined || typeof node !== "object") return;
		if (predicate(node)) hits.push(node);
		for (const child of node.children) walk(child);
	};
	walk(root);
	return hits;
};
const menuOf = (tree) => find(tree, (node) => node.props.role === "listbox")[0] || null;
const optionsOf = (tree) => find(tree, (node) => node.props.role === "option");
// Select 返回的是外层 div，真正能点的是里面那个按钮（只有它带 aria-haspopup）。
const buttonOf = (tree) => find(tree, (node) => node.props["aria-haspopup"] === "listbox")[0] || null;
const labelOf = (node) => find(node, (child) => child.type === "text").map((child) => child.children[0]).join("");

// ---------------------------------------------------------------------------
// 把真代码放进沙箱执行
// ---------------------------------------------------------------------------
// window 得在 createContext **之前**挂上沙箱对象：createContext 只按当时已有的
// 键去建全局，之后再写 sandbox.window 沙箱里是看不到的（坑：innerHeight 读成
// undefined，菜单方向就一直算不对）。
const sandbox = {
	React,
	document,
	console,
	RECT,
	window: { innerHeight: 900 },
	SELECT_STYLE: {
		minWidth: "168px",
		padding: "4px 8px",
		fontSize: "13px",
		color: "var(--dsw-alias-label-primary)",
		background: "var(--dsw-alias-bg-layer-2)",
		border: "1px solid var(--dsw-alias-border-l2)",
	},
};
createContext(sandbox);
// 用 IIFE 的返回值把 Select 取出来：vm 里 `const` 是词法的，赋值不进 sandbox。
const Select = runInContext(`(() => { ${selectSource}\n return Select; })()`, sandbox);
/** 摆位置：坐标写进沙箱里那份，别在外面改（跨 realm 改外面那份读不到）。 */
const rectAt = (top, bottom) => {
	runInContext(`RECT.top = ${top}; RECT.bottom = ${bottom}; RECT.height = ${bottom - top};`, sandbox);
};
const viewportHeight = (height) => runInContext(`window.innerHeight = ${height};`, sandbox);

// ---------------------------------------------------------------------------
// 受控使用方式：和面板里一样 —— value 由外面给，回调负责改值并重渲染
// ---------------------------------------------------------------------------
const CHOICES = [
	{ value: "none", label: "不要背景图" },
	{ value: "file", label: "本地文件…（系统选择器）" },
];

function mount(initialValue, choices = CHOICES) {
	const box = { value: initialValue, calls: [] };
	const root = mountRoot(() => Select(box.value, choices, (next) => { box.calls.push(next); box.value = next; }));
	// React 会在事件处理结束后重渲染；这里由访问器代劳（等价于"等一拍"）。
	const tree = () => {
		root.flush();
		return root.tree;
	};
	return {
		calls: box.calls,
		tree,
		button: () => buttonOf(tree()),
		menu: () => menuOf(tree()),
		option: (needle) => optionsOf(tree()).find((option) => labelOf(option).startsWith(needle)),
		options: () => optionsOf(tree()),
		// 点一下触发器：菜单开着就关，关着就开。
		toggle: () => userClick(buttonOf(tree())),
		flush: root.flush,
	};
}

// ---------------------------------------------------------------------------
out("1) 当前就是「本地文件」时，再点一次「本地文件」");
{
	const view = mount("file");
	check("一开始没有菜单", view.menu() === null);
	check("触发器显示当前项", labelOf(view.button()).includes("本地文件"), labelOf(view.button()));

	view.toggle();
	check("点触发器后菜单出现", view.menu() !== null);
	check("打开菜单本身不回调（打开 ≠ 选了）", view.calls.length === 0, `calls=${JSON.stringify(view.calls)}`);
	const options = view.options();
	check("菜单里两项都在", options.length === 2, `n=${options.length}`);
	check("第一项是「不要背景图」", labelOf(options[0]) === "不要背景图", labelOf(options[0]));
	check("第二项是「本地文件…」", labelOf(options[1]).startsWith("本地文件"), labelOf(options[1]));
	check("当前项被标成选中", options[1].props["aria-selected"] === true);

	userClick(options[1]); // ← 点的就是当前值
	check("点当前项也回调了一次", view.calls.length === 1, `calls=${JSON.stringify(view.calls)}`);
	check("回调拿到的值是 file", view.calls[0] === "file", `got=${view.calls[0]}`);
	check("点完菜单关上", view.menu() === null);

	// 再来一遍 —— 就是"我还想再挑一张别的图"。
	view.toggle();
	userClick(view.options()[1]);
	check("再点一次当前项又回调了（共 2 次）", view.calls.length === 2, `calls=${JSON.stringify(view.calls)}`);

	// 换成别的一项：照旧一次、值正确。
	view.toggle();
	userClick(view.option("不要背景图"));
	check("点另一项回调值正确", view.calls.length === 3 && view.calls[2] === "none", `calls=${JSON.stringify(view.calls)}`);
}

out("2) 点菜单项时焦点不会被抢走（否则那一次点击会落空）");
{
	const view = mount("file");
	view.toggle();
	const option = view.option("本地文件");
	let prevented = false;
	option.props.onMouseDown({ preventDefault: () => { prevented = true; }, stopPropagation: () => {} });
	check("菜单项 mousedown 会 preventDefault（焦点留在触发器上）", prevented === true);
	userClick(option);
	check("点的还是当前项，照样回调", view.calls.length === 1 && view.calls[0] === "file", `calls=${JSON.stringify(view.calls)}`);
}

out("3) 菜单关得掉");
{
	// 前面几节各自开过菜单，那批监听器与本节的计数无关，先清干净。
	documentListeners.clear();
	const view = mount("file");
	view.toggle();
	view.flush();
	check("打开", view.menu() !== null);
	check("打开时挂上两个 document 监听（点外面 + Esc）", documentListenerCount() === 2, `n=${documentListenerCount()}`);
	view.toggle();
	view.flush();
	check("再点一次触发器 = 关", view.menu() === null);
	check("关掉后监听器撤干净", documentListenerCount() === 0, `n=${documentListenerCount()}`);
	check("关菜单不回调", view.calls.length === 0, `calls=${JSON.stringify(view.calls)}`);

	// 真代码的监听器挂在 document 上；这里没有 React 事件系统，所以每次点完都
	// 手动 flush 一次 —— 等价于浏览器里事件处理跑完、React 提交副作用的那一拍。
	view.toggle();
	view.flush();
	fireDocument("keydown", { key: "Escape" });
	view.flush();
	check("Esc 关菜单", view.menu() === null);
	check("Esc 不回调", view.calls.length === 0, `calls=${JSON.stringify(view.calls)}`);

	view.toggle();
	view.flush();
	fireDocument("mousedown", { target: { id: "外面" } });
	view.flush();
	check("点外面关菜单", view.menu() === null);

	view.toggle();
	view.flush();
	fireDocument("mousedown", { target: view.options()[0] });
	view.flush();
	check("点在菜单内部**不**关菜单", view.menu() !== null);
}

out("4) 禁用项：只是说明，不是能点的按钮");
{
	const choices = [{ value: "dark-hero", label: "内置素材：暗色场景（来自皮肤）", disabled: true }, ...CHOICES];
	const view = mount("dark-hero", choices);
	check("当前值如实显示为内置素材", labelOf(view.button()).startsWith("内置素材"), labelOf(view.button()));
	view.toggle();
	const options = view.options();
	check("三条项都在", options.length === 3, `n=${options.length}`);
	check("第一条 disabled", options[0].props.disabled === true);
	check("第一条是灰的、不该点的样子", options[0].props.style.cursor === "not-allowed", String(options[0].props.style.cursor));
	// 真实浏览器不会给 disabled 的按钮派发 click，所以"点不动"由平台保证；这里没有
	// 浏览器，只能退一步验它被标成了禁用项（上面两条），可选项照常能选。
	check("可选项照样能点", (userClick(view.option("不要背景图")), view.calls.length === 1 && view.calls[0] === "none"), `calls=${JSON.stringify(view.calls)}`);
}

out("5) 菜单方向与高度：贴着底边向上弹，空间不够就压矮");
{
	// 视口高 900。触发器 top 700 / bottom 730 → 下方 162px、上方 692px。
	// 下方太窄（< 180），所以向上弹；上方够宽裕，高度照默认上限 260。
	viewportHeight(900);
	rectAt(700, 730);
	const view = mount("file");
	view.toggle();
	const menu = view.menu();
	check("还是渲染出菜单", menu !== null);
	check("下方太窄就向上弹（贴 bottom）", "bottom" in menu.props.style, JSON.stringify(menu.props.style));
	check("上方宽裕时用默认上限 260px", menu.props.style.maxHeight === "260px", String(menu.props.style.maxHeight));
}
{
	// top 700 / bottom 880 → 下方只剩 12px、上方 692px：照样向上弹。
	viewportHeight(900);
	rectAt(700, 880);
	const view = mount("file");
	view.toggle();
	const menu = view.menu();
	check("下方几乎没有空间时仍向上弹", "bottom" in menu.props.style, JSON.stringify(menu.props.style));
}
{
	// top 100 / bottom 130 → 上方 92px、下方 762px：下方宽裕，照常向下弹。
	viewportHeight(900);
	rectAt(100, 130);
	const view = mount("file");
	view.toggle();
	const menu = view.menu();
	check("下方宽裕时向下弹（贴 top）", "top" in menu.props.style, JSON.stringify(menu.props.style));
	check("下方宽裕时用默认上限 260px", menu.props.style.maxHeight === "260px", String(menu.props.style.maxHeight));
}
{
	// 视口压矮到 300：top 150 / bottom 180 → 上方 142、下方 112。
	// 两边都不宽裕：下方 < 180 且上方 > 下方 → 向上弹，高度压到上方剩余空间 142px。
	viewportHeight(300);
	rectAt(150, 180);
	const view = mount("file");
	view.toggle();
	const menu = view.menu();
	check("上下都窄时向上弹", "bottom" in menu.props.style, JSON.stringify(menu.props.style));
	check("高度压到上方的剩余空间 142px", menu.props.style.maxHeight === "142px", String(menu.props.style.maxHeight));
	viewportHeight(900);
}

out(failures === 0 ? "\n全部通过。" : `\n${failures} 条失败。`);
process.exit(failures === 0 ? 0 : 1);
