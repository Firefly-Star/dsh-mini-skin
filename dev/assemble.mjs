// Splice the new factory body into mini-skin's client bundle, keeping the header
// and the embedded IMAGES block (with its 230 KB of base64) untouched.
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = 'C:/Users/Summer/Documents/deepseek-harness/default-workspace/mini-skin/lib/client.js';
const FACTORY = 'C:/Users/Summer/Documents/deepseek-harness/default-workspace/_perf-probe/new-factory.txt';

const before = readFileSync(TARGET, 'utf8');
const at = before.indexOf('window.__ModuleLoader__.load({');
if (at < 0) throw new Error('module registration not found in target');
const prefix = before.slice(0, at);
const factory = readFileSync(FACTORY, 'utf8').replace(/\s*$/, '\n');

const after = prefix + factory;
writeFileSync(TARGET, after, 'utf8');
const count = (t, re) => [...t.matchAll(re)].length;
console.log(`prefix kept: ${(prefix.length / 1024).toFixed(1)} KB (${count(prefix, /data:image\/webp;base64,/g)} embedded images)`);
console.log(`factory:     ${(factory.length / 1024).toFixed(1)} KB`);
console.log(`written:     ${(after.length / 1024).toFixed(1)} KB, embedded images: ${count(after, /data:image\/webp;base64,/g)}`);
