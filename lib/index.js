/**
 * Node half: the plugin's own skin library.
 *
 * Self-contained packs live as JSON files in <DSH_HOME>/mini-skins/. This half owns
 * that directory and exposes it to the browser half over one same-origin route,
 * using the webServer service every host plugin is given:
 *   GET                 -> { dir, skins: [{ file, name, savedAt, bytes, ok, error }] }
 *   GET  ?file=<name>   -> the pack JSON itself
 *   POST { pack }       -> write the pack into the directory
 *   DELETE ?file=<name> -> remove one pack
 * Only *.json directly inside the directory is ever touched: a request may name a
 * file, never a path.
 *
 * It also owns the built-in "官方皮肤" (official skin) pack. That pack is a normal
 * library file -- the browser half never ships its configuration -- and this half
 * (re)installs it whenever the library is read, so a fresh install or a deleted
 * copy heals itself instead of depending on any code-side constant.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const ROUTE = "/api/dsh/mini-skins";
const FORMAT = "dsh-mini-skin-pack";
const MAX_BYTES = 64 * 1024 * 1024;
const FILE_PATTERN = /^[\w\u4e00-\u9fa5.-]{1,80}\.json$/;

/**
 * 官方皮肤 = 宿主原样。它的"原样"是**渲染规则**（撤下本插件的一切），而它的配置
 * 就在这里 —— 一份普通的两套预设包：深色→暗色场景、浅色→亮色场景、侧栏→maid-atelier
 * 立绘，主内容不透明度 52 / 侧栏 100。素材按名字引用（dark-hero / maid-left …），
 * 所以这份文件只有几 KB，不带任何图片字节。
 *
 * 文件名固定为 official.json，入库时也强制落到这个名字：客户端按文件名引用它，
 * 而"按包名自动命名"会把中文名写成另一份，于是库里出现两个官方皮肤、客户端却找不到。
 */
const OFFICIAL_NAME = "官方皮肤（宿主原样）";
const OFFICIAL_FILE = "official.json";
const OFFICIAL_PACK = {
	format: FORMAT,
	version: 3,
	name: OFFICIAL_NAME,
	savedAt: "2026-10-09T00:00:00.000Z",
	shared: { square: true, brandMark: "dsh", linkChip: true, uiFont: "system", sidebarFont: "inherit", packName: OFFICIAL_NAME },
	modes: {
		"dark:idle": { canvasImage: "dark-hero", canvasImageUrl: "", canvasFileName: "", canvasOpacity: 52, sidebarImage: "maid-left", sidebarImageUrl: "", sidebarFileName: "", sidebarOpacity: 100, sidebarOffsetX: 0, sidebarOffsetY: 0, characterImage: "none", characterFileName: "", characterHeight: 0 },
		"dark:work": { canvasImage: "dark-active", canvasImageUrl: "", canvasFileName: "", canvasOpacity: 52, sidebarImage: "maid-left", sidebarImageUrl: "", sidebarFileName: "", sidebarOpacity: 100, sidebarOffsetX: 0, sidebarOffsetY: 0, characterImage: "none", characterFileName: "", characterHeight: 0 },
		"light:idle": { canvasImage: "light-hero", canvasImageUrl: "", canvasFileName: "", canvasOpacity: 52, sidebarImage: "maid-left", sidebarImageUrl: "", sidebarFileName: "", sidebarOpacity: 100, sidebarOffsetX: 0, sidebarOffsetY: 0, characterImage: "none", characterFileName: "", characterHeight: 0 },
		"light:work": { canvasImage: "light-active", canvasImageUrl: "", canvasFileName: "", canvasOpacity: 52, sidebarImage: "maid-left", sidebarImageUrl: "", sidebarFileName: "", sidebarOpacity: 100, sidebarOffsetX: 0, sidebarOffsetY: 0, characterImage: "none", characterFileName: "", characterHeight: 0 },
	},
	images: {},
};

const libraryDir = () => {
	const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ""
		? process.env.DSH_HOME
		: join(homedir(), ".dsh");
	return join(home, "mini-skins");
};

/**
 * 装上官方皮肤包。判据是**包名**而不是文件名：用户可能把它改名或另存过一份，
 * 只要库里已经有一份叫这个名的，就什么都不做（绝不覆盖用户改过的版本）。
 * @returns 是否新写了一份。
 */
const ensureOfficial = async (dir) => {
	const names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith(".json"));
	for (const name of names) {
		try {
			const pack = JSON.parse(await readFile(join(dir, name), "utf8"));
			if (pack !== null && typeof pack === "object" && pack.name === OFFICIAL_NAME) return false;
		} catch {
			/* 坏文件不是一个"已存在的官方皮肤" */
		}
	}
	await writeFile(join(dir, OFFICIAL_FILE), JSON.stringify(OFFICIAL_PACK, null, 1), "utf8");
	return true;
};

const safeStem = (value) => String(value === null || value === undefined ? "" : value)
	.replace(/[^\w\u4e00-\u9fa5.-]+/g, "_")
	.replace(/^\.+/, "")
	.slice(0, 64);

const fileFromRequest = (req) => {
	const raw = new URL(req.url === undefined ? "/" : req.url, "http://localhost").searchParams.get("file");
	if (raw === null) return null;
	const name = basename(raw);
	if (name !== raw || !FILE_PATTERN.test(name)) return null;
	return name;
};

const send = (res, status, body) => {
	const text = typeof body === "string" ? body : JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(text),
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	res.end(text);
};

const readBody = async (req) => {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BYTES) throw new Error("payload too large");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
};

const describe = async (dir, file) => {
	try {
		const info = await stat(join(dir, file));
		const text = await readFile(join(dir, file), "utf8");
		let pack = null;
		let error = null;
		try {
			pack = JSON.parse(text);
		} catch {
			error = "JSON 解析失败";
		}
		if (pack !== null && (typeof pack !== "object" || pack.format !== FORMAT)) error = "不是 mini-skin 皮肤包（format 不符）";
		const named = pack !== null && typeof pack.name === "string" && pack.name !== "" ? pack.name : file.replace(/\.json$/, "");
		return { file, name: named, savedAt: info.mtime.toISOString(), bytes: info.size, ok: error === null, error };
	} catch (error) {
		return { file, name: file.replace(/\.json$/, ""), savedAt: null, bytes: 0, ok: false, error: `读取失败：${error.code === undefined ? error.message : error.code}` };
	}
};

/** Register the skin-library route. */
export function apply(ctx) {
	ctx.inject(["webServer"], (webCtx) => {
		const server = webCtx.get("webServer");
		webCtx.effect(() => server.register({
			kind: "exact",
			path: ROUTE,
			handler: async (req, res) => {
				const dir = libraryDir();
				try {
					if (req.method === "GET") {
						const file = fileFromRequest(req);
						if (file !== null) {
							try {
								send(res, 200, await readFile(join(dir, file), "utf8"));
							} catch (error) {
								send(res, error.code === "ENOENT" ? 404 : 500, { error: `读取失败：${error.code === undefined ? error.message : error.code}` });
							}
							return;
						}
						await mkdir(dir, { recursive: true });
						// 每次列目录都把官方皮肤补齐：全新安装、或用户把它删了，都会自己回来。
						// 只在缺失时写，所以用户改过的那份不会被覆盖。
						try {
							await ensureOfficial(dir);
						} catch {
							/* 装不上就只是列表里没有官方皮肤，不该让整个列表失败 */
						}
						const names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith(".json")).sort();
						const skins = [];
						for (const name of names) skins.push(await describe(dir, name));
						send(res, 200, { dir, skins });
						return;
					}
					if (req.method === "POST") {
						const payload = JSON.parse(await readBody(req));
						const pack = payload !== null && typeof payload === "object" ? payload.pack : null;
						if (pack === null || typeof pack !== "object" || pack.format !== FORMAT) {
							send(res, 400, { error: "不是 mini-skin 皮肤包" });
							return;
						}
						await mkdir(dir, { recursive: true });
						// 官方皮肤包固定落到 official.json（客户端按文件名引用它）；
						// 其余包仍按包名净化成文件名。
						const stem = pack.name === OFFICIAL_NAME ? "official" : safeStem(pack.name) === "" ? "skin" : safeStem(pack.name);
						const existing = new Set(await readdir(dir));
						const file = existing.has(`${stem}.json`) ? `${stem}-${Date.now().toString(36)}.json` : `${stem}.json`;
						await writeFile(join(dir, file), JSON.stringify(pack, null, 1), "utf8");
						send(res, 200, { file, dir });
						return;
					}
					if (req.method === "DELETE") {
						const file = fileFromRequest(req);
						if (file === null) {
							send(res, 400, { error: "缺少合法的 file 参数" });
							return;
						}
						await rm(join(dir, file), { force: true });
						send(res, 200, { file });
						return;
					}
					res.writeHead(405, { allow: "GET, POST, DELETE" }).end();
				} catch (error) {
					send(res, 500, { error: String(error !== null && error !== undefined && error.message !== undefined ? error.message : error) });
				}
			},
		}), "dsh-mini-skin: skin library route");
	});
}
