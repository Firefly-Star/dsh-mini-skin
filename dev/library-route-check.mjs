#!/usr/bin/env node
/**
 * library-route-check.mjs — 皮肤库路由（节点半边）的行为验证，不需要 DSH、不需要浏览器。
 *
 * 重点验「保存 / 另存为 / 重命名」依赖的那条新规则：
 *   - POST 不带 file  -> 按包名新建；重名时加时间戳后缀，不覆盖别人的包；
 *   - POST 带 file    -> 覆盖那个文件（保存 / 重命名都靠它）；
 *   - file 只能是目录里的文件名：`../`、子目录、怪字符一律退回"按包名新建"。
 *
 * 做法：把 lib/index.js 的 apply() 挂到一个假 ctx 上，截住它注册的路由，
 * 再用假的 req/res 调这个 handler；DSH_HOME 指向临时目录，不碰真实皮肤库。
 *
 * 跑：node dev/library-route-check.mjs
 */
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const { apply } = await import(new URL("../lib/index.js", import.meta.url).href);

let failures = 0;
const out = (line) => process.stdout.write(line + "\n");
const check = (name, ok, detail = "") => {
	if (ok) out(`  ok   ${name}`);
	else {
		failures += 1;
		out(`  FAIL ${name}${detail === "" ? "" : ` — ${detail}`}`);
	}
};

const home = await mkdtemp(join(tmpdir(), "dsh-mini-skin-route-"));
process.env.DSH_HOME = home;
const dir = join(home, "mini-skins");

let handler = null;
const server = { register: (route) => { handler = route.handler; } };
apply({
	inject: (_deps, fn) => fn({ get: () => server, effect: (run) => { run(); } }),
});
if (handler === null) throw new Error("路由没有注册");

const call = async (method, url, body) => {
	const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
	const req = {
		method,
		url,
		async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; },
	};
	const result = { status: 0, text: "" };
	const res = {
		writeHead(status) { result.status = status; return res; },
		end(text) { result.text = text === undefined ? "" : String(text); },
	};
	await handler(req, res);
	let parsed = null;
	try { parsed = result.text === "" ? null : JSON.parse(result.text); } catch { parsed = result.text; }
	return { status: result.status, body: parsed };
};

const packOf = (name) => ({ format: "dsh-mini-skin-pack", version: 3, name, savedAt: new Date().toISOString(), shared: { packName: name }, modes: {}, images: {} });

out("\n1. 列目录：官方皮肤自动补齐");
{
	const r = await call("GET", "/api/dsh/mini-skins");
	check("GET 返回 200", r.status === 200, String(r.status));
	check("返回目录就是 <DSH_HOME>/mini-skins", r.body !== null && r.body.dir === dir, r.body === null ? "无 body" : r.body.dir);
	const files = r.body === null ? [] : r.body.skins.map((row) => row.file);
	check("official.json 被补出来", files.includes("official.json"), files.join(","));
	const rows = r.body === null ? [] : r.body.skins;
	check("官方皮肤的 name 是那个固定名字", rows.some((row) => row.file === "official.json" && row.ok === true && row.name === "官方皮肤（宿主原样）"));
}

out("\n2. 不带 file：按包名新建，重名不覆盖");
{
	const first = await call("POST", "/api/dsh/mini-skins", { pack: packOf("测试皮肤") });
	check("新建成功并返回文件名", first.status === 200 && typeof first.body.file === "string", JSON.stringify(first.body));
	check("文件名 = 包名", first.body !== null && first.body.file === "测试皮肤.json", first.body === null ? "" : first.body.file);
	const second = await call("POST", "/api/dsh/mini-skins", { pack: packOf("测试皮肤") });
	check("重名时换名而不是覆盖", second.body !== null && second.body.file !== "测试皮肤.json" && second.body.file.startsWith("测试皮肤-"), second.body === null ? "" : second.body.file);
	const names = (await readdir(dir)).sort();
	check("两份包都在", names.includes("测试皮肤.json") && names.includes(second.body.file), names.join(","));
}

out("\n3. 带 file：原地覆盖（保存 / 重命名）");
{
	const r = await call("POST", "/api/dsh/mini-skins", { pack: packOf("改名之后"), file: "测试皮肤.json" });
	check("覆盖返回同一个文件名", r.status === 200 && r.body.file === "测试皮肤.json", JSON.stringify(r.body));
	const saved = JSON.parse(await readFile(join(dir, "测试皮肤.json"), "utf8"));
	check("内容真的被替换了", saved.name === "改名之后", saved.name);
	const names = await readdir(dir);
	check("没有多出文件", names.filter((n) => n.startsWith("测试皮肤")).length === 2, names.join(","));
}

out("\n4. 越界 / 非法 file 一律退回新建");
{
	for (const file of ["../escape.json", "sub/escape.json", "..", "not a name.json", ""]) {
		const r = await call("POST", "/api/dsh/mini-skins", { pack: packOf(`越界 ${file}`), file });
		const name = r.body !== null ? r.body.file : "";
		check(`"${file}" 没有写到目录外`, r.status === 200 && name !== "escape.json" && !String(name).includes("/"), String(name));
		check(`"${file}" 落在皮肤库目录里`, existsSync(join(dir, name)), name);
	}
	check("目录之外没有 escape.json", !existsSync(join(home, "escape.json")));
}

out("\n5. 坏包 / 删除");
{
	const bad = await call("POST", "/api/dsh/mini-skins", { pack: { format: "nope" } });
	check("format 不符被拒（400）", bad.status === 400, String(bad.status));
	const gone = await call("DELETE", "/api/dsh/mini-skins?file=" + encodeURIComponent("测试皮肤.json"));
	check("DELETE 成功", gone.status === 200, String(gone.status));
	check("文件确实删掉了", !existsSync(join(dir, "测试皮肤.json")));
	const missing = await call("DELETE", "/api/dsh/mini-skins");
	check("缺 file 参数被拒（400）", missing.status === 400, String(missing.status));
}

await rm(home, { recursive: true, force: true });
out(failures === 0 ? "\n全部通过。" : `\n${failures} 项失败。`);
process.exit(failures === 0 ? 0 : 1);
