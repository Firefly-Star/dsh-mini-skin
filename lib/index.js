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
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const ROUTE = "/api/dsh/mini-skins";
const FORMAT = "dsh-mini-skin-pack";
const MAX_BYTES = 64 * 1024 * 1024;
const FILE_PATTERN = /^[\w\u4e00-\u9fa5.-]{1,80}\.json$/;

const libraryDir = () => {
	const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ""
		? process.env.DSH_HOME
		: join(homedir(), ".dsh");
	return join(home, "mini-skins");
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
						const stem = safeStem(pack.name) === "" ? "skin" : safeStem(pack.name);
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
