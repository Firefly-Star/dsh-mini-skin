// Embed the dsh-deep-whale ORCA LINK scene images into mini-skin's client bundle
// as data URIs, in place of the __ART_*__ placeholders. Asserts one occurrence
// per placeholder before writing, so a partially-embedded file is impossible.
import { readFileSync, writeFileSync } from 'node:fs';

const CLONE = 'C:/Users/Summer/Documents/deepseek-harness/default-workspace/dsh-deep-whale/orca-link';
const TARGET = 'C:/Users/Summer/Documents/deepseek-harness/default-workspace/mini-skin/lib/client.js';

const images = {
  __ART_ORCA_LIGHT_HERO__: 'd5fdfd91306d2f3aaa766674d5994be4a014c4dd083d6afd7f90b4947bba6802.webp',
  __ART_ORCA_LIGHT_ACTIVE__: '3605bdd7ccfcc75ca78558f2c958bb3bb35e544cc705f5c15c3653ca21a274d5.webp',
  __ART_ORCA_DARK_HERO__: '5affe6ca90a22227bc020914e4b9d4dc8913a336ffc4a76e17f5b715fa2e0086.webp',
  __ART_ORCA_DARK_ACTIVE__: '905f86159587cb4f168fdc78dac8ac8b53e3271d829f78878ddb0c81d0e33747.webp',
};

let text = readFileSync(TARGET, 'utf8');
for (const [token, file] of Object.entries(images)) {
  const bytes = readFileSync(`${CLONE}/assets/runtime/${file}`);
  const uri = `data:image/webp;base64,${bytes.toString('base64')}`;
  const hits = text.split(token).length - 1;
  if (hits !== 1) {
    console.log(`${token}: found ${hits} occurrence(s), expected 1 -- aborting`);
    process.exit(1);
  }
  text = text.replace(token, uri);
  console.log(`${file.slice(0, 12)}…  ${(bytes.length / 1024).toFixed(1)} KB -> ${(uri.length / 1024).toFixed(1)} KB data URI`);
}
writeFileSync(TARGET, text, 'utf8');
console.log(`written: ${(text.length / 1024).toFixed(1)} KB`);
console.log(`placeholders left: ${(text.match(/__ART_/g) ?? []).length}`);
