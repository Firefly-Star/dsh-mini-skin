// 从皮肤包里导出"图片哈希 -> 皮肤名"对照表，供 probe-state.mjs 判断当前是哪一套皮肤。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKINS = ["orca-link.json", "深海女仆.json"];

const table = {};
for (const file of SKINS) {
	const path = join(HERE, "..", "..", "skins", file);
	let pack;
	try {
		pack = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		console.error(`跳过 ${file}：${error.message}`);
		continue;
	}
	const name = pack.shared?.packName ?? pack.name ?? file;
	for (const [slot, dataUrl] of Object.entries(pack.images ?? {})) {
		const base64 = String(dataUrl).split(",")[1] ?? "";
		const hash = createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex").slice(0, 8);
		table[hash] = name;
		console.log(`${hash}  ${name.padEnd(10)} ${slot}`);
	}
}
const out = join(HERE, "image-hashes.json");
const json = JSON.stringify(table, null, 1);
const { writeFileSync } = await import("node:fs");
writeFileSync(out, json, "utf8");
console.log(`\n已写入 ${out}（${Object.keys(table).length} 条）`);
