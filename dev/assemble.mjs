#!/usr/bin/env node
/**
 * Rebuild lib/client.js from the factory source.
 *
 *   lib/client.js  =  <image prefix>  +  new-factory.txt
 *
 * The image prefix (5 embedded images, ~412 KB) is PRESERVED from the current
 * lib/client.js and is regenerated separately by embed-art.mjs. This script is
 * path-relative, so it works from a fresh clone:
 *
 *   node dev/assemble.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const factoryPath = join(here, "new-factory.txt");
const clientPath = join(here, "..", "lib", "client.js");

const current = readFileSync(clientPath, "utf8");
const mark = "window.__ModuleLoader__.load(";
const at = current.indexOf(mark);
if (at < 0) throw new Error("lib/client.js 里找不到 " + mark + "，无法定位图片前缀");
const prefix = current.slice(0, at);
const factory = readFileSync(factoryPath, "utf8").trimEnd() + "\n";
writeFileSync(clientPath, prefix + factory, "utf8");

const count = (text) => (text.match(/data:image\//g) || []).length;
console.log("prefix kept: " + (prefix.length / 1024).toFixed(1) + " KB (" + count(prefix) + " embedded images)");
console.log("factory:     " + (factory.length / 1024).toFixed(1) + " KB");
console.log("written:     " + ((prefix.length + factory.length) / 1024).toFixed(1) + " KB");
