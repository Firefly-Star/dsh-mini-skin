#!/usr/bin/env node
/**
 * reapply-guard-check.mjs — 一次性验证："用户自己挑的图不会被皮肤包覆盖"这条规则。
 *
 * 背景（这次的 bug）：皮肤包里内嵌的图和用户自己挑的图**存在同一个槽位键下**
 * （`character:light:idle` 之类）。关设置面板时会走 `reapply()`，它会把包里的图写回
 * 存储 —— 等于把用户那张换掉，而页面随后又是从这个槽位读图的，于是"一关面板就变回
 * 皮肤自带的那张"。所以恢复包里的图时必须跳过"用户自己挑过"的槽位。
 *
 * 这个脚本从 lib/client.js 里抠出**真实的** `LOCAL_CHOICE_AT` 与 `userPickedSlots`
 * 来跑，验的就是那张映射表本身（槽位键 ↔ 设置里的字段）。
 *
 * 跑：node dev/reapply-guard-check.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

// 抠出 LOCAL_CHOICE_AT 与 userPickedSlots（以生成物为准，不另抄一份）。
const from = source.indexOf("\t\t/** 槽位 -> 当前设置里");
const to = source.indexOf("\n\t\t/**\n\t\t * 把一个皮肤包里内嵌的本地图片", from);
if (from < 0 || to < 0) throw new Error("在 lib/client.js 里找不到 LOCAL_CHOICE_AT / userPickedSlots（标记变了？）");
const guardSource = source.slice(from, to);

const out = (line) => process.stdout.write(line + "\n");
let failures = 0;
const check = (name, ok, detail = "") => {
	if (ok) out(`  ok   ${name}`);
	else {
		failures += 1;
		out(`  FAIL ${name}${detail === "" ? "" : ` — ${detail}`}`);
	}
};

const sandbox = {};
createContext(sandbox);
const { userPickedSlots, LOCAL_CHOICE_AT } = runInContext(
	`(() => { ${guardSource}\n return { userPickedSlots, LOCAL_CHOICE_AT }; })()`,
	sandbox,
);

const PRESETS = ["dark:idle", "dark:work", "light:idle", "light:work"];
const AREAS = [
	{ area: "canvas", imageKey: "canvasImage", nameKey: "canvasFileName" },
	{ area: "sidebar", imageKey: "sidebarImage", nameKey: "sidebarFileName" },
	{ area: "character", imageKey: "characterImage", nameKey: "characterFileName" },
];

/** 造一份"全是皮肤包原样"的设置：四个预设、三个区域都没被用户碰过。 */
const baseline = () => {
	const settings = {};
	for (const preset of PRESETS) {
		settings[preset] = {
			canvasImage: "dark-hero",
			canvasFileName: "",
			sidebarImage: "maid-left",
			sidebarFileName: "",
			characterImage: "none",
			characterFileName: "",
		};
	}
	return settings;
};

out("1) 映射表覆盖所有 12 个槽位，且每个槽位指向一个真实存在的预设");
{
	const slots = Object.keys(LOCAL_CHOICE_AT);
	check("一共 12 个槽位", slots.length === 12, `n=${slots.length}`);
	check(
		"槽位键与 ART_SLOTS 一致",
		slots.every((slot) => ["canvas", "sidebar", "character"].includes(slot.split(":")[0])),
		slots.join(","),
	);
	check("每个槽位的预设名都是四套之一", slots.every((slot) => PRESETS.includes(LOCAL_CHOICE_AT[slot][0])), JSON.stringify(LOCAL_CHOICE_AT));
	// 槽位里的模式/状态必须和它指向的预设一致，否则保护会张冠李戴。
	const mismatched = slots.filter((slot) => {
		const [area, mode, state] = slot.split(":");
		return LOCAL_CHOICE_AT[slot][0] !== `${mode}:${state}` || !LOCAL_CHOICE_AT[slot][1].startsWith(area);
	});
	check("没有张冠李戴的槽位", mismatched.length === 0, mismatched.join(","));
}

out("2) 包原样（FileName 是空）→ 一个都不保护，恢复时照常覆盖");
{
	check("没有任何保护槽位", userPickedSlots(baseline()).size === 0, [...userPickedSlots(baseline())].join(","));
}

out("3) 用户自己挑了图 → 只保护那一个槽位");
{
	for (const preset of PRESETS) {
		for (const { area, imageKey, nameKey } of AREAS) {
			const settings = baseline();
			settings[preset][imageKey] = "file";
			settings[preset][nameKey] = "我的图.png";
			const picked = userPickedSlots(settings);
			const expected = `${area}:${preset.replace(":", ":")}`;
			check(`只保护 ${expected}`, picked.size === 1 && picked.has(expected), `got=${[...picked].join(",")}`);
		}
	}
}

out("4) 边界：选了 file 但没有文件名 → 不保护（那是包带进来的，也不是用户挑的）");
{
	const settings = baseline();
	settings["light:idle"].characterImage = "file";
	settings["light:idle"].characterFileName = "";
	check("FileName 为空时不保护", userPickedSlots(settings).size === 0, [...userPickedSlots(settings)].join(","));
}

out("5) 边界：内置素材 / 无图 → 不保护（只有 file 才是本地图）");
{
	const settings = baseline();
	settings["light:idle"].characterImage = "none";
	settings["light:idle"].characterFileName = "我的图.png"; // 残留的旧名字不该让槽位被保护
	settings["dark:work"].sidebarImage = "maid-left";
	settings["dark:work"].sidebarFileName = "别的.png";
	check("只按 image === file 判定", userPickedSlots(settings).size === 0, [...userPickedSlots(settings)].join(","));
}

out("6) 多个预设各自挑图 → 各自保护，互不串");
{
	const settings = baseline();
	settings["light:idle"].characterImage = "file";
	settings["light:idle"].characterFileName = "a.png";
	settings["dark:work"].canvasImage = "file";
	settings["dark:work"].canvasFileName = "b.jpg";
	const picked = userPickedSlots(settings);
	check("两个槽位都被保护", picked.size === 2, [...picked].join(","));
	check("包含 light:idle 的顶部图", picked.has("character:light:idle"), [...picked].join(","));
	check("包含 dark:work 的主内容", picked.has("canvas:dark:work"), [...picked].join(","));
	check("没牵连 light:work", !picked.has("character:light:work"), [...picked].join(","));
}

out("7) 缺字段 / 脏数据不炸");
{
	check("空对象不炸", userPickedSlots({}).size === 0);
	check("null 预设不炸", userPickedSlots({ "dark:idle": null }).size === 0);
	check("FileName 是数字时不炸", userPickedSlots({ "light:idle": { characterImage: "file", characterFileName: 7 } }).size === 0);
}

out(failures === 0 ? "\n全部通过。" : `\n${failures} 条失败。`);
process.exit(failures === 0 ? 0 : 1);
