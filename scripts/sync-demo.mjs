// Copies the app's punch animation code into the product site, byte for byte, for the live demo in
// the hero (docs/demo/). The site is its own origin and loads only from 'self', so it cannot use the
// app's files directly. Run after every change to an animation:
//
//   node scripts/sync-demo.mjs          copy (and remove copies whose source is gone)
//   node scripts/sync-demo.mjs --check  only compare; exit 1 when a copy differs or is missing
//
// Not copied: public/js/store.js. fx.js imports it only for pickFx (random, never the same twice), but
// the real store pulls in the database, the API and the crypto. The site has a tiny stand-in at
// docs/demo/app/js/store.js (SHIMS below); test/unit/demo.test.js checks that it picks like the real one.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = 'docs/demo/app';

/** Files written by hand in docs/demo/app (not copies). */
export const SHIMS = ['js/store.js'];

/** Every copy: [source under public/, target under docs/demo/app/] (the same relative path). */
export function copyList(base = root) {
  const files = ['js/punchfx.js', 'js/fx.js', 'js/dom.js', 'punchfx.css'];
  for (const f of readdirSync(join(base, 'public/fx')).sort()) files.push(`fx/${f}`);
  return files.map((f) => [`public/${f}`, `${DEST}/${f}`]);
}

/** Compare every copy with its source; also report files in the target that are neither copy nor shim. */
export function check(base = root) {
  const problems = [];
  const list = copyList(base);
  for (const [src, dst] of list) {
    if (!existsSync(join(base, dst))) problems.push(`missing: ${dst}`);
    else if (!readFileSync(join(base, src)).equals(readFileSync(join(base, dst)))) problems.push(`differs: ${dst}`);
  }
  const known = new Set([...list.map(([, d]) => d), ...SHIMS.map((s) => `${DEST}/${s}`)]);
  const walk = (/** @type {string} */ dir) => {
    if (!existsSync(join(base, dir))) return;
    for (const e of readdirSync(join(base, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (!known.has(p)) problems.push(`stale: ${p}`);
    }
  };
  walk(DEST);
  return problems;
}

function sync() {
  for (const [src, dst] of copyList()) {
    mkdirSync(dirname(join(root, dst)), { recursive: true });
    writeFileSync(join(root, dst), readFileSync(join(root, src)));
  }
  for (const p of check()) {
    if (p.startsWith('stale: ')) rmSync(join(root, p.slice(7)));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = check();
    for (const p of problems) console.error(p);
    process.exit(problems.length ? 1 : 0);
  }
  sync();
  const left = check();
  if (left.length) {
    for (const p of left) console.error(p);
    process.exit(1);
  }
  console.log(`${copyList().length} files in ${DEST} match public/`);
}
