// Fails if any file that would be deployed contains a placeholder marker.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const self = fileURLToPath(import.meta.url);
const skipDirs = new Set(['node_modules', '.git', '.wrangler']);
const markers = ['[Gap', '[TODO', '[TBD', '[Placeholder'];
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (skipDirs.has(name)) continue;
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (p === self || st.size > 5_000_000) continue;
    const buf = readFileSync(p);
    if (buf.includes(0)) continue; // binary
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of markers) {
        if (line.includes(m)) hits.push(`${relative(root, p)}:${i + 1}: ${m}`);
      }
    });
  }
}

walk(root);
if (hits.length) {
  console.error('Placeholder markers found. Remove them before deploying:\n' + hits.join('\n'));
  process.exit(1);
}
console.log('check-no-placeholders: clean');
