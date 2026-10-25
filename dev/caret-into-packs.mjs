#!/usr/bin/env node
/**
 * caret-into-packs.mjs — 把光标那五个键写进 `skins/` 里手维护的皮肤包。
 *
 * 为什么要有这个脚本：`skins/*.json` 是**手维护**的（不是从面板导出的），
 * 它们是在加光标功能之前写的，所以 `modes` 里没有光标键 —— 换到这些皮肤上时
 * 光标只能吃代码里的默认值，包里改不了。这个脚本把字段补齐，之后就能直接
 * 在皮肤文件里改光标（`modes["dark:idle"].caretWidth` 这样）。
 *
 * 关键约束：**不做整包 JSON 重排**。`skins/深海女仆.json` 是 1.8 MB 单行 + 内嵌
 * base64，`JSON.stringify` 一遍会把整包 diff 掉。所以这里只做文本级插入：
 * 在每套预设的 `"characterHeight": N` 后面补五个键，其余字节一个不动。
 *
 * 跑：node dev/caret-into-packs.mjs                     # 写入仓库里的 skins/
 *     node dev/caret-into-packs.mjs --dry-run           # 只看会改什么
 *     node dev/caret-into-packs.mjs --dir <皮肤库目录>   # 顺带补 <DSH_HOME>/mini-skins 里的包
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dirFlag = process.argv.indexOf("--dir");
const targetDir = dirFlag >= 0 ? process.argv[dirFlag + 1] : join(here, "..", "skins");
const PACKS =
	dirFlag < 0
		? ["official.json", "orca-link.json", "深海女仆.json"]
		: readdirSync(targetDir).filter((name) => name.toLowerCase().endsWith(".json")).sort();
if (targetDir === undefined) throw new Error("--dir 后面要跟一个目录");
const PRESET_KEYS = ["dark:idle", "dark:work", "light:idle", "light:work"];

/** 与 dev/new-factory.txt 里的 CARET_MODE_DEFAULTS 保持一致：官方皮肤 = 宿主原样。 */
const CARET_FIELDS = [
	["caretFollowAccent", true],
	["caretColor", "#ffd166"],
	["caretWidth", 1],
	["caretGlow", 0],
	["caretBlink", true],
];

const dryRun = process.argv.includes("--dry-run");
const missing = (mode) => CARET_FIELDS.filter(([name]) => mode[name] === undefined).map(([name]) => name);

let changedFiles = 0;
for (const file of PACKS) {
	const path = join(targetDir, file);
	const raw = readFileSync(path, "utf8");
	const pack = JSON.parse(raw);

	const gaps = PRESET_KEYS.filter((key) => pack.modes?.[key] !== undefined && missing(pack.modes[key]).length > 0);
	if (gaps.length === 0) {
		process.stdout.write(`  skip  ${file}（四套预设都已带光标键）\n`);
		continue;
	}

	// 只补"缺的那几个"，已经手写过的键绝不覆盖。
	const pretty = raw.includes("\n");
	let text = raw;
	for (const key of gaps) {
		const have = CARET_FIELDS.filter(([name]) => pack.modes[key][name] === undefined);
		// 每套预设的结尾固定是 "...characterHeight": N } —— 在它后面接上缺的键最省事，
		// 也保证不会误插到 images 那一段里去（characterHeight 只出现在 modes 里）。
		const pattern = new RegExp(`("${key}": \\{[\\s\\S]*?"characterHeight": [0-9]+)`);
		const found = pattern.exec(text);
		if (found === null) throw new Error(`${file}: 找不到「${key}」的对象结尾（格式变了？）`);
		// 缩进跟着该行的既有缩进走，别把美化过的包插成参差不齐的样子。
		const lastBreak = found[1].lastIndexOf("\n");
		const indent = lastBreak < 0 ? "" : (found[1].slice(lastBreak + 1).match(/^[ \t]*/) ?? [""])[0];
		const separator = pretty ? ",\n" + indent : ", ";
		const fragment = have.map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`).join(separator);
		text = text.slice(0, found.index) + found[1] + separator + fragment + text.slice(found.index + found[1].length);
	}

	// 写入前自检：仍是合法 JSON，且除新增的光标键外没有任何差异。
	const after = JSON.parse(text);
	const added = [];
	for (const key of gaps) for (const name of missing(pack.modes[key])) added.push(`${key}.${name}`);
	for (const key of PRESET_KEYS) {
		const before = { ...pack.modes[key] };
		const now = { ...after.modes[key] };
		for (const name of missing(pack.modes[key])) {
			if (now[name] === undefined) throw new Error(`${file}: ${key}.${name} 没写进去`);
			delete now[name];
		}
		if (JSON.stringify(before) !== JSON.stringify(now)) throw new Error(`${file}: ${key} 除光标外还有其他改动，放弃写入`);
	}
	const keysBefore = Object.keys(pack).join(",");
	if (Object.keys(after).join(",") !== keysBefore) throw new Error(`${file}: 顶层键变了，放弃写入`);

	if (!dryRun) writeFileSync(path, text, "utf8");
	changedFiles += 1;
	process.stdout.write(`  ${dryRun ? "would " : "wrote "}${file}：+${added.length} 个键（${(text.length - raw.length)} 字节）\n`);
}

process.stdout.write(dryRun ? `\n(dry-run) 会改 ${changedFiles} 个文件；去掉 --dry-run 才写。\n` : `\n完成：改了 ${changedFiles} 个文件。\n`);
